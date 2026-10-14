// Real schema/reference integration. This is not an Electron Loader/UI test.
// The old APPDATA settings.register service is deliberately not used: current
// hosts project plugin Config and edit stable volatile references instead.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import {
  loadSchemastery,
  WIN_PILOT_EDITABLE_SETTING_KEYS as KEYS,
  WIN_PILOT_SETTINGS_DEFAULTS as DEFAULTS,
  applyConfigSnapshot,
  getSettings,
  resetSettingsForTest,
} from '../lib/settings.js'

const Schema = loadSchemastery()
if (!Schema) {
  console.log('settings integration check SKIPPED (current host schema library unavailable; legacy settings.register is not tested)')
  process.exit(0)
}

// Resolve cosmokit alongside the same schema generation; it is the real
// updateVolatile helper used by the current host Loader.
const roots = process.env.DSH_HOST_MODULES ? [process.env.DSH_HOST_MODULES] : [
  path.dirname(fileURLToPath(new URL('../lib/settings.js', import.meta.url))),
  process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'profiles', 'desktop', 'node_modules') : null,
  process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop', 'node_modules') : null,
  process.env.APPDATA ? path.join(process.env.APPDATA, 'com.jeremy.deepx-workbench', 'runtime', 'node_modules') : null,
].filter(Boolean)
let updateVolatile
for (const root of roots) {
  try {
    const req = createRequire(path.join(root, 'noop.js'))
    const mod = req('@deepseek-ai/schemastery')
    if ((mod.default || mod) !== Schema) continue
    const helpers = await import(pathToFileURL(req.resolve('@deepseek-ai/cosmokit')).href)
    updateVolatile = helpers.updateVolatile
    break
  } catch { /* this root does not serve the resolved schema generation */ }
}
assert.equal(typeof updateVolatile, 'function', 'the current schema generation needs a real volatile update helper')

const { Config } = await import('../lib/index.js')
assert.ok(Config)
assert.deepEqual(Object.keys(Config.dict), KEYS)
assert.deepEqual(Object.keys(Config.dict).filter((key) => Config.dict[key].meta.volatile), KEYS)
const parse = (input) => {
  const result = Config['~standard'].validate(input)
  assert.equal(result.issues, undefined)
  return result.value
}
const initial = parse({ overlay: false, statusPill: true, browserHeadlessDefault: false,
  maxBatchActions: 1, allowSystemKeys: false, lockGuard: false, defaultDispatch: 'foreground' })
applyConfigSnapshot(initial)
assert.deepEqual(getSettings(), { ...DEFAULTS, overlay: false })
const edited = parse({ overlay: true, statusPill: false, browserHeadlessDefault: true })
for (const key of KEYS) {
  const reference = initial[key]
  updateVolatile(reference, edited[key])
  assert.equal(initial[key], reference, 'the host updates the existing reference')
}
assert.deepEqual(getSettings(), { ...DEFAULTS, statusPill: false, browserHeadlessDefault: true })
assert.ok(Config['~standard'].validate({ overlay: 'false' }).issues)
assert.equal(getSettings().overlay, true, 'failed validation cannot commit a new value')
resetSettingsForTest()
assert.deepEqual(getSettings(), DEFAULTS)
console.log('settings integration check PASSED (real Config + schemastery/cosmokit volatile references; Electron Loader/UI not exercised)')
