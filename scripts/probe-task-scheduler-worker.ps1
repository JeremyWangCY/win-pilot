$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
$exe=Join-Path $root 'lib/task-desktop/win-pilot-task-desktop.exe'
if(-not (Test-Path -LiteralPath (Join-Path $root 'lib/task-desktop/safety-hold.json'))){throw 'This process-only probe requires the safety hold to stay enabled.'}
$instance=[Guid]::NewGuid().ToString('N')
$name='Win-Pilot-Launch-Probe-'+$instance
$config=Join-Path $env:TEMP ('win-pilot/launch-probe-'+$instance+'.json')
$errorFile=$config+'.worker-error'
$currentSession=(Get-Process -Id $PID).SessionId
[IO.File]::WriteAllText($config,('{"parent_session":'+$currentSession+'}'))
$report=[ordered]@{at=[DateTime]::UtcNow.ToString('O');session=$currentSession;hold_enabled=$true;purpose='Own worker entry only; safety hold refuses all desktop operations';samples=@()}
$registered=$false;$running=$null
$service=New-Object -ComObject Schedule.Service
$service.Connect()
$folder=$service.GetFolder('\')
try {
 $definition=$service.NewTask(0)
 $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
 $sid=$identity.User.Value
 $definition.Principal.UserId=$sid;$definition.Principal.LogonType=3
 $definition.Principal.RunLevel=[int]([Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))
 $definition.Settings.Enabled=$true;$definition.Settings.AllowDemandStart=$true;$definition.Settings.DisallowStartIfOnBatteries=$false;$definition.Settings.StopIfGoingOnBatteries=$false;$definition.Settings.ExecutionTimeLimit='PT1M'
 $action=$definition.Actions.Create(0);$action.Path=$exe;$action.Arguments='--worker "'+$config+'"';$action.WorkingDirectory=Split-Path $exe -Parent
 $task=$folder.RegisterTaskDefinition($name,$definition,2,$sid,$null,3,$null);$registered=$true
 $running=$task.RunEx($null,4,$currentSession,$null)
 $until=[DateTime]::UtcNow.AddSeconds(12)
 do {
  $report.samples+=@{state=[int]$running.State;engine_pid=[int]$running.EnginePID;last_result=[int]$task.LastTaskResult;at=[DateTime]::UtcNow.ToString('O')}
  if(Test-Path -LiteralPath $errorFile){$errorText=[IO.File]::ReadAllText($errorFile);$report.entry_reached=$true;$report.worker_result=$errorText;break}
  Start-Sleep -Milliseconds 300
 }while([DateTime]::UtcNow -lt $until)
}finally {
 if($null -ne $running){try{$running.Stop()}catch{}}
 if($registered){$folder.DeleteTask($name,0)}
 foreach($file in @($config,$errorFile,$config+'.worker-entry')){if(Test-Path -LiteralPath $file){Remove-Item -LiteralPath $file}}
 $report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'reports/task-desktop-scheduler-entry-probe.json') -Encoding utf8
 $report | ConvertTo-Json -Depth 5 -Compress
}
