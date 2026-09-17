import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const helper = fileURLToPath(new URL('../lib/win-pilot-helper.ps1', import.meta.url))
const ps = String.raw`
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${helper.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0] }
$fn = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Test-HiddenProcessMarker' }, $false)
if ($null -eq $fn) { throw 'Test-HiddenProcessMarker function missing' }
. ([scriptblock]::Create($fn.Extent.Text))
$process = Get-Process -Id $PID
$started = $process.StartTime.ToFileTimeUtc()
if (-not (Test-HiddenProcessMarker -RawMarker "$PID|$started")) { throw 'live matching process marker rejected' }
if (Test-HiddenProcessMarker -RawMarker "$PID|$($started + 1)") { throw 'reused PID marker accepted' }
if (Test-HiddenProcessMarker -RawMarker "$PID") { throw 'legacy PID-only marker accepted' }
if (Test-HiddenProcessMarker -RawMarker 'not-a-marker') { throw 'corrupt marker accepted' }
Write-Output 'hidden process marker validation passed'
`

const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
  encoding: 'utf8', timeout: 10000, windowsHide: true,
})
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`)
console.log(result.stdout.trim())
