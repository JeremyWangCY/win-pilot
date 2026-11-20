// browserControl=off contract: the user preference closes the whole browser
// channel, before any ownership check or dispatch, and leaves desktop control
// working. Everything here is in memory: no helper, browser, GUI, or input.
import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

// Install the process guard before importing the implementation.
const originalSpawn = childProcess.spawn
let spawnAttempts = 0
childProcess.spawn = () => { spawnAttempts++; throw new Error('REAL PROCESS START FORBIDDEN IN BROWSER CONTROL TEST') }
syncBuiltinESMExports()

const { defineComputerTool } = await import('../lib/index.js')
const { getRuntimeStatus } = await import('../lib/runtime.js')
const { getSettings, resetSettingsForTest, setSettingsForTest, applyConfigSnapshot } = await import('../lib/settings.js')
const { createWinPilotSkill, WIN_PILOT_SKILL } = await import('../lib/win-pilot-skill.js')
const { controlCoordinator } = await import('../lib/control-session.js')

// The coordinator only serializes requests and tracks control state; its real
// cross-process lease is covered elsewhere. Run the operation in place.
const coordinatorMethods = Object.fromEntries(['newSession', 'run', 'close', 'idle'].map(key => [key, controlCoordinator[key]]))
let nextSession = 0
Object.assign(controlCoordinator, {
  newSession: () => `browser-control-${++nextSession}`,
  run: (_id, _request, _signal, operation) => operation(_signal),
  close: async () => {},
  idle: () => false,
})

const DISABLED_MESSAGE = 'Browser control is turned off in the Win-Pilot settings. Desktop actions still work; ask the user to enable browser control instead of retrying.'
const browserCalls = []
const nativeCalls = []
const browserProvider = {
  name: 'mock-browser',
  capabilities: {},
  closeSession: async () => {},
  execute: async (action, args) => {
    browserCalls.push({ action, args })
    return { ok: true, action, outcome: 'completed', browser_endpoint: args.browser_endpoint, tab_id: args.tab_id, url: 'https://example.test/ready', tabs: [] }
  },
}
const taskDesktopProvider = {
  execute: async (action, args) => {
    nativeCalls.push({ action, args })
    if (action === 'launch_app') return { ok: true, action, outcome: 'completed', pid: 4242 }
    if (action === 'get_window_state') return { ok: true, action, outcome: 'completed', elements: [], snapshot_id: 'snap-1' }
    return { ok: true, action, outcome: 'completed' }
  },
  close: async () => {},
}
const noActivity = { begin: async () => {}, finish () {}, remove () {}, close: async () => {} }

const tool = defineComputerTool(value => value, {}, { browserProvider, activityReporter: noActivity })
const desktopTool = defineComputerTool(value => value, {}, {
  browserProvider, desktopEnvironment: 'task', taskDesktopProvider, activityReporter: noActivity,
})

const refuses = (result, action) => {
  assert.equal(result.ok, false, `${action} must be refused: ${JSON.stringify(result)}`)
  assert.equal(result.error_code, 'browser_control_disabled', `${action} must report browser_control_disabled: ${JSON.stringify(result)}`)
  assert.equal(result.outcome, 'not_executed', `${action} must prove nothing was executed`)
  assert.equal(result.actionSent, false, `${action} must report that nothing was sent`)
  assert.equal(result.retry, 'never', `${action} must never be retried`)
  assert.equal(result.message, DISABLED_MESSAGE, `${action} must explain the refusal`)
  assert.equal(result.action, action, `${action} must be named in the refusal`)
}

const browserTarget = { browser: { endpoint: 'ws://127.0.0.1:9222/devtools/browser/mock', tab_id: 'tab-1' } }

