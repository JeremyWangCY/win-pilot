using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;

namespace WinPilotTaskDesktop;

// Plaintext exists only while this native process verifies or connects. It is
// never part of the agent protocol, helper configuration, or diagnostic output.
sealed class WindowsLogin : IDisposable
{
    internal string Account { get; }
    internal byte[] Password { get; }
    internal WindowsLogin(string account,byte[] password){Account=account;Password=password;}
    internal (string User,string? Domain) Parts()=>Split(Account);
    internal static (string User,string? Domain) Split(string account)
    {
        if(string.IsNullOrWhiteSpace(account)||account.Length>512||account.Contains('\0'))throw new InvalidOperationException("请输入 Windows 账号。");
        int slash=account.IndexOf('\\');
        if(slash<0)return (account,null);
        if(slash==0||slash==account.Length-1||account.IndexOf('\\',slash+1)>=0)throw new InvalidOperationException("账号格式应为 域\\用户名 或邮箱。");
        return (account[(slash+1)..],account[..slash]);
    }
    internal void ValidateCurrentUser()
    {
        var (user,domain)=Parts();
        IntPtr password=Marshal.AllocHGlobal(Password.Length+2),token=IntPtr.Zero;
        try {
            Marshal.Copy(Password,0,password,Password.Length);Marshal.WriteInt16(password,Password.Length,0);
            if(!LogonUserW(user,domain,password,3,0,out token))throw new Win32Exception(Marshal.GetLastWin32Error(),"Windows 未接受该登录信息，请检查账号密码（不是 PIN）。");
            using var loggedIn=new WindowsIdentity(token);
            using var current=WindowsIdentity.GetCurrent();
            if(loggedIn.User==null||current.User==null||!loggedIn.User.Equals(current.User))throw new InvalidOperationException("请使用当前 Windows 用户的账号，不能连接其他用户的桌面。");
        }finally{Zero(password,Password.Length+2);Marshal.FreeHGlobal(password);if(token!=IntPtr.Zero)CloseHandle(token);}
    }
    internal static void Zero(IntPtr pointer,int length){for(int i=0;i<length;i++)Marshal.WriteByte(pointer,i,0);}
    public void Dispose()=>CryptographicOperations.ZeroMemory(Password);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool LogonUserW(string user,string? domain,IntPtr password,int kind,int provider,out IntPtr token);
    [DllImport("kernel32.dll")]static extern bool CloseHandle(IntPtr handle);
}

