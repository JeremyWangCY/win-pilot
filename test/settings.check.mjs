// Config projection and fixed runtime policy; no legacy registration doubles.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import {
  SETTINGS_NAMESPACE,
  WIN_PILOT_SETTINGS_DEFAULTS as DEFAULTS,
  WIN_PILOT_SETTINGS_FIELDS as FIELDS,
  WIN_PILOT_EDITABLE_SETTING_KEYS as KEYS,
  buildSettingsSchema,
  applyConfigSnapshot,
  getSettings,
  installWinPilotSettings,
  loadSchemastery,
  resetSettingsForTest,
  setSettingsForTest,
} from '../lib/settings.js'

assert.match(SETTINGS_NAMESPACE, /^[a-z][a-z0-9-]*$/)
assert.deepEqual(KEYS, ['overlay', 'statusPill', 'browserHeadlessDefault', 'desktopEnvironment'])
assert.deepEqual(FIELDS, [...KEYS.slice(0,3).map((key) => ({ key, type: 'boolean' })), {key:'desktopEnvironment',type:'enum',values:['current','task']}])
assert.equal(DEFAULTS.desktopEnvironment,'current')
assert.equal(DEFAULTS.overlay, true)
assert.equal(DEFAULTS.statusPill, true)
assert.equal(DEFAULTS.browserHeadlessDefault, false)
assert.equal(DEFAULTS.defaultDispatch, 'background')
assert.equal(DEFAULTS.foregroundRecovery, false)
assert.equal(DEFAULTS.includeTextDefault, true)
assert.equal(DEFAULTS.focusPolicy, 'yield')
assert.equal(DEFAULTS.actionTimeoutMs, 20000)
assert.equal(DEFAULTS.waitActionTimeoutMs, 40000)
assert.equal(DEFAULTS.maxBatchActions, 20)

resetSettingsForTest()
assert.deepEqual(getSettings(), DEFAULTS)

// Every old hidden setting is ignored, even when supplied as a reference.
const legacy = Object.fromEntries(Object.keys(DEFAULTS).filter((key) => !KEYS.includes(key)).map((key) => [
  key, { get: () => typeof DEFAULTS[key] === 'boolean' ? !DEFAULTS[key] : 'legacy override' },
]))
applyConfigSnapshot({ ...legacy, allowSystemKeys: false, lockGuard: false, userActivityGuard: false, overlay: false, statusPill: false, browserHeadlessDefault: true })
assert.deepEqual(getSettings(), { ...DEFAULTS, overlay: false, statusPill: false, browserHeadlessDefault: true })

// A volatile-only host edit updates the same reference without remounting.
let current = true
applyConfigSnapshot({ overlay: { get: () => current }, statusPill: 'false', browserHeadlessDefault: 1 })
assert.deepEqual(getSettings(), DEFAULTS, 'only boolean preferences may affect production settings')
current = false
assert.equal(getSettings().overlay, false)
let environment='task'
applyConfigSnapshot({desktopEnvironment:{get:()=>environment}})
assert.equal(getSettings().desktopEnvironment,'task')
environment='invalid'
assert.equal(getSettings().desktopEnvironment,'current')
applyConfigSnapshot(null)
assert.deepEqual(getSettings(), DEFAULTS)

// Tests may still tune runtime limits through the explicit test seam.
setSettingsForTest({ maxBatchActions: 3 })
assert.equal(getSettings().maxBatchActions, 3)
resetSettingsForTest()

const Schema = loadSchemastery()
const host = await import('../lib/index.js')
if (Schema) {
  assert.equal(installWinPilotSettings(), 'config-projected')
  const schema = buildSettingsSchema(Schema)
  for (const Config of [schema, host.Config]) {
    assert.ok(Config, 'the host must export a projectable Config')
    assert.equal(Config.type, 'object')
    assert.deepEqual(Object.keys(Config.dict), KEYS)
    assert.ok(KEYS.every((key) => Config.dict[key].meta.volatile === true))
    const result = Config['~standard'].validate({ overlay: false })
    assert.equal(result.issues, undefined)
    assert.equal(typeof result.value.overlay.get, 'function')
    assert.equal(result.value.overlay.get(), false)
    assert.equal(result.value.statusPill.get(), true)
    assert.equal(result.value.browserHeadlessDefault.get(), false)
    assert.ok(Config['~standard'].validate({ statusPill: 'false' }).issues)
    assert.ok(Config['~standard'].validate({ browserHeadlessDefault: 0 }).issues)
    assert.equal(Config['~standard'].validate({desktopEnvironment:'task'}).value.desktopEnvironment.get(),'task')
    assert.ok(Config['~standard'].validate({desktopEnvironment:'invalid'}).issues)
  }
} else {
  assert.equal(installWinPilotSettings(), 'unavailable')
  assert.equal(host.Config, undefined)
  console.log('settings check NOTE: real schema assertions skipped (volatile-capable schemastery unavailable)')
}

// A hostless CLI/MCP import must stay loadable without a fake schema fallback.
const isolated = spawnSync(process.execPath, ['--input-type=module', '-e', `
  import assert from 'node:assert/strict';
  const host = await import(${JSON.stringify(new URL('../lib/index.js', import.meta.url).href)});
  assert.equal(host.Config, undefined);
`], { encoding: 'utf8', env: { ...process.env, DSH_HOST_MODULES: 'C:/win-pilot-no-host-modules' } })
assert.equal(isolated.status, 0, isolated.stderr || isolated.stdout)

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
assert.deepEqual([...source.matchAll(/\{ key: '([A-Za-z0-9_]+)'/g)].map((match) => match[1]), KEYS)
assert.doesNotMatch(source, /settingsScope|type: 'number'|settings\.plugins\.tab|settings\.plugin\.item/)
resetSettingsForTest()
console.log('settings check PASSED')
