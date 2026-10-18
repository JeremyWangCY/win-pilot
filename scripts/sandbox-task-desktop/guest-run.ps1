# This file is intentionally never invoked by the prepare command.
# Identity checks precede copying, environment changes, registry writes, process
# launches, service changes, Add-Type, and every Windows session API.
$ErrorActionPreference = 'Stop'
$source = 'C:\WinPilotSource'
$manifest = Get-Content -LiteralPath (Join-Path $source 'bundle-manifest.json') -Raw | ConvertFrom-Json
$identityUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name.Split('\')[-1]
if ($manifest.kind -ne 'win-pilot-task-desktop-sandbox-v1' -or -not $manifest.host_computer_name -or $env:USERNAME -cne 'WDAGUtilityAccount' -or $identityUser -cne 'WDAGUtilityAccount' -or -not $env:COMPUTERNAME -or $env:COMPUTERNAME -ieq $manifest.host_computer_name) {
    throw 'Sandbox identity guard failed. Nothing has been started or modified.'
}
$script:FixtureGuestValidated = $true
$local = 'C:\WinPilotFixture'
if (Test-Path -LiteralPath $local) { throw 'Guest fixture directory already exists; use a fresh Sandbox instead of reusing uncertain state.' }
foreach ($item in $manifest.files) {
    $file = [IO.Path]::GetFullPath((Join-Path $source $item.path))
    if (-not $file.StartsWith($source + '\', [StringComparison]::OrdinalIgnoreCase) -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ine $item.sha256) { throw ('Bundle verification failed: ' + $item.path) }
}
if (-not (Test-Path -LiteralPath 'C:\WinPilotResults' -PathType Container)) { throw 'Writable results mapping is missing.' }
New-Item -ItemType Directory -Path $local | Out-Null
Copy-Item -LiteralPath (Join-Path $source 'payload') -Destination (Join-Path $local 'payload') -Recurse
$localResults = Join-Path $local 'results'
New-Item -ItemType Directory -Path $localResults | Out-Null
$script:TraceFile = Join-Path $localResults 'protocol.jsonl'
$script:FixtureEvents = Join-Path $localResults 'fixture-events.jsonl'
$sentinelEvents = Join-Path $localResults 'startup-sentinel.jsonl'
$script:HostProcess = $null
$script:HostStartedAt = $null
$script:OutputReadTask = $null
$script:ProtocolTimedOut = $false
$script:HostClosedResult = $null
$script:Instance = [guid]::NewGuid().ToString()
$script:ParentSession = [Diagnostics.Process]::GetCurrentProcess().SessionId
$script:TestClock = [Diagnostics.Stopwatch]::StartNew()
$testStarted = Get-Date
$script:Report = [ordered]@{ kind = 'win-pilot-task-desktop-sandbox-result-v1'; started_at = $testStarted.ToUniversalTime().ToString('o'); status = 'incomplete'; guest = $env:COMPUTERNAME; user = $identityUser; parent_session = $script:ParentSession; child_session = $null; observed_child_sessions = @(); instance_id = $script:Instance; checks = @(); limitations = @('Classic Run coverage does not prove MSIX StartupTask or Store package repair isolation.'); files = @() }
. (Join-Path $source 'guest-protocol.ps1')
. (Join-Path $source 'owned-host-cleanup.ps1')
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$runName = 'WinPilotSandboxStartupSentinel'
$runRegistered = $false
try {
    Add-FixtureCheck 'guest_guard_and_bundle_hashes' 'pass' 'Sandbox account, different computer name, and all source file hashes verified before mutation.'
    Add-FixtureCheck 'msix_startup_task_sentinel' 'incomplete' 'A reliable guest-only signed or development-mode StartupTask package is not provided. No claim of Store app safety is permitted.'
    Add-FixtureCheck 'fixture_visual_review' 'incomplete' 'Any saved screenshot requires human review; image existence does not prove correct desktop rendering.'
    $runtime = Join-Path $local 'payload\dotnet'
    $env:DOTNET_ROOT = $runtime
    $env:DOTNET_ROOT_X64 = $runtime
    $env:PATH = $runtime + ';' + $env:PATH
    # CreateEnvironmentBlock in the child must see the guest user's own runtime.
    [Environment]::SetEnvironmentVariable('DOTNET_ROOT', $runtime, 'User')
    [Environment]::SetEnvironmentVariable('DOTNET_ROOT_X64', $runtime, 'User')
    $sentinel = Join-Path $local 'payload\sentinel\win-pilot-startup-sentinel.exe'
    $runCommand = '"' + $sentinel + '" --events "' + $sentinelEvents + '" --origin classic_run'
    New-Item -Path $runKey -Force | Out-Null
    if (Get-ItemProperty -LiteralPath $runKey -Name $runName -ErrorAction SilentlyContinue) { throw 'Sentinel Run value already exists; uncertain fixture state.' }
    New-ItemProperty -LiteralPath $runKey -Name $runName -PropertyType String -Value $runCommand | Out-Null
    $runRegistered = $true
    $baseline = Start-Process -FilePath $sentinel -ArgumentList @('--events', ('"' + $sentinelEvents + '"'), '--origin', 'baseline') -WindowStyle Hidden -PassThru
    if (-not $baseline.WaitForExit(10000) -or $baseline.ExitCode -ne 0) { throw 'Startup sentinel baseline failed.' }
    $baselineEvents = @(Read-FixtureEvents $sentinelEvents | Where-Object { $_.origin -eq 'baseline' -and $_.session -eq $script:ParentSession })
    if ($baselineEvents.Count -ne 1) { throw 'Sentinel baseline event is missing or duplicated.' }
    Add-FixtureCheck 'classic_run_sentinel_registered' 'pass' 'Guest-only Run value installed and one manually launched parent-session baseline recorded. This does not claim a new parent login occurred.'
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FixtureGuestWts {
 [DllImport("wtsapi32.dll", SetLastError=true)] public static extern bool WTSIsChildSessionsEnabled(out bool enabled);
 [DllImport("wtsapi32.dll", SetLastError=true)] public static extern bool WTSEnableChildSessions(bool enabled);
 [DllImport("wtsapi32.dll", SetLastError=true)] public static extern bool WTSGetChildSessionId(out uint session);
}
'@
    # Sandbox has no external network adapter. Enable its own RDP listener for
    # the loopback child connection; never open a host firewall or touch host TS.
    $guestTerminalKey = 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server'
    $guestDenyTs = (Get-ItemProperty -LiteralPath $guestTerminalKey -Name fDenyTSConnections -ErrorAction Stop).fDenyTSConnections
    Set-ItemProperty -LiteralPath $guestTerminalKey -Name fDenyTSConnections -Value 0 -ErrorAction Stop
    Write-FixtureTrace 'guest_loopback_rdp_setup' @{ previous_deny=$guestDenyTs; current_deny=0; host_modified=$false }
    Start-Service -Name TermService -ErrorAction Stop
    try {
        $guestTsSetting = Get-CimInstance -Namespace root/cimv2/terminalservices -ClassName Win32_TerminalServiceSetting -OperationTimeoutSec 8 -ErrorAction Stop
        $guestTsSetup = Invoke-CimMethod -InputObject $guestTsSetting -MethodName SetAllowTSConnections -Arguments @{ AllowTSConnections=[uint32]1; ModifyFirewallException=[uint32]0 } -OperationTimeoutSec 8 -ErrorAction Stop
        Write-FixtureTrace 'guest_rdp_official_setup' @{ return_value=$guestTsSetup.ReturnValue; firewall_modified=$false }
    } catch { Write-FixtureTrace 'guest_rdp_official_setup' @{ error=$_.Exception.Message; firewall_modified=$false } }
    $guestLoopbackServer = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
    $guestLoopbackClient = New-Object Net.Sockets.TcpClient
    try {
        $guestLoopbackServer.Start()
        $guestLoopbackPort = $guestLoopbackServer.LocalEndpoint.Port
        $guestLoopbackConnect = $guestLoopbackClient.ConnectAsync('127.0.0.1',$guestLoopbackPort)
        $guestLoopbackCompleted = $guestLoopbackConnect.Wait(1000)
        Write-FixtureTrace 'guest_loopback_self_test' @{ connected=($guestLoopbackCompleted -and $guestLoopbackClient.Connected) }
    } catch { Write-FixtureTrace 'guest_loopback_self_test' @{ connected=$false; error=$_.Exception.GetBaseException().Message } }
    finally { $guestLoopbackClient.Dispose(); $guestLoopbackServer.Stop() }
    $guestTcp = New-Object Net.Sockets.TcpClient
    try {
        $guestTcpConnect = $guestTcp.ConnectAsync('127.0.0.1',3389)
        $guestTcpCompleted = $guestTcpConnect.Wait(1500)
        Write-FixtureTrace 'guest_loopback_listener' @{ tcp_3389_connected=($guestTcpCompleted -and $guestTcp.Connected); rdp_tcp_key_present=(Test-Path -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp') }
    } catch { Write-FixtureTrace 'guest_loopback_listener' @{ tcp_3389_connected=$false; error=$_.Exception.GetBaseException().Message; rdp_tcp_key_present=(Test-Path -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp') } }
    finally { $guestTcp.Dispose() }
    [bool]$enabled = $false
    $queried = [FixtureGuestWts]::WTSIsChildSessionsEnabled([ref]$enabled)
    $queryError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-FixtureTrace 'child_sessions_configuration' @{ ok=$queried; enabled=$enabled; win32_error=$queryError }
    if (-not $queried) { throw ('Guest does not expose child-session configuration. Win32 error: ' + $queryError) }
    if (-not $enabled) {
        $configured = [FixtureGuestWts]::WTSEnableChildSessions($true)
        $configureError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
        Write-FixtureTrace 'child_sessions_enable' @{ ok=$configured; win32_error=$configureError }
        if (-not $configured) { throw ('Guest cannot enable child sessions. Win32 error: ' + $configureError) }
    }
    [uint32]$existing = 0
    $childQueried = [FixtureGuestWts]::WTSGetChildSessionId([ref]$existing)
    $childQueryError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
    Write-FixtureTrace 'existing_child_session' @{ ok=$childQueried; session=$existing; win32_error=$childQueryError }
    $knownEmpty = -not $childQueried -and $childQueryError -eq 1168 -and $existing -eq [uint32]::MaxValue
    if (-not $childQueried -and -not $knownEmpty) { throw ('Cannot determine existing guest child session; refusing to create a session. Win32 error: ' + $childQueryError) }
    if ($existing -ne [uint32]::MaxValue) { throw 'Guest already has a child session. Nothing will be logged off or reused.' }
    # Hold removal is confined to this verified guest-local copy. The source
    # mapping is read-only and no host path is used for this operation.
    $hostDirectory = Join-Path $local 'payload\lib\task-desktop'
    $hold = [IO.Path]::GetFullPath((Join-Path $hostDirectory 'safety-hold.json'))
    if (-not $hold.StartsWith($local + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe guest hold path.' }
    Remove-Item -LiteralPath $hold -ErrorAction Stop
    $info = New-Object Diagnostics.ProcessStartInfo
    $info.FileName = Join-Path $hostDirectory 'win-pilot-task-desktop.exe'
    $info.Arguments = '--stdio --instance-id ' + $script:Instance
    $info.WorkingDirectory = $hostDirectory
    $info.UseShellExecute = $false
    $info.RedirectStandardInput = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.StandardOutputEncoding = New-Object Text.UTF8Encoding($false)
    $info.StandardErrorEncoding = New-Object Text.UTF8Encoding($false)
    $script:TestClock.Restart()
    $script:HostProcess = [Diagnostics.Process]::Start($info)
    $script:OwnedHostPid = $script:HostProcess.Id
    $script:HostStartedAt = $script:HostProcess.StartTime.ToUniversalTime().Ticks
    $stderr = $script:HostProcess.StandardError.ReadToEndAsync()
    Write-FixtureTrace 'host_started' @{ pid = $script:HostProcess.Id; parent_session = $script:ParentSession }
    $initial = Send-FixtureCommand 'status' @{} 15000
    if ($initial.parent_windows_session_id -ne $script:ParentSession -or $initial.host_pid -ne $script:HostProcess.Id) { throw 'Host identity does not match the owned guest process.' }
    $opened = Send-FixtureCommand 'open' @{} 65000
    if ($opened.ok -ne $true -or $opened.worker_ready -ne $true) { Add-FixtureCheck 'child_worker_startup' 'incomplete' ($opened | ConvertTo-Json -Compress); throw 'Worker did not become ready; no computer input was sent.' }
    $ready = Assert-FixtureReady
    Add-FixtureCheck 'child_worker_startup' 'pass' ('Worker ready in child session ' + $ready.windows_session_id + ', distinct from parent ' + $script:ParentSession)
    $fixture = Join-Path $local 'payload\fixture\win-pilot-task-fixture.exe'
    $launch = Invoke-FixtureAction 'launch_app' @{ name = '"' + $fixture + '" --events "' + $script:FixtureEvents + '"' }
    if ($launch.ok -ne $true -or -not $launch.pid) { throw 'Fixture launch did not return a verified process.' }
    $fixtureProcess = Get-Process -Id $launch.pid -ErrorAction Stop
    if ($fixtureProcess.SessionId -ne $script:Report.child_session) { Add-FixtureCheck 'fixture_child_launch' 'fail' 'Fixture PID belongs to the wrong session.'; throw 'Wrong fixture session.' }
    $app = [string]$launch.pid
    if (-not (Wait-FixtureEvent 'shown')) { throw 'No shown event from child fixture.' }
    Add-FixtureCheck 'fixture_child_launch' 'pass' ('Fixture PID ' + $app + ' recorded shown in the child session.')
    $observe = Invoke-FixtureAction 'get_window_state' @{ app = $app; screenshot = $true; include_text = $true }
    $inputElement = Get-FixtureElement $observe 'Fixture input'
    if ($observe.screenshot.path -and (Test-Path -LiteralPath $observe.screenshot.path)) {
        Copy-Item -LiteralPath $observe.screenshot.path -Destination (Join-Path $localResults 'fixture-before.png')
        Add-FixtureCheck 'fixture_screenshot' 'pass' 'A screenshot file was produced. Visual correctness still requires human inspection.'
    } else { Add-FixtureCheck 'fixture_screenshot' 'fail' 'No actual screenshot file was returned.' }
    $focus = Invoke-FixtureAction 'click' @{ app = $app; element = $inputElement.index; snapshot_id = $observe.snapshot_id }
    if ($focus.ok -ne $true) { throw 'Fixture input focus failed.' }
    $marker = 'sandbox-' + $script:Instance
    $typed = Invoke-FixtureAction 'type_text' @{ app = $app; text = $marker }
    if ($typed.ok -eq $true -and (Wait-FixtureEvent 'text_changed' $marker)) { Add-FixtureCheck 'text_input' 'pass' 'Child fixture independently recorded the complete typed marker.' } else { Add-FixtureCheck 'text_input' 'fail' 'Typed text was not independently confirmed.'; throw 'Text verification failed.' }
    $observe = Invoke-FixtureAction 'get_window_state' @{ app = $app; screenshot = $false; include_text = $true }
    $button = Get-FixtureElement $observe 'Fixture increment'
    $clicked = Invoke-FixtureAction 'click' @{ app = $app; element = $button.index; snapshot_id = $observe.snapshot_id }
    if ($clicked.ok -eq $true -and (Wait-FixtureEvent 'clicked')) { Add-FixtureCheck 'button_click' 'pass' 'Child fixture recorded its button callback.' } else { Add-FixtureCheck 'button_click' 'fail' 'No independently confirmed button callback.'; throw 'Click verification failed.' }
    $paused = Send-FixtureCommand 'pause' @{} 15000
    if ($paused.ok -ne $true -or $paused.paused -ne $true) { throw 'Pause did not confirm input cleanup.' }
    # Deliberately test the native paused refusal only after ready identity has
    # been checked. No mutation may be delivered to the child in this step.
    $refused = Invoke-FixtureAction 'type_text' @{ app = $app; text = '-MUST-NOT-APPEAR' } -AllowPaused
    $pausedObservation = Invoke-FixtureAction 'get_window_state' @{ app = $app; screenshot = $false; include_text = $true } -AllowPaused
    if ($refused.ok -eq $false -and $refused.outcome -eq 'not_executed' -and $refused.error_code -eq 'task_desktop_paused' -and $pausedObservation.ok -eq $true) { Add-FixtureCheck 'pause_refuses_input_allows_observation' 'pass' 'Native host rejected the paused mutation and retained observation.' } else { Add-FixtureCheck 'pause_refuses_input_allows_observation' 'fail' 'Pause behavior differs from the contract.'; throw 'Pause contract failed.' }
    $resumed = Send-FixtureCommand 'resume' @{} 15000
    if ($resumed.ok -ne $true -or $resumed.paused -eq $true) { throw 'Resume failed.' }
    $observe = Invoke-FixtureAction 'get_window_state' @{ app = $app; screenshot = $false; include_text = $true }
    $inputElement = Get-FixtureElement $observe 'Fixture input'
    $focus = Invoke-FixtureAction 'click' @{ app = $app; element = $inputElement.index; snapshot_id = $observe.snapshot_id }
    if ($focus.ok -ne $true) { throw 'Resume input focus failed.' }
    $endKey = Invoke-FixtureAction 'press_key' @{ app = $app; key = 'End' }
    if ($endKey.ok -ne $true) { throw 'Cannot position the caret for resumed typing.' }
    $append = Invoke-FixtureAction 'type_text' @{ app = $app; text = '-resumed' }
    if ($append.ok -eq $true -and (Wait-FixtureEvent 'text_changed' ($marker + '-resumed'))) { Add-FixtureCheck 'resume_input' 'pass' 'Fixture recorded resumed typing; paused marker was absent.' } else { Add-FixtureCheck 'resume_input' 'fail' 'Resumed fixture text differs from expected content.' }
} catch {
    $script:Report.error = $_.Exception.Message
    Write-FixtureTrace 'stopped' @{ message = $_.Exception.Message }
} finally {
    # Observe while the child is still alive and the Run value still exists;
    # closing first would hide delayed startup behavior.
    if ($script:HostProcess) { Start-Sleep -Seconds 15 }
    if ($runRegistered) { Remove-ItemProperty -LiteralPath $runKey -Name $runName -ErrorAction SilentlyContinue }
    if ($script:HostProcess) {
        try {
            $cleanup = Complete-FixtureOwnedHost $script:HostProcess $script:OwnedHostPid $script:HostStartedAt { Receive-FixtureClosed 8000 }
            Add-FixtureCheck 'owned_host_shutdown' $cleanup.status $cleanup.message
            if ($stderr -and $stderr.Wait(1000)) { Set-Content -LiteralPath (Join-Path $localResults 'host-stderr.txt') -Value $stderr.GetAwaiter().GetResult() -Encoding UTF8 }
        } catch { Add-FixtureCheck 'owned_host_shutdown' 'fail' $_.Exception.Message }
    }
    # Give classic Run a bounded observation window, even when worker startup
    # failed. Any non-parent launch is an explicit isolation failure.
    try {
        $sentinel = @(Read-FixtureEvents $sentinelEvents)
        $duplicates = @($sentinel | Where-Object { $_.session -ne $script:ParentSession -and $_.origin -eq 'classic_run' })
        if ($duplicates.Count) { Add-FixtureCheck 'classic_run_child_suppression' 'fail' ('Observed ' + $duplicates.Count + ' startup launches outside the parent session.') }
        elseif ($null -ne $script:Report.child_session) { Add-FixtureCheck 'classic_run_child_suppression' 'pass' 'No child-session classic Run sentinel launch was observed during this bounded guest test.' }
        else { Add-FixtureCheck 'classic_run_child_suppression' 'incomplete' 'No ready child session was proven; absence of startup events cannot prove suppression.' }
    } catch { Add-FixtureCheck 'classic_run_child_suppression' 'incomplete' ('Sentinel records could not be read: ' + $_.Exception.Message) }
    foreach ($log in @('Microsoft-Windows-AppXDeploymentServer/Operational','Microsoft-Windows-AppModel-Runtime/Admin','Microsoft-Windows-TerminalServices-LocalSessionManager/Operational','Microsoft-Windows-TerminalServices-ClientActiveXCore/Operational','Microsoft-Windows-TerminalServices-RemoteConnectionManager/Operational')) {
        try {
            $events = @(Get-WinEvent -FilterHashtable @{ LogName = $log; StartTime = $testStarted } -ErrorAction Stop | Select-Object TimeCreated,Id,ProviderName,RecordId,Message,@{Name='Xml';Expression={$_.ToXml()}})
            $safeName = $log.Replace('/','-') + '.json'
            ConvertTo-Json -InputObject $events -Depth 30 | Set-Content -LiteralPath (Join-Path $localResults $safeName) -Encoding UTF8
            $forced = @($events | Where-Object { $_.Message -match 'ForceTargetApplicationShutdown|RepairAppRegistration' -or $_.Xml -match 'ForceTargetApplicationShutdown|RepairAppRegistration' })
            if ($forced.Count) { Add-FixtureCheck ('windows_events_' + $log) 'fail' 'Guest AppX repair or forced shutdown event requires investigation.' }
            else { Add-FixtureCheck ('windows_events_' + $log) 'pass' ('Captured ' + $events.Count + ' events; no matching forced repair string was found. This does not prove all Store app behavior.') }
        } catch { Add-FixtureCheck ('windows_events_' + $log) 'incomplete' $_.Exception.Message }
    }
    foreach ($required in @('child_worker_startup','fixture_child_launch','fixture_screenshot','text_input','button_click','pause_refuses_input_allows_observation','resume_input','owned_host_shutdown')) {
        if (-not @($script:Report.checks | Where-Object name -eq $required).Count) { Add-FixtureCheck $required 'incomplete' 'Not reached because an earlier prerequisite failed; no success is inferred.' }
    }
    $script:Report.finished_at = [DateTimeOffset]::UtcNow.ToString('o')
    $script:Report.status = if (@($script:Report.checks | Where-Object status -eq 'fail').Count) { 'fail' } else { 'incomplete' }
    # Full completion remains gated by the missing MSIX StartupTask fixture and
    # human screenshot review, even if every implemented smoke check passes.
    $script:Report | ConvertTo-Json -Depth 80 | Set-Content -LiteralPath (Join-Path $localResults 'report.json') -Encoding UTF8
    foreach ($file in Get-ChildItem -LiteralPath $localResults -File) { Copy-Item -LiteralPath $file.FullName -Destination (Join-Path 'C:\WinPilotResults' $file.Name) -Force }
    Write-Host ('Sandbox report: C:\WinPilotResults\report.json; status: ' + $script:Report.status)
}
