param([long]$Window, [string]$Name)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [Windows.Automation.AutomationElement]::FromHandle([IntPtr]$Window)
if ($root.Current.Name -ne 'Win-Pilot controls') { throw 'Unexpected control window' }
$condition = New-Object Windows.Automation.PropertyCondition([Windows.Automation.AutomationElement]::NameProperty, $Name)
$button = $root.FindFirst([Windows.Automation.TreeScope]::Descendants, $condition)
if (-not $button -or -not $button.Current.IsEnabled) { throw 'The named activity button is unavailable' }
$pattern = $null
if ($button.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern, [ref]$pattern)) { $pattern.Invoke() }
else {
  # Framework controls can lack InvokePattern. Deliver the standard button
  # message to the freshly observed, named child without moving user focus.
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ActivityButton {
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SendMessageTimeout(IntPtr h,uint m,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
}
'@
  $target = [IntPtr]$button.Current.NativeWindowHandle
  if (-not [ActivityButton]::IsChild([IntPtr]$Window, $target) -or $button.Current.ClassName -notlike 'WindowsForms*.BUTTON.*') { throw 'Not a native child button' }
  $result = [IntPtr]::Zero
  if ([ActivityButton]::SendMessageTimeout($target, 0x00F5, [IntPtr]::Zero, [IntPtr]::Zero, 2, 10000, [ref]$result) -eq [IntPtr]::Zero) { throw 'The button response is uncertain; do not repeat the click' }
}
'ACTIVITY_CONTROL_SENT'
