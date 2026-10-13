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

/**
 * Minimal but stateful React stand-in.
 *
 * The card's real behaviour is validation, draft staging, the *Overridden*
 * badge, save and reset — none of which a stateless stub can exercise. Hooks
 * persist across re-renders and a setter re-renders synchronously, so a test can
 * fire an onChange/onClick and inspect the next tree.
 *
 * `createReact()` returns an INDEPENDENT renderer per call: the plugin's `apply`
 * runs before any component mounts, and a setter fired while nothing is mounted
 * must be a no-op rather than a crash.
 */
function createReact() {
  let hooks = []
  let cursor = 0
  let component = null
  let props = null
  let tree = null

  const element = (type, propsArg, ...children) => ({ type, props: propsArg || {}, children })
  const render = () => {
    if (typeof component !== 'function') return tree
    cursor = 0
    tree = component(props)
    return tree
  }
  const schedule = () => {
    if (typeof component === 'function') render()
  }

  const api = {
    createElement: element,
    useState(initial) {
      const index = cursor++
      if (hooks.length <= index) hooks[index] = typeof initial === 'function' ? initial() : initial
      const set = (next) => {
        hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
        schedule()
      }
      return [hooks[index], set]
    },
    useEffect(body) {
      const index = cursor++
      if (!hooks[index]) hooks[index] = { cleanup: body() }
    },
    useMemo(factory) { cursor++; return factory() },
    useCallback(fn) { cursor++; return fn },
    useRef(value) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: value }
      return hooks[index]
    },
    useSyncExternalStore(_subscribe, getSnapshot) { cursor++; return getSnapshot() },
    Fragment: 'Fragment',
  }

  return {
    api,
    mount(nextComponent, nextProps) {
      component = nextComponent
      props = nextProps
      hooks = []
      return render()
    },
    rerender() { return render() },
    get tree() { return tree },
  }
}

/** Flatten a rendered tree into a list of elements, depth-first. */
function flatten(node, out = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return out
  if (Array.isArray(node)) {
    for (const child of node) flatten(child, out)
    return out
  }
  if (typeof node === 'object') {
    out.push(node)
    for (const child of node.children ?? []) flatten(child, out)
    return out
  }
  out.push({ type: '#text', props: {}, children: [], text: String(node) })
  return out
}

/** Every string rendered anywhere in the tree — labels, badges, status copy. */
function texts(tree) {
  const found = []
  const walk = (node) => {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (Array.isArray(node)) { for (const child of node) walk(child); return }
    if (typeof node === 'object') {
      if (typeof node.text === 'string') found.push(node.text)
      for (const child of node.children ?? []) walk(child)
      return
    }
    if (typeof node === 'string' || typeof node === 'number') found.push(String(node))
  }
  walk(tree)
  return found
}

/** Find the first element matching a predicate. */
function find(tree, predicate) {
  return flatten(tree).find((node) => node.type !== '#text' && predicate(node))
}

// The field table the host schema accepts, read from lib/settings.js so the two
// can never drift; the card must render exactly these controls.
const { WIN_PILOT_SETTINGS_FIELDS: FIELDS } = await import(new URL('../lib/settings.js', import.meta.url).href)

/**
 * The React instance the plugin closes over. `captured.factory()` calls
 * `require('react')` exactly once during module evaluation, so every component
 * the plugin renders shares this renderer — tests must mount on it too.
 */
const pluginReact = createReact()
const requested = []
const factory = (name) => {
  requested.push(name)
  if (name === 'react') return pluginReact.api
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
  // Two registrations: the per-plugin card inside Settings -> Plugins, and a
  // top-level Settings page. The Plugins card is keyed by the settings
  // NAMESPACE, because the section dispatches `settings.plugin.item` once per
  // served namespace and a card under any other key is never rendered.
  assert.equal(registrations.length, 3)
  const byName = Object.fromEntries(registrations.map((r) => [r.options.name, r.options]))
  assert.ok(byName['settings.plugins.tab'],
    'the card must be registered as a Settings -> Plugins tab (the seam this build visibly serves)')
  assert.equal(byName['settings.plugins.tab'].id, 'win-pilot',
    'the Plugins tab must carry the plugin id')
  assert.ok(byName['settings.plugin.item'],
    'the card must also answer settings.plugin.item, keyed by the settings namespace')
  assert.equal(byName['settings.plugin.item'].key, 'win-pilot',
    'the Plugins card must be keyed by the settings namespace the Host serves')
  assert.ok(byName['settings.section'], 'a top-level Settings page must also be registered')
  assert.equal(byName['settings.section'].id, 'win-pilot')
  for (const registration of registrations) {
    assert.equal(typeof registration.component, 'function', 'every registration must pass a component')
  }
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
  assert.equal(registrations.length, 3, 'the Plugins tab, the Plugins item card, and the Settings page register')
}

