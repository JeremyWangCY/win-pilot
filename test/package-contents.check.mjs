import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const isWindows = process.platform === 'win32'
const packed = JSON.parse(execFileSync(
  isWindows ? (process.env.ComSpec || 'cmd.exe') : 'npm',
  isWindows ? ['/d', '/s', '/c', 'npm pack --dry-run --json'] : ['pack', '--dry-run', '--json'],
  {
  encoding: 'utf8',
  windowsHide: true,
  }
))
const paths = new Set(packed[0]?.files?.map((file) => file.path) || [])
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

assert.equal(packageJson.bin?.['win-pilot'], 'bin/win-pilot.js', 'published manifest must expose the win-pilot CLI bin mapping')
assert.ok(paths.has('lib/wgc/win-pilot-wgc.exe'), 'runtime WGC executable must be packaged')
for (const name of ['win-pilot-task-desktop.exe','win-pilot-task-desktop.dll','win-pilot-task-desktop.deps.json','win-pilot-task-desktop.runtimeconfig.json']) {
  assert.ok(paths.has(`lib/task-desktop/${name}`), `task desktop component must be packaged: ${name}`)
}
assert.ok(!paths.has('lib/task-desktop/safety-hold.json'), 'verified delivery must not ship the temporary investigation hold')
assert.ok(!paths.has('lib/task-desktop/win-pilot-task-desktop.pdb'), 'task desktop debug symbols must not be packaged')
assert.ok(paths.has('bin/win-pilot.js'), 'standalone win-pilot CLI must be packaged')
assert.ok(paths.has('lib/mcp-server.js'), 'MCP stdio server must be packaged')
assert.ok(paths.has('skills/win-pilot/SKILL.md'), 'agent-neutral skill must be packaged')
assert.ok(paths.has('lib/runtime.js'), 'standalone runtime API must be packaged')
assert.ok(paths.has('lib/cli.js'), 'CLI implementation must be packaged')
assert.ok(paths.has('lib/browser-provider.js'), 'browser provider interface must be packaged')
assert.ok(paths.has('lib/settings.js'), 'user-settings module must be packaged')
assert.ok(paths.has('lib/client.js'), 'settings card client bundle must be packaged')
assert.equal(packageJson.exports?.['./settings'], './lib/settings.js', 'the settings module must be exported')
assert.equal(packageJson.exports?.['./client'], './lib/client.js', 'the client bundle must be exported')
assert.equal(packageJson.dsh?.client?.platform, 'web', 'the client half must declare the web platform')
assert.ok(!paths.has('lib/wgc/win-pilot-wgc.pdb'), 'debug PDB must not be packaged')
for (const file of paths) {
  assert.ok(!file.startsWith('artifacts/'), `diagnostic artifact must not be packaged: ${file}`)
  assert.ok(!/(^|\/)scripts\/.*bili/i.test(file), `one-off Bilibili script must not be packaged: ${file}`)
}

console.log(`package contents check PASSED (${paths.size} files)`)
