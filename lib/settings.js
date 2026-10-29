// Win-Pilot exposes everyday preferences through the host Config.
// Runtime policy and numeric limits are internal defaults, not user settings.
import { createRequire } from 'node:module'
import path from 'node:path'

/** Settings namespace owned by this plugin (lowercase kebab-case, per the harness rule). */
export const SETTINGS_NAMESPACE = 'win-pilot'

/** Internal runtime defaults and editable preferences. */
export const WIN_PILOT_SETTINGS_DEFAULTS = Object.freeze({
  /** Draw the click-through virtual cursor glyph. */
  overlay: true,
  /** Show the top-center status pill while a Win-Pilot action is in flight. */
  statusPill: true,
  /** Grace period before the status pill hides after the last action, in ms. */
  statusPillIdleGraceMs: 5000,
  /** Per-action helper timeout in ms. */
  actionTimeoutMs: 20000,
  /** Timeout for the `wait` action in ms. */
  waitActionTimeoutMs: 40000,
  /** Idle time before the persistent PowerShell helper daemon is stopped, in ms. */
  daemonIdleMs: 300000,
  /** Model-facing tool call budget in ms. */
  hostTimeoutMs: 200000,
  /** Maximum actions accepted in one `actions` batch. */
  maxBatchActions: 20,
  /** Dispatch used when a request does not name one. */
  defaultDispatch: 'background',
  /** Whether a background refusal may be retried once in the foreground without an explicit `recovery`. */
  foregroundRecovery: false,
  /** Whether an action automatically captures a post-action observation. */
  observeAfterAction: true,
  /** Whether `get_window_state` captures the UIA tree when `include_text` is omitted. */
  includeTextDefault: true,
  /** Largest PNG attached to a model turn, in bytes. */
  screenshotMaxBytes: 8388608,
  /** How many Win-Pilot screenshots stay in active visual context. */
  visibleImageHistory: 2,
  /**
   * What Win-Pilot does when an action moves keyboard focus away from the
   * window the user was using.
   *
   * - `yield` (default): report the change and stop; never touch focus again.
   *   A user-caused foreground change is a valid action, so control is
   *   handed back rather than contested.
   * - `restore`: attempt a best-effort non-preemptive restore of the window the
   *   user had focused (the previous behavior).
   * - `never`: never observe or act on focus at all.
   */
  focusPolicy: 'yield',
  /** Refuse to run while another live Win-Pilot session owns input. */
  exclusiveControl: false,
  /** Mark consequential targets as requiring confirmation in the result payload. */
  confirmConsequential: false,
  /** Launch Chromium sessions headless by default. */
  browserHeadlessDefault: false,
  /** Desktop environment selected for the next computer-use operation. */
  desktopEnvironment: 'current',
  /**
   * What the task desktop does when a remote-control product is attached
   * (UU remote, RDP, and the like).
   *
   * - `fallback` (default): use the current desktop for this run and say so.
   *   The user's remote screen never follows the AI desktop.
   * - `refuse`: stop and report; nothing runs on either desktop.
   *
   * Neither choice creates a child session, so the remote screen cannot move.
   */
  remoteControlPolicy: 'fallback',
  /** Per-CDP-command timeout in ms for browser actions. */
  browserCommandTimeoutMs: 12000,
  /** Post-click network evidence wait in ms for `browser_click` with `capture_network`. */
  browserCaptureNetworkWaitMs: 1500,
})

const DEFAULTS = WIN_PILOT_SETTINGS_DEFAULTS

/** Only everyday preferences are projected into the settings panel. */
export const WIN_PILOT_EDITABLE_SETTING_KEYS = Object.freeze(['overlay', 'statusPill', 'browserHeadlessDefault', 'desktopEnvironment', 'remoteControlPolicy'])

/** The complete user settings schema; runtime defaults are not editable fields. */
export const WIN_PILOT_SETTINGS_FIELDS = Object.freeze([
  ...['overlay', 'statusPill', 'browserHeadlessDefault'].map((key) => Object.freeze({ key, type: 'boolean' })),
  Object.freeze({ key: 'desktopEnvironment', type: 'enum', values: Object.freeze(['current', 'task']) }),
  Object.freeze({ key: 'remoteControlPolicy', type: 'enum', values: Object.freeze(['fallback', 'refuse']) }),
])

/**
 * Load the harness schema library through the host's resolution path.
 *
 * Win-Pilot deliberately does not declare `@deepseek-ai/schemastery` as a hard
 * dependency: a profile host hoists it, and a standalone CLI/MCP install has no
 * harness at all. Resolution failure is a normal outcome that disables only the
 * user-editable layer, never the tool.
 *
 * A package-manager layout does not always hoist the library beside this plugin,
 * so profile and runtime roots are checked for the current volatile-capable build.
 * @returns the schemastery default export, or null when unavailable.
 */
