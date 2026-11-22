// Win-Pilot exposes everyday preferences through both the local user config
// file (`~/.win-pilot/config.json`, editable via `win-pilot config`) and the
// DSH host Config. Runtime policy and numeric limits are internal defaults.
import fs from 'node:fs'
import os from 'node:os'
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
  /** Keep acting when the user moves the mouse or types, instead of stopping for a fresh observation. */
  ignoreUserInput: false,
  /** Grace period before the status pill hides after the last action, in ms. */
  statusPillIdleGraceMs: 20000,
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
  /**
   * Let this tool drive Win-Pilot-owned Chromium sessions through `browser_*`.
   *
   * Off by default because many AI agents already ship their own browser
   * control. Turning it off is a user preference, not a runtime failure: every
   * browser_* action and browser postcondition is refused before dispatch, and
   * a headless launch (which exists only to feed that channel) is refused too.
   * Desktop actions keep working, so the tool never becomes unavailable.
   */
  browserControl: false,
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
export const WIN_PILOT_EDITABLE_SETTING_KEYS = Object.freeze(['overlay', 'statusPill', 'browserHeadlessDefault', 'browserControl', 'ignoreUserInput', 'desktopEnvironment', 'remoteControlPolicy'])

/** The complete user settings schema; runtime defaults are not editable fields. */
export const WIN_PILOT_SETTINGS_FIELDS = Object.freeze([
  ...['overlay', 'statusPill', 'browserHeadlessDefault', 'browserControl', 'ignoreUserInput'].map((key) => Object.freeze({ key, type: 'boolean' })),
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

// Lookup tables for CLI/config key resolution (accepts camelCase, kebab-case,
// snake_case, and case-insensitive spellings).
const FIELD_BY_KEY = new Map(WIN_PILOT_SETTINGS_FIELDS.map((field) => [field.key, field]))
const KEY_ALIAS_MAP = new Map()
for (const field of WIN_PILOT_SETTINGS_FIELDS) {
  const canonical = field.key
  const kebab = canonical.replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase())
  const snake = canonical.replace(/[A-Z]/g, (ch) => '_' + ch.toLowerCase())
  KEY_ALIAS_MAP.set(canonical.toLowerCase(), canonical)
  KEY_ALIAS_MAP.set(kebab, canonical)
  KEY_ALIAS_MAP.set(snake, canonical)
}

/**
 * Resolve the user-level Win-Pilot config file path.
 *
 * `WIN_PILOT_CONFIG` overrides the path so individual MCP/CLI agents can point
 * at their own config file if needed; otherwise `~/.win-pilot/config.json` is
 * shared across all standalone agents (Claude Code, Codex, Qoder, Pi, CLI, MCP).
 */
export function getUserConfigPath({ env = process.env, home = os.homedir() } = {}) {
  const explicit = typeof env?.WIN_PILOT_CONFIG === 'string' ? env.WIN_PILOT_CONFIG.trim() : ''
  if (explicit) return path.resolve(explicit)
  return path.join(home, '.win-pilot', 'config.json')
}

/** Resolve a canonical setting key from camelCase, kebab-case, or snake_case. */
export function resolveSettingKey(input) {
  if (typeof input !== 'string') return null
  const normalized = input.trim().toLowerCase()
  return KEY_ALIAS_MAP.get(normalized) || null
}

/** Parse and validate a setting value for an editable field. */
export function parseSettingValue(key, rawValue) {
  const canonical = resolveSettingKey(key)
  if (!canonical) {
    throw new Error(`unknown setting "${key}". Valid keys: ${WIN_PILOT_EDITABLE_SETTING_KEYS.join(', ')}`)
  }
  const field = FIELD_BY_KEY.get(canonical)
  if (field.type === 'boolean') {
    if (typeof rawValue === 'boolean') return rawValue
    if (typeof rawValue === 'string') {
      const token = rawValue.trim().toLowerCase()
      if (['true', '1', 'on', 'yes'].includes(token)) return true
      if (['false', '0', 'off', 'no'].includes(token)) return false
    }
    throw new Error(`setting "${canonical}" requires a boolean (true/false/on/off/1/0)`)
  }
  const normalized = typeof rawValue === 'string' ? rawValue.trim().toLowerCase() : rawValue
  const matched = field.values.find((candidate) => candidate.toLowerCase() === normalized)
  if (matched !== undefined) return matched
  throw new Error(`setting "${canonical}" must be one of: ${field.values.join(', ')}`)
}

/** Extract only valid editable fields from a plain object. */
function filterEditableValues(raw) {
  const values = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return values
  for (const field of WIN_PILOT_SETTINGS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(raw, field.key)) continue
    const value = raw[field.key]
    if (field.type === 'enum' ? field.values.includes(value) : typeof value === 'boolean') {
      values[field.key] = value
    }
  }
  return values
}

