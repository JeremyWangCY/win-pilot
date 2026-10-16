using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;

namespace WinPilotTaskDesktop;

// Read a stable process handle, including the session in its actual primary token.
static class ProcessIdentity
{
    internal sealed record Info(uint Pid, uint Session, string Image, long Created, string User);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr process,uint access,out IntPtr token);
    [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,out uint value,int size,out int required);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageNameW(IntPtr process,uint flags,StringBuilder image,ref uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process,out long created,out long exited,out long kernel,out long user);

    internal static uint SessionFromToken(IntPtr token) {
        if(!GetTokenInformation(token,12,out uint session,sizeof(uint),out _))throw new Win32Exception();
        return session;
    }
    internal static Info Capture(uint pid) {
        IntPtr process=OpenProcess(0x1000,false,pid),token=IntPtr.Zero;
        if(process==IntPtr.Zero)throw new Win32Exception();
        try {
            if(!OpenProcessToken(process,8,out token))throw new Win32Exception();
            uint session=SessionFromToken(token);
            var image=new StringBuilder(32768);uint size=(uint)image.Capacity;
            if(!QueryFullProcessImageNameW(process,0,image,ref size)||!GetProcessTimes(process,out long created,out _,out _,out _))throw new Win32Exception();
            using var identity=new WindowsIdentity(token);
            return new(pid,session,image.ToString(),created,identity.User?.Value??throw new InvalidOperationException("进程缺少用户身份。"));
        }finally{if(token!=IntPtr.Zero)CloseHandle(token);CloseHandle(process);}
    }
    internal static Info Verify(uint pid,uint session,string image,long? created=null) {
        var actual=Capture(pid);
        if(actual.Session!=session||!string.Equals(Path.GetFullPath(actual.Image),Path.GetFullPath(image),StringComparison.OrdinalIgnoreCase)||(created.HasValue&&actual.Created!=created.Value))
            throw new InvalidOperationException("执行进程身份或所属会话不匹配。");
        return actual;
    }
}
