# Fixture: assert the non-preemptive restore primitive directly.
#
# Racing a live foreground change against the helper's baseline capture is
# timing-dependent (PowerShell startup alone is 1-3s), so the property that
# actually matters is tested here instead: TryRestoreForeground must ASK for the
# foreground and report a refusal, unlike ForceForeground which always took it.
#
# Prints PASS/FAIL lines; the caller asserts on the exit code.
$ErrorActionPreference = 'Stop'
$helper = Join-Path $PSScriptRoot '..\..\lib\win-pilot-helper.ps1'

# Compile only the DshWin32 class out of the bundled helper. The bundle
# concatenates several Add-Type blocks, so take the DshWin32 one and cut it at
# the next class.
$src = Get-Content $helper -Raw
$body = $null
foreach ($m in [regex]::Matches($src, "(?s)Add-Type -TypeDefinition @'\r?\n(.*?)\r?\n'@")) {
  if ($m.Groups[1].Value -match 'class DshWin32') { $body = $m.Groups[1].Value; break }
}
if (-not $body) { Write-Output 'FAIL: DshWin32 type definition not found in the helper bundle'; exit 1 }
$start = $body.IndexOf('public static class DshWin32')
$end = $body.IndexOf('public static class WinPilotDeadline')
if ($start -lt 0) { Write-Output 'FAIL: DshWin32 class not found'; exit 1 }
if ($end -gt $start) { $body = $body.Substring(0, $end) }

Add-Type -TypeDefinition ("using System.Windows.Forms;`n" + $body) -ReferencedAssemblies @(
  'System.Windows.Forms', 'System.Drawing', 'System.Linq', 'System.Collections',
  'System.Threading', 'System.Threading.Thread', 'System.Runtime', 'System.Runtime.InteropServices'
)

$failures = New-Object System.Collections.Generic.List[string]

# 1. The primitive exists, and the preemptive one is kept for explicit paths.
if (-not [DshWin32].GetMethod('TryRestoreForeground')) { $failures.Add('TryRestoreForeground must exist') }
if (-not [DshWin32].GetMethod('ForceForeground')) { $failures.Add('ForceForeground must remain for explicit foreground paths') }

# 2. The restore must be materially smaller than the force: no AttachThreadInput
#    dance and no synthetic ALT/ESC sequence.
$restoreIl = [DshWin32].GetMethod('TryRestoreForeground').GetMethodBody().GetILAsByteArray()
$forceIl = [DshWin32].GetMethod('ForceForeground').GetMethodBody().GetILAsByteArray()
Write-Output ("  restore IL={0} bytes, force IL={1} bytes" -f $restoreIl.Length, $forceIl.Length)
if ($restoreIl.Length -ge $forceIl.Length) {
  $failures.Add('TryRestoreForeground must be smaller than ForceForeground (no attach/ALT-ESC sequence)')
}

# 3. A restore it cannot perform must report failure rather than forcing one.
$bogus = [IntPtr]::new(0x12345678)
if ([DshWin32]::TryRestoreForeground($bogus)) { $failures.Add('a bogus hwnd must not report a successful restore') }
if ([DshWin32]::TryRestoreForeground([IntPtr]::Zero)) { $failures.Add('a null hwnd must not report success') }

# 4. Already-foreground is a no-op success.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FocusFixtureProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@
$fg = [FocusFixtureProbe]::GetForegroundWindow()
if ($fg -ne [IntPtr]::Zero) {
  if (-not [DshWin32]::TryRestoreForeground($fg)) {
    $failures.Add('restoring the window that already has focus must report success')
  }
} else {
  Write-Output '  note: no foreground window in this session; skipped the already-foreground case'
}

if ($failures.Count -gt 0) {
  foreach ($f in $failures) { Write-Output "FAIL: $f" }
  exit 1
}
Write-Output 'RESTORE_PRIMITIVE_OK'
