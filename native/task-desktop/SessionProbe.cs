using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace WinPilotTaskDesktop;

// Read-only inspection of the interactive sessions UU (or any other remote-control
// product) can currently pick. It never creates, connects, or logs off a session.
//
// Windows cannot tell a remote-control product "do not take the child session"
// through any documented API, and GameViewerServer 4.42.1.2835 does not call
// WTSGetChildSessionId, so it treats our child session as an ordinary logged-on
// user session. The only reliable signal is the one WTS already exposes:
// WTSClientProtocolType is 0 for the local console and non-zero for RDP/loopback
// sessions, and WTSGetChildSessionId names the child session explicitly.
static class SessionProbe
{
    [StructLayout(LayoutKind.Sequential)]
    struct WtsSessionInfo { internal uint SessionId; internal IntPtr WinStationName; internal int State; }

    [DllImport("wtsapi32.dll",SetLastError=true)] static extern bool WTSEnumerateSessionsW(IntPtr server,uint reserved,uint version,out IntPtr sessions,out uint count);
    [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool WTSQuerySessionInformationW(IntPtr server,uint session,int kind,out IntPtr buffer,out uint bytes);
    [DllImport("wtsapi32.dll",EntryPoint="WTSGetChildSessionId",SetLastError=true)] static extern bool GetChildSessionIdRaw(out uint id);
    [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr memory);
    [DllImport("wtsapi32.dll",SetLastError=true)] static extern bool WTSIsChildSessionsEnabled(out bool enabled);

    // Process inspection stays on the managed API: WTSEnumerateProcessesW hands
    // back image-name pointers whose lifetime cannot be verified here, and an
    // access violation is not catchable, so a bad pointer would kill the host.

    // Remote-control products that stream a session. A process from this list whose
    // session is our child session is direct evidence that someone is watching it:
    // the child session is a loopback RDP session, so its own existence is not a
    // signal, and WTS reports the same client protocol whether or not a viewer is
    // attached. These names are matched case-insensitively without the extension.
    static readonly string[] RemoteControlNames = {
        "GameViewerServer","GameViewer","AnyDesk","ToDesk","ToDesk_Service","SunloginClient",
        "SunloginRemoteService","RustDesk","TeamViewer","TeamViewer_Service","mstsc","winvnc4","tvnserver",
    };

    internal static bool IsRemoteControl(string name)
    {
        if(string.IsNullOrEmpty(name))return false;
        foreach(var candidate in RemoteControlNames)
            if(string.Equals(name,candidate,StringComparison.OrdinalIgnoreCase))return true;
        return false;
    }

    [DllImport("iphlpapi.dll")] static extern uint GetExtendedTcpTable(IntPtr table,ref int size,bool order,int family,int tableClass,uint reserved);
    [DllImport("iphlpapi.dll")] static extern uint GetExtendedUdpTable(IntPtr table,ref int size,bool order,int family,int tableClass,uint reserved);
    const int AfInet=2, AfInet6=23, TcpOwnerPidAll=5, UdpOwnerPid=1, TcpEstablished=5;

    // A streamer's own network use is the only sign of whether a viewer is
    // attached. An idle UU streamer talks HTTPS only (one to five connections
    // to port 443 after a restart, settling to one) and holds no UDP; media
    // needs other sockets. Returns null when a table cannot be read, so the
    // caller treats the traffic as unknown rather than idle.
    static Dictionary<int,(int Established,int NonHttps,int Udp)>? NetworkUse()
    {
        var use=new Dictionary<int,(int Established,int NonHttps,int Udp)>();
        // Row layouts: MIB_TCPROW_OWNER_PID is 6 DWORDs (state first, pid last);
        // MIB_TCP6ROW_OWNER_PID is 56 bytes (state at 48, pid at 52); the UDP
        // rows are 12 and 28 bytes with the pid last.
        foreach(var (family,rowSize,stateOffset,pidOffset,remoteOffset,remoteLength,portOffset) in new[]{(AfInet,24,0,20,12,4,16),(AfInet6,56,48,52,24,16,44)}) {
            if(!ReadTable(true,family,out var buffer,out int rows))return null;
            try {
                for(int i=0;i<rows;i++) {
                    var row=IntPtr.Add(buffer,4+i*rowSize);
                    if(Marshal.ReadInt32(row,stateOffset)!=TcpEstablished)continue;
                    var remote=new byte[remoteLength];Marshal.Copy(IntPtr.Add(row,remoteOffset),remote,0,remoteLength);
                    if(System.Net.IPAddress.IsLoopback(new System.Net.IPAddress(remote)))continue;
                    // The port is stored in network byte order in the low word.
                    int port=((Marshal.ReadByte(row,portOffset)<<8)|Marshal.ReadByte(row,portOffset+1));
                    int pid=Marshal.ReadInt32(row,pidOffset);use.TryGetValue(pid,out var c);use[pid]=(c.Established+1,c.NonHttps+(port==443?0:1),c.Udp);
                }
            } finally { Marshal.FreeHGlobal(buffer); }
        }
        foreach(var (family,rowSize) in new[]{(AfInet,12),(AfInet6,28)}) {
            if(!ReadTable(false,family,out var buffer,out int rows))return null;
            try {
                for(int i=0;i<rows;i++) {
                    int pid=Marshal.ReadInt32(IntPtr.Add(buffer,4+i*rowSize),rowSize-4);use.TryGetValue(pid,out var c);use[pid]=(c.Established,c.NonHttps,c.Udp+1);
                }
            } finally { Marshal.FreeHGlobal(buffer); }
        }
        return use;
    }

    static bool ReadTable(bool tcp,int family,out IntPtr buffer,out int rows)
    {
        buffer=IntPtr.Zero;rows=0;int size=0;
        for(int attempt=0;attempt<4;attempt++) {
            uint status=tcp?GetExtendedTcpTable(buffer,ref size,false,family,TcpOwnerPidAll,0):GetExtendedUdpTable(buffer,ref size,false,family,UdpOwnerPid,0);
            if(status==0){rows=Marshal.ReadInt32(buffer);return true;}
            if(buffer!=IntPtr.Zero){Marshal.FreeHGlobal(buffer);buffer=IntPtr.Zero;}
            if(status!=122)return false;
            buffer=Marshal.AllocHGlobal(size);
        }
        if(buffer!=IntPtr.Zero){Marshal.FreeHGlobal(buffer);buffer=IntPtr.Zero;}
        return false;
    }

    // Returns the remote-control processes this account can see. Anything that
    // cannot be read is skipped rather than guessed, so an unreadable entry can
    // never fabricate an exposure.
    internal static JsonArray RemoteControlProcesses()
    {
        var found=new JsonArray();
        var network=NetworkUse();
        Process[] all;
        try { all=Process.GetProcesses(); } catch(Exception) { return found; }
        foreach(var process in all) {
            try {
                if(!IsRemoteControl(process.ProcessName))continue;
                var row=new JsonObject {
                    ["name"]=process.ProcessName,
                    ["process_id"]=process.Id,
                    ["session_id"]=process.SessionId
                };
                if(network!=null) {
                    network.TryGetValue(process.Id,out var use);
                    row["established"]=use.Established;row["non_https"]=use.NonHttps;row["udp"]=use.Udp;
                }
                found.Add(row);
            } catch(Exception) { }
            finally { process.Dispose(); }
        }
        return found;
    }

    // WTS_CONNECTSTATE_CLASS.WTSListen: protocol listeners are not sessions.
    const int ListenState=6;
    // WTS_INFO_CLASS: WTSClientProtocolType, WTSConnectState, WTSUserName.
    const int ClientProtocolTypeKind=16, ConnectStateKind=8, UserNameKind=5;
    const int WTSActive=0;

    // WTSClientProtocolType: console sessions report 0. RDP and loopback RDP report 2.
    internal static int? ClientProtocolType(uint session)
    {
        if(!WTSQuerySessionInformationW(IntPtr.Zero,session,ClientProtocolTypeKind,out IntPtr buffer,out uint bytes))return null;
        try { return bytes<(uint)sizeof(short)?null:(int)Marshal.ReadInt16(buffer); } finally { WTSFreeMemory(buffer); }
    }

    internal static int? ConnectState(uint session)
    {
        if(!WTSQuerySessionInformationW(IntPtr.Zero,session,ConnectStateKind,out IntPtr buffer,out uint bytes))return null;
        try { return bytes<4?null:Marshal.ReadInt32(buffer); } finally { WTSFreeMemory(buffer); }
    }

    internal static string UserName(uint session)
    {
        if(!WTSQuerySessionInformationW(IntPtr.Zero,session,UserNameKind,out IntPtr buffer,out uint bytes)||buffer==IntPtr.Zero)return "";
        try { return bytes<2?"":Marshal.PtrToStringUni(buffer)??""; } finally { WTSFreeMemory(buffer); }
    }

    internal static uint? ChildSessionId()
    {
        bool succeeded=GetChildSessionIdRaw(out uint id);
        int error=Marshal.GetLastWin32Error();
        // Windows 11 reports FALSE / ERROR_NOT_FOUND with ULONG(-1) when no child exists.
        if(!succeeded&&!(id==uint.MaxValue&&error==1168))return null;
        return id==uint.MaxValue||id==0?null:id;
    }

    // A remote-control product has an interactive target when an active session
    // other than our own child reports a non-zero client protocol. The child
    // session is itself loopback RDP, so counting it would flag every healthy run.
    //
    // Whether a viewer is attached to the child session is only observable through
    // its streamer process: WTS reports the same protocol with or without one.
    internal static JsonObject Snapshot()
    {
        var sessions=new JsonArray();
        bool externalRemote=false, anyConsoleActive=false;
        uint? child=ChildSessionId();
        if(!WTSEnumerateSessionsW(IntPtr.Zero,0,1,out IntPtr buffer,out uint count))throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            int size=Marshal.SizeOf<WtsSessionInfo>();
            for(uint i=0;i<count;i++) {
                var info=Marshal.PtrToStructure<WtsSessionInfo>(IntPtr.Add(buffer,(int)(i*(uint)size)));
                if(info.State==ListenState)continue;
                int? protocol=ClientProtocolType(info.SessionId);
                int? state=ConnectState(info.SessionId);
                bool isChild=child.HasValue&&child.Value==info.SessionId;
                if(state==WTSActive&&protocol!=0&&!isChild)externalRemote=true;
                if(state==WTSActive&&protocol==0&&!isChild)anyConsoleActive=true;
                sessions.Add(new JsonObject {
                    ["session_id"]=info.SessionId,
                    ["user"]=UserName(info.SessionId),
                    ["state"]=state,
                    ["client_protocol_type"]=protocol,
                    ["child_session"]=isChild
                });
            }
        } finally { WTSFreeMemory(buffer); }
        var streamers=RemoteControlProcesses();
        var childStreamers=new JsonArray();
        foreach(var entry in streamers) {
            var row=entry?.AsObject();
            if(row is null)continue;
            // Process.SessionId is an Int32; comparing it as UInt32 would throw.
            int streamerSession=row["session_id"]?.GetValue<int>()??-1;
            if(child.HasValue&&streamerSession>=0&&(uint)streamerSession==child.Value)childStreamers.Add(row.DeepClone());
        }
        bool enabled=WTSIsChildSessionsEnabled(out bool value)&&value;
        return new JsonObject {
            ["ok"]=true,
            ["remote_active"]=externalRemote,
            ["console_active"]=anyConsoleActive,
            ["child_session_present"]=child.HasValue,
            ["child_session_id"]=child,
            ["child_sessions_enabled"]=enabled,
            ["sessions"]=sessions,
            ["remote_control_processes"]=streamers,
            // Non-empty means a remote-control streamer is running inside the child
            // session, so a remote viewer is attached to the AI desktop.
            ["child_session_streamers"]=childStreamers
        };
    }
}