// A host with neither seam still mounts the card and must not throw.
{
  const { ctx, registrations } = harness({})
  assert.doesNotThrow(() => plugin.apply(ctx), 'a host with no settings seam must not throw')
  assert.equal(registrations.length, 3, 'the card still registers so the settings stay discoverable')
}

// A guarded/absent locale service must not break mounting.
{
  const scope = { getSnapshot: () => ({ value: {}, writable: false, status: 'ready' }), subscribe: () => () => {}, set: async () => {}, unset: async () => {}, load: async () => {} }
  const { ctx, registrations } = harness({ configForms: { get: () => scope } })
  assert.doesNotThrow(() => plugin.apply(ctx))
  assert.equal(registrations.length, 3)
}

// A guarded service getter that throws is treated as absent, not fatal.
{
  const { ctx, registrations } = harness({})
  ctx.get = (name) => { if (name === 'configForms') throw new Error('service not injected'); return undefined }
  assert.doesNotThrow(() => plugin.apply(ctx), 'a guarded service getter must not break mounting')
  assert.equal(registrations.length, 3)
}

// --- rendered card --------------------------------------------------------

/** Reach the Settings -> Plugins card component through a real apply() call. */
function registeredCard(services) {
  const { ctx, registrations } = harness(services)
  plugin.apply(ctx)
  const plugins = registrations.find((r) => r.options.name === 'settings.plugin.item')
  assert.ok(plugins, 'the Plugins card must be among the registrations')
  return plugins.component
}

/** A settings scope double that records writes and can report a stored section. */
function scopeDouble({ value = {}, user = undefined, writable = true, status = 'ready' } = {}) {
  const writes = []
  const unsets = []
  return {
    writes,
    unsets,
    getSnapshot: () => ({ value, user, writable, status, revision: writes.length + unsets.length }),
    subscribe: () => () => {},
    set: async (field, next) => { writes.push([field, next]) },
    unset: async (field) => { unsets.push(field) },
    load: async () => {},
  }
}

// A ready scope renders one control per declared field, grouped, ready to save.
{
  const scope = scopeDouble()
  const Card = registeredCard({
    configForms: { get: () => scope },
    locale: { getSnapshot: () => ({ active: 'en' }) },
  })
  const tree = pluginReact.mount(Card, { scope, locale: 'en' })
  const controls = flatten(tree).filter((node) =>
    node.type === 'input' || node.type === 'select')
  assert.equal(controls.length, FIELDS.length,
    `the card must render exactly one control per declared field (got ${controls.length}, expected ${FIELDS.length})`)
  // Every control is labelled, so the form is usable and screen-reader readable.
  for (const control of controls) {
    assert.ok(typeof control.props['aria-label'] === 'string' && control.props['aria-label'].length > 0,
      'every control must carry an accessible label')
  }
  // Nothing is written until Save.
  assert.deepEqual(scope.writes, [], 'mounting the card must not write anything')
  const save = find(tree, (node) => node.type === 'button' && node.props.className === 'wp-save')
  assert.ok(save, 'the card must render a save control')
  assert.equal(save.props.disabled, true, 'save stays disabled while nothing is staged')
}

// A staged edit enables save and writes the coerced value on click.
{
  const scope = scopeDouble()
  const Card = registeredCard({ configForms: { get: () => scope } })
  let tree = pluginReact.mount(Card, { scope, locale: 'en' })
  const batch = flatten(tree).find((node) =>
    node.type === 'input' && node.props['aria-label'] === 'Maximum actions per batch')
  assert.ok(batch, 'the batch-limit field must render')
  batch.props.onChange({ target: { value: '7' } })
  tree = pluginReact.tree
  const save = find(tree, (node) => node.type === 'button' && node.props.className === 'wp-save')
  assert.equal(save.props.disabled, false, 'a staged valid edit must enable save')
  await save.props.onClick()
  assert.deepEqual(scope.writes, [['maxBatchActions', 7]],
    'save must write the coerced numeric value once')
}

