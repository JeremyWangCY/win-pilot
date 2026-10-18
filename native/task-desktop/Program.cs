using System.Diagnostics;
using System.IO.Pipes;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace WinPilotTaskDesktop;

static class Program
{
    internal static readonly object OutputLock = new();
    internal static bool Stdio;
    internal static void Emit(object value) { if (!Stdio) return; lock(OutputLock) Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(value)); }
    internal static JsonObject Fail(string code, string message, bool sent = false) => new() { ["ok"]=false,["error_code"]=code,["message"]=message,["outcome"]=sent?"unknown":"not_executed",["actionSent"]=sent,["retry"]=sent?"reobserve":"never" };
    [STAThread]
    static void Main(string[] args)
    {
        if(args.Length==1&&args[0]=="--enable-child-sessions") {
            Environment.ExitCode=Native.WTSEnableChildSessions(true)&&Native.WTSIsChildSessionsEnabled(out bool enabled)&&enabled?0:1;return;
        }
        if(args.Length==2 && args[0]=="--worker") { try{Worker.Run(args[1]).GetAwaiter().GetResult();}catch(Exception e){try{File.WriteAllText(args[1]+".worker-error",e.ToString());}catch{}} return; }
        ApplicationConfiguration.Initialize();
        if(args.Length==1&&args[0]=="--setup-login") {
            using var dialog=new LoginSettingsDialog();Environment.ExitCode=dialog.ShowDialog()==DialogResult.OK?0:2;dialog.Login?.Dispose();return;
        }
        Stdio=args.Contains("--stdio");
        if(Stdio){Console.SetIn(new StreamReader(Console.OpenStandardInput(),Encoding.UTF8));Console.SetOut(new StreamWriter(Console.OpenStandardOutput(),new UTF8Encoding(false)){AutoFlush=true});}
        string instance=Guid.NewGuid().ToString();
        for(int i=0;i+1<args.Length;i++) if(args[i]=="--instance-id") instance=Guid.Parse(args[i+1]).ToString();
        Application.Run(new DesktopWindow(instance,args.Contains("--preview")));
    }
}

