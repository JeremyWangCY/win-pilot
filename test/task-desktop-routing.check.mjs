import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'

// A routing regression must never execute the real helper, status-bar GUI, or
// native task host. Import the implementation only after installing the guard.
const originalSpawn = childProcess.spawn
let forbiddenSpawnAttempts = 0
childProcess.spawn = () => { forbiddenSpawnAttempts++; throw new Error('REAL PROCESS START FORBIDDEN IN MOCK TEST') }
syncBuiltinESMExports()
const {createWinPilotRuntime, getRuntimeStatus, doctor} = await import('../lib/runtime.js')
const {defineComputerTool} = await import('../lib/index.js')
const {getTaskDesktopAvailability} = await import('../lib/task-desktop.js')
const {controlCoordinator} = await import('../lib/control-session.js')
const {setSettingsForTest, resetSettingsForTest} = await import('../lib/settings.js')

// Routing does not need the cross-process input lease implementation. Keep
// these tests entirely in memory; its real IPC is covered by separate tests.
const coordinatorMethods = Object.fromEntries(['newSession','run','close','idle'].map(key => [key, controlCoordinator[key]]))
let nextSession = 0
Object.assign(controlCoordinator, {
  newSession: () => `mock-session-${++nextSession}`,
  run: (_id, _request, signal, execute) => execute(signal),
  close: async () => {},
  idle: () => false,
})
setSettingsForTest({desktopEnvironment:'task', statusPill:true, overlay:false})

