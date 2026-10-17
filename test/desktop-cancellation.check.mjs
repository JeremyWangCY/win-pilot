import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const source = fileURLToPath(new URL('../native/helper/input-interruption.cs', import.meta.url)).replaceAll("'", "''")
const helper = fileURLToPath(new URL('../lib/win-pilot-helper.ps1', import.meta.url)).replaceAll("'", "''")
const script = `
$ErrorActionPreference='Stop'
Add-Type -Path '${source}'
Add-Type @'
using System;
using System.IO;
using System.Threading;
public static class CancellationFixture {
 public static Timer Signal(string path) { return new Timer(delegate(object o) { File.WriteAllText(path, "cancel"); }, null, 70, Timeout.Infinite); }
}
public static class DshWin32 {
 public static int Releases;
 public static IntPtr GetForegroundWindow() { return IntPtr.Zero; }
 public static void ReleaseOwnedInput() { Releases++; }
}
'@
$signal=Join-Path ([IO.Path]::GetTempPath()) ('win-pilot-cancel-fixture-'+[guid]::NewGuid().ToString('N')+'.signal')
try {
 [WinPilotInputMonitor]::ConfigureCancellation($signal)
 [WinPilotInputMonitor]::Check()
 # Seed only private state to exercise real cancellable waits without registering hooks.
 $flags=[Reflection.BindingFlags]'NonPublic,Static'
 $type=[WinPilotInputMonitor]
 $type.GetField('worker',$flags).SetValue($null,[Threading.Thread]::CurrentThread)
 $type.GetField('keyboardHook',$flags).SetValue($null,[IntPtr]1)
 $type.GetField('mouseHook',$flags).SetValue($null,[IntPtr]1)
 $type.GetField('active',$flags).SetValue($null,$true)
 [WinPilotInputMonitor]::MarkDispatched()
 $timer=[CancellationFixture]::Signal($signal)
 $watch=[Diagnostics.Stopwatch]::StartNew(); $cancelled=$false
 try { [WinPilotInputMonitor]::Sleep(5000) } catch { $cancelled=$_.Exception.ToString().Contains('operation_cancelled:') }
 $timer.Dispose()
 if (-not $cancelled -or $watch.ElapsedMilliseconds -gt 1000 -or -not [WinPilotInputMonitor]::HasDispatched) { throw 'cancelled hold must interrupt promptly without erasing dispatched state' }
 [WinPilotInputMonitor]::EndAction(); [WinPilotInputMonitor]::ClearCancellation(); [WinPilotInputMonitor]::Check()
 $tokens=$null; $errors=$null
 $ast=[System.Management.Automation.Language.Parser]::ParseFile('${helper}',[ref]$tokens,[ref]$errors)
 if ($errors.Count) { throw $errors[0] }
 $ast.FindAll({param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst]},$false) | ForEach-Object { . ([scriptblock]::Create($_.Extent.Text)) }
 $script:heldBackgroundButtons=@{}; $script:accessibilityHistory=@{window=@{}}; $script:elementIndexHistory=@{window=@{}}
 $script:observation=@{id='old'}; $script:cachedElements=@{2='cached'}; $script:lastScreenshot=@{id='old'}
 $result=Invoke-ActionRequest stop ([pscustomobject]@{focus_policy='never'})
 if (-not $result.ok -or -not $result.stopped -or [DshWin32]::Releases -ne 1 -or $script:observation -or $script:cachedElements -or $script:lastScreenshot -or $script:accessibilityHistory.Count -or $script:elementIndexHistory.Count) { throw 'native stop must release owned input and invalidate all state' }
 Write-Output 'PASS: real monitor cancellation during hold, preserved dispatched state, native stop cleanup'
} finally {
 [WinPilotInputMonitor]::EndAction(); [WinPilotInputMonitor]::ClearCancellation()
 # These pointers were fixture values; never attempt to unhook them.
 $type.GetField('keyboardHook',$flags).SetValue($null,[IntPtr]::Zero)
 $type.GetField('mouseHook',$flags).SetValue($null,[IntPtr]::Zero)
 if (Test-Path -LiteralPath $signal) { Remove-Item -LiteralPath $signal -Force }
}
`
const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
assert.match(output, /PASS:/)
console.log(output.trim())
