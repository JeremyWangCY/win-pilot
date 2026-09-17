import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const helper = fileURLToPath(new URL('../lib/win-pilot-helper.ps1', import.meta.url))
const ps = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition 'public static class DshWin32 { public static System.IntPtr GetForegroundWindow() { return System.IntPtr.Zero; } }'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile('${helper.replaceAll("'", "''")}', [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw $errors[0] }
$ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false) |
  ForEach-Object { . ([scriptblock]::Create($_.Extent.Text)) }

function Resolve-TargetWindow {
  return @{ Hwnd = [IntPtr]123; Rect = @{ Left = 200; Top = 150; Right = 800; Bottom = 650 } }
}
function Assert-ScreenshotBinding { }
function Notify-Cursor { param([int]$X, [int]$Y, [string]$Label); $script:notified = @($X, $Y, $Label) }

$payload = [pscustomobject]@{ app = 'fixture'; x = 300; y = 250; dispatch = 'background'; overlay = $true }
$result = Invoke-ActionRequest -Action mouse_move -Payload $payload
if (-not $result.ok) { throw ($result | ConvertTo-Json -Compress -Depth 8) }
if ($result.position.x -ne 500 -or $result.position.y -ne 400) {
  throw "window-relative mouse_move resolved to $($result.position.x),$($result.position.y), expected 500,400"
}
if ($script:notified[0] -ne 500 -or $script:notified[1] -ne 400) {
  throw "overlay received $($script:notified[0]),$($script:notified[1]), expected 500,400"
}
Write-Output 'mouse_move window-relative coordinates passed'
`

const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
  encoding: 'utf8', timeout: 20000, windowsHide: true,
})
assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}\n${result.error ?? ''}`)
console.log(result.stdout.trim())
