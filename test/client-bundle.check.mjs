// The Win-Pilot Settings card is a hand-authored harness client bundle. Nothing
// builds it, so these checks are what keep it loadable and honest: it must parse,
// declare the module contract the client module system serves, expose the plugin
// shape the browser half needs, and follow the current host configForms contract.
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
 * The card's real behaviour is draft staging, the *Overridden*
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
const { WIN_PILOT_EDITABLE_SETTING_KEYS: FIELDS, WIN_PILOT_SETTINGS_FIELDS: SCHEMA } = await import(new URL('../lib/settings.js', import.meta.url).href)

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
assert.ok(plugin.inject.includes('configForms'), 'the host must provide configForms before apply runs')
assert.equal(typeof plugin.apply, 'function', 'the browser plugin must expose apply')
// Only host-provided modules may be required; a bare import would not resolve.
assert.deepEqual([...new Set(requested)].sort(), ['react'], 'the bundle may require only host-provided react')

// --- apply against the current host -----------------------------------

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

/** The card props a registration hands its component (scope + locale). */
function propsOf(registrations, name) {
  const found = registrations.find((r) => r.options.name === name)
  assert.ok(found, `the ${name} registration must exist`)
  assert.equal(typeof found.options.inject, 'function', `${name} must supply its props through inject()`)
  return found.options.inject()
}

/** A scope double reporting a live entry, recording the calls the card makes. */
function liveScopeDouble(init = {}) {
  const calls = { load: 0, writes: [], unsets: [] }
  return {
    calls,
    getSnapshot: () => ({ value: init.value ?? {}, user: init.user, writable: init.writable !== false, status: 'ready' }),
    subscribe: () => () => {},
    set: async (field, value) => { calls.writes.push([field, value]) },
    unset: async (field) => { calls.unsets.push(field) },
    load: async () => { calls.load += 1 },
  }
}

/** A `configForms` double that only serves one entry id, like the real one does. */
function configFormsDouble(served, ready) {
  const asked = []
  const empty = {
    getSnapshot: () => ({ value: undefined, writable: false, status: 'unavailable' }),
    subscribe: () => () => {},
    set: async () => false,
    unset: async () => false,
    load: async () => {},
  }
  return {
    asked,
    describe: () => ({
      getSnapshot: () => ({ view: { namespaces: served.map((ns) => ({ ns })) } }),
      subscribe: () => () => {},
      ensure: () => {},
    }),
    // `configForms.get()` NEVER returns undefined: a wrong key yields a scope that
    // stays `unavailable`, which is the failure mode the plugin has to see.
    get: (key) => { asked.push(key); return key === served[0] ? ready : empty },
  }
}

// configForms (current DSH), keyed by the Loader entry id.
//
// The id is not knowable at apply() time — a patched profile serves
// `include:win-pilot` while a plain one serves `win-pilot`, and the shared
// describe mirror is usually still loading — so binding must be resolved lazily
// from the mirror instead of guessed once.
{
  const scope = liveScopeDouble()
  const forms = configFormsDouble(['include:win-pilot'], scope)
  const { ctx, registrations } = harness({
    configForms: forms,
    locale: { getSnapshot: () => ({ active: 'zh' }) },
  })
  plugin.apply(ctx)
  assert.deepEqual(forms.asked, [],
    'apply() must not guess an entry id before the mirror has answered')

  assert.equal(registrations.length, 2)
  const byName = Object.fromEntries(registrations.map((r) => [r.options.name, r.options]))
  assert.ok(byName['plugins.bundle.config'], 'the plugin detail page must expose its settings')
  assert.equal(byName['plugins.bundle.config'].key, 'win-pilot')
  assert.ok(byName['settings.section'], 'a top-level Settings page must also be registered')
  assert.equal(byName['settings.section'].id, 'win-pilot')
  for (const registration of registrations) {
    assert.equal(typeof registration.component, 'function', 'every registration must pass a component')
  }

  // The first read resolves the binding against what the Host actually serves.
  const props = propsOf(registrations, 'settings.section')
  assert.equal(props.locale, 'zh', 'the card must follow the active locale')
  const snapshot = props.scope.getSnapshot()
  assert.deepEqual(forms.asked, ['include:win-pilot'],
    'the card must bind the entry id the Host serves, not the package name')
  assert.equal(snapshot.status, 'ready', 'the bound scope must report the live entry')
  assert.equal(scope.calls.load, 1, 'binding must load the served entry exactly once')
}

