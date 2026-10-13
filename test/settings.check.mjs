// Win-Pilot user settings: schema, defaults, optional registration, and the
// live resolution the host plugin reads on every request.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import {
  SETTINGS_NAMESPACE,
  WIN_PILOT_SETTINGS_DEFAULTS,
  WIN_PILOT_SETTINGS_FIELDS,
  buildSettingsSchema,
  getSettings,
  installWinPilotSettings,
  loadSchemastery,
  resetSettingsForTest,
  setSettingsForTest,
} from '../lib/settings.js'

const require = createRequire(import.meta.url)

// The namespace must satisfy the harness rule (settingsNamespace()).
assert.match(SETTINGS_NAMESPACE, /^[a-z][a-z0-9-]*$/, 'namespace must be lowercase kebab-case')

// Defaults are the shipped behavior: the settings layer adds no behavior on its own.
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.overlay, true)
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.statusPill, true)
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.actionTimeoutMs, 20000)
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.waitActionTimeoutMs, 40000)
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.daemonIdleMs, 300000)
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.hostTimeoutMs, 200000)
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.maxBatchActions, 20)
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.defaultDispatch, 'background')
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.foregroundRecovery, false,
  'implicit foreground escalation must stay off by default')
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.includeTextDefault, false)
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.allowSystemKeys, false)
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.confirmConsequential, false)
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.screenshotMaxBytes, 8388608)
assert.equal(WIN_PILOT_SETTINGS_DEFAULTS.visibleImageHistory, 2)

// Every declared field has a default and a type, so the schema and the docs agree.
for (const field of WIN_PILOT_SETTINGS_FIELDS) {
  assert.ok(field.key in WIN_PILOT_SETTINGS_DEFAULTS, `field ${field.key} must have a default`)
  assert.ok(['boolean', 'number', 'string'].includes(field.type), `field ${field.key} needs a type`)
  if (field.type === 'number') {
    assert.ok(Number.isFinite(field.min) && Number.isFinite(field.max), `field ${field.key} needs bounds`)
    const value = WIN_PILOT_SETTINGS_DEFAULTS[field.key]
    assert.ok(value >= field.min && value <= field.max, `default for ${field.key} must be in range`)
  }
  if (field.type === 'string') assert.ok(field.values.includes(WIN_PILOT_SETTINGS_DEFAULTS[field.key]))
}
assert.deepEqual(
  WIN_PILOT_SETTINGS_FIELDS.map((field) => field.key).sort(),
  Object.keys(WIN_PILOT_SETTINGS_DEFAULTS).sort(),
  'the field table and the defaults must describe the same keys',
)

// Resolution falls back to the shipped defaults while no namespace is registered.
resetSettingsForTest()
assert.deepEqual(getSettings(), WIN_PILOT_SETTINGS_DEFAULTS)

const Schema = loadSchemastery()

// `@deepseek-ai/schemastery` is deliberately NOT a dependency of this package:
// a profile host hoists it, and a standalone CLI/MCP install has no harness.
// CI runs `npm test` without installing anything, so the schema-shape checks run
// against the real library when it is resolvable and are skipped otherwise; the
// registration checks below always run, against a minimal stand-in.
const realSchema = Schema ? buildSettingsSchema(Schema) : null

if (realSchema) {
  // The schema resolves a stored subset onto the defaults.
  const resolved = realSchema['~standard'].validate({ maxBatchActions: 7, defaultDispatch: 'foreground' })
  assert.equal(resolved.issues, undefined)
  assert.equal(resolved.value.maxBatchActions, 7)
  assert.equal(resolved.value.defaultDispatch, 'foreground')
  assert.equal(resolved.value.actionTimeoutMs, 20000, 'unset fields keep their default')

  // Out-of-range and unknown-enum values are rejected rather than silently coerced.
  assert.ok(realSchema['~standard'].validate({ maxBatchActions: 999 }).issues, 'range violation must fail')
  assert.ok(realSchema['~standard'].validate({ defaultDispatch: 'sideways' }).issues, 'enum violation must fail')
  assert.ok(realSchema['~standard'].validate({ actionTimeoutMs: -1 }).issues, 'negative timeout must fail')
}

/**
 * Minimal stand-in for the schemastery surface `buildSettingsSchema` uses, so
 * the registration path is exercised even where the real library is absent.
 */
function stubSchema() {
  const bound = (type, min, max) => {
    const schema = {
      type, min, max,
      default: (value) => ({ ...schema, defaultValue: value, required: false }),
    }
    return schema
  }
  const object = (shape) => ({
    shape,
    '~standard': {
      validate: (input) => {
        const value = {}
        const issues = []
        for (const [key, field] of Object.entries(shape)) {
          const supplied = input && Object.prototype.hasOwnProperty.call(input, key) ? input[key] : undefined
          if (supplied === undefined) { value[key] = field.defaultValue; continue }
          if (field.type === 'boolean' && typeof supplied !== 'boolean') issues.push({ path: [key], message: 'boolean expected' })
          else if (field.type === 'number' && (typeof supplied !== 'number' || supplied < field.min || supplied > field.max)) issues.push({ path: [key], message: 'number out of range' })
          else if (field.type === 'string' && !field.values.includes(supplied)) issues.push({ path: [key], message: 'not an allowed value' })
          value[key] = supplied
        }
        return issues.length > 0 ? { issues } : { value }
      },
    },
  })
  return {
    object,
    boolean: () => bound('boolean'),
    number: () => ({ ...bound('number', 0, 0), min(v) { return { ...this, min: v } }, max(v) { return { ...this, max: v } } }),
    string: () => bound('string'),
    union: (values) => ({ ...bound('string'), values }),
  }
}

