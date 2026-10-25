import assert from 'node:assert/strict'
import childProcess from 'node:child_process'
import { syncBuiltinESMExports } from 'node:module'

const originalSpawn = childProcess.spawn
childProcess.spawn = () => { throw new Error('REAL PROCESS START FORBIDDEN IN SKILL TEST') }
syncBuiltinESMExports()
const { WIN_PILOT_SKILL, WIN_PILOT_SKILL_HINT, createWinPilotSkill } = await import('../lib/win-pilot-skill.js')
const { apply, defineComputerTool } = await import('../lib/index.js')

assert.equal(WIN_PILOT_SKILL.name, 'win-pilot')
assert.equal(WIN_PILOT_SKILL.source, 'runtime')
assert.match(WIN_PILOT_SKILL.description, /Windows desktop|Chromium browser/i)
for (const rule of ['get_window_state', 'element_index', 'snapshot_id', 'accessibility_status', 'browser_state', 'browser_observe', '@eN', 'browser_endpoint', '`unknown`', 'background']) {
  assert.ok(WIN_PILOT_SKILL.content.includes(rule), `skill must teach ${rule}`)
}

const registered = defineComputerTool((tool) => tool, {})
assert.ok(registered.description.includes(WIN_PILOT_SKILL_HINT), 'tool description routes a zero-context agent to the runtime skill')
let registeredSkill
let registeredTool
apply({
  tools: { register(tool) { registeredTool = tool } },
  skills: { register(skill) { registeredSkill = skill } },
})
assert.equal(registeredSkill, WIN_PILOT_SKILL, 'apply registers the exact model-facing skill with DSH')
assert.equal(registeredTool?.name, 'computer', 'apply registers the computer tool under DSH schema validation')
// Scope-aware DSH hosts register a provider factory and await its results, so
// list()/get() must return thenables. Returning plain arrays/objects makes the
// host fail with "promise.then is not a function" when it awaits them.
let providerFactory
const providerCtx = {
  tools: { register(tool) { registeredTool = tool } },
  skills: { register() {}, registerProvider(create) { providerFactory = create } },
}
apply(providerCtx)
assert.equal(typeof providerFactory, 'function', 'apply registers a skill provider factory when the host supports providers')
const provider = providerFactory()
assert.equal(provider.name, 'win-pilot')
const listed = provider.list()
assert.equal(typeof listed?.then, 'function', 'skill provider list() must return a thenable')
const candidates = await listed
assert.equal(candidates.length, 1)
assert.equal(candidates[0].locator, 'win-pilot')
assert.equal(candidates[0].provider, 'win-pilot')
const got = provider.get(candidates[0], { scope: undefined })
assert.equal(typeof got?.then, 'function', 'skill provider get() must return a thenable')
const definition = await got
assert.equal(definition.provider, 'win-pilot')
assert.equal(typeof definition.content, 'string')
assert.deepEqual(JSON.parse(JSON.stringify(definition)), definition, 'skill definition must be lossless JSON')
assert.doesNotMatch(JSON.stringify({ skill:WIN_PILOT_SKILL, description:registered.description, parameters:registered.parameters }), /task.?desktop|second desktop|alternate session|independent.*desktop|virtual desktop/i)
const taskSkill = createWinPilotSkill('task')
assert.match(taskSkill.content, /Never fall back to the main desktop/)
assert.match(taskSkill.content, /Foreground input inside this task desktop is allowed/)
assert.doesNotMatch(taskSkill.content, /Use foreground interaction only|cannot be guaranteed independent/)
childProcess.spawn = originalSpawn
syncBuiltinESMExports()
console.log('PASS: Win-Pilot runtime skill is complete and discoverable from computer')
