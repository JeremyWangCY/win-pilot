// Win-Pilot user settings.
//
// The harness exposes one user-settings document (`$DSH_HOME/settings.yaml`,
// hot-reloaded) whose sections are owned by plugins through `ctx.settings`.
// Registering a namespace is what makes a knob user-editable: schema defaults,
// then the composition `base`, then the user section resolve into one value.
//
// The settings service is an OPTIONAL seam. A headless profile, an older
// harness, or a host without `dsh-settings-file` must leave Win-Pilot exactly
// as it behaves today, so registration happens behind `ctx.inject(['settings'])`
// and every read falls back to {@link WIN_PILOT_SETTINGS_DEFAULTS}. Nothing in
// this module throws when the seam is absent.
import { createRequire } from 'node:module'
import path from 'node:path'

/** Settings namespace owned by this plugin (lowercase kebab-case, per the harness rule). */
export const SETTINGS_NAMESPACE = 'win-pilot'

/**
 * The user-editable subset of Win-Pilot's runtime configuration.
 *
 * Every field defaults to the constant Win-Pilot shipped before this namespace
 * existed, so registering the namespace changes no behavior on its own.
 */
export const WIN_PILOT_SETTINGS_DEFAULTS = Object.freeze({
  /** Draw the click-through virtual cursor glyph and the "running" status pill. */
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
  includeTextDefault: false,
  /** Largest PNG attached to a model turn, in bytes. */
  screenshotMaxBytes: 8388608,
  /** How many Win-Pilot screenshots stay in active visual context. */
  visibleImageHistory: 2,
  /** Refuse desktop input while the workstation is locked. */
  lockGuard: true,
  /**
   * What Win-Pilot does when an action moves keyboard focus away from the
   * window the user was using.
   *
   * - `yield` (default): report the change and stop; never touch focus again.
   *   Matches the reference implementations, which detect user/foreground
   *   changes and hand control back rather than competing for it.
   * - `restore`: attempt a best-effort non-preemptive restore of the window the
   *   user had focused (the previous behavior).
   * - `never`: never observe or act on focus at all.
   */
  focusPolicy: 'yield',
  /** Refuse to run while another live Win-Pilot session owns input. */
  exclusiveControl: false,
  /** Allow Windows/Meta/Command system keys. Denied by default. */
  allowSystemKeys: false,
  /** Mark consequential targets as requiring confirmation in the result payload. */
  confirmConsequential: false,
  /** Launch Chromium sessions headless by default. */
  browserHeadlessDefault: false,
  /** Per-CDP-command timeout in ms for browser actions. */
  browserCommandTimeoutMs: 12000,
  /** Post-click network evidence wait in ms for `browser_click` with `capture_network`. */
  browserCaptureNetworkWaitMs: 1500,
})

const DEFAULTS = WIN_PILOT_SETTINGS_DEFAULTS

