import assert from 'node:assert/strict'
import { WIN_PILOT_SKILL, WIN_PILOT_SKILL_HINT } from '../lib/win-pilot-skill.js'
import { apply, defineComputerTool } from '../lib/index.js'

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
console.log('PASS: Win-Pilot runtime skill is complete and discoverable from computer')