const browserCalls = [], nativeCalls = []
const endpoint = 'ws://127.0.0.1:9222/devtools/browser/task-owned'
const mainEndpoint = 'ws://127.0.0.1:9222/devtools/browser/main-user'
const browserProvider = {
  name:'mock-browser', capabilities:{}, closeSession:async () => {},
  execute:async (action, args) => {
    browserCalls.push({action,args})
    return {ok:true,action,outcome:'completed',browser_endpoint:args.browser_endpoint,url:'https://example.test/ready',tabs:[]}
  },
}
const taskDesktopProvider = {
  execute:async (action, args) => {
    nativeCalls.push({action,args})
    if (args.app === 'throw-child') throw new Error('Mock child desktop disconnected')
    if (args.app === 'fail-child') return {ok:false,action,outcome:'not_executed',error_code:'task_desktop_not_ready',message:'Mock child desktop is unavailable'}
    if (action === 'launch_app') return {ok:args.name !== 'failed', action, outcome:'completed',headless:true,browser_profile_owned:true,browser_endpoint:args.name === 'failed' ? mainEndpoint : endpoint,pid:4242}
    return {ok:true,action,outcome:'completed'}
  },
  command:async () => { throw new Error('Diagnostics must not open or command a task desktop') },
  close:async () => {},
}
let runtime
try {
  runtime = createWinPilotRuntime({browserProvider,taskDesktopProvider,
    activityReporter:{begin:async()=>{},finish(){},remove(){},close:async()=>{}}})
  setSettingsForTest({desktopEnvironment:'current',statusPill:true,overlay:false})
  assert.equal(runtime.status().desktop_environment,'task','runtime captures its environment before its first action')
  assert.equal(runtime.status().providers.desktop,process.platform === 'win32' ? 'windows-child-session' : 'unavailable')
  assert.deepEqual(runtime.status().task_desktop,getTaskDesktopAvailability())
  const diagnostic = await runtime.doctor({probe:true,desktopEnvironment:'current'})
  assert.equal(diagnostic.desktop_environment,'task','call options cannot redirect trusted runtime diagnostics to the main desktop')
  assert.equal(diagnostic.ok,false,'a skipped task probe does not prove readiness')
  assert.equal(diagnostic.checks.find(check => check.name === 'helper_round_trip').skipped,true)
  assert.equal(nativeCalls.length,0)
  assert.deepEqual(getRuntimeStatus({desktopEnvironment:'task'}).task_desktop,getTaskDesktopAvailability())
  assert.equal((await doctor({desktopEnvironment:'task',probe:true})).checks.find(check => check.name === 'helper_round_trip').skipped,true)
  assert.doesNotMatch(JSON.stringify(getRuntimeStatus({desktopEnvironment:'current'})), /task.?desktop|child.session|independent.*desktop/i)
  assert.doesNotMatch(JSON.stringify(await doctor({desktopEnvironment:'current'})), /task.?desktop|child.session|independent.*desktop/i)

  for (const request of [
    {action:'browser_tabs',browser:{endpoint:mainEndpoint}},
    {action:'browser_navigate',browser_endpoint:mainEndpoint,url:'https://example.test/'},
    {action:'browser_shutdown',browser_endpoint:mainEndpoint},
    {action:'browser_tabs',browser_endpoint:mainEndpoint,when:{type:'browser_url',url:'https://example.test/'}},
    {action:'get_window',app:'fixture',browser_endpoint:mainEndpoint,expect:{type:'browser_url',url:'https://example.test/'}},
  ]) {
    const result = await runtime.run(request)
    assert.equal(result.error_code,'browser_not_owned',JSON.stringify(result))
    assert.equal(result.outcome,'not_executed')
    assert.equal(result.actionSent,false)
  }
  assert.equal(browserCalls.length,0,'unowned preconditions cannot attach a CDP provider')
  assert.equal(nativeCalls.length,0,'invalid browser expectations refuse before a native action')

  await runtime.act('launch_app',{name:'failed',headless:true})
  assert.equal((await runtime.act('browser_tabs',{browser_endpoint:mainEndpoint})).error_code,'browser_not_owned','a failed launch does not grant endpoint ownership')
  await runtime.act('launch_app',{name:'msedge',headless:true})
  const forged = await runtime.act('get_window',{app:'fixture',desktopEnvironment:'current',desktop_environment:'current',task_desktop:false})
  assert.equal(forged.desktop_environment,'task')
  assert.equal(nativeCalls.at(-1).args.dispatch,'foreground','task desktop foreground input is the configured default')
  for (const field of ['desktopEnvironment','desktop_environment','task_desktop']) assert.equal(field in nativeCalls.at(-1).args,false,'model environment fields never reach the native provider')
  const forgedBatch = await runtime.run({desktopEnvironment:'current',actions:[{action:'get_window',app:'fixture',desktop_environment:'current'}]})
  assert.equal(forgedBatch.desktop_environment,'task')
  for (const action of ['list_apps','list_windows','get_window_state','screenshot','read_clipboard','write_clipboard','list_displays','cursor_position','get_app_identity']) {
    const before = nativeCalls.length
    assert.equal((await runtime.act(action,{app:'fixture'})).ok,true,action)
    assert.equal(nativeCalls[before].action,action,`${action} stays inside the child desktop provider`)
  }
  const beforeClick = nativeCalls.length
  await runtime.act('click',{app:'fixture',x:5,y:5})
  assert.deepEqual(nativeCalls.slice(beforeClick).map(call => call.action),['click','get_window_state'],'automatic observation uses the child provider too')
  for (const [app,errorCode] of [['fail-child','task_desktop_not_ready'],['throw-child','native_action_rejected']]) {
    const failed = await runtime.act('get_window',{app})
    assert.equal(failed.ok,false)
    assert.equal(failed.error_code,errorCode)
    assert.equal(failed.desktop_environment,'task','a refusal or disconnection never changes the desktop')
  }
  const opened = await runtime.act('browser_tabs',{browser:{endpoint}})
  assert.equal(opened.ok,true)
  assert.equal(browserCalls.at(-1).args.browser_endpoint,endpoint)
  const expected = await runtime.act('get_window',{app:'fixture',browser_endpoint:endpoint,tab_id:'tab-1',expect:{type:'browser_url',url:'https://example.test/ready'}})
  assert.equal(expected.ok,true,JSON.stringify(expected))
  assert.equal(browserCalls.at(-1).action,'browser_state','owned postconditions use the same endpoint')
  const noActivity = {begin:async()=>{},finish(){},remove(){},close:async()=>{}}
  const separate = createWinPilotRuntime({desktopEnvironment:'task',browserProvider,taskDesktopProvider,activityReporter:noActivity})
  try {
    assert.equal((await separate.act('browser_tabs',{browser_endpoint:endpoint})).error_code,'browser_not_owned','another runtime cannot reuse a task endpoint without ownership')
  } finally { await separate.close() }

  const tool = defineComputerTool(value => value, {}, {desktopEnvironment:'task',browserProvider,taskDesktopProvider,activityReporter:noActivity})
  const agentA = {}, agentB = {}
  try {
    await tool.execute({action:'launch_app',name:'msedge',headless:true},{agent:agentA})
    assert.equal((await tool.execute({action:'browser_tabs',browser_endpoint:endpoint},{agent:agentB})).error_code,'browser_not_owned','different tasks in one tool instance do not share owned CDP endpoints')
    assert.equal((await tool.execute({action:'browser_tabs',browser_endpoint:endpoint},{agent:agentA})).ok,true)
    assert.equal((await tool.execute({action:'browser_shutdown',browser_endpoint:endpoint},{agent:agentA})).ok,true)
    assert.equal((await tool.execute({action:'browser_tabs',browser_endpoint:endpoint},{agent:agentA})).error_code,'browser_not_owned','shutdown revokes the endpoint capability')
  } finally { await tool.close() }
  assert.equal(forbiddenSpawnAttempts,0,'routing tests with the activity presenter disabled must not start main-desktop helpers')
  console.log('task desktop ownership and non-invasive diagnostics mock check PASSED')
} finally {
  await runtime?.close()
  resetSettingsForTest()
  Object.assign(controlCoordinator,coordinatorMethods)
  childProcess.spawn = originalSpawn
  syncBuiltinESMExports()
}
