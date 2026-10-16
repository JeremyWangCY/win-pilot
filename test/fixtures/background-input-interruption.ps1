# Real background-input function bodies with mock transport and monitor.
# No daemon initialization, hooks, windows or physical input.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
public static class WinPilotInputMonitor {
  public static int Checked;
  public static int Dispatched;
  public static int CancelAt = Int32.MaxValue;
  public static bool CancelInSleep;
  public static string BeginError;
  public static bool HasDispatched { get { return Dispatched > 0; } }
  public static void BeginAction() { Dispatched = 0; if (BeginError != null) throw new InvalidOperationException(BeginError); }
  public static void EndAction() { }
  public static void Reset() { Checked = 0; Dispatched = 0; CancelAt = Int32.MaxValue; CancelInSleep = false; BeginError = null; }
  public static void Check() {
    Checked++;
    if (Dispatched >= CancelAt) throw new InvalidOperationException("user_input_interrupted: fixture user input");
  }
  public static void MarkDispatched() { Dispatched++; }
  public static void Sleep(int ms) {
    if (CancelInSleep) throw new InvalidOperationException("user_input_interrupted: fixture input during hold");
    Check();
  }
}
public static class DshWin32 {
  public const uint SMTO_ABORTIFHUNG = 2;
  public struct POINT { public int X; public int Y; }
  public static List<string> Events = new List<string>();
  public static int RejectKey = -1;
  public static bool RejectRelease;
  public static int RejectMessage = -1;
  public static Dictionary<uint, uint> Parents = new Dictionary<uint, uint>();
  public static uint QueryParentProcessId(uint pid) { uint parent; return Parents.TryGetValue(pid, out parent) ? parent : 0; }
  public static IntPtr GetForegroundWindow() { return IntPtr.Zero; }
  public static void ReleaseOwnedInput() { }
  public static void Reset() { Events.Clear(); RejectKey = -1; RejectRelease = false; RejectMessage = -1; }
  public static int MapKey(string key) { return key == "ctrl" ? 17 : key == "a" ? 65 : 0; }
  public static POINT ScreenToClientPoint(IntPtr h, int x, int y) { return new POINT { X = x, Y = y }; }
  private static bool Record(uint message, IntPtr key) {
    Events.Add(message.ToString("X") + ":" + key.ToInt64());
    return !(message == 0x100 && key.ToInt64() == RejectKey) && !(message == 0x101 && RejectRelease) && message != RejectMessage;
  }
  public static IntPtr SendMessageTimeout(IntPtr h, uint message, IntPtr w, IntPtr l, uint flags, uint ms, ref IntPtr result) {
    return Record(message, w) ? new IntPtr(1) : IntPtr.Zero;
  }
  public static bool PostMessage(IntPtr h, uint message, IntPtr w, IntPtr l) { return Record(message, w); }
}
'@
. (Join-Path $PSScriptRoot '../../native/helper/background-input.ps1')
function Parse-KeyChord { param([string]$RawKey, [string]$RawModifiers); return @{Key=$RawKey; Modifiers=$RawModifiers} }
function Safe-Int { param($Value); return [int]$Value }
function Reset-Fixture { [WinPilotInputMonitor]::Reset(); [DshWin32]::Reset() }
function Assert-True([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Events([string[]]$Expected) {
  $actual = [DshWin32]::Events.ToArray()
  Assert-True (($actual -join ',') -ceq ($Expected -join ',')) "Expected $($Expected -join ','); got $($actual -join ',')"
}
function Assert-Error([scriptblock]$Body, [string]$Prefix = 'user_input_interrupted:') {
  $caught = $false
  try { & $Body } catch {
    $caught = $true
    Assert-True ($_.Exception.ToString().Contains($Prefix)) "Expected $Prefix, got $($_.Exception)"
  }
  Assert-True $caught "Expected $Prefix"
}

# A refused first check sends nothing, including cleanup for keys not pressed.
Reset-Fixture; [WinPilotInputMonitor]::CancelAt = 0
Assert-Error { Send-BackgroundKey -Hwnd 1 -Key a -Modifiers ctrl }
Assert-Events @()

# Cancellation part way through a chord releases only its submitted downs.
foreach ($async in @($false, $true)) {
  Reset-Fixture; [WinPilotInputMonitor]::CancelAt = 1
  Assert-Error { Send-BackgroundKey -Hwnd 1 -Key a -Modifiers 'ctrl,shift' -Async:$async }
  Assert-Events @('100:17','101:17')
  Reset-Fixture; [WinPilotInputMonitor]::CancelAt = 2
  Assert-Error { Send-BackgroundKey -Hwnd 1 -Key a -Modifiers 'ctrl,shift' -Async:$async }
  Assert-Events @('100:17','100:16','101:16','101:17')
  Reset-Fixture; [WinPilotInputMonitor]::CancelAt = 3
  Assert-Error { Send-BackgroundKey -Hwnd 1 -Key a -Modifiers 'ctrl,shift' -Async:$async }
  Assert-Events @('100:17','100:16','100:65','101:65','101:16','101:17')
}
Reset-Fixture
Send-BackgroundKey -Hwnd 1 -Key a -Modifiers 'ctrl,ctrl'
Assert-Events @('100:17','100:65','101:65','101:17')

# A synchronous timeout may have delivered the down, so balance it. A refused
# asynchronous post definitely submitted nothing and must not release that key.
Reset-Fixture; [DshWin32]::RejectKey = 65
Assert-Error { Send-BackgroundKey -Hwnd 1 -Key a -Modifiers ctrl } 'input_timeout:'
Assert-Events @('100:17','100:65','101:65','101:17')
Reset-Fixture; [DshWin32]::RejectKey = 65
Assert-Error { Send-BackgroundKey -Hwnd 1 -Key a -Modifiers ctrl -Async } 'background_unavailable:'
Assert-Events @('100:17','100:65','101:17')

# A release failure still attempts all owned keys and cannot report success.
Reset-Fixture; [DshWin32]::RejectRelease = $true
Assert-Error { Send-BackgroundKey -Hwnd 1 -Key a -Modifiers ctrl } 'input_timeout:'
Assert-Events @('100:17','100:65','101:65','101:17')

# Hold cancellation uses the cancellable wait and releases key plus modifiers.
Reset-Fixture; [WinPilotInputMonitor]::CancelInSleep = $true
Assert-Error { Send-BackgroundHoldKey -Hwnd 1 -Key a -Modifiers ctrl -DurationMs 5000 }
Assert-Events @('100:17','100:65','101:65','101:17')

# Character sequences stop before the next character; Return is always balanced.
Reset-Fixture; [WinPilotInputMonitor]::CancelAt = 1
Assert-Error { Send-BackgroundText -Hwnd 1 -Text ab }
Assert-Events @('102:97')
Reset-Fixture; [WinPilotInputMonitor]::CancelAt = 1
Assert-Error { Send-BackgroundText -Hwnd 1 -Text "`n" }
Assert-Events @('100:13','101:13')
Reset-Fixture
Send-BackgroundText -Hwnd 1 -Text "a`r`nb"
Assert-Events @('102:97','100:13','102:13','101:13','102:98')

# Interrupt a click after its down; cleanup keeps the X-button identity.
Reset-Fixture; [WinPilotInputMonitor]::CancelAt = 1
Assert-Error { Send-BackgroundMouseButton -Hwnd 1 -Sx 4 -Sy 5 -Button left -Count 3 }
Assert-Events @('201:1','202:0')
Reset-Fixture; [WinPilotInputMonitor]::CancelAt = 1
Assert-Error { Send-BackgroundMouseButton -Hwnd 1 -Sx 4 -Sy 5 -Button back -Count 1 }
Assert-Events @('20B:65536','20C:65536')
Reset-Fixture; [WinPilotInputMonitor]::CancelAt = 1
Assert-Error { Send-BackgroundMouseButton -Hwnd 1 -Sx 4 -Sy 5 -Button left -Count 1 -Modifiers ctrl }
Assert-Events @('100:17','101:17')
Reset-Fixture; [WinPilotInputMonitor]::CancelAt = 2
Assert-Error { Send-BackgroundMouseButton -Hwnd 1 -Sx 4 -Sy 5 -Button left -Count 1 -Modifiers ctrl }
Assert-Events @('100:17','201:9','202:8','101:17')
Reset-Fixture
Send-BackgroundMouseButton -Hwnd 1 -Sx 4 -Sy 5 -Button left -Count 3
Assert-Events @('201:1','202:0','203:1','202:0','203:1','202:0')

# Real semantic action path checks before dispatch and propagates interruption.
function Test-ElementInWindow { return $true }
$script:patternCalls = 0
$pattern = New-Object PSObject
$pattern | Add-Member ScriptMethod Invoke { $script:patternCalls++ }
$pattern | Add-Member ScriptMethod Toggle { $script:patternCalls++ }
$pattern | Add-Member ScriptMethod Select { $script:patternCalls++ }
$script:pattern = $pattern
$element = [pscustomobject]@{Current=[pscustomobject]@{Name='Fixture';IsEnabled=$true;NativeWindowHandle=1;BoundingRectangle=[pscustomobject]@{X=0;Y=0;Width=20;Height=20;IsEmpty=$false}}}
$element | Add-Member ScriptMethod TryGetCurrentPattern {
  param($id, $out)
  $out.Value = $script:pattern
  return $id -eq $script:expectedPattern
}
foreach ($expectedPattern in @([System.Windows.Automation.InvokePattern]::Pattern, [System.Windows.Automation.TogglePattern]::Pattern, [System.Windows.Automation.SelectionItemPattern]::Pattern)) {
  $script:expectedPattern = $expectedPattern
  $script:windowBackgroundCapabilities = @{}
  Reset-Fixture; [WinPilotInputMonitor]::CancelAt = 0
  Assert-Error { Invoke-FromPointInWindow -Hwnd 1 -X 4 -Y 5 -ExpectedName Fixture -Element $element }
  Assert-True ($script:patternCalls -eq 0) 'Interruption must precede the UIA mutation'
  Reset-Fixture
  $null = Invoke-FromPointInWindow -Hwnd 1 -X 4 -Y 5 -ExpectedName Fixture -Element $element
  Assert-True ($script:patternCalls -eq 1 -and [WinPilotInputMonitor]::Dispatched -eq 1) 'UIA action must be marked once'
  $script:patternCalls = 0
}

# Overlay positioning cannot silently scroll or mutate an observed target.
$point = Get-OverlayPoint-Element -Element $element
Assert-True ($point[0] -eq 10 -and $point[1] -eq 10) 'Overlay positioning must remain read-only'

# Exercise the actual dispatch functions without a Windows input destination.
$dispatchPath = Join-Path $PSScriptRoot '../../native/helper/dispatch.ps1'
$tokens = $null; $parseErrors = $null
$dispatchSource = [IO.File]::ReadAllText($dispatchPath, [Text.Encoding]::UTF8)
$ast = [System.Management.Automation.Language.Parser]::ParseInput($dispatchSource, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors) { throw ($parseErrors -join '; ') }
$functions = $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -in @('Invoke-BackgroundRangeScroll', 'Send-OwnedBackgroundButton', 'Release-OwnedBackgroundButtons', 'Invoke-ActionRequest', 'Test-ProcessDescendant', 'New-PasteClipboardContent', 'New-HtmlClipboardFormat', 'Convert-MarkdownFragment', 'Convert-MarkdownInline', 'Invoke-PasteClipboardTransaction') }, $true)
foreach ($function in $functions) { Invoke-Expression $function.Extent.Text }
Invoke-Expression ([regex]::Match($dispatchSource, '(?s)\$script:InputActions = @\(.*?\)').Value)
$script:heldBackgroundButtons = @{}
[DshWin32]::Parents[102] = 101
[DshWin32]::Parents[103] = 102
Assert-True (Test-ProcessDescendant -ProcessId 103 -AncestorId 101) 'Delegated windows require verified process ancestry'
Assert-True (-not (Test-ProcessDescendant -ProcessId 104 -AncestorId 101)) 'An unrelated new notification must never become the launched window'
Assert-True (-not (Test-ProcessDescendant -ProcessId 103 -AncestorId 0)) 'A launch without a process id cannot claim an arbitrary window'
[DshWin32]::Parents[102] = 103
Assert-True (-not (Test-ProcessDescendant -ProcessId 103 -AncestorId 101)) 'Cyclic process data must not hang discovery'

