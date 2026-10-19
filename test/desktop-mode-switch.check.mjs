import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

const originalSpawn = childProcess.spawn
childProcess.spawn = () => { throw new Error('Mode switching must not touch the current desktop') }
syncBuiltinESMExports()
const { defineComputerTool } = await import('../lib/index.js')
const { applyConfigSnapshot, resetSettingsForTest } = await import('../lib/settings.js')
const { controlCoordinator } = await import('../lib/control-session.js')
const originals = Object.fromEntries(['newSession', 'run', 'close', 'idle'].map(key => [key, controlCoordinator[key]]))
let sequence = 0
const closed = [], nativeCalls = [], browserClosed = []
Object.assign(controlCoordinator, {
  newSession: () => `switch-${++sequence}`,
  run: (_id, _args, signal, execute) => execute(signal),
  close: async id => { closed.push(id) },
  idle: () => false,
})
let environment = 'current'
applyConfigSnapshot({ desktopEnvironment: { get: () => environment }, statusPill: false, overlay: false })
const tool = defineComputerTool(value => value, {}, {
  browserProvider: { closeSession: async id => { browserClosed.push(id) } },
  taskDesktopProvider: {
    execute: async (action, args) => { nativeCalls.push({ action, args }); return { ok: true, action, outcome: 'completed' } },
    close: async () => {},
  },
})
const agent = {}
try {
  assert.match(tool.skillForAgent(agent).content, /current interactive Windows session/)
  environment = 'task'
  assert.ok(/Never fall back to the main desktop/.test(tool.skillForAgent(agent).content),
    'changing DSH settings must update the existing chat skill')
  const observation = await tool.execute({ action: 'list_windows' }, { agent })
  assert.equal(observation.desktop_environment, 'task', 'an existing chat must use the selected desktop')
  assert.equal(nativeCalls.at(-1).action, 'list_windows')
  assert.ok(closed.length, 'the previous control session must be closed before routing changes')
  assert.deepEqual(browserClosed, closed, 'old browser claims must be released with the previous session')
  const taskSession = nativeCalls.at(-1).args.control_session_id
  environment = 'current'
  const refused = await tool.execute({ action: 'click', x: 10, y: 10 }, { agent })
  assert.equal(refused.error_code, 'desktop_environment_changed', 'old target coordinates require a fresh observation')
  assert.equal(refused.actionSent, false)
  assert.ok(closed.includes(taskSession))
  const staleScreenshot = await tool.execute({ action: 'screenshot', hwnd: 12345 }, { agent })
  assert.equal(staleScreenshot.error_code, 'desktop_environment_changed')

  let releaseCleanup
  const cleanupGate = new Promise(resolve => { releaseCleanup = resolve })
  controlCoordinator.close = async id => { closed.push(id); await cleanupGate }
  environment = 'task'
  const before = nativeCalls.length, closedBefore = closed.length
  const pending = [tool.execute({ action: 'list_windows' }, { agent }), tool.execute({ action: 'list_apps' }, { agent })]
  await Promise.resolve()
  assert.equal(nativeCalls.length, before, 'new desktop input must wait for old-session cleanup')
  releaseCleanup()
  const results = await Promise.all(pending)
  assert.ok(results.every(result => result.ok && result.desktop_environment === 'task'))
  assert.equal(closed.length, closedBefore + 1, 'concurrent requests share one transition')
  const stoppedSession = nativeCalls.at(-1).args.control_session_id
  controlCoordinator.stop(stoppedSession)
  environment = 'current'
  await tool.execute({ action: 'click', x: 10, y: 10 }, { agent })
  assert.equal((await tool.execute({ action: 'control_status' }, { agent })).control.stopped, true,
    'changing desktops must not implicitly resume a stopped session')

  controlCoordinator.close = async () => { throw new Error('fixture cleanup failed') }
  environment = 'task'
  const failedSwitch = await tool.execute({ action: 'list_windows' }, { agent })
  assert.equal(failedSwitch.error_code, 'desktop_environment_switch_failed')
  assert.equal(failedSwitch.actionSent, false)
  assert.equal(nativeCalls.length, before + 2, 'failed cleanup cannot dispatch to either desktop')
  controlCoordinator.close = async id => { closed.push(id) }
  assert.equal((await tool.execute({ action: 'list_windows' }, { agent })).desktop_environment, 'task')
  console.log('desktop mode switching check PASSED (same chat, real routing, no current-desktop input)')
} finally {
  await tool.close()
  resetSettingsForTest()
  Object.assign(controlCoordinator, originals)
  childProcess.spawn = originalSpawn
  syncBuiltinESMExports()
}
