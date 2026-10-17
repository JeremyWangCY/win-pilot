import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import path from 'node:path'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { pathToFileURL } from 'node:url'

// Install before imports: no helper, input process, GUI or native session may run.
const originalSpawn = childProcess.spawn
let spawnAttempts = 0
childProcess.spawn = () => { spawnAttempts++; throw new Error('REAL PROCESS START FORBIDDEN IN MODE CONTRACT TEST') }
syncBuiltinESMExports()
const { apply, Config, defineComputerTool } = await import('../lib/index.js')
const { loadSchemastery, resetSettingsForTest } = await import('../lib/settings.js')
const { controlCoordinator } = await import('../lib/control-session.js')
const methods = Object.fromEntries(['newSession','run','close','idle'].map(key => [key,controlCoordinator[key]]))
let nextSession = 0
Object.assign(controlCoordinator, {
  newSession:() => `mode-contract-${++nextSession}`,
  // This test covers host configuration and session binding. Native routing and
  // CDP ownership are separately exercised by task-desktop-routing.check.mjs.
  run:async (_id, args) => ({ ok:true, action:args.action, outcome:'completed' }),
  close:async () => {}, idle:() => false,
})

let tool
try {
  const Schema = loadSchemastery()
  assert.ok(Schema && Config, 'real DSH volatile Config is required for this integration test')
  const roots = [process.env.DSH_HOST_MODULES,
    process.env.USERPROFILE && path.join(process.env.USERPROFILE,'.dsh','profiles','desktop','node_modules'),
    process.env.APPDATA && path.join(process.env.APPDATA,'com.jeremy.deepx-workbench','runtime','node_modules')].filter(Boolean)
  let updateVolatile, defineTool
  for (const root of roots) {
    try {
      const req = createRequire(path.join(root,'noop.js'))
      const mod = req('@deepseek-ai/schemastery')
      if ((mod.default || mod) !== Schema) continue
      updateVolatile = (await import(pathToFileURL(req.resolve('@deepseek-ai/cosmokit')).href)).updateVolatile
      defineTool = req('@deepseek-ai/dsh-tools').defineTool
      break
    } catch { /* another installed runtime may provide these modules */ }
  }
  assert.equal(typeof updateVolatile,'function')
  assert.equal(typeof defineTool,'function')
  assert.equal(Config.dict.desktopEnvironment.meta.volatile,true)
  const parse = input => {
    const result = Config['~standard'].validate(input)
    assert.equal(result.issues,undefined)
    return result.value
  }
  const config = parse({desktopEnvironment:'current',overlay:false,statusPill:false})
  let provider
  apply({
    tools:{register(value) { tool = value }},
    skills:{
      register() { assert.fail('DSH runtime register(skill) clones content; use the live provider API') },
      registerProvider(create) { provider = create({ signal:new AbortController().signal, invalidate() {} }) },
    },
  },config)
  assert.ok(provider && tool)
  const candidates = structuredClone(await provider.list({}))
  assert.doesNotMatch(JSON.stringify(candidates),/task.?desktop|second desktop|alternate session|independent.*desktop|virtual desktop/i)
  const skillFor = agent => provider.get(candidates[0],{scope:agent})
  const oldAgent = {}, enabledAgent = {}, disabledAgent = {}
  assert.match((await skillFor(oldAgent)).content,/current interactive Windows session/)
  const request = {action:'list_apps'}
  assert.equal((await tool.execute(request,{agent:oldAgent})).desktop_environment,'current')
  const originalReference = config.desktopEnvironment
  updateVolatile(config.desktopEnvironment,parse({desktopEnvironment:'task'}).desktopEnvironment)
  assert.equal(config.desktopEnvironment,originalReference,'Loader edits retain the Config reference')
  assert.match((await skillFor(enabledAgent)).content,/Never fall back to the main desktop/)
  assert.equal((await tool.execute(request,{agent:enabledAgent})).desktop_environment,'task')
  assert.match((await skillFor(oldAgent)).content,/current interactive Windows session/)
  assert.equal((await tool.execute(request,{agent:oldAgent})).desktop_environment,'current')
  updateVolatile(config.desktopEnvironment,parse({desktopEnvironment:'current'}).desktopEnvironment)
  const disabledSkill = await skillFor(disabledAgent)
  assert.doesNotMatch(JSON.stringify(disabledSkill),/task.?desktop|second desktop|alternate session|independent.*desktop|virtual desktop/i)
  assert.equal((await tool.execute(request,{agent:disabledAgent})).desktop_environment,'current')
  assert.equal((await tool.execute(request,{agent:enabledAgent})).desktop_environment,'task','settings never move an already-bound task')
  assert.match((await skillFor(enabledAgent)).content,/Never fall back to the main desktop/)
  const schema = JSON.stringify({description:tool.description,parameters:tool.parameters})
  assert.doesNotMatch(schema,/task.?desktop|desktopEnvironment|desktop_environment|second desktop|virtual desktop/i)

  // The real DSH defineTool copies only public fields. These trusted lifecycle
  // methods must survive that copy without entering schemas or model JSON.
  const defined = defineComputerTool(defineTool,{})
  for (const key of ['close','taskDesktop','waitForTaskDesktopClose','skillForAgent']) {
    assert.equal(typeof defined[key],'function')
    assert.equal(Object.keys(defined).includes(key),false)
  }
  await defined.close()
  assert.equal(spawnAttempts,0)
  console.log('desktop mode contract PASSED (real DSH Config/volatile/defineTool; mock registry and dispatcher; zero process starts)')
} finally {
  await tool?.close()
  resetSettingsForTest()
  Object.assign(controlCoordinator,methods)
  childProcess.spawn = originalSpawn
  syncBuiltinESMExports()
}
