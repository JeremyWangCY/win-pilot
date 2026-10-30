using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace WinPilotTaskDesktop;

// Logging off the child session sends any remote-control streamer that follows
// the newest session (UU's GameViewerServer) back into the user's session, and
// UU's privacy screen then rebuilds the display topology there. Observed on
// 2026-10-30: two seconds after the logoff the laptop panel's scale dropped from
// 125% to 100% and stayed there. The host records every active monitor's scale
// before logoff, and a detached watcher puts back any that change shortly after.
static class DisplayScale
{
    internal sealed record Monitor(string Path,int Scale);

    const uint OnlyActivePaths=2;
    const int GetTargetName=2,GetDpiScale=-3,SetDpiScale=-4;
    // How long after logoff a change is attributed to the session teardown, and
    // how often one monitor is put back before giving up on a product that keeps
    // re-applying its own value.
    static readonly TimeSpan WatchFor=TimeSpan.FromSeconds(60);
    const int MaxRestoresPerMonitor=3;

    [StructLayout(LayoutKind.Sequential)] struct Header{public int Type;public int Size;public uint AdapterLow;public int AdapterHigh;public uint Id;}
    [StructLayout(LayoutKind.Sequential)] struct DpiGet{public Header Header;public int Min;public int Current;public int Max;}
    [StructLayout(LayoutKind.Sequential)] struct DpiSet{public Header Header;public int Scale;}
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct TargetName{
        public Header Header;public uint Flags;public int Technology;public ushort Manufacturer;public ushort Product;public uint Connector;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=64)] public string FriendlyName;
        [MarshalAs(UnmanagedType.ByValTStr,SizeConst=128)] public string DevicePath;
    }
    [DllImport("user32.dll")] static extern int GetDisplayConfigBufferSizes(uint flags,out uint paths,out uint modes);
    [DllImport("user32.dll")] static extern int QueryDisplayConfig(uint flags,ref uint paths,[Out] byte[] pathInfo,ref uint modes,[Out] byte[] modeInfo,IntPtr topology);
    [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref DpiGet info);
    [DllImport("user32.dll")] static extern int DisplayConfigGetDeviceInfo(ref TargetName info);
    [DllImport("user32.dll")] static extern int DisplayConfigSetDeviceInfo(ref DpiSet info);

    // Scales are relative steps from the recommended value, the only form the
    // DPI-scale device info accepts. Monitors are keyed by device path because a
    // topology rebuild can move the same panel to another source id.
    static List<(Monitor Monitor,Header Source)> Read()
    {
        var found=new List<(Monitor,Header)>();
        if(GetDisplayConfigBufferSizes(OnlyActivePaths,out uint pathCount,out uint modeCount)!=0)return found;
        // DISPLAYCONFIG_PATH_INFO is 72 bytes: source adapter LUID and id at 0..11,
        // target adapter LUID and id at 20..31. A mode is 64 bytes.
        var paths=new byte[pathCount*72];var modes=new byte[modeCount*64];
        if(QueryDisplayConfig(OnlyActivePaths,ref pathCount,paths,ref modeCount,modes,IntPtr.Zero)!=0)return found;
        for(int i=0;i<pathCount;i++){
            int at=i*72;
            var target=new TargetName{Header=new(){Type=GetTargetName,Size=Marshal.SizeOf<TargetName>(),AdapterLow=BitConverter.ToUInt32(paths,at+20),AdapterHigh=BitConverter.ToInt32(paths,at+24),Id=BitConverter.ToUInt32(paths,at+28)}};
            var scale=new DpiGet{Header=new(){Type=GetDpiScale,Size=Marshal.SizeOf<DpiGet>(),AdapterLow=BitConverter.ToUInt32(paths,at),AdapterHigh=BitConverter.ToInt32(paths,at+4),Id=BitConverter.ToUInt32(paths,at+8)}};
            if(DisplayConfigGetDeviceInfo(ref target)!=0||DisplayConfigGetDeviceInfo(ref scale)!=0||string.IsNullOrEmpty(target.DevicePath))continue;
            found.Add((new Monitor(target.DevicePath,scale.Current),scale.Header));
        }
        return found;
    }

    /// <summary>The user's scales before the child session is torn down, as JSON.</summary>
    internal static string Capture()
    {
        try{return JsonSerializer.Serialize(Read().Select(row=>row.Monitor).ToArray());}catch{return "[]";}
    }

    /// <summary>Monitors present in both lists whose scale moved away from the recorded one.</summary>
    internal static IEnumerable<Monitor> Changed(IEnumerable<Monitor> recorded,IEnumerable<Monitor> current)
    {
        var before=recorded.GroupBy(m=>m.Path,StringComparer.OrdinalIgnoreCase).ToDictionary(g=>g.Key,g=>g.First().Scale,StringComparer.OrdinalIgnoreCase);
        return current.Where(m=>before.TryGetValue(m.Path,out int scale)&&scale!=m.Scale).Select(m=>m with{Scale=before[m.Path]});
    }

    /// <summary>Start the watcher apart from this host, which exits right after cleanup.</summary>
    internal static void WatchDetached(string recorded)
    {
        if(recorded=="[]")return;
        try{
            var start=new ProcessStartInfo(Environment.ProcessPath!){UseShellExecute=false,CreateNoWindow=true};
            start.ArgumentList.Add("--restore-display-scale");start.ArgumentList.Add(recorded);
            Process.Start(start)?.Dispose();
        }catch{ /* the scale guard is best effort and never blocks cleanup */ }
    }

    internal static void Watch(string recorded)
    {
        var before=JsonSerializer.Deserialize<Monitor[]>(recorded)??[];
        var restores=new Dictionary<string,int>(StringComparer.OrdinalIgnoreCase);
        var deadline=DateTime.UtcNow+WatchFor;
        while(DateTime.UtcNow<deadline){
            var now=Read();
            foreach(var wanted in Changed(before,now.Select(row=>row.Monitor))){
                restores.TryGetValue(wanted.Path,out int count);
                if(count>=MaxRestoresPerMonitor)continue;
                restores[wanted.Path]=count+1;
                var source=now.First(row=>string.Equals(row.Monitor.Path,wanted.Path,StringComparison.OrdinalIgnoreCase)).Source;
                var set=new DpiSet{Header=source,Scale=wanted.Scale};
                set.Header.Type=SetDpiScale;set.Header.Size=Marshal.SizeOf<DpiSet>();
                DisplayConfigSetDeviceInfo(ref set);
            }
            Thread.Sleep(500);
        }
    }
}
