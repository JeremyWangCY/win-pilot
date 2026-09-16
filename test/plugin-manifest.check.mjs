import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const plugin = JSON.parse(await readFile(new URL('../.codex-plugin/plugin.json', import.meta.url), 'utf8'))
const mcp = JSON.parse(await readFile(new URL('../.mcp.json', import.meta.url), 'utf8'))
const skill = await readFile(new URL('../skills/win-pilot/SKILL.md', import.meta.url), 'utf8')

assert.equal(plugin.name, 'win-pilot')
assert.equal(plugin.version, '0.1.0')
assert.equal(plugin.skills, './skills/')
assert.equal(plugin.mcpServers, './.mcp.json')
assert.deepEqual(mcp.mcpServers['win-pilot'].args, ['-y', 'github:JeremyWangCY/win-pilot#v0.1.0', 'mcp'])
assert.match(skill, /^---\r?\nname: win-pilot\r?\n/)

console.log('plugin manifest check PASSED')
