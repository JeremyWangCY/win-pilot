$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
# This recovery is deliberately bound to the recorded failed host test. It is
# not a general logoff command and cannot accept an arbitrary session number.
$proof=Get-Content -LiteralPath "$root/artifacts/task-desktop-host/aac24515-eaed-498f-a291-6e0d52dbcf3a/native.jsonl" | ForEach-Object { $_ | ConvertFrom-Json }
$connected=$proof | Where-Object {$_.event -eq 'startup_isolation' -and $_.instance_id -eq 'f1be9625-5203-4fd8-8e13-e74d61512890' -and $_.stage -eq 'login_complete' -and $_.windows_session_id -eq 2}
if(@($connected).Count -ne 1){throw 'The original test ownership evidence is missing.'}
Add-Type @'
using System;
using System.Diagnostics;
using System.Security.Principal;
using System.Runtime.InteropServices;
public static class OwnedChildCleanup {
 [DllImport("wtsapi32.dll",SetLastError=true)] static extern bool WTSGetChildSessionId(out uint id);
 [DllImport("wtsapi32.dll",SetLastError=true)] static extern bool WTSLogoffSession(IntPtr server,uint id,bool wait);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 public static void Run() {
  if(Process.GetCurrentProcess().SessionId!=1||!WTSGetChildSessionId(out uint child)||child!=2)throw new Exception("Original parent/child mapping changed");
  using(var shell=Process.GetProcessById(6424)) {
   if(shell.SessionId!=2||shell.StartTime.ToUniversalTime().ToFileTimeUtc()!=134365291814115116||!String.Equals(shell.MainModule.FileName,Environment.GetFolderPath(Environment.SpecialFolder.Windows)+"\\explorer.exe",StringComparison.OrdinalIgnoreCase))throw new Exception("Original child Explorer identity changed");
   if(!OpenProcessToken(shell.Handle,8,out IntPtr token))throw new System.ComponentModel.Win32Exception();
   try {using(var identity=new WindowsIdentity(token))using(var self=WindowsIdentity.GetCurrent())if(identity.User!=self.User)throw new Exception("Child user changed");}finally{CloseHandle(token);}
   if(!WTSGetChildSessionId(out child)||child!=2)throw new Exception("Child mapping changed");
   if(!WTSLogoffSession(IntPtr.Zero,2,true))throw new System.ComponentModel.Win32Exception();
  }
 }
}
'@
[OwnedChildCleanup]::Run()
@{original_instance='f1be9625-5203-4fd8-8e13-e74d61512890';child=2;explorer_pid=6424;explorer_created=134365291814115116;logoff_returned=$true;at=[DateTime]::UtcNow.ToString('O')} | ConvertTo-Json | Set-Content -LiteralPath "$root/reports/task-desktop-owned-child-recovery.json"
Get-Process -Id 5068 | Select-Object Id,SessionId,StartTime