// With a plain (unpatched) profile: the id is the namespace itself.
{
  const scope = liveScopeDouble()
  const forms = configFormsDouble(['win-pilot'], scope)
  const { ctx, registrations } = harness({ configForms: forms, locale: { getSnapshot: () => ({ active: 'en' }) } })
  plugin.apply(ctx)
  const { scope: bound } = propsOf(registrations, 'plugins.bundle.config')
  assert.equal(bound.getSnapshot().status, 'ready')
  assert.deepEqual(forms.asked, ['win-pilot'], 'an unpatched profile serves the bare namespace')
}

// Before the mirror answers: the card stays honest, then re-binds.
{
  const scope = liveScopeDouble()
  const asked = []
  let served = []
  const empty = {
    getSnapshot: () => ({ value: undefined, writable: false, status: 'unavailable' }),
    subscribe: () => () => {}, set: async () => false, unset: async () => false, load: async () => {},
  }
  const listeners = new Set()
  const configForms = {
    describe: () => ({
      getSnapshot: () => ({ view: { namespaces: served.map((ns) => ({ ns })) } }),
      ensure: () => {},
      subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    }),
    // The real host answers `unavailable` for every key it does not serve.
    get: (key) => { asked.push(key); return served.includes(key) ? scope : empty },
  }
  const { ctx, registrations } = harness({ configForms })
  plugin.apply(ctx)
  const props = propsOf(registrations, 'settings.section')
  assert.equal(props.scope.getSnapshot().status, 'unavailable',
    'an unanswered mirror must not fake a writable entry')
  assert.deepEqual(asked, [],
    'an unanswered mirror must not cause guessed namespace probes')

  // The mirror then reports the served entry; the card must adopt it.
  const off = props.scope.subscribe(() => {})
  served = ['include:win-pilot']
  for (const listener of listeners) listener()
  assert.equal(props.scope.getSnapshot().status, 'ready',
    'a later mirror answer must re-bind the card to the served entry')
  off()
}

// The card also needs controller notifications: they report saves, errors and
// readiness changes independently of the shared namespace mirror.
{
  let snapshot = { value: { overlay: true }, writable: true, status: 'ready' }
  const listeners = new Set()
  const controller = {
    getSnapshot: () => snapshot,
    subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    load: async () => {},
    set: async () => false,
    unset: async () => false,
  }
  const { ctx, registrations } = harness({ configForms: configFormsDouble(['include:win-pilot'], controller) })
  plugin.apply(ctx)
  const { scope } = propsOf(registrations, 'plugins.bundle.config')
  let updates = 0
  const off = scope.subscribe(() => { updates += 1 })
  snapshot = { ...snapshot, value: { overlay: false } }
  for (const listener of [...listeners]) listener()
  assert.ok(updates > 0, 'the live scope must forward controller changes to the card')
  assert.equal(scope.getSnapshot().value.overlay, false)
  off()
  assert.equal(listeners.size, 0, 'unmount must release the controller subscription')
}

// Similar package names must never select another plugin's writable entry.
{
  const foreign = liveScopeDouble({ value: { overlay: false } })
  const own = liveScopeDouble({ value: { overlay: true } })
  const forms = configFormsDouble(['include:win-pilot-helper', 'include:win-pilot'], foreign)
  const originalGet = forms.get
  forms.get = (key) => key === 'include:win-pilot' ? own : originalGet(key)
  const { ctx, registrations } = harness({ configForms: forms })
  plugin.apply(ctx)
  assert.equal(propsOf(registrations, 'plugins.bundle.config').scope.getSnapshot().value.overlay, true,
    'only the exact Win-Pilot entry may supply the settings card')
}

// A guarded/absent locale service must not break mounting.
{
  const scope = liveScopeDouble()
  const { ctx, registrations } = harness({ configForms: configFormsDouble(['win-pilot'], scope) })
  assert.doesNotThrow(() => plugin.apply(ctx))
  assert.equal(registrations.length, 2)
}

// --- rendered card --------------------------------------------------------