/** Schema shape as plain data, for tests and the browser bundle (no schemastery import). */
export const WIN_PILOT_SETTINGS_FIELDS = Object.freeze([
  { key: 'overlay', type: 'boolean' },
  { key: 'statusPill', type: 'boolean' },
  { key: 'statusPillIdleGraceMs', type: 'number', min: 0, max: 600000 },
  { key: 'actionTimeoutMs', type: 'number', min: 1000, max: 600000 },
  { key: 'waitActionTimeoutMs', type: 'number', min: 1000, max: 600000 },
  { key: 'daemonIdleMs', type: 'number', min: 1000, max: 86400000 },
  { key: 'hostTimeoutMs', type: 'number', min: 1000, max: 3600000 },
  { key: 'maxBatchActions', type: 'number', min: 1, max: 200 },
  { key: 'defaultDispatch', type: 'string', values: ['background', 'foreground'] },
  { key: 'foregroundRecovery', type: 'boolean' },
  { key: 'observeAfterAction', type: 'boolean' },
  { key: 'includeTextDefault', type: 'boolean' },
  { key: 'screenshotMaxBytes', type: 'number', min: 65536, max: 67108864 },
  { key: 'visibleImageHistory', type: 'number', min: 0, max: 8 },
  { key: 'lockGuard', type: 'boolean' },
  { key: 'focusPolicy', type: 'string', values: ['yield', 'restore', 'never'] },
  { key: 'exclusiveControl', type: 'boolean' },
  { key: 'allowSystemKeys', type: 'boolean' },
  { key: 'confirmConsequential', type: 'boolean' },
  { key: 'browserHeadlessDefault', type: 'boolean' },
  { key: 'browserCommandTimeoutMs', type: 'number', min: 2000, max: 30000 },
  { key: 'browserCaptureNetworkWaitMs', type: 'number', min: 0, max: 10000 },
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
 * so the known harness runtime roots are tried as well — the same fallback shape
 * `loadDefineToolSync` uses for `@deepseek-ai/dsh-tools`.
 * @returns the schemastery default export, or null when unavailable.
 */
export function loadSchemastery() {
  const candidates = []
  if (process.env.DSH_HOST_MODULES) candidates.push(process.env.DSH_HOST_MODULES)
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'com.jeremy.deepx-workbench', 'runtime', 'node_modules'))
  }
  for (const candidate of candidates) {
    try {
      const req = createRequire(path.join(candidate, 'noop.js'))
      const mod = req('@deepseek-ai/schemastery')
      const Schema = mod?.default || mod
      if (Schema) return Schema
    } catch { /* try the next root */ }
  }
  try {
    const req = createRequire(import.meta.url)
    const mod = req('@deepseek-ai/schemastery')
    return mod?.default || mod || null
  } catch {
    return null
  }
}

/**
 * Build the schemastery schema for {@link SETTINGS_NAMESPACE}.
 *
 * Every field is optional with a default, so a stored section may name any
 * subset and the rest resolve from {@link WIN_PILOT_SETTINGS_DEFAULTS}.
 * @param Schema - the schemastery default export.
 * @returns the runtime schema handed to `settings.register`.
 */
export function buildSettingsSchema(Schema) {
  const number = (min, max) => Schema.number().min(min).max(max)
  return Schema.object({
    overlay: Schema.boolean().default(DEFAULTS.overlay),
    statusPill: Schema.boolean().default(DEFAULTS.statusPill),
    statusPillIdleGraceMs: number(0, 600000).default(DEFAULTS.statusPillIdleGraceMs),
    actionTimeoutMs: number(1000, 600000).default(DEFAULTS.actionTimeoutMs),
    waitActionTimeoutMs: number(1000, 600000).default(DEFAULTS.waitActionTimeoutMs),
    daemonIdleMs: number(1000, 86400000).default(DEFAULTS.daemonIdleMs),
    hostTimeoutMs: number(1000, 3600000).default(DEFAULTS.hostTimeoutMs),
    maxBatchActions: number(1, 200).default(DEFAULTS.maxBatchActions),
    defaultDispatch: Schema.union(['background', 'foreground']).default(DEFAULTS.defaultDispatch),
    foregroundRecovery: Schema.boolean().default(DEFAULTS.foregroundRecovery),
    observeAfterAction: Schema.boolean().default(DEFAULTS.observeAfterAction),
    includeTextDefault: Schema.boolean().default(DEFAULTS.includeTextDefault),
    screenshotMaxBytes: number(65536, 67108864).default(DEFAULTS.screenshotMaxBytes),
    visibleImageHistory: number(0, 8).default(DEFAULTS.visibleImageHistory),
    lockGuard: Schema.boolean().default(DEFAULTS.lockGuard),
    focusPolicy: Schema.union(['yield', 'restore', 'never']).default(DEFAULTS.focusPolicy),
    exclusiveControl: Schema.boolean().default(DEFAULTS.exclusiveControl),
    allowSystemKeys: Schema.boolean().default(DEFAULTS.allowSystemKeys),
    confirmConsequential: Schema.boolean().default(DEFAULTS.confirmConsequential),
    browserHeadlessDefault: Schema.boolean().default(DEFAULTS.browserHeadlessDefault),
    browserCommandTimeoutMs: number(2000, 30000).default(DEFAULTS.browserCommandTimeoutMs),
    browserCaptureNetworkWaitMs: number(0, 10000).default(DEFAULTS.browserCaptureNetworkWaitMs),
  })
}