// An out-of-range entry is refused: the field is flagged and the value is not saved.
{
  const scope = scopeDouble()
  const Card = registeredCard({ configForms: { get: () => scope } })
  let tree = pluginReact.mount(Card, { scope, locale: 'en' })
  const batch = flatten(tree).find((node) =>
    node.type === 'input' && node.props['aria-label'] === 'Maximum actions per batch')
  batch.props.onChange({ target: { value: '9999' } })
  tree = pluginReact.tree
  assert.ok(find(tree, (node) => node.props.className === 'wp-input wp-input-bad'),
    'an out-of-range entry must mark the field invalid')
  const save = find(tree, (node) => node.type === 'button' && node.props.className === 'wp-save')
  await save.props.onClick()
  assert.deepEqual(scope.writes, [], 'an invalid field must not be written')
}

// A field present in the user layer shows the Overridden badge and a reset control.
{
  const scope = scopeDouble({ value: { maxBatchActions: 7 }, user: { maxBatchActions: 7 } })
  const Card = registeredCard({ configForms: { get: () => scope } })
  const tree = pluginReact.mount(Card, { scope, locale: 'en' })
  assert.ok(texts(tree).includes('Overridden'), 'an overridden field must be badged')
  const reset = find(tree, (node) => node.type === 'button' && node.props.className === 'wp-reset')
  assert.ok(reset, 'an overridden field must offer a reset control')
  await reset.props.onClick()
  assert.deepEqual(scope.unsets, ['maxBatchActions'], 'reset must clear exactly that field')
}

// A read-only scope renders controls but offers no save.
{
  const scope = scopeDouble({ writable: false })
  const Card = registeredCard({ configForms: { get: () => scope } })
  const tree = pluginReact.mount(Card, { scope, locale: 'en' })
  const save = find(tree, (node) => node.type === 'button' && node.props.className === 'wp-save')
  assert.equal(save.props.disabled, true, 'a read-only scope can never save')
  const first = flatten(tree).find((node) => node.type === 'input')
  assert.equal(first.props.disabled, true, 'a read-only scope disables its controls')
}

// An unavailable scope renders the explanatory note instead of an empty panel.
{
  const unavailable = scopeDouble({ value: undefined, writable: false, status: 'unavailable' })
  const Card = registeredCard({ configForms: { get: () => unavailable } })
  const tree = pluginReact.mount(Card, { scope: unavailable, locale: 'zh' })
  assert.match(texts(tree).join(' '), /settings\.yaml/,
    'the unavailable card must point at settings.yaml')
  assert.equal(flatten(tree).filter((node) => node.type === 'input').length, 0,
    'the unavailable card must not render editable controls')
}

// --- what the shipped client-module scan will do with this package ---------

// The scan (`packages/client/modules`) anchors at the config tree, resolves
// `<name>/package.json`, requires `dsh.client.platform === 'web'`, and maps
// `exports["./client"]` to a bundle path it then reads. Reproduce those exact
// steps against this package so a declaration the host would reject fails here
// rather than silently producing no card.
{
  const pkgUrl = new URL('../package.json', import.meta.url)
  const pkg = JSON.parse(readFileSync(pkgUrl, 'utf8'))
  const decl = pkg.dsh?.client
  assert.ok(decl, 'the scan requires a dsh.client declaration')
  assert.equal(decl.platform, 'web', "the scan requires dsh.client.platform === 'web'")
  assert.ok(decl.inject === undefined || (Array.isArray(decl.inject) && decl.inject.every(i => typeof i === 'string')),
    'dsh.client.inject must be a string array when present')
  assert.ok(decl.immediately === undefined || typeof decl.immediately === 'boolean',
    'dsh.client.immediately must be a boolean when present')

  const exported = pkg.exports?.['./client']
  const rel = typeof exported === 'string'
    ? exported
    : (exported && typeof exported === 'object' && typeof exported.default === 'string' ? exported.default : undefined)
  assert.ok(rel, 'the scan rejects a dsh.client declaration with no resolvable exports["./client"]')

  // The bundle the host will serve must be the file these tests just exercised.
  const declaredBundle = readFileSync(new URL(rel, pkgUrl), 'utf8')
  assert.equal(declaredBundle, source,
    'exports["./client"] must point at the same bundle the card tests exercise')
}

console.log('client bundle check PASSED')
