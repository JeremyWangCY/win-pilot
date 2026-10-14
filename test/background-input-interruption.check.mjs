import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') {
  console.log('background input interruption check SKIPPED (Windows fixture required)')
} else {
  const fixture = fileURLToPath(new URL('./fixtures/background-input-interruption.ps1', import.meta.url))
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fixture], {
    encoding: 'utf8', timeout: 20000, windowsHide: true,
  })
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`)
  assert.match(result.stdout, /BACKGROUND_INPUT_INTERRUPTION_OK/)
  console.log('background input interruption check PASSED (real function bodies, mock monitor/WM; no desktop input)')
}
