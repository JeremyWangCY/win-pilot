param([Parameter(Mandatory=$true)][int]$ChildSession,[Parameter(Mandatory=$true)][int]$ExplorerPid,[Parameter(Mandatory=$true)][long]$ExplorerCreated)
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Collections.Generic;
public static class ChildLaunchProbe {
 [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct SI {public int cb;public string reserved,desktop,title;public int x,y,cx,cy,xc,yc,fill,flags;public short show,cb2;public IntPtr reserved2,input,output,error;}
 [StructLayout(LayoutKind.Sequential)] struct SIX {public SI si;public IntPtr list;}
 [StructLayout(LayoutKind.Sequential)] struct PI {public IntPtr process,thread;public uint pid,tid;}
 [DllImport("wtsapi32.dll",SetLastError=true)]static extern bool WTSGetChildSessionId(out uint id);
 [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr OpenProcess(uint access,bool inherit,int pid);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool DuplicateTokenEx(IntPtr token,uint access,IntPtr attrs,int level,int type,out IntPtr duplicate);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateProcessAsUserW(IntPtr token,string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string dir,ref SI si,out PI pi);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CreateProcessW(string app,StringBuilder cmd,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string dir,ref SIX si,out PI pi);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool InitializeProcThreadAttributeList(IntPtr list,int count,int flags,ref IntPtr size);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool UpdateProcThreadAttribute(IntPtr list,uint flags,IntPtr key,IntPtr value,IntPtr size,IntPtr previous,IntPtr returned);
 [DllImport("kernel32.dll")]static extern void DeleteProcThreadAttributeList(IntPtr list);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool TerminateProcess(IntPtr process,uint code);
 [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
 [DllImport("kernel32.dll",SetLastError=true)]static extern bool GetProcessTimes(IntPtr process,out long created,out long exit,out long kernel,out long user);
 [StructLayout(LayoutKind.Sequential,Pack=4)]struct TP {public uint count;public long luid;public uint attributes;}
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool LookupPrivilegeValueW(string system,string name,out long luid);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool AdjustTokenPrivileges(IntPtr token,bool disable,ref TP state,int size,out TP previous,out int returned);
 [DllImport("advapi32.dll",SetLastError=true)]static extern bool GetTokenInformation(IntPtr token,int kind,out uint value,int size,out int required);
 static void Check(bool ok){if(!ok)throw new System.ComponentModel.Win32Exception();}
 public static string Run(uint child,int explorer,long created,string exe) {
  Check(WTSGetChildSessionId(out uint current));if(current!=child||child==Process.GetCurrentProcess().SessionId||child==0)throw new Exception("Wrong child");
  IntPtr shell=OpenProcess(0x1080,false,explorer),token=IntPtr.Zero;Check(shell!=IntPtr.Zero);
  var results=new List<object>();
  try {
   Check(GetProcessTimes(shell,out long actual,out _,out _,out _));if(actual!=created)throw new Exception("Explorer changed");
   Check(OpenProcessToken(shell,0xA,out token));Check(GetTokenInformation(token,12,out uint sid,4,out _));if(sid!=child)throw new Exception("Wrong token session");
   using(var remote=new WindowsIdentity(token))using(var self=WindowsIdentity.GetCurrent())if(remote.User!=self.User)throw new Exception("Wrong user");
   foreach(uint access in new uint[]{0xB,0x2000000}) {
    Check(DuplicateTokenEx(token,access,IntPtr.Zero,2,1,out IntPtr primary));
    try {var si=new SI{cb=Marshal.SizeOf<SI>(),desktop="winsta0\\default"};
     bool ok=CreateProcessAsUserW(primary,exe,new StringBuilder("\""+exe+"\" --preview"),IntPtr.Zero,IntPtr.Zero,false,0x08000404,IntPtr.Zero,System.IO.Path.GetDirectoryName(exe),ref si,out PI pi);int error=Marshal.GetLastWin32Error();
     uint observed=uint.MaxValue;if(ok){try{Check(OpenProcessToken(pi.process,8,out IntPtr pt));try{Check(GetTokenInformation(pt,12,out observed,4,out _));}finally{CloseHandle(pt);}}finally{Check(TerminateProcess(pi.process,1));CloseHandle(pi.thread);CloseHandle(pi.process);}}
     results.Add(new{method="as_user",access,ok,error,session=observed,suspended_only=true});
    }finally{CloseHandle(primary);}
   }
   IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);IntPtr list=Marshal.AllocHGlobal(size),value=Marshal.AllocHGlobal(IntPtr.Size);bool initialized=false;
   try {Check(InitializeProcThreadAttributeList(list,1,0,ref size));initialized=true;Marshal.WriteIntPtr(value,shell);Check(UpdateProcThreadAttribute(list,0,new IntPtr(0x20000),value,new IntPtr(IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
    var six=new SIX{si=new SI{cb=Marshal.SizeOf<SIX>(),desktop="winsta0\\default"},list=list};
    bool ok=CreateProcessW(exe,new StringBuilder("\""+exe+"\" --preview"),IntPtr.Zero,IntPtr.Zero,false,0x08080404,IntPtr.Zero,System.IO.Path.GetDirectoryName(exe),ref six,out PI pi);int error=Marshal.GetLastWin32Error();
    uint observed=uint.MaxValue;if(ok){try{Check(OpenProcessToken(pi.process,8,out IntPtr pt));try{Check(GetTokenInformation(pt,12,out observed,4,out _));}finally{CloseHandle(pt);}}finally{Check(TerminateProcess(pi.process,1));CloseHandle(pi.thread);CloseHandle(pi.process);}}
    results.Add(new{method="child_shell_parent",ok,error,session=observed,suspended_only=true});
   }finally{if(initialized)DeleteProcThreadAttributeList(list);Marshal.FreeHGlobal(value);Marshal.FreeHGlobal(list);}
  }finally{if(token!=IntPtr.Zero)CloseHandle(token);CloseHandle(shell);}
  return System.Text.Json.JsonSerializer.Serialize(results);
 }
 public static string RunWithTcb(uint child,int explorer,long created,string exe) {
  Check(OpenProcessToken(Process.GetCurrentProcess().Handle,0x28,out IntPtr token));
  try {Check(LookupPrivilegeValueW(null,"SeTcbPrivilege",out long luid));var request=new TP{count=1,luid=luid,attributes=2};Check(AdjustTokenPrivileges(token,false,ref request,Marshal.SizeOf<TP>(),out TP previous,out _));int error=Marshal.GetLastWin32Error();if(error!=0)throw new System.ComponentModel.Win32Exception(error);
   try{return Run(child,explorer,created,exe);}finally{Check(AdjustTokenPrivileges(token,false,ref previous,Marshal.SizeOf<TP>(),out _,out _));}
  }finally{CloseHandle(token);}
 }
}
'@
$result=[ChildLaunchProbe]::Run($ChildSession,$ExplorerPid,$ExplorerCreated,"$root/lib/task-desktop/win-pilot-task-desktop.exe")
$result | Set-Content -LiteralPath "$root/reports/task-desktop-child-launch-probe.json" -Encoding utf8
$result
$privileged=[ChildLaunchProbe]::RunWithTcb($ChildSession,$ExplorerPid,$ExplorerCreated,"$root/lib/task-desktop/win-pilot-task-desktop.exe")
$privileged | Set-Content -LiteralPath "$root/reports/task-desktop-child-launch-tcb-probe.json" -Encoding utf8
$privileged