$range = [pscustomobject]@{ Current = [pscustomobject]@{ Value = 4.0; Minimum = 0.0; Maximum = 10.0; SmallChange = 3.0; IsReadOnly = $false }; Writes = @() }
$range | Add-Member ScriptMethod SetValue { param($value) $this.Writes += $value; $this.Current.Value = $value }
Reset-Fixture
Invoke-BackgroundRangeScroll -Pattern $range -Amount 5 -Down $true
Assert-True (($range.Writes -join ',') -eq '7,10') 'Range scrolling must stop at the maximum'
$range.Writes = @()
Invoke-BackgroundRangeScroll -Pattern $range -Amount 5 -Down $false
Assert-True (($range.Writes -join ',') -eq '7,4,1,0') 'Range scrolling must clamp to the minimum'
Reset-Fixture; $range.Current.Value = 4; $range.Writes = @(); [WinPilotInputMonitor]::CancelAt = 1
Assert-Error { Invoke-BackgroundRangeScroll -Pattern $range -Amount 5 -Down $true }
Assert-True (($range.Writes -join ',') -eq '7') 'Cancelled range scrolling must not dispatch another step'
Reset-Fixture; $range.Current.IsReadOnly = $true
Assert-Error { Invoke-BackgroundRangeScroll -Pattern $range -Amount 1 -Down $true } 'target_read_only:'
Assert-True ([WinPilotInputMonitor]::Dispatched -eq 0) 'Read-only range must not be mutated'
$range.Current.IsReadOnly = $false; $range.Current.SmallChange = 0
Assert-Error { Invoke-BackgroundRangeScroll -Pattern $range -Amount 1 -Down $true } 'background_unavailable:'