export function loadSchemastery() {
  const roots = process.env.DSH_HOST_MODULES ? [process.env.DSH_HOST_MODULES] : [
    null,
    process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'profiles', 'desktop', 'node_modules') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop', 'node_modules') : null,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'com.jeremy.deepx-workbench', 'runtime', 'node_modules') : null,
  ]
  for (const root of new Set(roots)) {
    const Schema = resolveSchemastery(root)
    // Hot updates require actual volatile references (schemastery 3.18.4).
    if (hasVolatileSupport(Schema)) return Schema
  }
  return null
}

/** Resolve `@deepseek-ai/schemastery` from one root; `null` means this module. */
function resolveSchemastery(root) {
  try {
    const req = root === null ? createRequire(import.meta.url) : createRequire(path.join(root, 'noop.js'))
    const mod = req('@deepseek-ai/schemastery')
    return mod?.default || mod || null
  } catch {
    return null
  }
}

/** Does this schemastery build expose the `volatile()` field helper? */
function hasVolatileSupport(Schema) {
  try {
    return typeof Schema?.boolean?.()?.volatile === 'function'
  } catch {
    return false
  }
}

/** Build the Config schema projected by the current host. */
export function buildSettingsSchema(Schema) {
  return Schema.object(Object.fromEntries(WIN_PILOT_SETTINGS_FIELDS.map((field) => {
    const schema = field.type === 'enum' ? Schema.union(field.values) : Schema.boolean()
    return [field.key, schema.default(DEFAULTS[field.key]).volatile()]
  })))
}

// The resolved value is held module-wide rather than captured per call: the
// settings document is hot-reloaded, and the helper payload is assembled deep
// inside request paths that have no settings handle of their own. Config
// references expose host edits to the next request.
let resolved = DEFAULTS

// The live `Config` the host resolved for this fiber, when it mounted us with
// one. Held so a volatile edit — which the Loader commits into the existing
// references instead of remounting the plugin — is observed on the next read.
let liveConfig = null

/** Read the declared fields out of a resolved config, dereferencing volatile refs. */
function readConfigValues(config, base) {
  const next = { ...base }
  for (const field of WIN_PILOT_SETTINGS_FIELDS) {
    const { key } = field
    if (!Object.prototype.hasOwnProperty.call(config, key)) continue
    const raw = config[key]
    const value = raw && typeof raw === 'object' && typeof raw.get === 'function' ? raw.get() : raw
    if (field.type === 'enum' ? field.values.includes(value) : typeof value === 'boolean') next[key] = value
  }
  return next
}

/**
 * Current runtime settings; shipped defaults when no host Config is applied.
 *
 * With a live host `Config` this re-reads every call, because a volatile field is
 * a reference the Loader updates in place (`updateVolatile`), and caching it here
 * would pin the value the plugin started with.
 */
export function getSettings() {
  if (liveConfig) return Object.freeze(readConfigValues(liveConfig, DEFAULTS))
  return resolved
}

/** Override runtime defaults for isolated tests; production uses applyConfigSnapshot. */
export function setSettingsForTest(value) {
  liveConfig = null
  resolved = value && typeof value === 'object' ? Object.freeze({ ...DEFAULTS, ...value }) : DEFAULTS
  if (!WIN_PILOT_SETTINGS_FIELDS.find((field) => field.key === 'desktopEnvironment').values.includes(resolved.desktopEnvironment)) {
    resolved = Object.freeze({ ...resolved, desktopEnvironment: DEFAULTS.desktopEnvironment })
  }
  if (!WIN_PILOT_SETTINGS_FIELDS.find((field) => field.key === 'remoteControlPolicy').values.includes(resolved.remoteControlPolicy)) {
    resolved = Object.freeze({ ...resolved, remoteControlPolicy: DEFAULTS.remoteControlPolicy })
  }
}

/** Restore the shipped defaults. Test seam. */
export function resetSettingsForTest() {
  liveConfig = null
  resolved = DEFAULTS
}

/**
 * Adopt the values the host resolved for this plugin's `Config` schema.
 *
 * The host validates the stored patch through the exported schema and either
 * remounts the plugin or, for a volatile-only change, commits the new values
 * into the live references in place. Either way a `volatile()` field arrives as
 * a reference object (`{ get() }`) rather than a plain value, which is why this
 * reads through `get()` when it is present. Only the declared boolean and enum
 * preferences are accepted; legacy policy values are ignored.
 *
 * Writes are ignored: the harness owns the document, and a settings surface that
 * could mutate the shipped defaults would make a read-only host lie about what
 * is in force.
 * @param config - the resolved config object handed to `apply(ctx, config)`.
 * @returns the resolved settings now in force.
 */
export function applyConfigSnapshot(config) {
  if (!config || typeof config !== 'object') {
    liveConfig = null
    resolved = DEFAULTS
    return resolved
  }
  const next = Object.freeze(readConfigValues(config, DEFAULTS))
  liveConfig = config
  resolved = next
  return resolved
}

/** Compatibility export: current hosts project Config without registration. */
export function installWinPilotSettings() {
  return loadSchemastery() ? 'config-projected' : 'unavailable'
}