try {
  // --- default true: the browser channel is unchanged ---------------------
  resetSettingsForTest()
  assert.equal(getSettings().browserControl, true, 'the shipped default must leave browser control available')
  assert.equal((await tool.execute({ action: 'browser_state', ...browserTarget }, {})).ok, true, 'browser_* must stay dispatchable by default')
  assert.equal(browserCalls.at(-1).action, 'browser_state')
  assert.equal(browserCalls.length, 1, 'default behavior must reach the provider')

  { // A browser postcondition still uses the provider while it is on.
    browserCalls.length = 0
    await tool.execute({ action: 'browser_read', ...browserTarget, expect: { type: 'browser_text', text: 'ready', timeout_ms: 0 } }, {})
    assert.deepEqual(browserCalls.map(call => call.action), ['browser_read', 'browser_read'], 'an enabled browser postcondition observes through the provider')
  }

  // --- false: every browser_* name is refused before dispatch -------------
  setSettingsForTest({ browserControl: false, statusPill: false, overlay: false })
  browserCalls.length = 0
  for (const action of ['browser_state', 'browser_click', 'browser_shutdown', 'browser_open', 'browser_tabs', 'browser_events', 'browser_downloads', 'browser_history', 'browser_wait', 'browser_read', 'browser_frames', 'browser_observe', 'browser_actasdf']) {
    refuses(await tool.execute({ action, ...browserTarget }, {}), action)
  }
  assert.equal(browserCalls.length, 0, 'a disabled browser channel must not reach the provider once')

  // Ownership is not even consulted: an unowned/shutdown request reports the
  // setting refusal, not browser_not_owned.
  refuses(await tool.execute({ action: 'browser_shutdown', browser_endpoint: 'ws://127.0.0.1:9222/devtools/browser/unknown' }, {}), 'browser_shutdown')

  // --- false: browser preconditions/postconditions are refused -------------
  {
    const before = browserCalls.length
    refuses(await tool.execute({ action: 'browser_read', ...browserTarget, expect: { type: 'browser_url', url: 'https://example.test/ready', timeout_ms: 0 } }, {}), 'browser_read')
    refuses(await tool.execute({ action: 'browser_open', ...browserTarget, url: 'https://example.test/', when: { type: 'browser_ready', timeout_ms: 0 } }, {}), 'browser_open')
    refuses(await tool.execute({ action: 'browser_downloads', ...browserTarget, expect: { type: 'download_completed', filename: 'file.txt', timeout_ms: 0 } }, {}), 'browser_downloads')
    // A desktop action carrying a browser condition is refused too, before the
    // native dispatch: no observation may attach an endpoint first.
    const desktopBefore = nativeCalls.length
    refuses(await tool.execute({ action: 'get_window', app: 'fixture', ...browserTarget, expect: { type: 'browser_ready', timeout_ms: 0 } }, {}), 'get_window')
    refuses(await tool.execute({ action: 'list_windows', ...browserTarget, when: { type: 'browser_url', url: 'https://example.test/' } }, {}), 'list_windows')
    assert.equal(browserCalls.length, before, 'a refused browser condition must not observe through the provider')
    assert.equal(nativeCalls.length, desktopBefore, 'a refused browser condition must not dispatch a desktop action')
  }

  // --- false: headless launch refused, headed launch still allowed ---------
  {
    refuses(await tool.execute({ action: 'launch_app', name: 'msedge', headless: true }, {}), 'launch_app')
    const nativeBefore = nativeCalls.length
    const headed = await desktopTool.execute({ action: 'launch_app', name: 'notepad' }, {})
    assert.equal(headed.ok, true, 'a headed launch_app must keep working: ' + JSON.stringify(headed))
    assert.equal(nativeCalls.length, nativeBefore + 1, 'a headed launch must reach the desktop provider')
    assert.equal(nativeCalls.at(-1).action, 'launch_app')
    // The headless DEFAULT belongs to the browser channel, so it is not applied
    // while browser control is off: a plain launch_app stays a headed desktop
    // launch instead of turning into a refusal the model never asked for.
    setSettingsForTest({ browserControl: false, browserHeadlessDefault: true, statusPill: false, overlay: false })
    const defaulted = await desktopTool.execute({ action: 'launch_app', name: 'msedge' }, {})
    assert.equal(defaulted.ok, true, 'browser control off must not inherit the headless default: ' + JSON.stringify(defaulted))
    assert.equal(defaulted.headless, undefined, 'the headless default must not be applied while browser control is off')
    // The same setting with browser control ON still applies the default.
    setSettingsForTest({ browserControl: true, browserHeadlessDefault: true, statusPill: false, overlay: false })
    const headlessDefaulted = await desktopTool.execute({ action: 'launch_app', name: 'msedge' }, {})
    assert.equal(headlessDefaulted.ok, true, 'the headless default still applies while browser control is on')
    assert.equal(nativeCalls.at(-1).args.headless, true, 'the default reaches the desktop provider only while browser control is on')
    setSettingsForTest({ browserControl: false, browserHeadlessDefault: false, statusPill: false, overlay: false })
  }

  // --- false: desktop actions keep working --------------------------------
  {
    const results = []
    for (const action of ['get_window_state', 'list_windows', 'list_apps', 'screenshot']) {
      results.push(await desktopTool.execute({ action, app: 'fixture' }, {}))
    }
    assert.ok(results.every(result => result.ok === true), 'desktop actions must remain available: ' + JSON.stringify(results))
    assert.deepEqual(nativeCalls.slice(-results.length).map(call => call.action), ['get_window_state', 'list_windows', 'list_apps', 'screenshot'])
    const clicked = await desktopTool.execute({ action: 'click', app: 'fixture', x: 5, y: 5 }, {})
    assert.equal(clicked.ok, true, 'desktop input must remain available: ' + JSON.stringify(clicked))
  }

  // --- false: batch steps fail with the same shape ------------------------
  {
    browserCalls.length = 0
    const batch = await desktopTool.execute({ actions: [{ action: 'list_windows', app: 'fixture' }, { action: 'browser_click', ...browserTarget }] }, {})
    assert.equal(batch.ok, false, JSON.stringify(batch))
    assert.equal(batch.action, 'batch')
    assert.equal(batch.failed_index, 1, 'the browser step is the failure point')
    assert.equal(batch.steps.length, 2, 'the desktop step still ran')
    refuses(batch.steps[1], 'browser_click')
    assert.equal(batch.steps[0].ok, true, 'a batch stops only at the refused browser step')
    assert.equal(browserCalls.length, 0, 'a refused batch step must not reach the provider')

    const headlessBatch = await tool.execute({ headless: true, actions: [{ action: 'launch_app', name: 'msedge' }] }, {})
    assert.equal(headlessBatch.ok, false, JSON.stringify(headlessBatch))
    assert.equal(headlessBatch.steps[0].error_code, 'browser_control_disabled', 'a batch-level headless launch is refused')

    const batchCondition = await tool.execute({ actions: [{ action: 'get_window', app: 'fixture', expect: { type: 'download_completed', filename: 'x.txt' } }] }, {})
    assert.equal(batchCondition.steps[0].error_code, 'browser_control_disabled', 'a batch step browser condition is refused')
  }

  // --- false: the live setting applies to the NEXT call, no remount ------
  {
    setSettingsForTest({ browserControl: true, statusPill: false, overlay: false })
    assert.equal((await tool.execute({ action: 'browser_state', ...browserTarget }, {})).ok, true, 'turning it back on reopens the channel')
    setSettingsForTest({ browserControl: false, statusPill: false, overlay: false })
    refuses(await tool.execute({ action: 'browser_state', ...browserTarget }, {}), 'browser_state')

    // The host Config path (a volatile reference) behaves the same way.
    let live = true
    applyConfigSnapshot({ browserControl: { get: () => live }, statusPill: false, overlay: false })
    assert.equal((await tool.execute({ action: 'browser_state', ...browserTarget }, {})).ok, true, 'a live Config value of true dispatches')
    live = false
    refuses(await tool.execute({ action: 'browser_state', ...browserTarget }, {}), 'browser_state')
    live = true
    assert.equal((await tool.execute({ action: 'browser_state', ...browserTarget }, {})).ok, true, 'the next call follows the live Config without remounting')
  }

  // --- the model-facing skill follows the live setting --------------------
  {
    resetSettingsForTest()
    assert.equal(createWinPilotSkill('current').content, WIN_PILOT_SKILL.content, 'the default skill body must stay byte-identical')
    assert.equal(createWinPilotSkill('task', true).content,
      createWinPilotSkill('task').content, 'an enabled task skill must stay byte-identical')
    assert.equal(tool.skillForAgent({}).content, WIN_PILOT_SKILL.content, 'an enabled tool skill must stay byte-identical')

    setSettingsForTest({ browserControl: false, statusPill: false, overlay: false })
    const disabledSkill = tool.skillForAgent({})
    assert.match(disabledSkill.content, /Browser control is turned off/, 'the disabled skill must say browser control is off')
    assert.match(disabledSkill.content, /error_code: browser_control_disabled/, 'the disabled skill must name the refusal code')
    assert.match(disabledSkill.content, /Desktop actions still work/, 'the disabled skill must say desktop actions still work')
    assert.match(disabledSkill.content, /do not launch or connect a browser|do not work around the refusal/i, 'the disabled skill must forbid working around it')
    assert.match(disabledSkill.content, /do not ask for another browser tool/, 'the disabled skill must forbid another browser tool')
    assert.ok(!disabledSkill.content.includes('## Browser control is off\n## Browser control is off'), 'the notice is inserted once')
    assert.equal(disabledSkill.name, WIN_PILOT_SKILL.name)
    assert.equal(disabledSkill.source, 'runtime')
    // The desktop/task substitution still applies to the disabled variant.
    const taskDisabled = createWinPilotSkill('task', false)
    assert.deepEqual(JSON.parse(JSON.stringify(taskDisabled)), taskDisabled, 'the task skill must stay lossless JSON')
    assert.match(createWinPilotSkill('task', false).content, /Never fall back to the main desktop/)
    assert.match(createWinPilotSkill('current', false).content, /current interactive Windows session/)
    // Returning to the default restores the exact original body.
    resetSettingsForTest()
    assert.equal(tool.skillForAgent({}).content, WIN_PILOT_SKILL.content)
  }

  // --- runtime status reports the channel state -------------------------
  {
    resetSettingsForTest()
    const enabled = getRuntimeStatus()
    assert.equal(enabled.browser_control, 'enabled', 'the default status must report browser control as enabled')
    assert.equal(enabled.ok, true)
    for (const key of ['name', 'version', 'platform', 'arch', 'node', 'desktop_environment', 'daemon', 'providers', 'capabilities']) {
      assert.ok(key in enabled, `the status must keep its existing field: ${key}`)
    }
    setSettingsForTest({ browserControl: false })
    assert.equal(getRuntimeStatus().browser_control, 'disabled', 'a disabled setting must be reported by diagnostics')
    assert.equal(getRuntimeStatus({ desktopEnvironment: 'task' }).browser_control, 'disabled', 'the field tracks the same resolved settings on any desktop')
    resetSettingsForTest()
    assert.equal(getRuntimeStatus().browser_control, 'enabled')
  }

  assert.equal(spawnAttempts, 0, 'no real process may start')
  console.log('PASS: browserControl=off refuses browser_* / browser conditions / headless launches before dispatch, keeps desktop actions working, and reports the live state')
} finally {
  await Promise.all([tool.close(), desktopTool.close()])
  resetSettingsForTest()
  Object.assign(controlCoordinator, coordinatorMethods)
  childProcess.spawn = originalSpawn
  syncBuiltinESMExports()
}