// --- registration ---------------------------------------------------------

/** Minimal stand-in for the harness settings service and its owner scope. */
function fakeHarness({ initial = {}, registerImpl } = {}) {
  const state = { watcher: null, dispose: null, registered: null }
  const scope = {
    get: () => ({ ...WIN_PILOT_SETTINGS_DEFAULTS, ...initial }),
    watch: (callback) => { state.watcher = callback; return () => { state.watcher = null } },
  }
  const settingsCtx = {
    settings: {
      register: (ns, sch, opts) => {
        state.registered = { ns, schema: sch, options: opts }
        if (registerImpl) registerImpl(ns)
        return scope
      },
    },
    effect: (body) => { state.dispose = body(); return state.dispose },
  }
  return { state, settingsCtx }
}

// A host that serves ctx.settings registers the namespace and reads it live.
{
  const { state, settingsCtx } = fakeHarness({ initial: { maxBatchActions: 5 } })
  const ctx = { inject: (deps, callback) => { assert.deepEqual(deps, ['settings']); callback(settingsCtx) } }
  assert.equal(installWinPilotSettings(ctx, { Schema: Schema || stubSchema() }), 'registered', 'a host with a settings service registers the namespace')
  assert.equal(state.registered.ns, 'win-pilot')
  assert.equal(getSettings().maxBatchActions, 5, 'a stored value is in force after registration')
  // A committed change re-resolves without re-registering.
  state.watcher({ ...WIN_PILOT_SETTINGS_DEFAULTS, maxBatchActions: 2 })
  assert.equal(getSettings().maxBatchActions, 2, 'watch() must update the resolved value')
  // Disposal restores the defaults so a removed plugin leaves no stale config.
  state.dispose()
  assert.equal(getSettings().maxBatchActions, 20, 'disposal must fall back to the defaults')
}

// A host whose settings callback never runs stays 'deferred' — the namespace is
// simply not registered, and the tool keeps its defaults.
{
  const ctx = { inject: () => {} }
  assert.equal(installWinPilotSettings(ctx, { Schema: Schema || stubSchema() }), 'deferred', 'an unmet inject callback is deferred, not fatal')
  assert.equal(getSettings().maxBatchActions, 20)
}

// A context that cannot inject at all (older host shape) must not throw.
assert.equal(installWinPilotSettings({}, { Schema: Schema || stubSchema() }), 'unavailable', 'a context with no inject seam is unavailable')

// A host where the schema library is unresolvable keeps the defaults.
{
  const { state, settingsCtx } = fakeHarness()
  const ctx = { inject: (deps, callback) => callback(settingsCtx) }
  assert.equal(installWinPilotSettings(ctx, { Schema: null }), 'unavailable', 'an unresolvable schema library disables only the settings layer')
  assert.equal(state.registered, null, 'no schema means no registration')
  assert.equal(getSettings().maxBatchActions, 20)
}

// A settings service without register() is tolerated rather than fatal.
{
  const ctx = { inject: (deps, callback) => callback({ settings: {} }) }
  assert.equal(installWinPilotSettings(ctx, { Schema: Schema || stubSchema() }), 'unavailable', 'a settings service without register() is unavailable, not fatal')
}

// Registration failures propagate so a broken namespace is loud, not silent.
{
  const { settingsCtx } = fakeHarness({ registerImpl: () => { throw new Error('namespace taken') } })
  const ctx = { inject: (deps, callback) => callback(settingsCtx) }
  assert.throws(() => installWinPilotSettings(ctx, { Schema: Schema || stubSchema() }), /namespace taken/)
}

// Test seams restore a clean module state for the rest of the suite.
setSettingsForTest({ maxBatchActions: 3 })
assert.equal(getSettings().maxBatchActions, 3)
resetSettingsForTest()
assert.deepEqual(getSettings(), WIN_PILOT_SETTINGS_DEFAULTS)

// The client bundle must offer exactly the fields the host schema accepts.
{
  const source = await import('node:fs').then((fs) => fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8'))
  const declared = [...source.matchAll(/\{ key: '([A-Za-z0-9_]+)'/g)].map((match) => match[1]).sort()
  assert.deepEqual(declared, Object.keys(WIN_PILOT_SETTINGS_DEFAULTS).sort(),
    'the Settings card must not offer a field the host schema would reject, or hide one it accepts')
}

console.log('settings check PASSED')
