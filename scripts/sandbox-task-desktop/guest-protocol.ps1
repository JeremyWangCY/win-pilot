# Dot-source only after guest-run.ps1 has established the Sandbox identity.
if (-not $script:FixtureGuestValidated -or $env:USERNAME -cne 'WDAGUtilityAccount') { throw 'Sandbox guest guard has not passed.' }

function Write-FixtureTrace([string]$Kind, $Detail) {
    $entry = [ordered]@{ at = [DateTimeOffset]::UtcNow.ToString('o'); kind = $Kind; detail = $Detail }
    Add-Content -LiteralPath $script:TraceFile -Value ($entry | ConvertTo-Json -Depth 80 -Compress) -Encoding UTF8
}

function Add-FixtureCheck([string]$Name, [string]$Status, [string]$Detail) {
    if ($Status -notin @('pass', 'fail', 'incomplete')) { throw 'Invalid test status.' }
    $script:Report.checks += [ordered]@{ name = $Name; status = $Status; detail = $Detail }
}

function Send-FixtureCommand([string]$Command, [hashtable]$Request = @{}, [int]$TimeoutMs = 30000) {
    if (-not $script:HostProcess -or $script:HostProcess.HasExited -or $script:ProtocolTimedOut) { throw 'Original host is unavailable; it will not be replaced.' }
    if ($script:TestClock.Elapsed.TotalSeconds -ge 240) { throw 'Guest command phase reached its 240-second budget; this is not a whole-run watchdog.' }
    $id = [guid]::NewGuid().ToString()
    $message = @{ id = $id; command = $Command }
    if ($Command -eq 'execute') { $message.request = $Request }
    Write-FixtureTrace 'command' $message
    $script:HostProcess.StandardInput.WriteLine(($message | ConvertTo-Json -Depth 80 -Compress))
    $script:HostProcess.StandardInput.Flush()
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.ElapsedMilliseconds -lt $TimeoutMs -and $script:TestClock.Elapsed.TotalSeconds -lt 240) {
        if (-not $script:OutputReadTask) { $script:OutputReadTask = $script:HostProcess.StandardOutput.ReadLineAsync() }
        if (-not $script:OutputReadTask.Wait(200)) { continue }
        $line = $script:OutputReadTask.GetAwaiter().GetResult()
        $script:OutputReadTask = $null
        if ($null -eq $line) { throw 'Original task host closed stdout.' }
        if ($line.Length -gt 8388608) { throw 'Host response exceeds 8 MiB; no further actions are allowed.' }
        $reply = $line | ConvertFrom-Json
        Write-FixtureTrace 'response' $reply
        if ($reply.event -eq 'startup_isolation') {
            if ($reply.instance_id -ne $script:Instance) { throw 'Startup-isolation event identity mismatch.' }
            continue
        }
        if ($reply.event -eq 'closed') {
            if ($reply.instance_id -ne $script:Instance) { throw 'Host closed-event identity mismatch.' }
            $script:HostClosedResult = $reply.result
            throw 'Host closed while a command was pending; cleanup confirmation will be checked separately.'
        }
        if ($reply.event -eq 'state') {
            if ($reply.state.instance_id -ne $script:Instance) { throw 'Host state identity mismatch.' }
            $script:LastHostState = $reply.state
            if ($null -ne $reply.state.windows_session_id -and $reply.state.windows_session_id -notin $script:Report.observed_child_sessions) { $script:Report.observed_child_sessions += $reply.state.windows_session_id }
            continue
        }
        if ($reply.id -ne $id -or $null -eq $reply.result) { throw 'Unexpected or malformed host response.' }
        if ($reply.result.instance_id -and $reply.result.instance_id -ne $script:Instance) { throw 'Host response identity mismatch.' }
        return $reply.result
    }
    $script:ProtocolTimedOut = $true
    throw ('Host command timeout: ' + $Command + '. No input will be replayed.')
}

