# Fixture: the premise that makes the user-activity guard sound.
#
# The guard reads the system-wide last-input tick and refuses background input
# when it is fresh. That is only correct if Win-Pilot's OWN background input does
# not advance that tick — otherwise the guard would refuse its own actions.
#
# Measures each input method Win-Pilot can use:
#   background: PostMessage / SendMessage WM_CHAR, WM_KEYDOWN/UP, UIA ValuePattern
#   foreground: SendInput, keybd_event (the real input queue)
#
# Expected: background methods leave the tick alone; real input advances it.
# Prints USER_ACTIVITY_PREMISE_OK on success or FAIL: lines on failure.
#
# Harness note: results travel through a script-scoped slot, not a return value,
# because a function that emits both a display line and a value makes
# `$r = Probe ...` capture an ARRAY — and a non-empty string is truthy, which
# silently produced a false verdict in an earlier version of this probe.
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Runtime.InteropServices;

public class ActivityFixture {
  [StructLayout(LayoutKind.Sequential)]
  public struct LII { public uint cbSize; public uint dwTime; }

  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII p);
  [DllImport("kernel32.dll")] public static extern uint GetTickCount();
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);

  [StructLayout(LayoutKind.Sequential)]
  public struct INPUT { public uint type; public InputUnion U; }
  [StructLayout(LayoutKind.Explicit)]
  public struct InputUnion { [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)]
  public struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [DllImport("user32.dll")] public static extern uint SendInput(uint n, INPUT[] p, int cb);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte s, uint f, IntPtr e);

  public const uint WM_CHAR = 0x0102;
  public const uint WM_KEYDOWN = 0x0100;
  public const uint WM_KEYUP = 0x0101;
  public const uint KEYEVENTF_KEYUP = 0x0002;

  public static uint Tick() {
    LII l = new LII();
    l.cbSize = (uint)Marshal.SizeOf(typeof(LII));
    if (!GetLastInputInfo(ref l)) return 0;
    return l.dwTime;
  }

  public static void TypeViaSendInput(ushort scan) {
    INPUT[] d = new INPUT[1];
    d[0].type = 1;
    d[0].U.ki = new KEYBDINPUT { wVk = 0, wScan = scan, dwFlags = 0x0004, time = 0, dwExtraInfo = IntPtr.Zero };
    SendInput(1, d, Marshal.SizeOf(typeof(INPUT)));
    INPUT[] u = new INPUT[1];
    u[0].type = 1;
    u[0].U.ki = new KEYBDINPUT { wVk = 0, wScan = scan, dwFlags = 0x0004 | KEYEVENTF_KEYUP, time = 0, dwExtraInfo = IntPtr.Zero };
    SendInput(1, u, Marshal.SizeOf(typeof(INPUT)));
  }
}
"@

$script:adv = $false
function Probe([string]$label, [scriptblock]$body) {
  Start-Sleep -Milliseconds 400
  $before = [ActivityFixture]::Tick()
  & $body | Out-Null
  Start-Sleep -Milliseconds 400
  $after = [ActivityFixture]::Tick()
  $script:adv = ($after -ne $before)
  Write-Output ("  {0,-44} advanced={1}" -f $label, $script:adv)
}

Add-Type -AssemblyName System.Windows.Forms
$target = New-Object System.Windows.Forms.Form
$target.Text = 'wp activity premise'
$target.ShowInTaskbar = $false
$target.StartPosition = 'Manual'
$target.Left = -3000; $target.Top = -3000; $target.Width = 300; $target.Height = 200
$tb = New-Object System.Windows.Forms.TextBox
$tb.Left = 10; $tb.Top = 10; $tb.Width = 250
$target.Controls.Add($tb)
$target.Show()
Start-Sleep -Milliseconds 800
$th = $target.Handle

Probe 'background: PostMessage WM_CHAR' { [ActivityFixture]::PostMessage($th, [ActivityFixture]::WM_CHAR, [IntPtr]65, [IntPtr]0) }
$bg1 = $script:adv
Probe 'background: SendMessage WM_CHAR' { [ActivityFixture]::SendMessage($th, [ActivityFixture]::WM_CHAR, [IntPtr]66, [IntPtr]0) }
$bg2 = $script:adv
Probe 'background: PostMessage WM_KEYDOWN/UP' {
  [ActivityFixture]::PostMessage($th, [ActivityFixture]::WM_KEYDOWN, [IntPtr]67, [IntPtr]0)
  [ActivityFixture]::PostMessage($th, [ActivityFixture]::WM_KEYUP, [IntPtr]67, [IntPtr]0)
}
$bg3 = $script:adv
Probe 'background: UIA ValuePattern.SetValue' {
  try {
    Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
    $rootEl = [System.Windows.Automation.AutomationElement]::FromHandle($th)
    $cond = New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Edit)
    $el = $rootEl.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
    if ($el) {
      $vp = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      $vp.SetValue('uia background write')
    }
  } catch { }
}
$bg4 = $script:adv

$target.Activate()
Start-Sleep -Milliseconds 500
Probe 'foreground: SendInput (our real input)' { [ActivityFixture]::TypeViaSendInput(0x78) }
$fg1 = $script:adv
Probe 'foreground: keybd_event (our real input)' {
  [ActivityFixture]::keybd_event(0x41, 0, 0, [IntPtr]::Zero)
  [ActivityFixture]::keybd_event(0x41, 0, [ActivityFixture]::KEYEVENTF_KEYUP, [IntPtr]::Zero)
}
$fg2 = $script:adv

$target.Dispose()

$backgroundAdvances = ($bg1 -or $bg2 -or $bg3 -or $bg4)
$realInputAdvances = ($fg1 -or $fg2)

Write-Output ""
Write-Output "background own-input advances the tick : $backgroundAdvances (post=$bg1 send=$bg2 key=$bg3 uia=$bg4)"
Write-Output "real input advances the tick           : $realInputAdvances (sendinput=$fg1 keybd=$fg2)"

if ($backgroundAdvances) {
  Write-Output "FAIL: Win-Pilot's own background input advances the last-input tick, so the"
  Write-Output "      activity guard cannot distinguish the user from Win-Pilot in background mode."
  exit 1
}
if (-not $realInputAdvances) {
  Write-Output "FAIL: real input did not advance the tick, so the probe cannot detect the user"
  Write-Output "      on this host and the guard would never fire."
  exit 1
}
Write-Output ""
Write-Output "USER_ACTIVITY_PREMISE_OK"
