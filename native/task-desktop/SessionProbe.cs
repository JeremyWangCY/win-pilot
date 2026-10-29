using System.ComponentModel;
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

    // A remote-control product has an interactive target when a non-console
    // session is active, or when any session reports a non-zero client protocol.
    internal static JsonObject Snapshot()
    {
        var sessions=new JsonArray();
        bool remote=false, anyConsoleActive=false;
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
                // Console (protocol 0) that is active is the user's own desktop.
                // Anything else that is active is an interactive remote target.
                if(state==WTSActive&&protocol!=0)remote=true;
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
        bool enabled=WTSIsChildSessionsEnabled(out bool value)&&value;
        return new JsonObject {
            ["ok"]=true,
            ["remote_active"]=remote,
            ["console_active"]=anyConsoleActive,
            ["child_session_present"]=child.HasValue,
            ["child_session_id"]=child,
            ["child_sessions_enabled"]=enabled,
            ["sessions"]=sessions
        };
    }
}
