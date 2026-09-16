import assert from 'node:assert/strict'
import { getAgentInstallPlan } from '../lib/agent-install.js'

for (const agent of ['codex', 'claude', 'qoder', 'pi', 'dsh']) {
  const plan = getAgentInstallPlan(agent, { executable: 'win-pilot' })
  assert.equal(plan.agent, agent)
  assert.ok(plan.skill.destination.includes('win-pilot'))
  assert.ok(plan.verify.some(command => command.includes('win-pilot doctor')))
}

const genericMcp = getAgentInstallPlan('mcp', {
  executable: 'win-pilot',
  clientCommand: ['nova-agent', 'tools', 'add'],
})
assert.equal(genericMcp.agent, 'mcp')
assert.deepEqual(
  genericMcp.registration.command,
  ['nova-agent', 'tools', 'add', 'win-pilot', '--', 'win-pilot', 'mcp'],
)

const genericCli = getAgentInstallPlan('cli')
assert.equal(genericCli.registration.kind, 'skill-cli')

assert.deepEqual(
  getAgentInstallPlan('codex', { executable: 'win-pilot' }).registration.command,
  ['codex', 'mcp', 'add', 'win-pilot', '--', 'win-pilot', 'mcp'],
)
assert.deepEqual(
  getAgentInstallPlan('claude', { executable: 'win-pilot' }).registration.command,
  ['claude', 'mcp', 'add', '--scope', 'user', 'win-pilot', '--', 'win-pilot', 'mcp'],
)
assert.deepEqual(
  getAgentInstallPlan('qoder', { executable: 'win-pilot' }).registration.command,
  ['qoder', 'mcp', 'add', '-s', 'user', 'win-pilot', '--', 'win-pilot', 'mcp'],
)
assert.equal(getAgentInstallPlan('pi').registration.kind, 'skill-cli')
assert.equal(getAgentInstallPlan('dsh').registration.kind, 'dsh-plugin')
assert.throws(() => getAgentInstallPlan('unknown'), /unsupported agent/)

console.log('agent install check PASSED')
