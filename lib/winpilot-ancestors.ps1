param([uint32]$ParentProcess)
$ErrorActionPreference = 'Stop'
# The same process query used by the desktop helper. It does not depend on WMI,
# the registry or PowerShell module auto-loading.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class WinPilotAncestors {
  [StructLayout(LayoutKind.Sequential)] struct BasicInformation {
    public IntPtr Reserved1, PebBaseAddress, Reserved2_0, Reserved2_1, UniqueProcessId, ParentProcessId;
  }
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("ntdll.dll")] static extern int NtQueryInformationProcess(IntPtr handle,int kind,ref BasicInformation information,int size,out int returned);
  public static uint Parent(uint pid) {
    IntPtr handle=OpenProcess(0x1000,false,pid);
    if(handle==IntPtr.Zero) return 0;
    try {
      var information=new BasicInformation(); int returned;
      return NtQueryInformationProcess(handle,0,ref information,Marshal.SizeOf(typeof(BasicInformation)),out returned)==0
        ? unchecked((uint)information.ParentProcessId.ToInt64()) : 0;
    } finally { CloseHandle(handle); }
  }
}
'@
$cursorId = $ParentProcess
$seen = @{}
for ($i = 0; $i -lt 24 -and $cursorId -gt 0 -and -not $seen.ContainsKey($cursorId); $i++) {
  $seen[$cursorId] = $true
  $cursorId
  $cursorId = [WinPilotAncestors]::Parent($cursorId)
}
