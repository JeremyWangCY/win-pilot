$ErrorActionPreference = 'Stop'
# Read only Win-Pilot's exact current-user target. Report metadata only: never
# enumerate other credentials, decrypt a password, or print credential bytes.
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
public static class WinPilotLoginStatus {
 [StructLayout(LayoutKind.Sequential)] struct Credential {
  public uint Flags,Type; public IntPtr TargetName,Comment; public long LastWritten;
  public uint CredentialBlobSize; public IntPtr CredentialBlob; public uint Persist,AttributeCount;
  public IntPtr Attributes,TargetAlias,UserName;
 }
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CredReadW(string target,uint type,uint flags,out IntPtr credential);
 [DllImport("advapi32.dll")] static extern void CredFree(IntPtr pointer);
 public static int[] Read() {
  using(var identity=WindowsIdentity.GetCurrent()) {
   if(identity.User==null)throw new InvalidOperationException("Current Windows user is unavailable");
   string target="WinPilot/TaskDesktop/"+identity.User.Value+"/Login/v1";
   IntPtr pointer;
   if(!CredReadW(target,1,0,out pointer)) {int error=Marshal.GetLastWin32Error();return new[]{0,0,error};}
   Credential value=default(Credential);
   try {
    value=(Credential)Marshal.PtrToStructure(pointer,typeof(Credential));
    byte[] header=Encoding.ASCII.GetBytes("WINPILOT_DPAPI_V1");
    bool valid=value.Type==1&&value.Persist==2&&value.CredentialBlob!=IntPtr.Zero&&value.CredentialBlobSize>header.Length&&value.CredentialBlobSize<=2560;
    if(valid)for(int i=0;i<header.Length;i++)if(Marshal.ReadByte(value.CredentialBlob,i)!=header[i]){valid=false;break;}
    return new[]{1,valid?1:0,0};
   } finally {
    if(value.CredentialBlob!=IntPtr.Zero&&value.CredentialBlobSize<=2560)for(int i=0;i<value.CredentialBlobSize;i++)Marshal.WriteByte(value.CredentialBlob,i,0);
    CredFree(pointer);
   }
  }
 }
}
'@
$taskLoginStatus = [WinPilotLoginStatus]::Read()
[ordered]@{
  credential_present = $taskLoginStatus[0] -eq 1
  encrypted_format_valid = $taskLoginStatus[1] -eq 1
  windows_error = $taskLoginStatus[2]
  password_decrypted = $false
  target_scope = 'WinPilot current-user task desktop login only'
} | ConvertTo-Json
if ($taskLoginStatus[2] -ne 0 -and $taskLoginStatus[2] -ne 1168) { exit 1 }
