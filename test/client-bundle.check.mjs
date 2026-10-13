// The Win-Pilot Settings card is a hand-authored harness client bundle. Nothing
// builds it, so these checks are what keep it loadable and honest: it must parse,
// declare the module contract the client module system serves, expose the plugin
// shape the browser half needs, and degrade instead of throwing on a host that
// serves neither settings seam.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

// --- packaging contract ---------------------------------------------------

assert.equal(packageJson.exports['./client'], './lib/client.js',
  'the client half must be exported at ./client for the module system to serve it')
assert.ok(packageJson.dsh?.client, 'package.json must declare dsh.client to join the client module table')
assert.equal(packageJson.dsh.client.platform, 'web')
assert.ok(Array.isArray(packageJson.dsh.client.inject), 'dsh.client.inject must be an array of package edges')
assert.ok(packageJson.files.includes('lib/*.js'), 'lib/client.js must be packaged')

// The bundle is served as a classic script, not an ES module: the module system
// materializes it from window.__ModuleLoader__.load({ id, factory }).
assert.match(source, /window\.__ModuleLoader__\.load\(\{/, 'bundle must register through window.__ModuleLoader__.load')
assert.match(source, /id:\s*'win-pilot'/, 'the bundle id must be the package name')

// --- load and inspect -----------------------------------------------------

let captured = null
const documentStub = {
  createElement: () => ({ dataset: {}, style: {}, remove() {} }),
  head: { appendChild() {} },
}
const windowStub = { __ModuleLoader__: { load: (options) => { captured = options } } }
// eslint-disable-next-line no-new-func -- the harness executes this file as a script
new Function('window', 'document', source)(windowStub, documentStub)
assert.ok(captured, 'the bundle must call window.__ModuleLoader__.load at evaluation time')

/** Host-provided React surface; the bundle must not import anything else. */
function reactStub() {
  const element = (type, props, ...children) => ({ type, props, children })
  return {
    createElement: element,
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useMemo: (factory) => factory(),
    useCallback: (fn) => fn,
    useRef: (value) => ({ current: value }),
    useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
    Fragment: 'Fragment',
  }
}

const requested = []
const factory = (name) => {
  requested.push(name)
  if (name === 'react') return reactStub()
  if (name === 'react/jsx-runtime') return { jsx: () => ({}), jsxs: () => ({}), Fragment: 'Fragment' }
  throw new Error(`unexpected require: ${name}`)
}

const plugin = captured.factory(factory)
assert.equal(plugin.name, 'win-pilot', 'the browser plugin must carry the package name')
assert.ok(Array.isArray(plugin.inject), 'the browser plugin must declare inject')
assert.equal(typeof plugin.apply, 'function', 'the browser plugin must expose apply')
// Only host-provided modules may be required; a bare import would not resolve.
assert.deepEqual([...new Set(requested)].sort(), ['react'], 'the bundle may require only host-provided react')

// --- apply against each host generation -----------------------------------

/** Record what the plugin registers, and offer a chosen set of client services. */
function harness(services) {
  const registrations = []
  const ctx = {
    get: (name) => services[name],
    effect: (body) => { body(); return () => {} },
    slots: {
      inject: (slot, register) => { register(); return () => {} },
      register: (options, component) => { registrations.push({ options, component }); return () => {} },
    },
  }
  return { ctx, registrations }
}

// Generation A: configForms (DSH >= 0.1.7), keyed by the Loader entry id.
{
  const scope = { getSnapshot: () => ({ value: {}, writable: true, status: 'ready' }), subscribe: () => () => {}, set: async () => {}, unset: async () => {}, load: async () => {} }
  const asked = []
  const { ctx, registrations } = harness({
    configForms: { get: (key) => { asked.push(key); return scope } },
    locale: { getSnapshot: () => ({ active: 'zh' }) },
  })
  plugin.apply(ctx)
  assert.deepEqual(asked, ['win-pilot'], 'configForms must be asked for the win-pilot namespace')
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].options.name, 'settings.section')
  assert.equal(registrations[0].options.id, 'win-pilot')
  assert.equal(typeof registrations[0].component, 'function')
}

// Generation B: settingsScope (DSH 0.1.5/0.1.6), keyed by the namespace.
{
  const bound = []
  const scope = { getSnapshot: () => ({ value: {}, writable: true, status: 'ready' }), subscribe: () => () => {}, set: async () => {}, unset: async () => {}, load: async () => {} }
  const { ctx, registrations } = harness({
    settingsScope: { bind: (spec) => { bound.push(spec.namespace); return scope } },
    locale: { getSnapshot: () => ({ active: 'en' }) },
  })
  plugin.apply(ctx)
  assert.deepEqual(bound, ['win-pilot'], 'settingsScope must be bound to the win-pilot namespace')
  assert.equal(registrations.length, 1)
}

// A host with neither seam still mounts the card and must not throw.
{
  const { ctx, registrations } = harness({})
  assert.doesNotThrow(() => plugin.apply(ctx), 'a host with no settings seam must not throw')
  assert.equal(registrations.length, 1, 'the card still registers so the section is discoverable')
}

// A guarded/absent locale service must not break mounting.
{
  const scope = { getSnapshot: () => ({ value: {}, writable: false, status: 'ready' }), subscribe: () => () => {}, set: async () => {}, unset: async () => {}, load: async () => {} }
  const { ctx, registrations } = harness({ configForms: { get: () => scope } })
  assert.doesNotThrow(() => plugin.apply(ctx))
  assert.equal(registrations.length, 1)
}

// A guarded service getter that throws is treated as absent, not fatal.
{
  const { ctx, registrations } = harness({})
  ctx.get = (name) => { if (name === 'configForms') throw new Error('service not injected'); return undefined }
  assert.doesNotThrow(() => plugin.apply(ctx), 'a guarded service getter must not break mounting')
  assert.equal(registrations.length, 1)
}

// --- rendered card --------------------------------------------------------

/** Reach the registered component through a real apply() call. */
function registeredCard(services) {
  const { ctx, registrations } = harness(services)
  plugin.apply(ctx)
  return registrations[0].component
}

const readyScope = {
  getSnapshot: () => ({ value: {}, writable: true, status: 'ready' }),
  subscribe: () => () => {},
  set: async () => {},
  unset: async () => {},
  load: async () => {},
}

// The component renders rows for a ready scope.
{
  const Card = registeredCard({
    configForms: { get: () => readyScope },
    locale: { getSnapshot: () => ({ active: 'en' }) },
  })
  assert.ok(Card({ scope: readyScope, locale: 'en' }), 'the card renders for a ready scope')
}

// An unavailable scope renders the explanatory note instead of an empty panel.
{
  const unavailable = {
    getSnapshot: () => ({ value: undefined, writable: false, status: 'unavailable' }),
    subscribe: () => () => {},
    set: async () => {},
    unset: async () => {},
    load: async () => {},
  }
  const Card = registeredCard({ configForms: { get: () => unavailable } })
  assert.match(JSON.stringify(Card({ scope: unavailable, locale: 'zh' })), /settings\.yaml/,
    'the unavailable card must point at settings.yaml')
}

console.log('client bundle check PASSED')