static class Native
{
    internal static bool Mutation(string action)=>!new[]{"list_apps","list_windows","get_window","get_window_state","get_app_identity","screenshot","elements","read_clipboard","list_displays","cursor_position","wait"}.Contains(action);
    [DllImport("wtsapi32.dll",SetLastError=true)] internal static extern bool WTSIsChildSessionsEnabled(out bool enabled);
    [DllImport("wtsapi32.dll",SetLastError=true)] internal static extern bool WTSEnableChildSessions(bool enabled);
    internal static async Task EnableChildSessions(CancellationToken cancellation)
    {
        if(WTSEnableChildSessions(true))return;
        int error=Marshal.GetLastWin32Error();
        if(error!=5)throw new System.ComponentModel.Win32Exception(error);
        // One Windows UAC request for the exact child-session switch. No service,
        // password storage or general remote-desktop policy changes are needed.
        var start=new ProcessStartInfo(Environment.ProcessPath!){UseShellExecute=true,Verb="runas"};
        start.ArgumentList.Add("--enable-child-sessions");
        using var enable=await Task.Run(()=>Process.Start(start),cancellation)??throw new IOException("Windows 未启动独立桌面启用程序。");
        await enable.WaitForExitAsync(cancellation);
        if(enable.ExitCode!=0||!WTSIsChildSessionsEnabled(out bool enabled)||!enabled)throw new InvalidOperationException("Windows 尚未启用独立桌面。");
    }
    [DllImport("wtsapi32.dll",EntryPoint="WTSGetChildSessionId",SetLastError=true)] static extern bool GetChildSessionIdRaw(out uint id);
    internal static bool WTSGetChildSessionId(out uint id){bool success=GetChildSessionIdRaw(out id);int error=Marshal.GetLastWin32Error();return ChildSessionQuery.IsKnown(success,id,error);}
    [DllImport("wtsapi32.dll",SetLastError=true)] internal static extern bool WTSLogoffSession(IntPtr server,uint session,bool wait);
    [DllImport("wtsapi32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern bool WTSQuerySessionInformationW(IntPtr server,uint session,int kind,out IntPtr buffer,out uint bytes);
    [DllImport("wtsapi32.dll")]static extern void WTSFreeMemory(IntPtr memory);
    internal static bool SessionExists(uint session){
        bool success=WTSQuerySessionInformationW(IntPtr.Zero,session,8,out IntPtr buffer,out uint bytes);int error=Marshal.GetLastWin32Error();
        try{if(success)return bytes>=4;if(error is 2 or 7022)return false;throw new System.ComponentModel.Win32Exception(error);}finally{if(buffer!=IntPtr.Zero)WTSFreeMemory(buffer);}
    }
    [DllImport("user32.dll")] internal static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll",SetLastError=true)]internal static extern bool PrintWindow(IntPtr window,IntPtr dc,uint flags);
    [DllImport("user32.dll",EntryPoint="SendMessageW")]internal static extern IntPtr SendWindowMessage(IntPtr window,int message,IntPtr wParam,IntPtr lParam);
    [DllImport("user32.dll")] internal static extern bool IsChild(IntPtr parent,IntPtr child);
    internal delegate bool ChildWindowVisitor(IntPtr window,IntPtr state);
    [DllImport("user32.dll")]internal static extern bool EnumChildWindows(IntPtr parent,ChildWindowVisitor visitor,IntPtr state);
    [DllImport("user32.dll")] internal static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint process);
    [DllImport("kernel32.dll")] internal static extern bool ProcessIdToSessionId(uint process,out uint session);
    internal static bool WindowBelongsToSession(IntPtr window,uint session){
        GetWindowThreadProcessId(window,out uint process);
        return IsWindow(window)&&ProcessIdToSessionId(process,out uint actual)&&actual==session;
    }
    [DllImport("user32.dll")] internal static extern short VkKeyScanW(char ch);
    [DllImport("user32.dll")] internal static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
    internal static bool InputDown(int key){
        if((key==1||key==2)&&GetSystemMetrics(23)!=0)key=3-key;
        return (GetAsyncKeyState(key)&0x8000)!=0;
    }
    [DllImport("user32.dll")] internal static extern uint MapVirtualKeyW(uint code,uint type);
    internal static void SendKeys(object client,(uint vk,bool up,bool extended)[] events)=>RdpKeyboard.Send(client,events);
    [ComImport,Guid("302D8188-0052-4807-806A-362B628F9AC5"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ExtendedSettings
    {
        void SetProperty([MarshalAs(UnmanagedType.BStr)] string name,[In,MarshalAs(UnmanagedType.Struct)] ref object value);
        void GetProperty([MarshalAs(UnmanagedType.BStr)] string name,[Out,MarshalAs(UnmanagedType.Struct)] out object value);
    }
}

sealed class RdpView : AxHost,IMessageFilter
{
    public RdpView():base("8B918B82-7985-4C24-89DF-C33AD2BBFBCD") { Application.AddMessageFilter(this);inputWindowTimer.Tick+=(_,_)=>BindInputWindows(); }
    public object Client => GetOcx();
    public bool AllowUserInput;
    public Func<Task<bool>>? AcquireUserInput;
    public Action? UserActivity;
    readonly List<Message> queuedInput=new();
    readonly List<InputWindow> inputWindows=new();
    readonly System.Windows.Forms.Timer inputWindowTimer=new(){Interval=250};
    volatile bool replayingInput;
    readonly HashSet<long> heldInput=new();
    internal Func<int,bool> InputIsDown=Native.InputDown;
    public bool HasHeldUserInput {get{
        // Native capture/IME windows can consume an up outside this subtree.
        // Reconcile only inputs already tracked here; never record global input.
        heldInput.RemoveWhere(key=>!InputIsDown(key>0?(int)key:key switch{-1=>1,-2=>2,-3=>4,-4=>5,-5=>6,_=>0}));
        return heldInput.Count>0;
    }}
    public void ReleaseUserInputTracking()=>heldInput.Clear();
    bool acquiringInput;
    static bool IsInput(int message)=>(message>=0x100&&message<=0x109)||(message>=0x200&&message<=0x20e)||(message>=0x240&&message<=0x24f);
    public bool PreFilterMessage(ref Message message){
        if(!IsHandleCreated||(message.HWnd!=Handle&&!Native.IsChild(Handle,message.HWnd))||!IsInput(message.Msg))return false;
        if(message.Msg is 0x100 or 0x104)heldInput.Add(message.WParam.ToInt64());
        if(message.Msg is 0x101 or 0x105)heldInput.Remove(message.WParam.ToInt64());
        int button=message.Msg switch {0x201 or 0x203 or 0x202=>1,0x204 or 0x206 or 0x205=>2,0x207 or 0x209 or 0x208=>3,0x20b or 0x20d or 0x20c=>4,_=>0};
        if(button==4&&((message.WParam.ToInt64()>>16)&0xffff)==2)button=5;
        if(button>0){if(message.Msg is 0x202 or 0x205 or 0x208 or 0x20c)heldInput.Remove(-button);else heldInput.Add(-button);}
        if(AllowUserInput&&!acquiringInput){UserActivity?.Invoke();return false;}
        if(AcquireUserInput==null)return true;
        // Hover does not take control. Preserve the first gesture while the
        // worker confirms its input has stopped, then deliver in original order.
        if(!acquiringInput&&message.Msg==0x200)return true;
        if(queuedInput.Count>=512){queuedInput.Clear();AcquireUserInput=null;return true;}
        if(message.Msg==0x200&&queuedInput.Count>0&&queuedInput[^1].Msg==0x200)queuedInput[^1]=message;else queuedInput.Add(message);UserActivity?.Invoke();
        if(!acquiringInput){acquiringInput=true;_=AcquireAndReplay();}
        return true;
    }
    async Task AcquireAndReplay(){
        try{
            bool allowed=AcquireUserInput!=null&&await AcquireUserInput();
            if(!allowed||!AllowUserInput||IsDisposed||AcquireUserInput==null)return;
            foreach(var message in queuedInput.ToArray())ReplayInput(message);
        }catch(Exception e){AllowUserInput=false;Program.Emit(new{@event="manual_input_failed",message=e.Message});}
        finally{queuedInput.Clear();acquiringInput=false;}
    }
    void ReplayInput(Message message){
        if(IsDisposed||!AllowUserInput||!Native.IsWindow(message.HWnd)||(message.HWnd!=Handle&&!Native.IsChild(Handle,message.HWnd)))return;
        replayingInput=true;try{Native.SendWindowMessage(message.HWnd,message.Msg,message.WParam,message.LParam);}finally{replayingInput=false;}
    }
    void ReceiveInput(Message message){if(IsDisposed)return;if(!PreFilterMessage(ref message))ReplayInput(message);}
    sealed class InputWindow : NativeWindow {
        readonly RdpView owner;
        internal InputWindow(RdpView view,IntPtr window){owner=view;AssignHandle(window);}
        protected override void WndProc(ref Message message){
            // Native ActiveX child windows also receive synchronous messages,
            // which never pass through WinForms' IMessageFilter.
            if(IsInput(message.Msg)&&!owner.replayingInput){
                var copy=message;
                if(owner.InvokeRequired){try{owner.BeginInvoke(new Action(()=>owner.ReceiveInput(copy)));}catch(InvalidOperationException){}}
                else owner.ReceiveInput(copy);
                return;
            }
            base.WndProc(ref message);
        }
    }
    void BindInputWindows(){
        if(!IsHandleCreated||IsDisposed)return;
        inputWindows.RemoveAll(window=>window.Handle==IntPtr.Zero);
        Native.EnumChildWindows(Handle,(window,_)=>{
            Native.GetWindowThreadProcessId(window,out uint process);
            if(process==(uint)Environment.ProcessId&&Control.FromHandle(window)==null&&!inputWindows.Any(bound=>bound.Handle==window))try{inputWindows.Add(new(this,window));}catch(InvalidOperationException){}
            return true;
        },IntPtr.Zero);
    }
    protected override void OnHandleCreated(EventArgs e){base.OnHandleCreated(e);inputWindowTimer.Start();BindInputWindows();}
    protected override void WndProc(ref Message message){if(IsHandleCreated&&IsInput(message.Msg)&&!replayingInput){ReceiveInput(message);return;}base.WndProc(ref message);}
    protected override void Dispose(bool disposing){if(disposing){Application.RemoveMessageFilter(this);inputWindowTimer.Dispose();foreach(var window in inputWindows)window.ReleaseHandle();inputWindows.Clear();}base.Dispose(disposing);}
}

sealed class DesktopWindow : Form
{
    readonly string instance, token=Convert.ToHexString(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));
    readonly bool previewOnly;
    readonly int parentSession=Process.GetCurrentProcess().SessionId;
    readonly string parentUserSid=ProcessIdentity.Capture((uint)Environment.ProcessId).User;
    readonly string pipeName, configPath, helperPath;
    readonly Panel canvas=new(){Dock=DockStyle.Fill,BackColor=Color.FromArgb(247,248,250)};
    readonly Label notice=new(){Dock=DockStyle.Fill,TextAlign=ContentAlignment.MiddleCenter,ForeColor=Color.FromArgb(102,112,133),Font=new Font("Microsoft YaHei UI",13)};
    readonly Label badge=new(){AutoSize=false,Dock=DockStyle.Fill,ForeColor=Color.FromArgb(26,127,90),Padding=new Padding(9,6,0,0)};
    readonly CancellationTokenSource lifetime=new();
    readonly CancellationTokenSource startupCancellation=new();
    readonly Dictionary<string,TaskCompletionSource<JsonObject>> pending=new();
    readonly SemaphoreSlim pipeWrite=new(1,1);
    readonly SemaphoreSlim startupGate=new(1,1);
    readonly System.Windows.Forms.Timer timer=new(){Interval=500};
    readonly System.Windows.Forms.Timer startupTimer=new(){Interval=25};
    RdpView? view; NamedPipeServerStream? pipe; StreamWriter? writer;
    Task? acceptWorkerTask,bootstrapTask;
    bool bootstrapCleanupConfirmed;
    TaskCompletionSource<bool> workerReady=new(TaskCreationOptions.RunContinuationsAsynchronously);
    readonly TaskCompletionSource<bool> rdpConnected=new(TaskCreationOptions.RunContinuationsAsynchronously);
    readonly TaskCompletionSource<bool> startupMarkersReady=new(TaskCreationOptions.RunContinuationsAsynchronously);
    readonly TaskCompletionSource<bool> loginCompleted=new(TaskCreationOptions.RunContinuationsAsynchronously);
    uint childSession=uint.MaxValue; HashSet<uint> sessionBaseline=new(); bool paused=true, takeover, closing, shutdownComplete, opening, connected, bootstrapStarted,workerAuthenticated,sessionInvalidated;
    ProcessIdentity.Info? workerIdentity;
    string state="idle",lastError="";
    DateTime connectStarted,lastSessionWaitNotice;
    // WTS session enumeration blocks for about a minute while a child session is
    // being created. Calling it on the UI thread froze the timer and the RDP startup
    // sequence, so it now runs only on a background thread and every UI-thread check
    // reads this cached snapshot instead.
    readonly object liveLock=new(); HashSet<uint> liveSnapshot=new(); Task? liveRefresh; long lastSlowEnumerateMs;
    HashSet<uint> LiveSnapshot(){lock(liveLock)return new(liveSnapshot);}
    bool LiveCached(uint id){lock(liveLock)return liveSnapshot.Contains(id);}
    void RefreshLiveSessions()
    {
        if(liveRefresh is {IsCompleted:false})return;
        liveRefresh=Task.Run(()=>{
            long started=Environment.TickCount64;
            try{var live=ChildSessionQuery.LiveSessions();lock(liveLock)liveSnapshot=live;}catch{}
            long elapsed=Environment.TickCount64-started;
            if(elapsed>250&&elapsed-lastSlowEnumerateMs>250){
                lastSlowEnumerateMs=elapsed;
                Program.Emit(new{@event="startup_isolation",instance_id=instance,stage="session_enumerate_slow",windows_session_id=(uint?)null,marker=(string?)null,elapsed_ms=elapsed,timestamp=DateTime.UtcNow.ToString("O")});
            }
        });
    }
    bool TryResolveCached(out uint sid,out string pending)
    {
        uint? reported=ChildSessionQuery.ReportedChild(out uint value)?value:null;
        return ChildSessionQuery.TryResolve(LiveSnapshot(),sessionBaseline,(uint)parentSession,reported,out sid,out pending);
    }
    readonly Button windowSize,pinWindow;
    readonly ToolStripMenuItem loginSettings;
    readonly ContextMenuStrip windowMenu=new();
    readonly ToolTip windowHints=new(){ShowAlways=true};
    Rectangle compactBounds;
    bool expanded;
    bool automaticTakeover;
    long lastManualInput;
    long manualInputVersion;
    bool windowsLoginRequested,connectionRequested;
    public DesktopWindow(string id,bool preview=false)
    {
        instance=id;previewOnly=preview; pipeName="win-pilot-task-"+id;
        configPath=Path.Combine(Path.GetTempPath(),"win-pilot", "task-desktop-"+id+".json");
        helperPath=Path.GetFullPath(Path.Combine(AppContext.BaseDirectory,"..","win-pilot-helper.ps1"));
        Text="Win-Pilot · 任务桌面";FormBorderStyle=FormBorderStyle.None;
        ClientSize=new(432,300);MinimumSize=new(360,240);StartPosition=FormStartPosition.Manual;TopMost=true;Padding=new Padding(1);
        var work=Screen.PrimaryScreen!.WorkingArea;Location=new(Math.Max(work.Left,work.Right-Width-16),Math.Max(work.Top,work.Bottom-Height-16));
        BackColor=Color.White; ForeColor=Color.FromArgb(24,25,27); Font=new Font("Microsoft YaHei UI",9);
        var top=new Panel(){Dock=DockStyle.Top,Height=32};
        var tools=new FlowLayoutPanel(){Dock=DockStyle.Right,Width=104,Padding=new Padding(0,3,2,2),WrapContents=false};
        loginSettings=MenuItem("登录设置…",()=>{using var dialog=new LoginSettingsDialog();dialog.ShowDialog(this);dialog.Login?.Dispose();return Task.CompletedTask;});
        windowMenu.BackColor=Color.White;windowMenu.ForeColor=ForeColor;windowMenu.Font=Font;
        windowMenu.Items.Add(loginSettings);top.ContextMenuStrip=windowMenu;badge.ContextMenuStrip=windowMenu;
        windowSize=Button("↗",()=>{ToggleWindowSize();return Task.CompletedTask;});windowSize.Name="task-window-size";windowSize.AccessibleName="放大任务窗口";
        pinWindow=Button("",()=>{TopMost=!TopMost;pinWindow!.Invalidate();return Task.CompletedTask;});pinWindow.Name="task-window-pin";pinWindow.AccessibleName="切换置顶";
        pinWindow.Paint+=(_,e)=>{
            e.Graphics.SmoothingMode=System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            using var shape=new System.Drawing.Drawing2D.GraphicsPath();
            shape.AddPolygon(new Point[]{new(10,4),new(20,4),new(20,6),new(18,6),new(18,12),new(21,15),new(9,15),new(12,12),new(12,6),new(10,6)});
            using var pen=new Pen(ForeColor,1.2f);if(TopMost){using var fill=new SolidBrush(ForeColor);e.Graphics.FillPath(fill,shape);}else e.Graphics.DrawPath(pen,shape);
            e.Graphics.DrawLine(pen,15,15,15,21);
        };
        var closeWindow=Button("×",()=>{Close();return Task.CompletedTask;});closeWindow.AccessibleName="关闭任务窗口";
        foreach(var button in new[]{windowSize,pinWindow,closeWindow}){button.AutoSize=false;button.Size=new(30,25);button.Margin=new Padding(2,0,1,0);button.FlatAppearance.BorderSize=0;}
        windowHints.SetToolTip(windowSize,"放大 / 收回 · 放大后可直接操作，空闲10秒交还 AI");windowHints.SetToolTip(pinWindow,"置顶 / 取消置顶");windowHints.SetToolTip(closeWindow,"关闭任务窗口");
        tools.Controls.AddRange([windowSize,pinWindow,closeWindow]);top.Controls.Add(badge);top.Controls.Add(tools);
        Controls.Add(canvas);Controls.Add(top);canvas.Controls.Add(notice);
        Point? dragOrigin=null;Point windowOrigin=default;
        foreach(var surface in new Control[]{top,badge}){
            surface.MouseDown+=(_,e)=>{if(e.Button==MouseButtons.Left){dragOrigin=Cursor.Position;windowOrigin=Location;surface.Capture=true;}};
            surface.MouseMove+=(_,_)=>{if(dragOrigin is Point origin){var cursor=Cursor.Position;Location=new(windowOrigin.X+cursor.X-origin.X,windowOrigin.Y+cursor.Y-origin.Y);}};
            surface.MouseUp+=(_,_)=>{dragOrigin=null;surface.Capture=false;};
        }
        Paint+=(_,e)=>{using var border=new Pen(Color.FromArgb(229,231,235));e.Graphics.DrawRectangle(border,0,0,Width-1,Height-1);};
        Deactivate+=(_,_)=>view?.ReleaseUserInputTracking();
        notice.Font=new Font(Font.FontFamily,10);
        notice.Text=previewOnly?"任务画面":"等待连接…";
        Shown+=(_,_)=>{ UpdateState(); if(Program.Stdio)_=Task.Run(ReadCommands); };
        timer.Tick+=(_,_)=>Poll();timer.Start();
        startupTimer.Tick+=(_,_)=>{RefreshLiveSessions();PrepareStartupMarkers();};
        FormClosing+=(_,e)=>{if(!shutdownComplete){e.Cancel=true;_=Shutdown();}};
        Disposed+=(_,_)=>{windowMenu.Dispose();windowHints.Dispose();};
    }
    protected override bool ShowWithoutActivation=>previewOnly;
    void ToggleWindowSize()
    {
        var work=Screen.FromControl(this).WorkingArea;
        if(!expanded){compactBounds=Bounds;ClientSize=new(Math.Min(960,Math.Max(360,work.Width-40)),Math.Min(660,Math.Max(290,work.Height-60)));Location=new(work.Left+(work.Width-Width)/2,work.Top+(work.Height-Height)/2);}
        else {Bounds=compactBounds;Location=new(Math.Clamp(Left,work.Left,Math.Max(work.Left,work.Right-Width)),Math.Clamp(Top,work.Top,Math.Max(work.Top,work.Bottom-Height)));}
        expanded=!expanded;windowSize.Text=expanded?"↙":"↗";windowSize.AccessibleName=expanded?"收回悬浮窗":"放大任务窗口";
        ConfigureManualInput();UpdateState();
    }
    void ConfigureManualInput(){if(view!=null)view.AcquireUserInput=expanded?BeginManualInput:null;}
    async Task<bool> BeginManualInput(){
        if(!expanded||closing)return false;
        var stopping=Pause(true);long version=manualInputVersion;
        var result=await stopping;
        if(result["ok"]?.GetValue<bool>()!=true||!expanded||closing||version!=manualInputVersion)return false;
        view?.Focus();
        automaticTakeover=true;lastManualInput=Environment.TickCount64;return true;
    }
    ToolStripMenuItem MenuItem(string text,Func<Task> action)
    {
        var item=new ToolStripMenuItem(text);item.Click+=async(_,_)=>{try{await action();}catch(Exception e){Error(e.Message);}};return item;
    }
    Button Button(string text,Func<Task> action)
    {
        var b=new Button(){Text=text,AutoSize=true,Height=32,FlatStyle=FlatStyle.Flat,Margin=new Padding(4,0,4,0),BackColor=Color.White,ForeColor=Color.FromArgb(24,25,27)};
        b.FlatAppearance.BorderSize=1;b.FlatAppearance.BorderColor=Color.FromArgb(229,231,235);b.FlatAppearance.MouseOverBackColor=Color.FromArgb(243,244,246);
        b.Click+=async(_,_)=>{try{await action();}catch(Exception e){Error(e.Message);}};return b;
    }
    JsonObject Snapshot()=>new(){["ok"]=true,["instance_id"]=instance,["preview_only"]=previewOnly,["state"]=state,["windows_session_id"]=childSession==uint.MaxValue?null:childSession,["parent_windows_session_id"]=parentSession,["startup_isolation_ready"]=startupMarkersReady.Task.IsCompletedSuccessfully,["worker_ready"]=workerReady.Task.IsCompletedSuccessfully&&writer!=null&&connected,["paused"]=paused,["takeover"]=takeover,["visible"]=Visible&&!IsDisposed,["connected"]=connected,["message"]=lastError,["host_pid"]=Environment.ProcessId};
    void UpdateState()
    {
        badge.Text=state switch{"ready"=>paused?"● 已暂停":"● 运行就绪","login_settings"=>"● 首次登录设置","awaiting_windows_login"=>"● 请登录 Windows","connecting"=>"● 正在连接","takeover"=>"● 人工接管","needs_preparation"=>"● 需要准备","error"=>"● 连接失败",_=>"● 待连接"};
        if(previewOnly)badge.Text="○ 窗口预览";
        loginSettings.Enabled=!previewOnly&&!opening;
        if(view!=null)view.AllowUserInput=expanded&&(takeover||(connected&&!loginCompleted.Task.IsCompletedSuccessfully&&!workerAuthenticated));
        Program.Emit(new{ @event="state",state=Snapshot()});
    }
    void Error(string message){lastError=message;state="error";paused=true;UpdateState();if(view==null)notice.Text="暂时无法连接独立桌面\n\n"+message+"\n\n不会切换到你的主桌面执行操作。";}
    void StartupEvent(string stage,uint? session=null,string? marker=null)=>Program.Emit(new{@event="startup_isolation",instance_id=instance,stage,windows_session_id=session,marker,timestamp=DateTime.UtcNow.ToString("O")});
    void PrepareStartupMarkers()
    {
        if(startupMarkersReady.Task.IsCompleted){startupTimer.Stop();return;}
        try {
            startupCancellation.Token.ThrowIfCancellationRequested();
            if(closing||File.Exists(Path.Combine(AppContext.BaseDirectory,"safety-hold.json")))throw new InvalidOperationException("会话启动已被拦截。");
            // Markers must land before the shell starts, so this stage resolves the
            // newly created session without yet requiring a completed logon.
            bool resolved=TryResolveCached(out uint sid,out string pending);
            // A slow or failed child-session creation must be observable rather than
            // inferred, so the wait reason is recorded once per second.
            if(!resolved) {
                if(DateTime.UtcNow-lastSessionWaitNotice>TimeSpan.FromSeconds(1)) {
                    lastSessionWaitNotice=DateTime.UtcNow;
                    string live;try{live=string.Join(",",LiveSnapshot().OrderBy(id=>id));}catch(Exception e){live="enumerate_failed:"+e.Message;}
                    uint? reported=ChildSessionQuery.ReportedChild(out uint value)?value:null;
                    Program.Emit(new{@event="startup_isolation",instance_id=instance,stage="session_wait",windows_session_id=(uint?)null,marker=(string?)null,pending,live_sessions=live,reported_child=reported,timestamp=DateTime.UtcNow.ToString("O")});
                }
                return;
            }
            // The target must stay live and stay the one this connection created;
            // a stale or replaced id aborts marker creation instead of mis-marking.
            ExplorerStartupMarker.Prepare((uint)parentSession,sid,()=>LiveCached(sid)&&TryResolveCached(out uint again,out _)&&again==sid?sid:uint.MaxValue,(target,name)=>{
                if(File.Exists(Path.Combine(AppContext.BaseDirectory,"safety-hold.json")))throw new InvalidOperationException("启动标记已被安全拦截。");
                ExplorerStartupMarker.CreateRegistryMarker(target,name);StartupEvent("marker_created",target,name);
            },startupCancellation.Token);
            childSession=sid;startupTimer.Stop();startupMarkersReady.TrySetResult(true);
        }catch(Exception e){startupTimer.Stop();startupMarkersReady.TrySetException(e);startupCancellation.Cancel();Error("未完成子会话启动隔离："+e.Message);}
    }
    void Poll()
    {
        if(view==null||closing||sessionInvalidated)return;
        if(automaticTakeover&&!view.HasHeldUserInput&&Environment.TickCount64-lastManualInput>=10000){automaticTakeover=false;_=Resume();}
        try {
            int value=(int)((dynamic)view.Client).Connected;
            RefreshLiveSessions();
            if(workerIdentity!=null&&!LiveCached(workerIdentity.Session)) {sessionInvalidated=true;connected=false;takeover=false;Error("子会话已改变，已停止旧执行工具。");_=CancelWorker();return;}
            if(value==1&&!connected){connected=true;UpdateState();}
            if(connected&&childSession==uint.MaxValue&&TryResolveCached(out uint later,out _)){childSession=later;UpdateState();}
            if(connected&&loginCompleted.Task.IsCompletedSuccessfully&&startupMarkersReady.Task.IsCompletedSuccessfully&&childSession!=uint.MaxValue&&!bootstrapStarted&&!workerAuthenticated&&!workerReady.Task.IsCompleted){bootstrapStarted=true;bootstrapTask=BootstrapWorker();}
            if(connected&&value==0){connected=false;paused=true;state="disconnected";lastError="任务桌面连接已断开；没有切换到主桌面。";_=CancelWorker();UpdateState();}
        }catch(Exception e){Error("RDP 状态读取失败："+e.Message);}
    }
    async Task BootstrapWorker()
    {
        bootstrapCleanupConfirmed=false;
        try {
            // Session queries and Task Scheduler COM calls must not run on the UI
            // thread: they can block for about a minute during session creation and
            // would freeze the RDP control's own startup sequence.
            await Task.Run(()=>ChildSessionTask.Start(childSession,configPath,workerReady.Task,startupCancellation.Token,LiveCached,(stage,detail)=>{
                // Worker launch stages are surfaced so a failure identifies its step
                // instead of collapsing into one opaque message.
                StartupEvent(stage,childSession);Program.Emit(new{@event="worker_launch",instance_id=instance,stage,detail,windows_session_id=childSession,timestamp=DateTime.UtcNow.ToString("O")});
            },confirmed=>bootstrapCleanupConfirmed=confirmed));
        }catch(Exception e){
            try{File.WriteAllText(configPath+".launch-diagnostic",e.ToString());}catch{}
            workerReady.TrySetException(e);
            if(!closing)Error("执行工具启动失败："+e.Message);
        }
    }
    async Task<JsonObject> Open(bool prepare,bool windowsLogin=false)
    {
        if(closing||lifetime.IsCancellationRequested||startupCancellation.IsCancellationRequested)return Program.Fail("task_desktop_closed","任务窗口已停止连接，请重新打开窗口。");
        if(!startupGate.Wait(0))return Program.Fail("task_desktop_connecting","任务桌面正在连接，请稍后观察状态。");
        opening=true;UpdateState();
        try{return await OpenCore(prepare,windowsLogin);}
        finally{opening=false;startupGate.Release();if(!IsDisposed)UpdateState();}
    }
    async Task<JsonObject> OpenCore(bool prepare,bool windowsLogin)
    {
        Show(); if(WindowState==FormWindowState.Minimized)WindowState=FormWindowState.Normal;
        if(previewOnly)return Program.Fail("task_desktop_preview_only","当前窗口仅供预览，不建立 Windows 会话。");
        windowsLoginRequested|=windowsLogin;
        if(File.Exists(Path.Combine(AppContext.BaseDirectory,"safety-hold.json"))) {
            const string reason="独立桌面测试暂时停用：已观察到新会话触发 Windows 修复应用包并关闭主桌面的 ChatGPT。启动隔离修复并验证之前，不再创建或注销会话。";
            Error(reason);return Program.Fail("task_desktop_safety_hold",reason);
        }
        if(workerReady.Task.IsCompletedSuccessfully)return Snapshot();
        // Keep the original ownership baseline for this connection, including
        // after worker startup fails. A second login must not adopt it as old.
        if(view!=null||connected||connectionRequested)return Program.Fail("task_desktop_occupied","当前窗口已有连接，请使用「重试工具」或结束后重新连接。");
        if(!Native.WTSIsChildSessionsEnabled(out bool enabled))return Program.Fail("task_desktop_detection_failed","无法读取 Windows 子会话配置，错误 "+Marshal.GetLastWin32Error());
        if(!enabled) {
            if(!prepare&&!windowsLogin){state="needs_preparation";lastError="Windows 子会话功能尚未启用，请先完成首次设置。";notice.Text=lastError;UpdateState();return Snapshot();}
            state="preparing";lastError="首次启用独立桌面，请完成 Windows 的系统授权。";UpdateState();
            try{await Native.EnableChildSessions(startupCancellation.Token);}catch(Exception e){return Program.Fail("task_desktop_preparation_failed",e.Message);}
        }
        if(!File.Exists(helperPath))return Program.Fail("task_desktop_helper_missing","缺少任务桌面执行工具。");
        WindowsLogin? credential=null;
        try {
            credential=new WindowsLoginStore().Read();
            if(credential!=null)await Task.Run(credential.ValidateCurrentUser);
            else if(windowsLoginRequested){
                state="login_settings";lastError="请在本机登录设置窗口完成首次设置，勾选记住后可自动连接。";UpdateState();
                using var dialog=new LoginSettingsDialog();
                if(dialog.ShowDialog(this)!=DialogResult.OK)return Program.Fail("task_desktop_login_cancelled","已取消首次登录设置，未创建 Windows 会话。");
                credential=dialog.Login;
            }
        }catch(Exception e){credential?.Dispose();Error(e.Message);return Program.Fail("task_desktop_login_unavailable",e.Message);}
        using var loginLifetime=credential;
        if(closing||lifetime.IsCancellationRequested||startupCancellation.IsCancellationRequested)return Program.Fail("task_desktop_closed","连接已取消，未创建 Windows 会话。");
        // Capture ownership after human setup, which can remain open for minutes.
        // A child created by another program during setup must be pre-existing.
        try{sessionBaseline=await Task.Run(()=>ChildSessionQuery.LiveSessions());}
        catch(Exception e){return Program.Fail("task_desktop_detection_failed","无法枚举 Windows 会话，未建立连接："+e.Message);}
        if(closing||lifetime.IsCancellationRequested||startupCancellation.IsCancellationRequested)return Program.Fail("task_desktop_closed","连接已取消，未创建 Windows 会话。");
        uint? reportedExisting=ChildSessionQuery.ReportedChild(out uint existing)?existing:null;
        if(reportedExisting.HasValue&&reportedExisting.Value!=uint.MaxValue&&sessionBaseline.Contains(reportedExisting.Value))
            return Program.Fail("task_desktop_occupied","已有活动子会话，请结束现有会话后连接。");
        state="connecting";lastError="正在建立 Windows 子会话，等待独立执行工具握手…";connectStarted=DateTime.UtcNow;UpdateState();
        try {
            Directory.CreateDirectory(Path.GetDirectoryName(configPath)!);
            var hostIdentity=ProcessIdentity.Capture((uint)Environment.ProcessId);
            File.WriteAllText(configPath,new JsonObject(){["pipe"]=pipeName,["token"]=token,["helper"]=helperPath,["parent_session"]=parentSession,["host_pid"]=Environment.ProcessId,["host_created"]=hostIdentity.Created,["instance_id"]=instance}.ToJsonString(),new UTF8Encoding(false));
            pipe=new NamedPipeServerStream(pipeName,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly);
            acceptWorkerTask=AcceptWorker();
            view=new RdpView(){Dock=DockStyle.Fill};view.UserActivity=()=>lastManualInput=Environment.TickCount64;ConfigureManualInput(); ((System.ComponentModel.ISupportInitialize)view).BeginInit();canvas.Controls.Add(view);((System.ComponentModel.ISupportInitialize)view).EndInit();notice.Visible=false;view.BringToFront();view.CreateControl();
            dynamic client=view.Client; client.Server="localhost";client.DesktopWidth=1280;client.DesktopHeight=800;client.ColorDepth=32;
            var rdpEvents=new Guid("336D5562-EFA8-482E-8CB3-C5C0FC7A7DB6");
            ComEventsHelper.Combine(view.Client,rdpEvents,1,new Action(()=>StartupEvent("connecting")));
            ComEventsHelper.Combine(view.Client,rdpEvents,2,new Action(()=>{StartupEvent("connected");rdpConnected.TrySetResult(true);startupTimer.Start();PrepareStartupMarkers();}));
            ComEventsHelper.Combine(view.Client,rdpEvents,22,new Action<int>(code=>Program.Emit(new{@event="rdp_logon",instance_id=instance,error_code=code,timestamp=DateTime.UtcNow.ToString("O")})));
            ComEventsHelper.Combine(view.Client,rdpEvents,10,new Action<int>(code=>Program.Emit(new{@event="rdp_fatal",instance_id=instance,error_code=code,timestamp=DateTime.UtcNow.ToString("O")})));
            // The session becomes enumerable only after logon begins, so this event
            // is the last chance to write markers before the shell's StartupTask runs.
            // Markers are attempted synchronously here rather than aborting on order.
            ComEventsHelper.Combine(view.Client,rdpEvents,3,new Action(()=>{PrepareStartupMarkers();StartupEvent("login_complete",childSession==uint.MaxValue?null:childSession);if(startupMarkersReady.Task.IsCompletedSuccessfully)loginCompleted.TrySetResult(true);if(!startupMarkersReady.Task.IsCompletedSuccessfully){startupTimer.Stop();startupCancellation.Cancel();startupMarkersReady.TrySetException(new InvalidOperationException("Windows 登录先于启动隔离完成，已拒绝继续启动工具。"));Error("启动隔离时序未验证成功，已停止任务。");}}));
            ComEventsHelper.Combine(view.Client,rdpEvents,4,new Action<int>(reason=>{if(!closing){connected=false;paused=true;takeover=false;var error=new IOException("RDP 已断开，原因 "+reason+"；需要检查本机子会话和 Windows 登录条件。");rdpConnected.TrySetException(error);startupMarkersReady.TrySetException(error);workerReady.TrySetException(error);startupCancellation.Cancel();startupTimer.Stop();_=CancelWorker();Error(error.Message);}}));
            object yes=true;var extended=(Native.ExtendedSettings)view.Client;extended.SetProperty("ConnectToChildSession",ref yes);
            extended.GetProperty("ConnectToChildSession",out object childMode);
            if(childMode is not bool configuredChild||!configuredChild)throw new InvalidOperationException("RDP 控件没有启用子会话连接，已拒绝普通远程连接。");
            RdpCredentials.ConfigureChildSession(view.Client,windowsLoginRequested);
            if(credential!=null){RdpCredentials.ApplyLogin(view.Client,credential);credential.Dispose();}
            dynamic advanced=client.AdvancedSettings9; advanced.SmartSizing=true;advanced.EnableCredSspSupport=true;advanced.RedirectClipboard=false;advanced.RedirectDrives=false;advanced.allowBackgroundInput=0;
            // Let Windows finish the child logon normally. The authenticated
            // worker starts separately through RunEx after logon, not as a shell.
            client.SecuredSettings2.KeyboardHookMode=1;
            client.AdvancedSettings2.EnableWindowsKey=1;
            if(windowsLoginRequested){state="awaiting_windows_login";lastError="正在使用 Windows 当前登录状态连接；如系统要求登录，请在系统窗口完成。";UpdateState();StartupEvent("windows_login_requested");}
            connectionRequested=true;client.Connect();
            using var startupWait=CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token,startupCancellation.Token);
            // Child-session creation was observed to take up to 60s on this host, so the
            // budget tolerates a slow session while the login-before-marker rule below
            // still aborts rather than starting a worker without startup isolation.
            // Human credential entry has no connection timer; closing this owned
            // window cancels it. Apply the startup budget only after RDP connects.
            if(windowsLoginRequested)await rdpConnected.Task.WaitAsync(startupWait.Token);
            else await rdpConnected.Task.WaitAsync(TimeSpan.FromSeconds(30),startupWait.Token);
            startupWait.CancelAfter(TimeSpan.FromSeconds(150));
            await startupMarkersReady.Task.WaitAsync(TimeSpan.FromSeconds(110),startupWait.Token);
            // Some Windows logon methods show the sign-in page inside RDP.
            // Human sign-in is not a worker startup timeout.
            await loginCompleted.Task.WaitAsync(windowsLoginRequested?startupCancellation.Token:startupWait.Token);
            // After logon the launcher owns the bounded worker attempt. Do not
            // return a separate timeout while that same attempt can still succeed.
            await workerReady.Task.WaitAsync(startupCancellation.Token);
            if(closing||!connected)throw new OperationCanceledException("任务窗口已停止。");
            return Snapshot();
        }catch(Exception e){string reason=startupMarkersReady.Task.Exception?.GetBaseException().Message??(e is OperationCanceledException?"任务桌面启动已取消。":e.Message);
            // A worker failure after Windows has logged on need not discard the
            // user's authenticated desktop. Keep it paused for an explicit retry.
            if(!(connected&&loginCompleted.Task.IsCompletedSuccessfully&&startupMarkersReady.Task.IsCompletedSuccessfully&&!startupCancellation.IsCancellationRequested&&!closing)){
                startupCancellation.Cancel();startupTimer.Stop();try{if(view!=null)((dynamic)view.Client).Disconnect();}catch{}
            }
            Error(reason);return Program.Fail("task_desktop_connection_failed",reason);
        }
    }
    bool CanRetryWorker()=>connected&&!closing&&!workerAuthenticated&&writer==null&&pipe is {IsConnected:false}&&acceptWorkerTask is {IsCompleted:false}&&bootstrapTask is {IsCompleted:true}&&bootstrapCleanupConfirmed&&workerReady.Task.IsFaulted&&!startupCancellation.IsCancellationRequested;
    async Task<JsonObject> RetryWorker(){
        if(File.Exists(Path.Combine(AppContext.BaseDirectory,"safety-hold.json")))return Program.Fail("task_desktop_safety_hold","独立桌面启动已被拦截。");
        if(!CanRetryWorker()||!LiveCached(childSession)||!ChildSessionQuery.ReportedChild(out uint reported)||reported!=childSession)return Program.Fail("task_desktop_retry_unavailable","当前连接不能安全重试执行工具。");
        if(!startupGate.Wait(0))return Program.Fail("task_desktop_connecting","执行工具正在连接。");
        opening=true;paused=true;takeover=false;workerReady=new(TaskCreationOptions.RunContinuationsAsynchronously);state="connecting";lastError="正在重试任务工具；保留当前 Windows 登录。";UpdateState();
        // Observe the launcher's one bounded attempt to its actual conclusion.
        // A separate 35s waiter must not abandon an attempt that can still accept
        // a worker later and leave the visible state frozen at an old error.
        try{bootstrapTask=BootstrapWorker();await workerReady.Task.WaitAsync(startupCancellation.Token);if(closing||!connected)throw new OperationCanceledException("任务窗口已停止。");return Snapshot();}
        catch(Exception e){Error(e.Message);return Program.Fail("task_desktop_worker_unavailable",e.Message);}
        finally{opening=false;startupGate.Release();UpdateState();}
    }
    async Task AcceptWorker()
    {
        try {
            await pipe!.WaitForConnectionAsync(lifetime.Token);
            var reader=new StreamReader(pipe,Encoding.UTF8,false,65536,true);writer=new StreamWriter(pipe,new UTF8Encoding(false),65536,true){AutoFlush=true};
            string? first=await reader.ReadLineAsync(lifetime.Token);var hello=JsonNode.Parse(first??"")!.AsObject();
            uint sid=hello["windows_session_id"]!.GetValue<uint>();
            if(hello["token"]?.GetValue<string>()!=token||!LiveCached(sid)||sid!=childSession||sid==(uint)parentSession||sid==0||sid==uint.MaxValue)throw new InvalidOperationException("子会话身份校验失败。");
            workerIdentity=PipeIdentity.Client(pipe,hello["pid"]!.GetValue<uint>(),sid,Environment.ProcessPath!);
            if(workerIdentity.User!=ProcessIdentity.Capture((uint)Environment.ProcessId).User)throw new InvalidOperationException("执行工具用户身份不匹配。");
            await startupMarkersReady.Task.WaitAsync(TimeSpan.FromSeconds(10),startupCancellation.Token);
            if(sid!=childSession||!LiveCached(sid))throw new InvalidOperationException("执行工具不属于已准备的目标子会话。");
            startupCancellation.Token.ThrowIfCancellationRequested();
            if(closing||File.Exists(Path.Combine(AppContext.BaseDirectory,"safety-hold.json")))throw new InvalidOperationException("执行工具启动已被拦截。");
            childSession=sid;workerAuthenticated=true;
            await writer.WriteLineAsync(new JsonObject(){["event"]="authenticated",["instance_id"]=instance}.ToJsonString());
            var readyLine=await reader.ReadLineAsync(lifetime.Token).AsTask().WaitAsync(TimeSpan.FromSeconds(20));
            var ready=JsonNode.Parse(readyLine??"")!.AsObject();
            if(ready["event"]?.ToString()!="ready")throw new InvalidDataException("执行工具未完成启动自检。");
            startupCancellation.Token.ThrowIfCancellationRequested();
            if(closing||!connected||!LiveCached(sid)||File.Exists(Path.Combine(AppContext.BaseDirectory,"safety-hold.json")))throw new InvalidOperationException("任务窗口已停止，拒绝执行工具就绪。");
            if(!workerReady.TrySetResult(true))throw new InvalidOperationException("本次工具启动已经结束，拒绝迟到的就绪消息。");
            paused=false;takeover=false;state="ready";lastError="";UpdateState();
            StartupEvent("worker_ready",sid);
            while(!lifetime.IsCancellationRequested) {
                var line=await reader.ReadLineAsync(lifetime.Token);if(line==null)break;if(line.Length>8*1024*1024)throw new InvalidDataException("执行工具响应过大。");
                var response=JsonNode.Parse(line)!.AsObject();var key=response["id"]?.ToString()??"";
                TaskCompletionSource<JsonObject>? t;lock(pending){pending.Remove(key,out t);}t?.TrySetResult(response["result"]?.AsObject()??Program.Fail("task_desktop_protocol_error","执行工具返回无效结果。"));
            }
            throw new IOException("子会话执行工具已断开。");
        }catch(Exception e) {
            writer=null;workerReady.TrySetException(e);lock(pending){foreach(var p in pending.Values)p.TrySetException(e);pending.Clear();}
            if(!closing){Error(e.Message);}
        }
    }
    async Task<JsonObject> SendWorker(string command,JsonObject? request=null)
    {
        if(writer==null||!workerReady.Task.IsCompletedSuccessfully)return Program.Fail("task_desktop_worker_unavailable","独立执行工具尚未就绪。");
        string id=Guid.NewGuid().ToString();var completion=new TaskCompletionSource<JsonObject>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock(pending)pending[id]=completion;
        try {
            await pipeWrite.WaitAsync(lifetime.Token);
            try{await writer.WriteLineAsync(new JsonObject(){["id"]=id,["command"]=command,["request"]=request?.DeepClone()}.ToJsonString());}finally{pipeWrite.Release();}
            return await completion.Task.WaitAsync(TimeSpan.FromSeconds(210),lifetime.Token);
        }finally{lock(pending)pending.Remove(id);}
    }
    async Task<JsonObject> CancelWorker(){
        if(writer==null)return Program.Fail("task_desktop_worker_unavailable","无法确认独立执行工具已停止。",workerReady.Task.IsCompletedSuccessfully);
        try{return await SendWorker("pause").WaitAsync(TimeSpan.FromSeconds(3));}
        catch(Exception e){return Program.Fail("task_desktop_stop_unconfirmed","停止执行工具未获确认："+e.Message,true);}
    }
    async Task<JsonObject> Pause(bool manual){
        automaticTakeover=false;long version=++manualInputVersion;
        // Before a worker is authenticated there is no agent input to cancel.
        // Allow the human to complete Windows' own login UI inside this RDP view.
        if(manual&&connected&&!workerAuthenticated&&writer==null&&view!=null&&!closing&&!startupCancellation.IsCancellationRequested&&!File.Exists(Path.Combine(AppContext.BaseDirectory,"safety-hold.json"))) {
            paused=true;takeover=true;state=loginCompleted.Task.IsCompletedSuccessfully?"takeover":"awaiting_login";lastError="";UpdateState();return Snapshot();
        }
        if(!workerReady.Task.IsCompletedSuccessfully)startupCancellation.Cancel();
        paused=true;takeover=false;state="pausing";UpdateState();
        var stopped=await CancelWorker();
        if(closing||version!=manualInputVersion)return Program.Fail("task_desktop_control_changed","控制状态已改变，请重新观察。");
        if(stopped["ok"]?.GetValue<bool>()!=true){Error(stopped["message"]?.ToString()??"停止执行工具未获确认。");return stopped;}
        takeover=manual;state=manual?"takeover":"ready";lastError="";UpdateState();return Snapshot();
    }
    async Task<JsonObject> Resume(){
        if(closing||startupCancellation.IsCancellationRequested)return Program.Fail("task_desktop_closed","任务窗口正在结束，拒绝恢复操作。");
        if(writer==null||!connected||sessionInvalidated||workerIdentity==null||File.Exists(Path.Combine(AppContext.BaseDirectory,"safety-hold.json")))return Program.Fail("task_desktop_worker_unavailable","执行工具未就绪、已断开或启动已被拦截。");
        if(!LiveCached(workerIdentity.Session))return Program.Fail("task_desktop_session_changed","目标子会话已改变。");
        long version=++manualInputVersion;automaticTakeover=false;paused=true;takeover=false;if(view!=null)view.AllowUserInput=false;
        var r=await SendWorker("resume");
        if(r["ok"]?.GetValue<bool>()!=true)return r;
        if(closing||version!=manualInputVersion||view?.HasHeldUserInput==true)return Program.Fail("task_desktop_control_changed","手动操作或控制状态已改变，未交还 AI。");
        paused=false;takeover=false;state="ready";lastError="";UpdateState();return Snapshot();
    }
    async Task ReadCommands()
    {
        try {
            string? line;while((line=await Console.In.ReadLineAsync(lifetime.Token))!=null) {
                if(line.Length>8*1024*1024)break;
                JsonObject message;try{message=JsonNode.Parse(line)!.AsObject();}catch{continue;}
                BeginInvoke(new Action(()=>_=Dispatch(message)));
            }
        }catch(OperationCanceledException){}finally{if(!closing&&!IsDisposed)BeginInvoke(new Action(async()=>await Shutdown()));}
    }
    async Task Dispatch(JsonObject message)
    {
        string id=message["id"]?.ToString()??"",command=message["command"]?.ToString()??"";JsonObject result;
        try {
            result=command switch {
                "status"=>Snapshot(),"preview"=>Snapshot(),"open"=>await Open(false),"login"=>await Open(false,true),"prepare"=>await Open(true),"retry"=>await RetryWorker(),
                "pause"=>await Pause(false),"takeover"=>await Pause(true),"resume"=>await Resume(),
                "execute"=>await Execute(message["request"]?.AsObject()??new()),
                "preview_snapshot"=>CapturePreview(),
                "close"=>await CloseCommand(),_=>Program.Fail("task_desktop_unknown_command","不支持的窗口命令。")
            };
        }catch(Exception e){result=Program.Fail("task_desktop_command_failed",e.Message,command=="execute");}
        Program.Emit(new{id,result});
    }
    JsonObject CapturePreview(){
        string file=Path.Combine(Path.GetTempPath(),"win-pilot","task-preview-"+instance+".png");Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        using var bitmap=new Bitmap(Width,Height);bool printed;
        using(var graphics=Graphics.FromImage(bitmap)){var dc=graphics.GetHdc();try{printed=Native.PrintWindow(Handle,dc,2);}finally{graphics.ReleaseHdc(dc);}}
        if(!printed)DrawToBitmap(bitmap,new Rectangle(0,0,Width,Height));
        bitmap.Save(file,System.Drawing.Imaging.ImageFormat.Png);return new(){["ok"]=true,["path"]=file,["capture_method"]=printed?"print_window":"draw_to_bitmap"};
    }
    async Task<JsonObject> Execute(JsonObject request)
    {
        if(closing||startupCancellation.IsCancellationRequested)return Program.Fail("task_desktop_closed","任务窗口正在结束，拒绝新操作。");
        if(previewOnly)return Program.Fail("task_desktop_preview_only","当前窗口仅供预览，不执行电脑动作。");
        string action=request["action"]?.ToString()??"";
        if(action=="stop"){automaticTakeover=false;++manualInputVersion;var stopped=await SendWorker("stop",request);paused=true;takeover=false;state="ready";UpdateState();return stopped;}
        if(File.Exists(Path.Combine(AppContext.BaseDirectory,"safety-hold.json")))return Program.Fail("task_desktop_safety_hold","独立桌面操作已被安全拦截。");
        if(!connected||(paused&&Native.Mutation(action)))return Program.Fail("task_desktop_paused","任务桌面已暂停或断开，未执行操作。");
        if(workerIdentity==null||workerIdentity.Session!=childSession||!LiveCached(childSession)||childSession==(uint)parentSession)return Program.Fail("task_desktop_session_changed","目标子会话已改变。");
        return await SendWorker("execute",request);
    }
    Task<JsonObject> CloseCommand(){var result=Snapshot();startupCancellation.Cancel();paused=true;BeginInvoke(new Action(async()=>await Shutdown()));return Task.FromResult(result);}
    async Task Shutdown()
    {
        if(closing)return;closing=true;startupCancellation.Cancel();startupTimer.Stop();timer.Stop();paused=true;
        await CancelWorker();if(writer!=null)try{await SendWorker("close").WaitAsync(TimeSpan.FromSeconds(1));}catch{}
        // End this control's connection before querying an initializing session:
        // WTS queries can otherwise wait for that same login to finish.
        try{if(connectionRequested&&view!=null)((dynamic)view.Client).Disconnect();}catch{}
        connected=false;
        bool cleanupConfirmed=!connectionRequested;
        // Never treat every new Windows session as ours. Only the single bound
        // child, absent from our baseline and logged on as this account, can be
        // logged off without an authenticated worker. An idle/preview window
        // never takes session ownership at all.
        var owned=new List<uint>();
        try{if(connectionRequested){
            var live=await Task.Run(()=>ChildSessionQuery.LiveSessions()).WaitAsync(TimeSpan.FromSeconds(6));
            var created=live.Where(id=>id!=0&&id!=(uint)parentSession&&!sessionBaseline.Contains(id)).ToArray();
            if(created.Length==0&&(childSession==uint.MaxValue||!live.Contains(childSession)))cleanupConfirmed=true;
            else {
                uint? reported=ChildSessionQuery.ReportedChild(out uint current)?current:null;
                string? accountSid=workerIdentity?.Session==childSession?workerIdentity.User:await Task.Run(()=>ChildSessionQuery.SessionUserSid(childSession,out string sid)?sid:null).WaitAsync(TimeSpan.FromSeconds(3));
                if(ChildSessionQuery.CanCleanup(live,sessionBaseline,(uint)parentSession,childSession,reported,accountSid,parentUserSid))owned.Add(childSession);
                else lastError="本次连接未取得可验证的会话归属；仅断开本窗口，没有注销其他会话。";
            }
        }}
        catch(Exception e){lastError="无法枚举会话以确认归属："+e.Message;}
        if(File.Exists(Path.Combine(AppContext.BaseDirectory,"safety-hold.json"))) {
            if(!cleanupConfirmed)lastError="安全拦截生效，未注销本次会话。";
        } else if(owned.Count>0)try {
            foreach(uint id in owned) {
                // Re-verify the authenticated worker when there is one; otherwise the
                // baseline diff is the ownership evidence for this exact session.
                bool workerAlive=false;
                if(workerIdentity!=null&&workerIdentity.Session==id)try{using var process=Process.GetProcessById((int)workerIdentity.Pid);workerAlive=!process.HasExited;}catch(ArgumentException){}
                string? accountSid=workerAlive?ProcessIdentity.Verify(workerIdentity!.Pid,id,workerIdentity.Image,workerIdentity.Created).User:await Task.Run(()=>ChildSessionQuery.SessionUserSid(id,out string sid)?sid:null).WaitAsync(TimeSpan.FromSeconds(3));
                var live=await Task.Run(()=>ChildSessionQuery.LiveSessions()).WaitAsync(TimeSpan.FromSeconds(6));
                uint? reported=ChildSessionQuery.ReportedChild(out uint current)?current:null;
                if(!ChildSessionQuery.CanCleanup(live,sessionBaseline,(uint)parentSession,id,reported,accountSid,parentUserSid))throw new InvalidOperationException("Windows 父子会话关联或用户身份已改变，未执行注销。");
                if(!Native.WTSLogoffSession(IntPtr.Zero,id,false))throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
            }
            var deadline=DateTime.UtcNow.AddSeconds(20);
            do {
                var remaining=deadline-DateTime.UtcNow;
                if(remaining<=TimeSpan.Zero)break;
                var live=await Task.Run(()=>ChildSessionQuery.LiveSessions()).WaitAsync(remaining);
                lock(liveLock)liveSnapshot=live;
                if(owned.All(id=>!live.Contains(id))){cleanupConfirmed=true;break;}
                await Task.Delay(200);
            }while(DateTime.UtcNow<deadline);
            if(!cleanupConfirmed)lastError="子会话注销尚未确认；未自动重试。";
        }catch(Exception e){lastError="会话清理未获确认："+e.Message;}
        if(!cleanupConfirmed&&lastError.Length==0)lastError="未取得可验证的会话归属；没有自动注销会话。";
        lifetime.Cancel();pipe?.Dispose();
        try{if(view!=null&&connected)((dynamic)view.Client).Disconnect();}catch{}
        try{File.Delete(configPath);}catch{};view?.Dispose();
        Program.Emit(new{@event="closed",instance_id=instance,result=cleanupConfirmed?new JsonObject(){["ok"]=true,["cleanup_confirmed"]=true}:Program.Fail("task_desktop_cleanup_unconfirmed",lastError,true)});
        shutdownComplete=true;
        Close();
    }
}

static class Worker
{
    public static async Task Run(string configPath)
    {
        if(File.Exists(Path.Combine(AppContext.BaseDirectory,"safety-hold.json")))throw new InvalidOperationException("独立桌面启动安全拦截生效，未启动任何程序。");
        var config=JsonNode.Parse(await File.ReadAllTextAsync(configPath))!.AsObject();int session=Process.GetCurrentProcess().SessionId;
        File.WriteAllText(configPath+".worker-entry",new JsonObject(){["stage"]="entry",["pid"]=Environment.ProcessId,["session"]=session,["parent_session"]=config["parent_session"]!.DeepClone(),["timestamp"]=DateTime.UtcNow.ToString("O")}.ToJsonString());
        if(session==config["parent_session"]!.GetValue<int>())throw new InvalidOperationException("执行程序被 Windows 启动到了宿主会话，已拒绝启动操控工具。");
        using var pipe=new NamedPipeClientStream(".",config["pipe"]!.GetValue<string>(),PipeDirection.InOut,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly);
        await pipe.ConnectAsync(30000);using var reader=new StreamReader(pipe,Encoding.UTF8,false,65536,true);using var writer=new StreamWriter(pipe,new UTF8Encoding(false),65536,true){AutoFlush=true};
        var server=PipeIdentity.Server(pipe,config["host_pid"]!.GetValue<uint>(),(uint)config["parent_session"]!.GetValue<int>(),Environment.ProcessPath!,config["host_created"]!.GetValue<long>());
        var self=ProcessIdentity.Capture((uint)Environment.ProcessId);
        if(server.User!=self.User)throw new InvalidOperationException("任务桌面宿主用户不匹配。");
        await writer.WriteLineAsync(new JsonObject(){["token"]=config["token"]!.DeepClone(),["windows_session_id"]=session,["pid"]=Environment.ProcessId}.ToJsonString());
        var auth=JsonNode.Parse(await reader.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(15))??"")!.AsObject();
        if(auth["event"]?.ToString()!="authenticated"||auth["instance_id"]?.ToString()!=config["instance_id"]?.ToString())throw new InvalidOperationException("任务桌面宿主未确认启动授权。");
        if(File.Exists(Path.Combine(AppContext.BaseDirectory,"safety-hold.json")))throw new InvalidOperationException("独立桌面启动安全拦截生效。");
        var psi=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe")){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=Encoding.UTF8};
        foreach(string arg in new[]{"-NoProfile","-ExecutionPolicy","Bypass","-File",config["helper"]!.GetValue<string>(),"-Server"})psi.ArgumentList.Add(arg);
        using var helper=Process.Start(psi)!;_=helper.StandardError.ReadToEndAsync();
        var gate=new SemaphoreSlim(1,1);var write=new SemaphoreSlim(1,1);string? activeCancel=null;bool paused=false,draining=false;var operations=new List<Task>();
        var helperProtocol=new HelperProtocol(helper.StandardInput,helper.StandardOutput);
        async Task Reply(string id,JsonObject result){await write.WaitAsync();try{await writer.WriteLineAsync(new JsonObject(){["id"]=id,["result"]=result}.ToJsonString());}finally{write.Release();}}
        async Task<JsonObject> Invoke(JsonObject request) {
            if(helper.HasExited)return Program.Fail("task_desktop_helper_lost","原独立桌面执行工具已退出。");
            return await helperProtocol.Invoke(request);
        }
        async Task Handle(JsonObject msg) {
            string id=msg["id"]!.ToString(),command=msg["command"]!.ToString();
            if(command is "pause" or "stop" or "close") {paused=true;var cancel=activeCancel;if(cancel!=null)try{File.WriteAllText(cancel,"cancel");}catch{}}
            await gate.WaitAsync();
            try {
                JsonObject result;
                if(draining&&command is not ("close" or "stop" or "pause"))result=Program.Fail("task_desktop_closing","执行工具正在结束，拒绝新操作。");
                else if(command=="resume"){paused=false;result=new(){["ok"]=true};}
                else if(command is "pause" or "stop" or "close")result=await Invoke(new(){["id"]=id,["action"]="stop",["control_session_id"]=msg["request"]?["control_session_id"]?.DeepClone()});
                else if(paused&&Native.Mutation(msg["request"]?["action"]?.ToString()??""))result=Program.Fail("task_desktop_paused","任务已暂停。");
                // HWND lookup must run inside the target session: the host has
                // a different window namespace, even for an identical number.
                else if(msg["request"]?["hwnd"] is JsonValue window&&!Native.WindowBelongsToSession(new IntPtr(window.GetValue<long>()),(uint)session))result=Program.Fail("task_desktop_wrong_window","窗口不属于独立任务桌面。");
                else {
                    var request=msg["request"]!.DeepClone().AsObject();request["id"]=id;
                    activeCancel=Path.Combine(Path.GetTempPath(),"win-pilot","task-cancel-"+Guid.NewGuid()+".signal");Directory.CreateDirectory(Path.GetDirectoryName(activeCancel)!);
                    request["cancellation_path"]=activeCancel;request["overlay"]=false;request["status_pill"]=false;
                    try{result=await Invoke(request);}finally{try{File.Delete(activeCancel);}catch{}activeCancel=null;}
                    result["desktop_environment"]="task";result["windows_session_id"]=session;
                }
                if(command=="close")draining=true;
                await Reply(id,result);
            }catch(Exception e){try{await Reply(id,Program.Fail("task_desktop_worker_error",e.Message,command=="execute"));}catch{}}
            finally{gate.Release();}
        }
        try {
            // Readiness means the real helper has answered, not just that the pipe connected.
            await DesktopReadiness.WaitAsync(()=>Invoke(new(){["id"]="bootstrap-"+Guid.NewGuid(),["action"]="list_displays"}).WaitAsync(TimeSpan.FromSeconds(15)));
            await writer.WriteLineAsync(new JsonObject(){["event"]="ready"}.ToJsonString());
            string? line;while((line=await reader.ReadLineAsync())!=null) {
                if(line.Length>8*1024*1024)break;var msg=JsonNode.Parse(line)!.AsObject();operations.RemoveAll(task=>task.IsCompleted);operations.Add(Handle(msg));
            }
            await Task.WhenAll(operations).WaitAsync(TimeSpan.FromSeconds(5));
        }finally {
            if(activeCancel!=null)try{File.WriteAllText(activeCancel,"cancel");}catch{}
            try{helper.StandardInput.Close();if(!helper.WaitForExit(1500))helper.Kill();}catch{}
        }
    }
}