class WindowsLoginStore
{
    static readonly byte[] Header=Encoding.ASCII.GetBytes("WINPILOT_DPAPI_V1");
    readonly string target;
    readonly byte[] entropy;
    internal WindowsLoginStore(Guid? testId=null)
    {
        using var identity=WindowsIdentity.GetCurrent();
        string sid=identity.User?.Value??throw new InvalidOperationException("无法确认当前 Windows 用户。");
        target="WinPilot/TaskDesktop/"+sid+(testId.HasValue?"/Tests/"+testId.Value.ToString("D"):"/Login/v1");
        entropy=Encoding.UTF8.GetBytes(target);
    }
    internal virtual void Save(WindowsLogin login)
    {
        WindowsLogin.Split(login.Account);
        if(login.Password.Length>1024||login.Password.Length%2!=0)throw new InvalidOperationException("登录信息长度不受支持。");
        byte[] encrypted=Protect(login.Password,true),blob=new byte[Header.Length+encrypted.Length];
        IntPtr secret=IntPtr.Zero,name=IntPtr.Zero,account=IntPtr.Zero;
        try {
            Header.CopyTo(blob,0);encrypted.CopyTo(blob,Header.Length);
            if(blob.Length>2560)throw new InvalidOperationException("登录信息超过 Windows 保存限制。");
            secret=Marshal.AllocHGlobal(blob.Length);Marshal.Copy(blob,0,secret,blob.Length);
            name=Marshal.StringToHGlobalUni(target);account=Marshal.StringToHGlobalUni(login.Account);
            var credential=new Credential(){Type=1,TargetName=name,UserName=account,CredentialBlobSize=(uint)blob.Length,CredentialBlob=secret,Persist=2};
            if(!CredWriteW(ref credential,0))throw new Win32Exception(Marshal.GetLastWin32Error(),"Windows 无法保存 Win-Pilot 登录信息。");
        }finally{
            if(secret!=IntPtr.Zero){WindowsLogin.Zero(secret,blob.Length);Marshal.FreeHGlobal(secret);}
            if(name!=IntPtr.Zero)Marshal.FreeHGlobal(name);if(account!=IntPtr.Zero)Marshal.FreeHGlobal(account);
            CryptographicOperations.ZeroMemory(encrypted);CryptographicOperations.ZeroMemory(blob);
        }
    }
    internal virtual WindowsLogin? Read()
    {
        if(!CredReadW(target,1,0,out IntPtr pointer)){
            int error=Marshal.GetLastWin32Error();if(error==1168)return null;
            throw new Win32Exception(error,"无法读取 Win-Pilot 登录设置，请在「登录设置」重新设置或清除。");
        }
        byte[]? blob=null,clear=null;
        try {
            var credential=Marshal.PtrToStructure<Credential>(pointer);
            if(credential.Type!=1||credential.CredentialBlob==IntPtr.Zero||credential.CredentialBlobSize<=Header.Length||credential.CredentialBlobSize>2560)throw InvalidSaved();
            string account=Marshal.PtrToStringUni(credential.UserName)??throw InvalidSaved();WindowsLogin.Split(account);
            blob=new byte[(int)credential.CredentialBlobSize];Marshal.Copy(credential.CredentialBlob,blob,0,blob.Length);
            if(!blob.AsSpan(0,Header.Length).SequenceEqual(Header))throw InvalidSaved();
            clear=Protect(blob.AsSpan(Header.Length).ToArray(),false);
            if(clear.Length>1024||clear.Length%2!=0)throw InvalidSaved();
            var login=new WindowsLogin(account,clear);clear=null;return login;
        }finally{
            if(clear!=null)CryptographicOperations.ZeroMemory(clear);if(blob!=null)CryptographicOperations.ZeroMemory(blob);
            if(pointer!=IntPtr.Zero){var value=Marshal.PtrToStructure<Credential>(pointer);if(value.CredentialBlob!=IntPtr.Zero&&value.CredentialBlobSize<=2560)WindowsLogin.Zero(value.CredentialBlob,(int)value.CredentialBlobSize);CredFree(pointer);}
        }
    }
    internal virtual void Delete()
    {
        if(!CredDeleteW(target,1,0)&&Marshal.GetLastWin32Error()!=1168)throw new Win32Exception(Marshal.GetLastWin32Error(),"无法清除 Win-Pilot 登录设置。");
    }
    static InvalidOperationException InvalidSaved()=>new("Win-Pilot 保存的登录信息无法使用，请在「登录设置」重新设置或清除。");
    byte[] Protect(byte[] input,bool encrypt)
    {
        IntPtr source=IntPtr.Zero,extra=IntPtr.Zero;DataBlob output=default;
        try {
            source=Marshal.AllocHGlobal(Math.Max(1,input.Length));Marshal.Copy(input,0,source,input.Length);
            extra=Marshal.AllocHGlobal(entropy.Length);Marshal.Copy(entropy,0,extra,entropy.Length);
            var data=new DataBlob(){Size=(uint)input.Length,Data=source};var salt=new DataBlob(){Size=(uint)entropy.Length,Data=extra};
            bool ok=encrypt?CryptProtectData(ref data,IntPtr.Zero,ref salt,IntPtr.Zero,IntPtr.Zero,1,out output):CryptUnprotectData(ref data,IntPtr.Zero,ref salt,IntPtr.Zero,IntPtr.Zero,1,out output);
            if(!ok)throw new Win32Exception(Marshal.GetLastWin32Error(),"Windows 无法保护或恢复 Win-Pilot 登录信息，请重新设置。");
            if(output.Size>65536||output.Data==IntPtr.Zero)throw InvalidSaved();
            byte[] result=new byte[(int)output.Size];Marshal.Copy(output.Data,result,0,result.Length);return result;
        }finally{
            if(source!=IntPtr.Zero){WindowsLogin.Zero(source,input.Length);Marshal.FreeHGlobal(source);}if(extra!=IntPtr.Zero)Marshal.FreeHGlobal(extra);
            if(output.Data!=IntPtr.Zero){WindowsLogin.Zero(output.Data,(int)output.Size);LocalFree(output.Data);}
        }
    }
    [StructLayout(LayoutKind.Sequential)]struct DataBlob{internal uint Size;internal IntPtr Data;}
    [StructLayout(LayoutKind.Sequential)]struct Credential
    {
        internal uint Flags,Type;internal IntPtr TargetName,Comment;internal long LastWritten;internal uint CredentialBlobSize;internal IntPtr CredentialBlob;internal uint Persist,AttributeCount;internal IntPtr Attributes,TargetAlias,UserName;
    }
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredReadW(string target,uint type,uint flags,out IntPtr credential);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredWriteW(ref Credential credential,uint flags);
    [DllImport("advapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool CredDeleteW(string target,uint type,uint flags);
    [DllImport("advapi32.dll")]static extern void CredFree(IntPtr value);
    [DllImport("crypt32.dll",SetLastError=true)]static extern bool CryptProtectData(ref DataBlob input,IntPtr description,ref DataBlob entropy,IntPtr reserved,IntPtr prompt,uint flags,out DataBlob output);
    [DllImport("crypt32.dll",SetLastError=true)]static extern bool CryptUnprotectData(ref DataBlob input,IntPtr description,ref DataBlob entropy,IntPtr reserved,IntPtr prompt,uint flags,out DataBlob output);
    [DllImport("kernel32.dll")]static extern IntPtr LocalFree(IntPtr value);
}
