$ErrorActionPreference = 'Stop'
$source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot '../../native/helper/observation.ps1'))
$start = $source.IndexOf('function Notify-Cursor {')
if ($start -lt 0) { throw 'Notify-Cursor missing' }
Invoke-Expression $source.Substring($start)
function Get-OverlayEnabled { return $script:overlay }
function Get-PayloadValue { param($Name) if ($Name -eq 'status_pill') { return $script:pill }; return $null }
function Ensure-OverlayProcess { $script:cursorStarted = $true }
function Ensure-StatusbarProcess { $script:pillStarted = $true }
function Write-CursorState { param($X, $Y, $Label, $Show) $script:cursorShown = $Show }
function Write-StatusState { param($Show) $script:pillShown = $Show }
foreach ($overlay in @($false, $true)) {
  foreach ($pill in @($false, $true)) {
    $script:overlay = $overlay; $script:pill = $pill
    $script:cursorStarted = $false; $script:pillStarted = $false
    Notify-Cursor -X 10 -Y 20 -Label 'test'
    if ($script:cursorShown -ne $overlay -or $script:cursorStarted -ne $overlay) { throw 'Cursor preference mismatch' }
    if ($script:pillShown -ne $pill -or $script:pillStarted -ne $pill) { throw 'Status pill preference mismatch' }
  }
}
'SETTINGS_STATUS_OK'
