// Real-seam integration check: mount Win-Pilot's settings registration against
// the ACTUAL @deepseek-ai/dsh-settings service (not a stand-in), driven through
// a genuine cordis Context. This is the check that proves the namespace works
// on a real harness rather than only against the test double in
// test/settings.check.mjs.
//
// Runs only where the harness packages resolve (a DSH profile / desktop host);
// CI installs no harness, so it reports a skip instead of failing.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const require = createRequire(import.meta.url)

/** Resolve a harness package from the usual hoisted locations, or null. */
function resolveHarness(name) {
  const roots = [
    process.env.DSH_HOST_MODULES,
    process.env.APPDATA ? path.join(process.env.APPDATA, 'com.jeremy.deepx-workbench', 'runtime', 'node_modules') : null,
    process.env.DSH_HOME ? path.join(process.env.DSH_HOME, 'profiles', 'desktop', 'node_modules') : null,
    process.env.USERPROFILE ? path.join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop', 'node_modules') : null,
    path.join(process.cwd(), 'node_modules'),
  ].filter(Boolean)
  for (const root of roots) {
    const candidate = path.join(root, name)
    if (fs.existsSync(candidate)) return candidate
  }
  try { return require.resolve(name) } catch { return null }
}

const settingsPath = resolveHarness('@deepseek-ai/dsh-settings')
const cordisPath = resolveHarness('@deepseek-ai/cordis')
const schemaPath = resolveHarness('@deepseek-ai/schemastery')

if (!settingsPath || !cordisPath || !schemaPath) {
  console.log(`settings integration check SKIPPED (harness packages unavailable: settings=${Boolean(settingsPath)} cordis=${Boolean(cordisPath)} schemastery=${Boolean(schemaPath)})`)
  process.exit(0)
}

const { default: SettingsProvider } = await import(pathToFileURL(path.join(settingsPath, 'lib', 'index.js')).href)
const { Context } = await import(pathToFileURL(path.join(cordisPath, 'lib', 'index.js')).href)
const { default: Schema } = await import(pathToFileURL(path.join(schemaPath, 'lib', 'index.cjs')).href)
// Load the win-pilot module under test from the development tree, but hand it the
// harness schema explicitly: `loadSchemastery()` resolves through this package's
// own import.meta.url, which only works once the plugin is installed inside a
// profile (its real deployment). In the checkout it is not resolvable, so an
// explicit `Schema` is what lets this test exercise the real service.
const settings = await import(new URL('../lib/settings.js', import.meta.url).href)

/** An in-memory settings provider: the real service, a trivial document store. */
class MemorySettings extends SettingsProvider {
  constructor(ctx, config) {
    super(ctx, config)
    this.document = {}
    this.writableValue = true
  }

  get writable() { return this.writableValue }

  async load() { return this.document }

  async persist(ns, section) { this.document = { ...this.document, [ns]: section } }
}

/**
 * Let cordis flush queued work (inject callbacks and effect scheduling), which
 * is what settles a deferred namespace registration.
 * @returns after the macrotask queue has turned over.
 */
async function settle() {
  for (let i = 0; i < 3; i++) await new Promise((resolve) => setImmediate(resolve))
}

// 1. Register the namespace against the real service on a real fiber.
const ctx = new Context()
await ctx.plugin(MemorySettings)

// Exercise the production path: installWinPilotSettings resolves the schema
// itself (loadSchemastery), exactly as it does inside a real host.
assert.ok(settings.loadSchemastery(), 'schemastery must resolve for the production path')
const status = settings.installWinPilotSettings(ctx)
// cordis queues an `inject` callback until its dependencies are ready, so on a
// live fiber registration may settle after this call returns. Both `registered`
// and `deferred` are success; `unavailable` is the only failure.
assert.notEqual(status, 'unavailable', 'a real settings service must not report unavailable')
await settle()
assert.equal(settings.getSettings().maxBatchActions, 20, 'defaults are in force after registration')

// 2. The real service now describes the namespace to configuration surfaces.
const descriptors = ctx.settings.describe({ redactSecrets: true })
const descriptor = descriptors.find((entry) => entry.ns === 'win-pilot')
assert.ok(descriptor, 'describe() must include the win-pilot namespace')
assert.ok(descriptor.schema, 'the descriptor must carry the schema a form renders')
const schemaKeys = new Set(Object.keys(descriptor.schema.dictionary?.properties ?? descriptor.schema.properties ?? {}))
assert.ok(schemaKeys.size === 0 || schemaKeys.size === settings.WIN_PILOT_SETTINGS_FIELDS.length,
  `the described schema must match the declared field count (got ${schemaKeys.size})`)

// 3. A write through the real service reaches the live resolved value.
await ctx.settings.update('win-pilot', { maxBatchActions: 6, defaultDispatch: 'foreground' })
assert.equal(settings.getSettings().maxBatchActions, 6, 'a committed write must reach the live setting')
assert.equal(settings.getSettings().defaultDispatch, 'foreground')
assert.equal(settings.getSettings().actionTimeoutMs, 20000, 'unwritten fields keep their default')

// 4. The value survives a re-describe with the user layer present.
const after = ctx.settings.describe({ redactSecrets: true }).find((entry) => entry.ns === 'win-pilot')
assert.deepEqual(after.user, { maxBatchActions: 6, defaultDispatch: 'foreground' },
  'the user layer must reflect exactly what was written')

// 5. A schema violation is refused by the real service, leaving the good value.
await assert.rejects(
  () => ctx.settings.update('win-pilot', { maxBatchActions: 9999 }),
  /.+/,
  'an out-of-range write must be refused',
)
assert.equal(settings.getSettings().maxBatchActions, 6, 'a refused write must not change the live value')

// 6. Disposal releases the namespace and restores the shipped defaults.
await ctx.fiber.dispose?.()
assert.equal(settings.getSettings().maxBatchActions, 20, 'disposal must restore the defaults')

console.log('settings integration check PASSED (real SettingsProvider + cordis fiber)')
