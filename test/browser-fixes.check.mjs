// Regression checks for the browser-channel fixes: real pointer geometry,
// occlusion, key coverage, dialogs, and the actions that used to be missing.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { browserAction } from '../lib/browser-session.js'
import { keySpec } from '../lib/browser-keys.js'

// ---------------------------------------------------------------- key coverage
{
  const ok = name => assert.doesNotThrow(() => keySpec(name), `${name} must be supported`)
  ok('Enter'); ok('Tab'); ok('Escape'); ok('Space'); ok('PageUp'); ok('PageDown'); ok('Insert'); ok('Home'); ok('End')
  ok('ArrowLeft'); ok('F1'); ok('F5'); ok('F12'); ok('F24')
  ok('1'); ok('9'); ok('0'); ok('/'); ok('.'); ok('-'); ok('='); ok('['); ok(']'); ok(';'); ok("'"); ok(','); ok('\\'); ok('`')
  ok('question'); ok('greater'); ok('underscore'); ok('period'); ok('plus')
  ok('a'); ok('Z'); ok('ctrl+c'); ok('Control_L+a'); ok('shift+a'); ok('ctrl+shift+p'); ok('alt+f4'); ok('meta+ArrowLeft')
  ok('KP_0'); ok('KP_9'); ok('Numpad_Add'); ok('Numpad_Subtract'); ok('Numpad_Enter'); ok('Numpad_Divide'); ok('Numpad_Decimal')
  assert.equal(keySpec('F5').windowsVirtualKeyCode, 116)
  assert.equal(keySpec('PageDown').windowsVirtualKeyCode, 34)
  assert.equal(keySpec('1').text, '1', 'a digit press must insert text')
  assert.equal(keySpec('shift+a').key, 'A')
  assert.equal(keySpec('Control_L+a').modifiers, 2)
  assert.equal(keySpec('ctrl+c').text, undefined, 'a control chord must not insert text')
  assert.equal(keySpec('Numpad_Add').location, 3)
  assert.equal(keySpec('question').text, '?')
  assert.throws(() => keySpec('bogus'), /Unsupported key/)
  assert.throws(() => keySpec(''), /Unsupported key/)
  console.log('PASS key coverage: named keys, digits, punctuation, chords, keypad')
}

// ------------------------------------------------------------------- fixtures
const PAGE = `<!doctype html><meta charset=utf-8><title>Fixes</title>
<style>
  body{margin:0;font:14px system-ui}
  button,select,[role=button]{display:inline-block;margin:4px}
  #wide{width:3000px;height:160px;background:#e8e8e8}
  #op0{opacity:0}
  #sub{display:none}
  #overlay{position:fixed;inset:0;background:rgba(0,150,0,.1);z-index:99999}
</style>
<button id="hover-host">Hover Host</button><span id="sub">Sub Item</span>
<button id="covered">Covered Button</button>
<button id="op0">Opacity Zero</button>
<select id="sel" aria-label="Pick one"><option value="one">One</option><option value="two">Two</option><option value="three">Three</option></select>
<button id="add-overlay">Add overlay</button>
<div id="shot-target" style="width:160px;height:80px;background:#fed">shot target</div>
<div id="wide">wide content</div>
<script>
  document.getElementById('hover-host').addEventListener('mouseenter', () => { document.getElementById('sub').style.display = 'inline' });
  document.getElementById('covered').addEventListener('click', () => { document.title = 'COVERED-CLICKED' });
  document.getElementById('add-overlay').addEventListener('click', () => {
    const overlay = document.createElement('div'); overlay.id = 'overlay'; document.body.append(overlay);
    document.title = 'OVERLAY-ADDED';
  });
</script>`