foreach ($button in @('left', 'back', 'forward')) {
  Reset-Fixture; $script:heldBackgroundButtons = @{}
  $message = if ($button -eq 'left') { 0x201 } else { 0x20B }
  $extra = switch ($button) { 'left' { 1 }; 'back' { 0x10000 }; 'forward' { 0x20000 } }
  Send-OwnedBackgroundButton -Hwnd 1 -Message $message -Button $button -WParam $extra -LParam 123 -IsDown $true
  [WinPilotInputMonitor]::CancelAt = 1
  Assert-Error { [WinPilotInputMonitor]::Check() }
  Release-OwnedBackgroundButtons
  $up = if ($button -eq 'left') { '202:0' } else { '20C:' + $extra }
  Assert-Events @(($message.ToString('X') + ':' + $extra), $up)
  Assert-True ($script:heldBackgroundButtons.Count -eq 0) 'Only owned background buttons should be released'
}
Reset-Fixture; [DshWin32]::RejectMessage = 0x201
Assert-Error { Send-OwnedBackgroundButton -Hwnd 1 -Message 0x201 -Button left -WParam 1 -LParam 0 -IsDown $true } 'input_timeout:'
[DshWin32]::RejectMessage = -1
Release-OwnedBackgroundButtons
Assert-Events @('201:1', '202:0')
Reset-Fixture; [WinPilotInputMonitor]::CancelAt = 0
Assert-Error { Send-OwnedBackgroundButton -Hwnd 1 -Message 0x201 -Button left -WParam 1 -LParam 0 -IsDown $true }
Release-OwnedBackgroundButtons
Assert-Events @()