/** Reach the current plugin detail card through the browser plugin apply(). */
function registeredCard(services) {
  const { ctx, registrations } = harness(services)
  plugin.apply(ctx)
  const plugins = registrations.find((r) => r.options.name === 'plugins.bundle.config')
  assert.ok(plugins, 'the Plugins card must be among the registrations')
  return (props) => plugins.component({ ...props, scope: plugins.options.inject().scope })
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
    configForms: configFormsDouble(['win-pilot'], scope),
    locale: { getSnapshot: () => ({ active: 'en' }) },
  })
  const tree = pluginReact.mount(Card, { scope, locale: 'en' })
  const booleans = SCHEMA.filter((field) => field.type === 'boolean')
  const enums = SCHEMA.filter((field) => field.type === 'enum')
  // Counts come from the schema, not from literals: adding a field must not
  // silently pass a test that still expects the old number.
  const controls = flatten(tree).filter((node) => node.props && node.props.role === 'switch')
  assert.equal(controls.length, booleans.length,
    'the card must render one switch per boolean field (got ' + controls.length + ', expected ' + booleans.length + ')')
  const segments = flatten(tree).filter((node) => node.props && node.props.role === 'radio')
  assert.equal(segments.length, enums[0].values.length,
    'the environment choice renders one segment per option (got ' + segments.length + ')')
  assert.equal(flatten(tree).filter((node) => node.props && node.props.role === 'radiogroup').length, enums.length,
    'each enum field renders exactly one radiogroup')
  // The card must never render a free-text or number input anywhere.
  assert.equal(flatten(tree).filter((node) => node.type === 'input').length, 0,
    'the settings card must not render any raw input element')
  // Every visible label points at a control that actually exists in the tree.
  // A <label> with no htmlFor, or one naming a missing id, silently does nothing.
  const ids = new Set(flatten(tree)
    .filter((node) => node.props && typeof node.props.id === 'string')
    .map((node) => node.props.id))
  const labels = flatten(tree).filter((node) => node.type === 'label')
  assert.equal(labels.length, SCHEMA.length, 'every field has exactly one visible label')
  for (const label of labels) {
    assert.ok(typeof label.props.htmlFor === 'string' && label.props.htmlFor.length > 0,
      'every label must carry htmlFor')
    assert.ok(ids.has(label.props.htmlFor),
      'label htmlFor must name an existing control id: ' + label.props.htmlFor)
  }
  // Nothing is written until Save.
  assert.deepEqual(scope.writes, [], 'mounting the card must not write anything')
  const save = find(tree, (node) => node.type === 'button' && node.props.className === 'wp-save')
  assert.ok(save, 'the card must render a save control')
  assert.equal(save.props.disabled, true, 'save stays disabled while nothing is staged')
}

// Picking the other environment stages it, and save writes that value once.
{
  const scope=scopeDouble()
  const Card=registeredCard({configForms:configFormsDouble(['win-pilot'],scope)})
  let tree=pluginReact.mount(Card,{scope,locale:'en'})
  const current=find(tree,node=>node.props&&node.props.role==='radio'&&node.props['aria-checked']===true)
  assert.ok(current,'one environment segment is selected by default')
  const other=flatten(tree).find(node=>node.props&&node.props.role==='radio'&&node.props['aria-checked']===false)
  assert.ok(other,'the other environment segment is offered')
  other.props.onClick()
  tree=pluginReact.tree
  await find(tree,node=>node.type==='button'&&node.props.className==='wp-save').props.onClick()
  assert.equal(scope.writes.length,1,'save writes exactly the staged environment')
  assert.equal(scope.writes[0][0],'desktopEnvironment')
  assert.ok(scope.writes[0][1]==='task'||scope.writes[0][1]==='current')
}

// A staged edit enables save and writes the checkbox value on click.
{
  const scope = scopeDouble()
  const Card = registeredCard({ configForms: configFormsDouble(['win-pilot'], scope) })
  let tree = pluginReact.mount(Card, { scope, locale: 'en' })
  const batch = flatten(tree).find((node) =>
    node.props && node.props.role === 'switch' && node.props['aria-label'] === 'Show the operation cursor')
  assert.ok(batch, 'the cursor switch must render')
  batch.props.onClick()
  tree = pluginReact.tree
  const save = find(tree, (node) => node.type === 'button' && node.props.className === 'wp-save')
  assert.equal(save.props.disabled, false, 'a staged switch edit must enable save')
  await save.props.onClick()
  assert.deepEqual(scope.writes, [['overlay', true]],
    'save must write the chosen switch value once')
}

