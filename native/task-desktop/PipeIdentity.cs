using System.IO.Pipes;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace WinPilotTaskDesktop;

static class PipeIdentity
{
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeClientProcessId(SafePipeHandle pipe,out uint pid);
    [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetNamedPipeServerProcessId(SafePipeHandle pipe,out uint pid);
    internal static ProcessIdentity.Info Client(NamedPipeServerStream pipe,uint expectedPid,uint session,string image) {
        if(!GetNamedPipeClientProcessId(pipe.SafePipeHandle,out uint peer)||peer!=expectedPid)throw new InvalidOperationException("执行工具管道进程身份不匹配。");
        return ProcessIdentity.Verify(peer,session,image);
    }
    internal static ProcessIdentity.Info Server(NamedPipeClientStream pipe,uint expectedPid,uint session,string image,long created) {
        if(!GetNamedPipeServerProcessId(pipe.SafePipeHandle,out uint peer)||peer!=expectedPid)throw new InvalidOperationException("任务桌面宿主管道身份不匹配。");
        return ProcessIdentity.Verify(peer,session,image,created);
    }
}
