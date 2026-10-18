# Pure object-level cleanup routine. The guest supplies its owned Process;
# unit tests supply in-memory mocks and never launch the guest runner.
function Complete-FixtureOwnedHost($HostProcess, [int]$OwnedPid, [long]$StartedAt, [scriptblock]$ReadClosed) {
    $closedResult = $null
    $protocolError = $null
    $cleanupError = $null
    $forced = $false
    $exited = $false
    try {
        if ($HostProcess.Id -ne $OwnedPid -or $HostProcess.StartTime.ToUniversalTime().Ticks -ne $StartedAt) { throw 'Owned host identity changed; no stdin or termination is allowed.' }
        if (-not $HostProcess.HasExited) {
            $HostProcess.StandardInput.WriteLine((@{ id = [guid]::NewGuid().ToString(); command = 'close' } | ConvertTo-Json -Compress))
            $HostProcess.StandardInput.Flush()
            $HostProcess.StandardInput.Close()
        }
        $closedResult = & $ReadClosed
    } catch { $protocolError = $_.Exception.Message }
    finally {
        # Malformed JSON, mismatched events, and read failures cannot bypass
        # the bounded fallback for this single PID and creation time.
        try {
            if ($HostProcess.Id -ne $OwnedPid -or $HostProcess.StartTime.ToUniversalTime().Ticks -ne $StartedAt) { throw 'Host identity could not be verified; no process was terminated.' }
            $exited = $HostProcess.HasExited
            if (-not $exited) { $exited = $HostProcess.WaitForExit(4000) }
            if (-not $exited) {
                if ($HostProcess.Id -ne $OwnedPid -or $HostProcess.StartTime.ToUniversalTime().Ticks -ne $StartedAt) { throw 'Host identity changed during wait; no process was terminated.' }
                $HostProcess.Kill()
                $forced = $true
                $exited = $HostProcess.WaitForExit(3000)
            }
        } catch { $cleanupError = $_.Exception.Message }
    }
    if ($cleanupError) { return @{ status = 'fail'; message = $cleanupError; protocol_error = $protocolError; forced = $forced } }
    if ($forced -or -not $exited) { return @{ status = 'fail'; message = 'Graceful close timed out; only the original owned PID was terminated. Child cleanup remains unverified.'; protocol_error = $protocolError; forced = $forced } }
    if ($protocolError) { return @{ status = 'fail'; message = ('Shutdown protocol failed; owned-process fallback still ran: ' + $protocolError); forced = $false } }
    if ($closedResult -and $closedResult.ok -eq $true -and $closedResult.cleanup_confirmed -eq $true) { return @{ status = 'pass'; message = 'Final closed event confirmed cleanup and the original host exited.'; forced = $false } }
    if ($closedResult -and $closedResult.ok -eq $false) { return @{ status = 'fail'; message = ('Final host cleanup failed: ' + $closedResult.message); forced = $false } }
    return @{ status = 'incomplete'; message = 'No successful final closed event. Process exit and initial close acknowledgement do not prove cleanup.'; forced = $false }
}