/** Read the user config file without throwing on missing or malformed files. */
export function readUserConfig({ configPath, env = process.env } = {}) {
  const filePath = configPath ? path.resolve(configPath) : getUserConfigPath({ env })
  try {
    const rawText = fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '')
    const parsed = JSON.parse(rawText)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { path: filePath, exists: true, values: {}, error: 'config file must contain a JSON object' }
    }
    return { path: filePath, exists: true, values: filterEditableValues(parsed), error: null }
  } catch (cause) {
    if (cause && cause.code === 'ENOENT') {
      return { path: filePath, exists: false, values: {}, error: null }
    }
    return { path: filePath, exists: true, values: {}, error: cause?.message || String(cause) }
  }
}

let userConfigCache = null

/** Clear the cached user config snapshot so the next read checks disk. */
export function invalidateUserConfigCache() {
  userConfigCache = null
}

/** Persist a clean editable-settings map to the user config file. */
export function writeUserConfig(values, { configPath, env = process.env } = {}) {
  const filePath = configPath ? path.resolve(configPath) : getUserConfigPath({ env })
  const clean = filterEditableValues(values)
  const dir = path.dirname(filePath)
  fs.mkdirSync(dir, { recursive: true })
  const payload = JSON.stringify(clean, null, 2) + '\n'
  const tmpPath = path.join(dir, `.config.${process.pid}.${Date.now()}.tmp`)
  try {
    fs.writeFileSync(tmpPath, payload, 'utf8')
    fs.renameSync(tmpPath, filePath)
  } catch {
    try { fs.rmSync(tmpPath, { force: true }) } catch { /* ignore cleanup error */ }
    fs.writeFileSync(filePath, payload, 'utf8')
  }
  invalidateUserConfigCache()
  return { path: filePath, values: clean }
}

/** Set one editable preference in the user config file. */
export function setUserConfigValue(key, rawValue, options = {}) {
  const canonical = resolveSettingKey(key)
  if (!canonical) {
    throw new Error(`unknown setting "${key}". Valid keys: ${WIN_PILOT_EDITABLE_SETTING_KEYS.join(', ')}`)
  }
  const value = parseSettingValue(canonical, rawValue)
  const current = readUserConfig(options)
  if (current.error) throw new Error(`cannot update corrupt config file (${current.path}): ${current.error}`)
  const next = { ...current.values, [canonical]: value }
  const written = writeUserConfig(next, options)
  return {
    path: written.path,
    key: canonical,
    value,
    default: DEFAULTS[canonical],
    overridden: true,
    values: written.values,
  }
}

/** Remove one override from the user config file (restores shipped default). */
export function unsetUserConfigValue(key, options = {}) {
  const canonical = resolveSettingKey(key)
  if (!canonical) {
    throw new Error(`unknown setting "${key}". Valid keys: ${WIN_PILOT_EDITABLE_SETTING_KEYS.join(', ')}`)
  }
  const current = readUserConfig(options)
  if (current.error) throw new Error(`cannot update corrupt config file (${current.path}): ${current.error}`)
  const next = { ...current.values }
  delete next[canonical]
  const written = writeUserConfig(next, options)
  return {
    path: written.path,
    key: canonical,
    value: DEFAULTS[canonical],
    default: DEFAULTS[canonical],
    overridden: false,
    values: written.values,
  }
}

/** Reset all overrides in the user config file to shipped defaults. */
export function resetUserConfig(options = {}) {
  return writeUserConfig({}, options)
}

/** Inspect all editable settings, their effective values, and their sources. */
export function getConfigSummary(options = {}) {
  const file = readUserConfig(options)
  const hasExplicitTarget = Boolean(options.configPath || options.env)
  const effective = hasExplicitTarget
    ? Object.freeze({ ...DEFAULTS, ...file.values })
    : getSettings()
  const activeSource = !hasExplicitTarget && liveConfig ? 'dsh-host' : (file.exists ? 'config' : 'default')
  const fields = WIN_PILOT_SETTINGS_FIELDS.map((field) => {
    const inFile = Object.prototype.hasOwnProperty.call(file.values, field.key)
    const source = !hasExplicitTarget && liveConfig ? 'dsh-host' : (inFile ? 'config' : 'default')
    return {
      key: field.key,
      type: field.type,
      ...(field.values ? { values: [...field.values] } : {}),
      value: effective[field.key],
      default: DEFAULTS[field.key],
      overridden: source === 'config' || effective[field.key] !== DEFAULTS[field.key],
      source,
    }
  })
  return {
    path: file.path,
    exists: file.exists,
    source: activeSource,
    ...(file.error ? { error: file.error } : {}),
    fields,
    settings: Object.fromEntries(WIN_PILOT_EDITABLE_SETTING_KEYS.map((key) => [key, effective[key]])),
  }
}

// The resolved value is held module-wide rather than captured per call: the
// settings document is hot-reloaded, and the helper payload is assembled deep
// inside request paths that have no settings handle of their own. Config
// references expose host edits to the next request.
let testOverride = null
let userConfigSuppressed = false

// The live `Config` the host resolved for this fiber, when it mounted us with
// one. Held so a volatile edit — which the Loader commits into the existing
// references instead of remounting the plugin — is observed on the next read.
let liveConfig = null
let mirrorLiveConfigToUserConfig = false
let lastMirroredSignature = null

