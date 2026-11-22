import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const plugin = JSON.parse(await readFile(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8'))
const mcp = JSON.parse(await readFile(new URL('../.mcp.json', import.meta.url), 'utf8'))
const agyPlugin = JSON.parse(await readFile(new URL('../plugin.json', import.meta.url), 'utf8'))
const agyMcp = JSON.parse(await readFile(new URL('../mcp_config.json', import.meta.url), 'utf8'))
const skill = await readFile(new URL('../skills/win-pilot/SKILL.md', import.meta.url), 'utf8')

assert.equal(plugin.name, 'win-pilot')
assert.equal(plugin.version, pkg.version)
assert.equal(plugin.skills, './skills/')
assert.equal(plugin.mcpServers, './.mcp.json')
assert.deepEqual(mcp.mcpServers['win-pilot'].args, ['-y', `win-pilot@${pkg.version}`, 'mcp'])
assert.match(skill, /^---\r?\nname: win-pilot\r?\n/)

// Antigravity plugin manifest contract (only allowed top-level fields).
const ALLOWED_AGY_FIELDS = new Set(['name', 'description', 'logo', 'suggestedPrompts', 'displayName', 'version', 'author', 'homepage', 'repository', 'disabled'])
for (const key of Object.keys(agyPlugin)) {
  assert.ok(ALLOWED_AGY_FIELDS.has(key), `unexpected top-level field in plugin.json: ${key}`)
}
assert.equal(agyPlugin.name, 'win-pilot')
assert.equal(agyPlugin.version, pkg.version)
assert.ok(typeof agyPlugin.logo === 'string' && existsSync(new URL(`../${agyPlugin.logo}`, import.meta.url)), 'plugin.json logo must exist')
assert.ok(Array.isArray(agyPlugin.suggestedPrompts) && agyPlugin.suggestedPrompts.length === 3, 'plugin.json should provide 3 suggestedPrompts')
assert.deepEqual(agyMcp.mcpServers['win-pilot'].args, ['-y', `win-pilot@${pkg.version}`, 'mcp'])

console.log('plugin manifest check PASSED')