function Receive-FixtureClosed([int]$TimeoutMs = 8000) {
    if ($script:HostClosedResult) { return $script:HostClosedResult }
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.ElapsedMilliseconds -lt $TimeoutMs) {
        if (-not $script:OutputReadTask) { $script:OutputReadTask = $script:HostProcess.StandardOutput.ReadLineAsync() }
        if (-not $script:OutputReadTask.Wait(200)) { continue }
        $line = $script:OutputReadTask.GetAwaiter().GetResult()
        $script:OutputReadTask = $null
        if ($null -eq $line) { return $null }
        if ($line.Length -gt 8388608) { throw 'Shutdown response exceeds the frame limit.' }
        $reply = $line | ConvertFrom-Json
        Write-FixtureTrace 'shutdown_response' $reply
        if ($reply.event -eq 'closed') {
            if ($reply.instance_id -ne $script:Instance) { throw 'Shutdown event identity mismatch.' }
            $script:HostClosedResult = $reply.result
            return $reply.result
        }
        if ($reply.event -eq 'state' -and $reply.state.instance_id -ne $script:Instance) { throw 'Shutdown state identity mismatch.' }
        if ($reply.event -eq 'startup_isolation' -and $reply.instance_id -ne $script:Instance) { throw 'Shutdown startup-isolation identity mismatch.' }
    }
    return $null
}

function Assert-FixtureReady {
    $state = Send-FixtureCommand 'status' @{} 10000
    if ($state.ok -ne $true -or $state.worker_ready -ne $true -or $state.connected -ne $true -or $null -eq $state.windows_session_id -or $state.windows_session_id -eq $script:ParentSession -or $state.parent_windows_session_id -ne $script:ParentSession) {
        throw 'Task worker has not proven a distinct ready child session. Computer input is prohibited.'
    }
    $script:Report.child_session = $state.windows_session_id
    return $state
}

function Invoke-FixtureAction([string]$Action, [hashtable]$Fields = @{}, [switch]$AllowPaused) {
    $state = Assert-FixtureReady
    if ($state.paused -eq $true -and -not $AllowPaused) { throw 'Task is paused; action refused before dispatch.' }
    $request = @{ action = $Action; control_session_id = $script:Instance; dispatch = 'foreground'; overlay = $false; status_pill = $false; focus_policy = 'yield'; lock_guard = $true }
    foreach ($name in $Fields.Keys) { $request[$name] = $Fields[$name] }
    return Send-FixtureCommand 'execute' $request 30000
}

function Read-FixtureEvents([string]$File) {
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) { return @() }
    $stream = New-Object IO.FileStream($File, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::ReadWrite)
    try {
        $reader = New-Object IO.StreamReader($stream)
        try { $content = $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $stream.Dispose() }
    # Writers append one JSON line at a time. A final unterminated line can be
    # in flight; never invent an event from a partial record.
    $lines = $content.Split("`n")
    return @(for ($index = 0; $index -lt $lines.Length - 1; $index++) { if ($lines[$index].Trim()) { $lines[$index] | ConvertFrom-Json } })
}

function Wait-FixtureEvent([string]$Name, [string]$ExpectedText = '', [int]$TimeoutMs = 5000) {
    $clock = [Diagnostics.Stopwatch]::StartNew()
    while ($clock.ElapsedMilliseconds -lt $TimeoutMs) {
        $events = @(Read-FixtureEvents $script:FixtureEvents | Where-Object { $_.name -eq $Name -and $_.session -eq $script:Report.child_session })
        if ($ExpectedText) { $events = @($events | Where-Object { $_.detail.text -eq $ExpectedText }) }
        if ($events.Count) { return $events[-1] }
        Start-Sleep -Milliseconds 100
    }
    return $null
}

function Get-FixtureElement($State, [string]$Name) {
    $found = @($State.elements | Where-Object { $_.name -eq $Name -and $_.enabled -ne $false })
    if ($State.ok -ne $true -or -not $State.snapshot_id -or $found.Count -ne 1) { throw ('No unique accessible fixture element: ' + $Name) }
    return $found[0]
}
