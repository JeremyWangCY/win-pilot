using Microsoft.Win32;
using System.Globalization;

namespace WinPilotTaskDesktop;

// Reconstructed from shipped PiP code. Explorer's marker semantics are private,
// so passing these checks does not prove that every StartupTask is suppressed.
static class ExplorerStartupMarker
{
    internal const string SessionInfoPath=@"Software\Microsoft\Windows\CurrentVersion\Explorer\SessionInfo";
    internal static void Prepare(uint parent,uint target,Func<uint> observedChild,Action<uint,string> createVolatileMarker,CancellationToken cancellation=default)
    {
        if(target==0||target==uint.MaxValue||target==parent)throw new InvalidOperationException("拒绝标记主桌面或无效会话。");
        foreach(string marker in new[]{"RunStuffHasBeenRun","StartupHasBeenRun"}) {
            cancellation.ThrowIfCancellationRequested();
            if(observedChild()!=target)throw new InvalidOperationException("目标子会话已改变，未继续标记。");
            createVolatileMarker(target,marker);
        }
    }
    internal static void CreateRegistryMarker(uint session,string marker)
    {
        if(session==0||session==uint.MaxValue||marker is not ("RunStuffHasBeenRun" or "StartupHasBeenRun"))throw new InvalidOperationException("无效的会话启动标记。");
        using var root=Registry.CurrentUser.OpenSubKey(SessionInfoPath,writable:true)??throw new InvalidOperationException("Windows 会话启动信息尚未准备好。");
        using var sessionKey=root.CreateSubKey(session.ToString(CultureInfo.InvariantCulture),RegistryKeyPermissionCheck.ReadWriteSubTree,RegistryOptions.Volatile);
        using var key=sessionKey.CreateSubKey(marker,RegistryKeyPermissionCheck.ReadWriteSubTree,RegistryOptions.Volatile);
    }
}