// Freeze edits while a write is in flight so later drafts cannot be erased.
{
  const scope = scopeDouble({ value: { overlay: true }, user: { overlay: true } })
  let finish
  scope.set = () => new Promise((resolve) => { finish = resolve })
  const Card = registeredCard({ configForms: configFormsDouble(['win-pilot'], scope) })
  pluginReact.mount(Card, { locale: 'en' })
  find(pluginReact.tree, (node) => node.props['aria-label'] === 'Show the operation cursor')
    .props.onClick()
  const saved = find(pluginReact.tree, (node) => node.props.className === 'wp-save').props.onClick()
  assert.ok(flatten(pluginReact.tree).filter((node) => node.props && node.props.role === 'switch').every((node) => node.props.disabled))
  assert.equal(find(pluginReact.tree, (node) => node.props.className === 'wp-reset').props.disabled, true)
  finish()
  await saved
}

// A field present in the user layer shows the Overridden badge and a reset control.
{
  const scope = scopeDouble({ value: { overlay: false }, user: { overlay: false } })
  const Card = registeredCard({ configForms: configFormsDouble(['win-pilot'], scope) })
  const tree = pluginReact.mount(Card, { scope, locale: 'en' })
  assert.ok(texts(tree).includes('Overridden'), 'an overridden field must be badged')
  const reset = find(tree, (node) => node.type === 'button' && node.props.className === 'wp-reset')
  assert.ok(reset, 'an overridden field must offer a reset control')
  await reset.props.onClick()
  assert.deepEqual(scope.unsets, ['overlay'], 'reset must clear exactly that field')
}

// A read-only scope renders controls but offers no save.
{
  const scope = scopeDouble({ writable: false })
  const Card = registeredCard({ configForms: configFormsDouble(['win-pilot'], scope) })
  const tree = pluginReact.mount(Card, { scope, locale: 'en' })
  const save = find(tree, (node) => node.type === 'button' && node.props.className === 'wp-save')
  assert.equal(save.props.disabled, true, 'a read-only scope can never save')
  const first = flatten(tree).find((node) => node.props && node.props.role === 'switch')
  assert.equal(first.props.disabled, true, 'a read-only scope disables its controls')
}

// An unavailable scope renders the explanatory note instead of an empty panel.
{
  const unavailable = scopeDouble({ value: undefined, writable: false, status: 'unavailable' })
  const Card = registeredCard({ configForms: configFormsDouble(['win-pilot'], unavailable) })
  const tree = pluginReact.mount(Card, { scope: unavailable, locale: 'zh' })
  assert.match(texts(tree).join(' '), /可编辑设置/,
    'the unavailable card must explain that settings cannot be read')
  assert.equal(flatten(tree).filter((node) => node.props && node.props.role === 'switch').length, 0,
    'the unavailable card must not render editable controls')
}

// A refused reset preserves the edit and exposes the failure.
{
  const scope = scopeDouble({ value: { overlay: true }, user: { overlay: true } })
  scope.unset = async () => false
  const Card = registeredCard({ configForms: configFormsDouble(['win-pilot'], scope) })
  pluginReact.mount(Card, { locale: 'en' })
  find(pluginReact.tree, (node) => node.props['aria-label'] === 'Show the operation cursor')
    .props.onClick()
  await find(pluginReact.tree, (node) => node.props.className === 'wp-reset').props.onClick()
  assert.equal(find(pluginReact.tree, (node) => node.props['aria-label'] === 'Show the operation cursor').props['aria-checked'], false)
  assert.equal(find(pluginReact.tree, (node) => node.props.className === 'wp-save').props.disabled, false)
  assert.ok(find(pluginReact.tree, (node) => node.props.className === 'wp-err'))
}

// --- what the shipped client-module scan will do with this package ---------

// A rejected Host write returns false rather than throwing. Preserve the draft
// and report failure instead of claiming that it was saved.
{
  const scope = scopeDouble()
  scope.set = async () => false
  const Card = registeredCard({ configForms: configFormsDouble(['win-pilot'], scope) })
  let tree = pluginReact.mount(Card, { locale: 'en' })
  const batch = find(tree, (node) => node.props['aria-label'] === 'Show the operation cursor')
  batch.props.onClick()
  await find(pluginReact.tree, (node) => node.props.className === 'wp-save').props.onClick()
  tree = pluginReact.tree
  assert.equal(find(tree, (node) => node.props.className === 'wp-save').props.disabled, false,
    'a refused write must leave the staged value available for retry')
  assert.ok(find(tree, (node) => node.props.className === 'wp-err'),
    'a refused write must render the save failure')
}

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
