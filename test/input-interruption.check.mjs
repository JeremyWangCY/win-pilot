import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(path.join(root, 'native/helper/input-interruption.cs'), 'utf8')
assert.doesNotMatch(source, /GetLastInputInfo|GetTickCount|grace|LLKHF_INJECTED|LLMHF_INJECTED/,
  'Guard must use events and self tags, without idle-time or injected-flag heuristics')
assert.match(source, /SetWindowsHookEx\(13,/)
assert.match(source, /SetWindowsHookEx\(14,/)
assert.match(source, /GetMessage\(out message/)
assert.match(source, /CallNextHookEx\(IntPtr\.Zero, code, message, data\)/)
assert.match(source, /ProcessExit/)

if (process.platform === 'win32') {
  const output = execFileSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(root, 'test/fixtures/input-interruption.ps1'),
  ], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
  assert.match(output, /INPUT_INTERRUPTION_OK/, output)
  const cleanup = execFileSync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(root, 'test/fixtures/input-owned-cleanup.ps1'),
  ], { encoding: 'utf8', windowsHide: true, timeout: 20000 })
  assert.match(cleanup, /INPUT_OWNED_CLEANUP_OK/, cleanup)
}
console.log('input interruption check PASSED')
