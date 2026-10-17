using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace WinPilotTaskDesktop;

static class ChildSessionQuery
{
    [StructLayout(LayoutKind.Sequential)]
    struct WtsSessionInfo { internal uint SessionId; internal IntPtr WinStationName; internal int State; }
    [DllImport("wtsapi32.dll",EntryPoint="WTSGetChildSessionId",SetLastError=true)] static extern bool GetChildSessionIdRaw(out uint id);
    [DllImport("wtsapi32.dll",SetLastError=true)] static extern bool WTSEnumerateSessionsW(IntPtr server,uint reserved,uint version,out IntPtr sessions,out uint count);
    [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool WTSQuerySessionInformationW(IntPtr server,uint session,int kind,out IntPtr buffer,out uint bytes);
    [DllImport("wtsapi32.dll")] static extern void WTSFreeMemory(IntPtr memory);

    // WTS_CONNECTSTATE_CLASS.WTSListen. Protocol listeners are not sessions.
    const int ListenState=6;
    // WTS_INFO_CLASS: WTSUserName, WTSConnectState.
    const int UserNameKind=5, DomainNameKind=7, ConnectStateKind=8;

    // Windows 11 also returns FALSE / ERROR_NOT_FOUND with ULONG(-1) when
    // no child exists. Only that exact pair is a known empty result.
    internal static bool IsKnown(bool succeeded,uint session,int error)
        =>succeeded||(!succeeded&&session==uint.MaxValue&&error==1168);

    // WTSGetChildSessionId keeps reporting the id of a child session that has
    // already been destroyed, so its value alone is never a launch target.
    // Enumerating real sessions is the only way to tell a live child from a stale id.
    internal static HashSet<uint> LiveSessions()
    {
        if(!WTSEnumerateSessionsW(IntPtr.Zero,0,1,out IntPtr buffer,out uint count))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        try {
            var live=new HashSet<uint>();
            int size=Marshal.SizeOf<WtsSessionInfo>();
            for(uint i=0;i<count;i++) {
                var info=Marshal.PtrToStructure<WtsSessionInfo>(IntPtr.Add(buffer,(int)(i*(uint)size)));
                if(info.State!=ListenState)live.Add(info.SessionId);
            }
            return live;
        } finally { WTSFreeMemory(buffer); }
    }

    internal static bool Live(uint session)
    {
        try{return session!=uint.MaxValue&&LiveSessions().Contains(session);}catch{return false;}
    }

    // A child session is only usable once the same account has a logon there.
    // This deliberately does not require explorer.exe: the worker is started
    // through the Task Scheduler, and requiring a shell would couple worker
    // startup to a shell that may legitimately be suppressed.
    internal static bool SessionUser(uint session,out string user)
    {
        user="";
        if(!WTSQuerySessionInformationW(IntPtr.Zero,session,UserNameKind,out IntPtr buffer,out uint bytes))
            return false;
        try {
            if(bytes<2||buffer==IntPtr.Zero)return false;
            user=Marshal.PtrToStringUni(buffer)??"";
            return user.Length>0;
        } finally { WTSFreeMemory(buffer); }
    }

    internal static bool SessionUserSid(uint session,out string sid)
    {
        sid="";
        if(!SessionUser(session,out string user)||!WTSQuerySessionInformationW(IntPtr.Zero,session,DomainNameKind,out IntPtr buffer,out uint bytes))return false;
        string domain;
        try{domain=bytes>=2&&buffer!=IntPtr.Zero?Marshal.PtrToStringUni(buffer)??"":"";}finally{WTSFreeMemory(buffer);}
        // Never resolve an unqualified username against an implicit local domain.
        if(domain.Length==0)return false;
        try{sid=((SecurityIdentifier)new NTAccount(domain,user).Translate(typeof(SecurityIdentifier))).Value;return true;}
        catch(IdentityNotMappedException){return false;}
        catch(SystemException){return false;}
    }

    internal static bool CanCleanup(IReadOnlyCollection<uint> live,HashSet<uint> baseline,uint parent,uint bound,uint? reported,string? sessionSid,string expectedSid)
        =>bound!=0&&bound!=uint.MaxValue&&bound!=parent&&!baseline.Contains(bound)&&reported==bound&&live.Contains(bound)
        &&live.Count(id=>id!=0&&id!=parent&&!baseline.Contains(id))==1
        &&!string.IsNullOrEmpty(sessionSid)&&!string.IsNullOrEmpty(expectedSid)&&string.Equals(sessionSid,expectedSid,StringComparison.Ordinal);

    internal static int? ConnectState(uint session)
    {
        if(!WTSQuerySessionInformationW(IntPtr.Zero,session,ConnectStateKind,out IntPtr buffer,out uint bytes))return null;
        try{return bytes<4?null:Marshal.ReadInt32(buffer);}finally{WTSFreeMemory(buffer);}
    }

    // Resolve the one child session this connection created: live, not the parent,
    // and absent from the pre-connect baseline. Ambiguity is refused rather than
    // guessed, so a stale id or a second session can never be targeted.
    internal static bool TryResolve(IReadOnlyCollection<uint> live,HashSet<uint> baseline,uint parent,uint? reported,out uint session,out string pending)
    {
        session=uint.MaxValue;
        var created=live.Where(id=>id!=0&&id!=parent&&!baseline.Contains(id)).Distinct().ToArray();
        if(created.Length>1){pending="观察到多个候选子会话，已拒绝猜测。";return false;}
        // A baseline difference alone could be somebody else's new logon. Require
        // the Windows parent/child query to agree with the single live candidate.
        // Stale or unavailable mappings remain pending rather than being guessed.
        if(created.Length==1&&reported.HasValue&&reported.Value==created[0]&&reported.Value!=uint.MaxValue&&reported.Value!=parent)
            {session=reported.Value;pending="";return true;}
        pending=created.Length==1?"新会话与 Windows 父子会话关联尚未一致，未取得目标归属。":"尚未观察到本次新建的子会话。";
        return false;
    }

    internal static bool TryResolveLive(HashSet<uint> baseline,uint parent,out uint session,out string pending)
    {
        uint? reported=ReportedChild(out uint id)?id:null;
        try{return TryResolve(LiveSessions(),baseline,parent,reported,out session,out pending);}
        catch(Exception e){session=uint.MaxValue;pending="无法枚举 Windows 会话："+e.Message;return false;}
    }

    internal static bool ReportedChild(out uint session)
    {
        session=uint.MaxValue;
        bool success=GetChildSessionIdRaw(out uint id);
        int error=Marshal.GetLastWin32Error();
        if(!IsKnown(success,id,error))return false;
        session=id;
        return id!=uint.MaxValue;
    }
}
