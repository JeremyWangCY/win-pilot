param([Parameter(Mandatory=$true)][string]$ActionDonePath)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class PillProbe {
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string cls,string title);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindowEx(IntPtr parent,IntPtr after,string cls,string title);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
'@
$seen = $false; $hiddenAfter = $false
$foreground = [PillProbe]::GetForegroundWindow()
$focusStable = $true
$watch = [Diagnostics.Stopwatch]::StartNew()
$doneAt = $null
$hiddenDuringAction = $false
Write-Output 'READY'
while ($watch.ElapsedMilliseconds -lt 45000) {
  if ($null -eq $doneAt -and (Test-Path -LiteralPath $ActionDonePath)) { $doneAt = $watch.ElapsedMilliseconds }
  $h = [IntPtr]::Zero; $visible = $false
  do {
    $h = [PillProbe]::FindWindowEx([IntPtr]::Zero, $h, 'DshStatusPillCls', $null)
    if ($h -ne [IntPtr]::Zero -and [PillProbe]::IsWindowVisible($h)) { $visible = $true }
  } while ($h -ne [IntPtr]::Zero)
  if ($visible) { $seen = $true }
  if ($seen -and -not $visible -and $null -eq $doneAt) { $hiddenDuringAction = $true }
  if ($null -ne $doneAt -and $seen -and -not $visible) { $hiddenAfter = $true; break }
  if ([PillProbe]::GetForegroundWindow() -ne $foreground) { $focusStable = $false }
  if ($null -ne $doneAt -and ($watch.ElapsedMilliseconds - $doneAt) -ge 8500) { break }
  Start-Sleep -Milliseconds 80
}
@{ seen = $seen; hidden_after = $hiddenAfter; foreground_stable = $focusStable; hidden_during_action = $hiddenDuringAction } | ConvertTo-Json -Compress