/** Mirror non-default editable settings from a live DSH host into `~/.win-pilot/config.json`. */
function maybeMirrorToUserConfig(resolvedValues) {
  if (!mirrorLiveConfigToUserConfig || userConfigSuppressed) return
  const explicitPath = typeof process.env.WIN_PILOT_CONFIG === 'string' ? process.env.WIN_PILOT_CONFIG.trim() : ''
  if (!explicitPath && process.env.WIN_PILOT_NO_USER_CONFIG === '1') return
  const overrides = {}
  for (const field of WIN_PILOT_SETTINGS_FIELDS) {
    if (resolvedValues[field.key] !== DEFAULTS[field.key]) {
      overrides[field.key] = resolvedValues[field.key]
    }
  }
  const signature = JSON.stringify(overrides)
  if (signature === lastMirroredSignature) return
  lastMirroredSignature = signature
  try { writeUserConfig(overrides) } catch { /* never break DSH on read-only disk */ }
}

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

/** Hot-read the user config file with stat-based caching. */
function readCachedUserSettings() {
  if (userConfigSuppressed) return DEFAULTS
  const explicitPath = typeof process.env.WIN_PILOT_CONFIG === 'string' ? process.env.WIN_PILOT_CONFIG.trim() : ''
  if (!explicitPath && process.env.WIN_PILOT_NO_USER_CONFIG === '1') return DEFAULTS
  const filePath = getUserConfigPath()
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch {
    if (userConfigCache?.path === filePath && userConfigCache.missing) return DEFAULTS
    userConfigCache = { path: filePath, missing: true, settings: DEFAULTS }
    return DEFAULTS
  }
  if (
    userConfigCache
    && !userConfigCache.missing
    && userConfigCache.path === filePath
    && userConfigCache.mtimeMs === stat.mtimeMs
    && userConfigCache.size === stat.size
  ) {
    return userConfigCache.settings
  }
  const { values } = readUserConfig({ configPath: filePath })
  const merged = Object.keys(values).length ? Object.freeze({ ...DEFAULTS, ...values }) : DEFAULTS
  userConfigCache = { path: filePath, missing: false, mtimeMs: stat.mtimeMs, size: stat.size, settings: merged }
  return merged
}

/**
 * Current runtime settings; precedence is:
 * 1. Explicit test override (`setSettingsForTest`)
 * 2. Live DSH host `Config` (`applyConfigSnapshot`)
 * 3. User config file (`~/.win-pilot/config.json` or `WIN_PILOT_CONFIG`), hot-reloaded
 * 4. Shipped defaults (`WIN_PILOT_SETTINGS_DEFAULTS`)
 */
export function getSettings() {
  if (testOverride) return testOverride
  if (liveConfig) {
    const next = Object.freeze(readConfigValues(liveConfig, DEFAULTS))
    maybeMirrorToUserConfig(next)
    return next
  }
  return readCachedUserSettings()
}

/** Override runtime defaults for isolated tests; production uses applyConfigSnapshot or user config. */
export function setSettingsForTest(value) {
  liveConfig = null
  mirrorLiveConfigToUserConfig = false
  lastMirroredSignature = null
  userConfigSuppressed = true
  let next = value && typeof value === 'object' ? Object.freeze({ ...DEFAULTS, ...value }) : DEFAULTS
  if (!FIELD_BY_KEY.get('desktopEnvironment').values.includes(next.desktopEnvironment)) {
    next = Object.freeze({ ...next, desktopEnvironment: DEFAULTS.desktopEnvironment })
  }
  if (!FIELD_BY_KEY.get('remoteControlPolicy').values.includes(next.remoteControlPolicy)) {
    next = Object.freeze({ ...next, remoteControlPolicy: DEFAULTS.remoteControlPolicy })
  }
  testOverride = next
}

/** Restore the shipped defaults and isolate from user config. Test seam. */
export function resetSettingsForTest() {
  liveConfig = null
  mirrorLiveConfigToUserConfig = false
  lastMirroredSignature = null
  testOverride = null
  userConfigSuppressed = true
  invalidateUserConfigCache()
}

/** Re-enable live user config file resolution in tests. Test seam. */
export function enableUserConfigForTest() {
  liveConfig = null
  mirrorLiveConfigToUserConfig = false
  lastMirroredSignature = null
  testOverride = null
  userConfigSuppressed = false
  invalidateUserConfigCache()
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
export function applyConfigSnapshot(config, { mirrorToUserConfig = false } = {}) {
  testOverride = null
  if (!config || typeof config !== 'object') {
    liveConfig = null
    mirrorLiveConfigToUserConfig = false
    lastMirroredSignature = null
    return getSettings()
  }
  const next = Object.freeze(readConfigValues(config, DEFAULTS))
  liveConfig = config
  mirrorLiveConfigToUserConfig = Boolean(mirrorToUserConfig)
  lastMirroredSignature = null
  maybeMirrorToUserConfig(next)
  return next
}

/** Compatibility export: current hosts project Config without registration. */
export function installWinPilotSettings() {
  return loadSchemastery() ? 'config-projected' : 'unavailable'
}
