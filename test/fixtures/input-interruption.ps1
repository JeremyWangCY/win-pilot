$ErrorActionPreference = 'Stop'
$sourcePath = Join-Path $PSScriptRoot '../../native/helper/input-interruption.cs'
if (-not (Test-Path -LiteralPath $sourcePath)) {
  throw 'input_monitor_unavailable: input monitor source is missing'
}
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Resolve-Path -LiteralPath $sourcePath)))
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class InputInterruptionFixture {
  [DllImport("user32.dll")] private static extern void keybd_event(byte vk, byte scan, uint flags, IntPtr extra);
  public static void Pulse(IntPtr tag) {
    // F24 carries no text and does not change a user application's contents.
    keybd_event(0x87, 0, 0, tag);
    keybd_event(0x87, 0, 2, tag);
  }
  public static Thread PulseAfter(int delay) {
    Thread thread = new Thread(delegate() { Thread.Sleep(delay); Pulse(IntPtr.Zero); });
    thread.IsBackground = true;
    thread.Start();
    return thread;
  }
}
'@

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw $message }
}
function Assert-Error([scriptblock]$body, [string]$prefix) {
  $caught = $false
  try { & $body } catch {
    $caught = $true
    Assert-True ($_.Exception.ToString().Contains($prefix)) "Expected $prefix, got $($_.Exception)"
  }
  Assert-True $caught "Expected $prefix to stop guarded input"
}

try {
  [WinPilotInputMonitor]::Check()
  [WinPilotInputMonitor]::EnsureStarted()
  [WinPilotInputMonitor]::EnsureStarted()
  Assert-True ([WinPilotInputMonitor]::SelfTag.ToInt64() -eq 0x5750494E) 'Self input tag must be stable on 32/64 bit hosts'

  $initial = [WinPilotInputMonitor]::BeginObservation()
  [InputInterruptionFixture]::Pulse([IntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  Assert-True (-not [WinPilotInputMonitor]::AcceptObservation($initial)) 'An initially unblocked observation must reject intervening user input'
  Assert-Error { [WinPilotInputMonitor]::BeginAction() } 'observation_required:'
  $initial = [WinPilotInputMonitor]::BeginObservation()
  Assert-True ([WinPilotInputMonitor]::AcceptObservation($initial)) 'Fresh observation must restore the initial action'
  [WinPilotInputMonitor]::MarkDispatched()
  Assert-True (-not [WinPilotInputMonitor]::HasDispatched) 'Dispatch markers outside an active action must be ignored'

  [WinPilotInputMonitor]::BeginAction()
  Assert-True (-not [WinPilotInputMonitor]::HasDispatched) 'New action must have no dispatched input'
  [InputInterruptionFixture]::Pulse([WinPilotInputMonitor]::SelfTag)
  [WinPilotInputMonitor]::Sleep(80)
  [WinPilotInputMonitor]::Check()
  [WinPilotInputMonitor]::MarkDispatched()
  Assert-True ([WinPilotInputMonitor]::HasDispatched) 'Dispatched input must be remembered'

  $injector = [InputInterruptionFixture]::PulseAfter(80)
  $timer = [Diagnostics.Stopwatch]::StartNew()
  Assert-Error { [WinPilotInputMonitor]::Sleep(2000) } 'user_input_interrupted:'
  $timer.Stop()
  $injector.Join()
  Assert-True ($timer.ElapsedMilliseconds -lt 1500) 'Sleep must wake promptly when input interrupts it'
  Assert-True ([WinPilotInputMonitor]::HasDispatched) 'Interruption must preserve partial action status'
  [WinPilotInputMonitor]::EndAction()
  [WinPilotInputMonitor]::MarkDispatched()
  Assert-True ([WinPilotInputMonitor]::HasDispatched) 'Inactive dispatch markers must preserve the completed action status'
  $inactiveWait = [Diagnostics.Stopwatch]::StartNew()
  [WinPilotInputMonitor]::Sleep(50)
  Assert-True ($inactiveWait.ElapsedMilliseconds -ge 40) 'Observation waits must retain their duration after interruption'
  Assert-Error { [WinPilotInputMonitor]::BeginAction() } 'observation_required:'
  Assert-True (-not [WinPilotInputMonitor]::HasDispatched) 'Rejected action must not inherit earlier dispatched status'
  Assert-Error { [WinPilotInputMonitor]::BeginAction() } 'observation_required:'

  $stale = [WinPilotInputMonitor]::BeginObservation()
  [InputInterruptionFixture]::Pulse([IntPtr]::Zero)
  Start-Sleep -Milliseconds 80
  Assert-True (-not [WinPilotInputMonitor]::AcceptObservation($stale)) 'Input during observation must invalidate it'
  Assert-Error { [WinPilotInputMonitor]::BeginAction() } 'observation_required:'
  $fresh = [WinPilotInputMonitor]::BeginObservation()
  Assert-True ([WinPilotInputMonitor]::AcceptObservation($fresh)) 'Uninterrupted observation must re-arm guarded input'
  [WinPilotInputMonitor]::BeginAction()
  Assert-True (-not [WinPilotInputMonitor]::HasDispatched) 'Next action must reset only dispatched status'
  [WinPilotInputMonitor]::Check()
  [WinPilotInputMonitor]::EndAction()

  [WinPilotInputMonitor]::BeginAction()
  [WinPilotInputMonitor]::Stop()
  Assert-Error { [WinPilotInputMonitor]::Check() } 'input_monitor_unavailable:'
  Assert-Error { [WinPilotInputMonitor]::Sleep(50) } 'input_monitor_unavailable:'
  [WinPilotInputMonitor]::EndAction()
  Assert-Error { [WinPilotInputMonitor]::EnsureStarted() } 'input_monitor_unavailable:'
  Assert-Error { [WinPilotInputMonitor]::BeginAction() } 'input_monitor_unavailable:'
  Assert-Error { [WinPilotInputMonitor]::BeginObservation() } 'input_monitor_unavailable:'
  'INPUT_INTERRUPTION_OK'
} finally {
  [WinPilotInputMonitor]::Stop()
}