function Test-DesktopLocked { return $false }
function Get-Dispatch { return 'background' }
function Get-FocusPolicy { return 'never' }
function Get-PayloadValue { param($Name) return $script:payload.$Name }
function Resolve-TargetWindow { return [pscustomobject]@{ Hwnd = [IntPtr]1 } }
function Find-TextInputHwnd { return [IntPtr]1 }
function Invoke-PasteClipboardOperation {
  param($Operation, $Argument)
  switch ($Operation) {
    capture { return @{ data = $script:clipboard } }
    write { $script:clipboard = $Argument.content.text; $script:clipboardOwner = 'ours'; return @{ token = 'ours' } }
    restore {
      if ($script:clipboardOwner -ne $Argument.owner.token) { return $false }
      $script:clipboard = $Argument.previous.data
      return $true
    }
  }
}
function Send-BackgroundKey {
  [WinPilotInputMonitor]::MarkDispatched()
  if ($script:userCopies) { $script:clipboard = 'new user copy'; $script:clipboardOwner = $null }
  throw 'user_input_interrupted: fixture cancellation during paste'
}
foreach ($action in @('paste', 'launch_app')) {
  Reset-Fixture; [WinPilotInputMonitor]::BeginError = 'input_monitor_unavailable: fixture unavailable'
  $reply = Invoke-ActionRequest -Action $action -Payload ([pscustomobject]@{ text = 'paste'; hwnd = 1 })
  Assert-True ($reply.error_code -eq 'input_monitor_unavailable' -and $reply.outcome -eq 'not_executed') "$action must not bypass unavailable hooks"
}
foreach ($userCopies in @($false, $true)) {
  Reset-Fixture; $script:heldBackgroundButtons = @{}; $script:userCopies = $userCopies; $script:clipboard = 'old text'
  $reply = Invoke-ActionRequest -Action paste -Payload ([pscustomobject]@{ text = 'paste'; hwnd = 1 })
  Assert-True ($reply.error_code -eq 'user_input_interrupted' -and $reply.action_sent) 'Paste cancellation must retain partial input classification'
  $expectedClipboard = if ($userCopies) { 'new user copy' } else { 'old text' }
  Assert-True ($script:clipboard -ceq $expectedClipboard) 'Paste finally must restore old text without overwriting a new user copy'
}
'BACKGROUND_INPUT_INTERRUPTION_OK'
