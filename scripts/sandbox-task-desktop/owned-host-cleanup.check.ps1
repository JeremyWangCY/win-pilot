$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'owned-host-cleanup.ps1')
function New-MockHost {
    $inputStream = New-Object PSObject
    foreach ($method in @('WriteLine','Flush','Close')) { $inputStream | Add-Member ScriptMethod $method { param($value) } }
    $process = [pscustomobject]@{ Id = 4242; StartTime = [DateTime]::SpecifyKind([DateTime]'2026-10-15T01:00:00',[DateTimeKind]::Utc); HasExited = $false; StandardInput = $inputStream; WaitCalls = 0; KillCalls = 0 }
    $process | Add-Member ScriptMethod WaitForExit { param($milliseconds) $this.WaitCalls++; return $this.HasExited }
    $process | Add-Member ScriptMethod Kill { $this.KillCalls++; $this.HasExited = $true }
    return $process
}
foreach ($failure in @('malformed JSON','identity mismatch','read I/O failed')) {
    $mock = New-MockHost
    $read = { throw $failure }.GetNewClosure()
    $result = Complete-FixtureOwnedHost $mock 4242 $mock.StartTime.Ticks $read
    if ($result.status -ne 'fail' -or $mock.KillCalls -ne 1 -or $mock.WaitCalls -ne 2 -or -not $mock.HasExited) { throw ('Cleanup fallback bypassed on ' + $failure) }
}
$mock = New-MockHost
$result = Complete-FixtureOwnedHost $mock 9999 $mock.StartTime.Ticks { throw 'must not read an unowned host' }
if ($result.status -ne 'fail' -or $mock.KillCalls -ne 0 -or $mock.WaitCalls -ne 0) { throw 'An unowned PID was touched.' }
$mock = New-MockHost
$result = Complete-FixtureOwnedHost $mock 4242 ($mock.StartTime.Ticks + 1) { throw 'must not read a recycled PID' }
if ($result.status -ne 'fail' -or $mock.KillCalls -ne 0 -or $mock.WaitCalls -ne 0) { throw 'A process with a different creation time was touched.' }
$mock = New-MockHost
$mock.HasExited = $true
$result = Complete-FixtureOwnedHost $mock 4242 $mock.StartTime.Ticks { return @{ok=$true;cleanup_confirmed=$true} }
if ($result.status -ne 'pass' -or $mock.KillCalls -ne 0) { throw 'Confirmed graceful shutdown failed.' }
Write-Output 'owned host cleanup pure mock checks PASSED (6 cases; no Process objects or guest execution)'