const DIALOG_PAGE = `<!doctype html><meta charset=utf-8><title>Dialog</title><body>dialog page
<script>setTimeout(() => { window.confirm('confirm me') }, 250)</script>`

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end(req.url.startsWith('/dialog') ? DIALOG_PAGE : PAGE)
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`
const edge = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
assert.ok(existsSync(edge), 'Set EDGE_PATH to an isolated Chromium executable')
const profile = await mkdtemp(path.join(tmpdir(), 'win-pilot-fixes-'))
let child
let endpoint
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function eventually(fn) {
  let last
  for (let attempt = 0; attempt < 100; attempt++) {
    try { return await fn() } catch (error) { last = error; await delay(100) }
  }
  throw last
}
try {
  child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-background-networking', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let launchError
  child.on('error', error => { launchError = error })
  const portFile = await eventually(async () => {
    if (launchError) throw launchError
    return readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')
  })
  const [port, socketPath] = portFile.trim().split(/\r?\n/)
  endpoint = `ws://127.0.0.1:${port}${socketPath}`
  const opened = await browserAction('browser_open', { browser_endpoint: endpoint, url: base })
  const args = { browser_endpoint: endpoint, tab_id: opened.tab_id, command_timeout_ms: 10000 }
  const action = (name, extra = {}) => browserAction(name, { ...args, ...extra })
  const find = (state, name) => state.elements.find(item => item.name === name)
  const stateNow = async () => action('browser_state')

  const state = await eventually(async () => {
    const snapshot = await stateNow()
    assert.ok(find(snapshot, 'Covered Button'), 'fixture must expose the covered button')
    return snapshot
  })

  // ------------------------------------------------------ visibility defaults
  assert.equal(find(state, 'Opacity Zero'), undefined,
    'a control drawn with opacity:0 must not be offered as actionable')
  assert.equal(find(state, 'Covered Button').covered_by, undefined,
    'a clear on-screen control must not report covered_by')

  // ---------------------------------------------------- horizontal scrolling
  const right = await action('browser_scroll', { scroll_x: 600, scroll_y: 0 })
  assert.equal(right.ok, true, JSON.stringify(right))
  assert.equal(right.movement.x, true, 'scroll_x must actually move the page: ' + JSON.stringify(right))
  assert.equal(right.scroll_position.after.x, 600)
  const left = await action('browser_scroll', { direction: 'left', scroll_step: 600 })
  assert.equal(left.scroll_position.after.x, 0, 'direction left must scroll back horizontally')
  await action('browser_scroll', { direction: 'right' })
  const toEnd = await action('browser_scroll', { scroll_x: 10000, scroll_y: 0 })
  assert.equal(toEnd.ok, true, 'a large delta must reach the horizontal end: ' + JSON.stringify(toEnd))
  assert.equal(toEnd.scroll_position.at_x_end, true)
  const atEnd = await action('browser_scroll', { scroll_x: 10000, scroll_y: 0 })
  assert.equal(atEnd.ok, false, 'a scroll that cannot move must not report success: ' + JSON.stringify(atEnd))
  assert.equal(atEnd.error_code, 'scroll_no_effect')
  await action('browser_scroll', { scroll_x: -10000, scroll_y: -10000 })

  // --------------------------------------------------------------- hover menu
  assert.doesNotMatch((await action('browser_read')).text, /Sub Item/, 'the hover-only menu starts hidden')
  const hostItem = eventually(async () => {
    const item = find(await stateNow(), 'Hover Host')
    assert.ok(item)
    return item
  })
  const hovered = await action('browser_hover', { element: (await hostItem).element, hover_delay_ms: 200 })
  assert.equal(hovered.ok, true, JSON.stringify(hovered))
  await eventually(async () => {
    assert.match((await action('browser_read')).text, /Sub Item/, 'hover must reveal the menu entry')
  })

  // ------------------------------------------------------------------- select
  const selectItem = (await stateNow()).elements.find(item => item.role === 'combobox')
  assert.ok(selectItem, 'the fixture select must be listed as a combobox')
  const selected = await action('browser_select', { element: selectItem.element, text: 'Three' })
  assert.equal(selected.ok, true, JSON.stringify(selected))
  assert.equal(selected.selected_value, 'three')
  const missing = await action('browser_select', { element: selectItem.element, text: 'No such option' })
  assert.equal(missing.ok, false)
  assert.equal(missing.error_code, 'option_not_found')
  assert.equal(missing.available_options.length, 3)

  // -------------------------------------------------------------- screenshots
  // A software-rendered headless renderer can take longer than the default CDP
  // command budget to produce an image; capture failures are reported, never
  // thrown, so a slow frame must not abort the whole check.
  const shot = (extra = {}) => action('browser_screenshot', { command_timeout_ms: 25000, ...extra })
  const viewportShot = await shot()
  assert.equal(viewportShot.ok, true, JSON.stringify(viewportShot))
  assert.ok((await stat(viewportShot.screenshot.path)).size > 1000, 'a viewport screenshot must contain an image')
  await delay(250)
  const elementShot = await shot({ selector: '#shot-target' })
  assert.equal(elementShot.ok, true, JSON.stringify(elementShot))
  assert.equal(elementShot.mode, 'selector')
  assert.ok(elementShot.screenshot.width >= 150 && elementShot.screenshot.height >= 70, JSON.stringify(elementShot.screenshot))
  await delay(250)
  const fullShot = await shot({ full_page: true })
  assert.equal(fullShot.ok, true, JSON.stringify(fullShot))
  assert.ok(fullShot.screenshot.height > elementShot.screenshot.height, 'a full-page capture must be taller than one element')
  assert.equal((await shot({ selector: '#nope' })).error_code, 'selector_not_found')

  // ------------------------------------------------------------- wait selector
  const waited = await action('browser_wait', { browser_wait_for: 'selector', selector: '#shot-target', browser_wait_timeout_ms: 2000 })
  assert.equal(waited.ok, true, JSON.stringify(waited))
  assert.equal(waited.selector_found, true, JSON.stringify(waited))
  const waitMiss = await action('browser_wait', { browser_wait_for: 'selector', selector: '#nope', browser_wait_timeout_ms: 300 })
  assert.equal(waitMiss.ok, false)
  assert.equal(waitMiss.error_code, 'browser_wait_timeout')

  // -------------------------------------------------------- origin allowlist
  const otherOrigin = 'http://127.0.0.1:1/denied'
  await assert.rejects(action('browser_navigate', { url: otherOrigin }), /allowed_origins/)
  await assert.rejects(action('browser_request', { url: otherOrigin }), /allowed_origins/)
  assert.equal((await action('browser_request', { url: `${base}/echo`, method: 'GET' })).ok, true)

  // -------------------------------------------------- occlusion and hit test
  const addOverlay = find(await stateNow(), 'Add overlay')
  assert.ok(addOverlay, 'the overlay trigger must be listed')
  assert.equal((await action('browser_click', { element: addOverlay.element })).ok, true)
  await eventually(async () => {
    assert.match((await action('browser_read')).title, /OVERLAY-ADDED/)
  })
  await action('browser_scroll', { scroll_x: -10000, scroll_y: -10000 })
  const coveredNow = find(await stateNow(), 'Covered Button')
  assert.ok(coveredNow, 'the covered control stays listed')
  assert.ok(coveredNow.covered_by, 'an occluded on-screen control must report covered_by: ' + JSON.stringify(coveredNow))
  assert.equal(coveredNow.covered_by.reason, 'occluded')
  const refused = await action('browser_click', { element: coveredNow.element, trusted_input: true })
  assert.equal(refused.ok, false, 'a click an overlay would eat must not report success: ' + JSON.stringify(refused))
  assert.equal(refused.error_code, 'click_intercepted')
  assert.ok(refused.intercepted_by)
  assert.doesNotMatch((await action('browser_read')).title, /COVERED-CLICKED/, 'a refused click must not dispatch')
  const forcedClick = await action('browser_click', { element: coveredNow.element, trusted_input: true, force_click: true })
  assert.equal(forcedClick.ok, true, JSON.stringify(forcedClick))
  assert.ok(forcedClick.intercepted_by, 'a forced click still reports what it hit')

  // ------------------------------------------------------------------ dialog
  const dialogTab = await browserAction('browser_open', { browser_endpoint: endpoint, url: `${base}/dialog` })
  const dialogArgs = { browser_endpoint: endpoint, tab_id: dialogTab.tab_id, command_timeout_ms: 5000 }
  const dialogAction = (name, extra = {}) => browserAction(name, { ...dialogArgs, ...extra })
  const startedAt = Date.now()
  const dialogState = await dialogAction('browser_state')
  assert.ok(Date.now() - startedAt < 5000, 'a blocking dialog must never hang an action until its timeout')
  if (dialogState.error_code === 'javascript_dialog_open') {
    assert.equal(dialogState.dialog.type, 'confirm')
    assert.equal((await dialogAction('browser_dialog', { accept: false })).ok, true)
    assert.equal((await dialogAction('browser_state')).ok, true, 'the tab must be usable once the dialog is answered')
  } else {
    // Headless Chromium auto-dismisses script dialogs; the tab must stay usable.
    assert.equal(dialogState.ok, true)
  }
  assert.equal((await dialogAction('browser_dialog', { accept: true })).error_code, 'no_javascript_dialog')

  console.log('PASS browser fixes: key coverage, scroll axes, hover, select, screenshots, selector wait, origin allowlist, occlusion refusal/force, dialog guard')
} finally {
  if (endpoint) { try { await browserAction('browser_shutdown', { browser_endpoint: endpoint }) } catch { } }
  // Edge starts a whole process tree; killing only the launcher leaves renderers
  // running and starves later captures.
  try { if (child?.pid) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }) } catch { }
  server.closeAllConnections?.()
  server.close()
  await delay(300)
  await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => { })
}