// The resolved value is held module-wide rather than captured per call: the
// settings document is hot-reloaded, and the helper payload is assembled deep
// inside request paths that have no settings handle of their own. A watcher
// keeps this current, so a stored edit takes effect on the next request.
let resolved = DEFAULTS

/** Current resolved settings; the shipped defaults whenever no namespace is registered. */
export function getSettings() {
  return resolved
}

/** Overwrite the resolved value. Test seam; production updates flow through `watch`. */
export function setSettingsForTest(value) {
  resolved = value && typeof value === 'object' ? Object.freeze({ ...DEFAULTS, ...value }) : DEFAULTS
}

/** Restore the shipped defaults. Test seam. */
export function resetSettingsForTest() {
  resolved = DEFAULTS
}

/**
 * Register the Win-Pilot settings namespace when the harness serves one.
 *
 * Registration rides the calling plugin's fiber, so disposing Win-Pilot removes
 * the namespace and its watcher. Without a settings service this is a no-op and
 * {@link getSettings} keeps returning {@link WIN_PILOT_SETTINGS_DEFAULTS}.
 *
 * cordis queues an `inject` callback until its declared dependencies are ready,
 * so on a live fiber registration can settle AFTER this function returns. The
 * return value therefore reports only what is knowable synchronously:
 * `'registered'` (settled immediately), `'deferred'` (the callback is queued and
 * will run when the service mounts), or `'unavailable'` (no injection seam, so
 * no namespace will ever be registered).
 * @param ctx - the host plugin context.
 * @param options - injection seam for tests; `Schema` overrides resolution.
 * @returns the synchronous registration status.
 */
export function installWinPilotSettings(ctx, options = {}) {
  const inject = options.inject || (typeof ctx?.inject === 'function' ? ctx.inject.bind(ctx) : null)
  if (typeof inject !== 'function') return 'unavailable'
  let status = 'deferred'
  inject(['settings'], (settingsCtx) => {
    const settings = settingsCtx?.settings
    if (!settings || typeof settings.register !== 'function') {
      status = 'unavailable'
      return
    }
    // An explicitly supplied `Schema` (including null) wins; otherwise the host's
    // resolution path is tried. A host without a resolvable schema library keeps
    // the defaults — the tool itself must never fail to load because a settings
    // surface cannot.
    const Schema = 'Schema' in options ? options.Schema : loadSchemastery()
    if (!Schema) {
      status = 'unavailable'
      return
    }
    // Namespace syntax is validated by the harness; mirror it here so a bad
    // constant fails at registration instead of silently never being served.
    if (!/^[a-z][a-z0-9-]*$/.test(SETTINGS_NAMESPACE)) {
      throw new TypeError(`settings namespace "${SETTINGS_NAMESPACE}" must match /^[a-z][a-z0-9-]*$/`)
    }
    const scope = settings.register(SETTINGS_NAMESPACE, buildSettingsSchema(Schema), { base: {} })
    // `watch` hands the committed value directly; the initial call reads the
    // scope so a stored section is in force before the first request.
    const sync = (next) => {
      const value = next === undefined ? scope.get() : next
      resolved = value && typeof value === 'object' ? value : DEFAULTS
    }
    sync()
    settingsCtx.effect?.(() => {
      const stop = scope.watch(sync)
      return () => {
        stop()
        resolved = DEFAULTS
      }
    }, 'win-pilot.settings()')
    status = 'registered'
  })
  return status
}
