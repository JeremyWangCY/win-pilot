using System.Reflection;
using System.Drawing.Imaging;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Runtime.InteropServices;
using System.Text;

class LayoutTest
{
    [STAThread]
    static int Main(string[] args)
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        string output=Path.GetFullPath(args[0]);Directory.CreateDirectory(output);
        var type=Assembly.Load("win-pilot-task-desktop").GetType("WinPilotTaskDesktop.DesktopWindow",true)!;
        using var form=(Form)Activator.CreateInstance(type,[Guid.NewGuid().ToString(),true])!;
        ManualInputChecks.FreezeBackgroundTimers(form);
        form.Location=new(-15000,-15000);form.ShowInTaskbar=false;
        var samples=new List<object>();Exception? failure=null;
        void Capture(string name)
        {
            form.PerformLayout();
            foreach(var panel in form.Controls.OfType<FlowLayoutPanel>())foreach(Control child in panel.Controls)
                if(child.Visible&&!panel.ClientRectangle.Contains(child.Bounds))throw new Exception("Clipped control: "+child.Text);
            using var image=new Bitmap(form.Width,form.Height);form.DrawToBitmap(image,form.ClientRectangle with {Width=form.Width,Height=form.Height});
            image.Save(Path.Combine(output,name+".png"),ImageFormat.Png);
            samples.Add(new {name,width=form.ClientSize.Width,height=form.ClientSize.Height,form.TopMost,dpi=form.DeviceDpi});
        }
        using var timer=new System.Windows.Forms.Timer(){Interval=200};
        timer.Tick+=(_,_)=>{
            timer.Stop();
            try{
                // A second close while asynchronous shutdown is in progress must
                // remain cancelled until the native cleanup ACK has been emitted.
                var closing=type.GetField("closing",BindingFlags.Instance|BindingFlags.NonPublic)!;
                var complete=type.GetField("shutdownComplete",BindingFlags.Instance|BindingFlags.NonPublic)!;
                var onClosing=typeof(Form).GetMethod("OnFormClosing",BindingFlags.Instance|BindingFlags.NonPublic)!;
                closing.SetValue(form,true);
                for(int attempt=0;attempt<2;attempt++){
                    var eventArgs=new FormClosingEventArgs(CloseReason.UserClosing,false);
                    onClosing.Invoke(form,[eventArgs]);
                    if(!eventArgs.Cancel)throw new Exception("Repeated close bypassed pending cleanup");
                }
                complete.SetValue(form,true);
                var finishedArgs=new FormClosingEventArgs(CloseReason.UserClosing,false);onClosing.Invoke(form,[finishedArgs]);
                if(finishedArgs.Cancel)throw new Exception("Confirmed cleanup cannot close its window");
                closing.SetValue(form,false);complete.SetValue(form,false);
                if(form.ClientSize.Width>480||form.ClientSize.Height>380)throw new Exception("Default preview is not compact");
                var compact=form.Size;Capture("compact");
                var expand=form.Controls.Find("task-window-size",true).OfType<Button>().Single();expand.PerformClick();
                form.Location=new(-15000,-15000);if(form.Width<=compact.Width)throw new Exception("Expand did not enlarge preview");Capture("expanded");
                expand.PerformClick();if(form.Size!=compact)throw new Exception("Compact size was not restored");
                Capture("restored");
                ManualInputChecks.Run(form,type,args.Contains("--inject-early-input-fault"),args.Contains("--force-slow-test"));
            }catch(Exception error){failure=error;}
            finally{form.Close();}
        };
        form.Shown+=(_,_)=>timer.Start();Application.Run(form);
        var report=new {status=failure==null?"pass":"fail",preview_only=true,windows_session_created=false,force_slow_test=args.Contains("--force-slow-test"),samples,error=failure?.ToString()};
        File.WriteAllText(Path.Combine(output,"report.json"),JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
        Console.WriteLine(JsonSerializer.Serialize(report));return failure==null?0:1;
    }
}

static class ManualInputChecks
{
    const BindingFlags Fields=BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic;
    static object? Get(object target,string name)=>target.GetType().GetField(name,Fields)!.GetValue(target);
    static void Set(object target,string name,object? value)=>target.GetType().GetField(name,Fields)!.SetValue(target,value);
    static object? Call(object target,string name,params object[] args)=>target.GetType().GetMethod(name,Fields)!.Invoke(target,args);
    static void Require(bool condition,string message){if(!condition)throw new Exception(message);}
    internal static void FreezeBackgroundTimers(Form form){
        foreach(string name in new[]{"timer","startupTimer"})((System.Windows.Forms.Timer)Get(form,name)!).Stop();
        RequireBackgroundTimersFrozen(form);
    }
    static void RequireBackgroundTimersFrozen(Form form){
        foreach(string name in new[]{"timer","startupTimer"})Require(!((System.Windows.Forms.Timer)Get(form,name)!).Enabled,"Fixture background timer unexpectedly enabled: "+name);
    }
    static void PumpUntil(Func<bool> ready,string message){
        var deadline=Environment.TickCount64+2000;
        while(!ready()&&Environment.TickCount64<deadline){Application.DoEvents();Thread.Sleep(2);}
        Require(ready(),message);
    }
    static void PumpFor(int milliseconds){
        var deadline=Environment.TickCount64+milliseconds;
        do{Application.DoEvents();Thread.Sleep(2);}while(Environment.TickCount64<deadline);
    }
    internal static void Run(Form form,Type desktopType,bool injectEarlyInputFault,bool forceSlowTest)
    {
        // Exercise the shipped RdpView and DesktopWindow.Pause against a memory
        // worker ACK. The ActiveX control is never connected to any server.
        var viewType=desktopType.Assembly.GetType("WinPilotTaskDesktop.RdpView",true)!;
        using var view=(AxHost)Activator.CreateInstance(viewType)!;
        using var output=new MemoryStream();
        using var workerWriter=new ProbeWorkerWriter(output){AutoFlush=true};
        var originalReady=Get(form,"workerReady");
        var originalLiveRefresh=Get(form,"liveRefresh");
        FreezeBackgroundTimers(form);
        // Poll must not enumerate real sessions. An unfinished in-memory refresh
        // suppresses that background query; Connected remains the real COM zero.
        Set(form,"liveRefresh",new TaskCompletionSource<bool>().Task);
        try{
            var canvas=(Panel)Get(form,"canvas")!;
            ((System.ComponentModel.ISupportInitialize)view).BeginInit();canvas.Controls.Add(view);
            ((System.ComponentModel.ISupportInitialize)view).EndInit();view.CreateControl();
            using var probe=new InputProbe(view.Handle);
            Set(form,"view",view);Set(form,"expanded",true);Set(form,"connected",true);Set(form,"workerAuthenticated",true);
            var ready=new TaskCompletionSource<bool>();ready.SetResult(true);Set(form,"workerReady",ready);
            ((TaskCompletionSource<bool>)Get(form,"loginCompleted")!).TrySetResult(true);
            Set(form,"writer",workerWriter);
            viewType.GetField("UserActivity")!.SetValue(view,(Action)(()=>Set(form,"lastManualInput",Environment.TickCount64)));
            Call(form,"ConfigureManualInput");Call(form,"UpdateState");
            var filter=(IMessageFilter)view;
            bool Feed(int id,int value=0){
                var message=Message.Create(probe.Handle,id,new IntPtr(value),IntPtr.Zero);
                bool blocked=filter.PreFilterMessage(ref message);
                if(!blocked)InputProbe.Send(probe.Handle,id,message.WParam,message.LParam);
                return blocked;
            }
            JsonObject[] Requests()=>Encoding.UTF8.GetString(output.ToArray()).Split('\n',StringSplitOptions.RemoveEmptyEntries).Select(line=>JsonNode.Parse(line)!.AsObject()).ToArray();
            Dictionary<string,TaskCompletionSource<JsonObject>> Pending()=>(Dictionary<string,TaskCompletionSource<JsonObject>>)Get(form,"pending")!;
            void Reply(string command,bool ok){
                var request=Requests().Last(r=>r["command"]!.ToString()==command&&Pending().ContainsKey(r["id"]!.ToString()));
                Pending()[request["id"]!.ToString()].SetResult(new JsonObject(){["ok"]=ok,["message"]=ok?"synthetic stopped":"synthetic stop rejected"});
            }
            void Acknowledge(bool ok){
                var pending=(Dictionary<string,TaskCompletionSource<JsonObject>>)Get(form,"pending")!;
                Require(pending.Count==1,"Exactly one stop confirmation must be pending");
                var completion=pending.Single().Value;
                completion.SetResult(new JsonObject(){["ok"]=ok,["message"]=ok?"synthetic stopped":"synthetic stop rejected"});
                PumpUntil(()=>!(bool)Get(view,"acquiringInput")!,"Manual input handshake did not finish");
            }
            void Reset(){
                probe.Delivered.Clear();Set(form,"connected",true);Set(form,"takeover",false);Set(form,"automaticTakeover",false);
                Call(view,"ReleaseUserInputTracking");Call(form,"UpdateState");
            }
            dynamic client=viewType.GetProperty("Client")!.GetValue(view)!;
            Require((int)client.Connected==0,"Test COM must remain disconnected");
            Require(Feed(0x200),"Hover must be consumed while the agent owns input");
            Require(Requests().Length==0&&probe.Delivered.Count==0,"Hover must not acquire control or dispatch input");
            // Optional test-only fault injection demonstrates that the assertion
            // catches input handed over before the worker's stop ACK.
            if(injectEarlyInputFault)Set(view,"AllowUserInput",true);
            var gesture=new[]{(0x100,65),(0x101,65),(0x201,1),(0x202,0)};
            foreach(var (id,value) in gesture)Require(Feed(id,value),"First gesture must be queued before stop confirmation");
            Require(probe.Delivered.Count==0,"No first down/up may be delivered before stop ACK");
            Require(Requests().Select(r=>r["command"]!.ToString()).SequenceEqual(new[]{"pause"}),"First gesture must request production Pause once");
            Acknowledge(true);
            Require(probe.Delivered.SequenceEqual(gesture),"Confirmed first gesture must replay original down/up order to the same child handle");
            Require((bool)Get(form,"automaticTakeover")!&&(bool)Get(form,"takeover")!,"Production Pause success must activate automatic manual control");

            int deliveredBeforeCollapse=probe.Delivered.Count;
            Call(form,"ToggleWindowSize");form.Location=new(-15000,-15000);

            // Login is a separate incomplete handshake. It must not override the
            // compact-view gate, even though expanded login accepts user input.
            using(var loginForm=(Form)Activator.CreateInstance(desktopType,[Guid.NewGuid().ToString(),true])!){
                FreezeBackgroundTimers(loginForm);
                Set(loginForm,"view",view);Set(loginForm,"connected",true);
                Call(loginForm,"ConfigureManualInput");Call(loginForm,"UpdateState");
                Require(!(bool)Get(view,"AllowUserInput")!,"Compact Windows login must keep user input gated");
                int before=probe.Delivered.Count;
                Require(Feed(0x100,69)&&Feed(0x101,69)&&probe.Delivered.Count==before,"Compact login must not dispatch keys to the view");
                Set(loginForm,"view",null);
            }
            Call(form,"ConfigureManualInput");Call(form,"UpdateState");
            Require(Feed(0x100,68)&&Feed(0x101,68),"Collapsed view must gate manual input even after takeover");
            Require(probe.Delivered.Count==deliveredBeforeCollapse,"Collapsing the view must stop delivery to its child");
            Call(form,"ToggleWindowSize");form.Location=new(-15000,-15000);

            Reset();int requestCount=Requests().Length;
            Feed(0x100,66);Feed(0x101,66);Acknowledge(false);
            Require(Requests().Length==requestCount+1&&probe.Delivered.Count==0,"Failed stop confirmation must discard queued input");
            Require(!(bool)Get(view,"AllowUserInput")!,"Failed stop must leave user input gated");

            foreach(var (down,up,key) in new[]{(0x100,0x101,67),(0x201,0x202,1)}){
                Reset();Feed(down,key);Acknowledge(true);
                Require((bool)viewType.GetProperty("HasHeldUserInput")!.GetValue(view)!,"A held key or mouse button must be tracked");
                // No connected session exists: retain COM Connected==0, disable
                // synthetic connected state and use reflection only for the clock.
                Set(form,"connected",false);Set(form,"lastManualInput",Environment.TickCount64-11000);
                requestCount=Requests().Length;Call(form,"Poll");
                Require((bool)Get(form,"automaticTakeover")!&&Requests().Length==requestCount,"Held key/mouse must block the 10-second idle resume branch");
                Feed(up,down==0x100?key:0);
                Require(!(bool)viewType.GetProperty("HasHeldUserInput")!.GetValue(view)!,"Matching release must clear held input");
                Set(form,"lastManualInput",Environment.TickCount64-11000);Call(form,"Poll");
                Require(!(bool)Get(form,"automaticTakeover")!,"Released input must permit the idle resume branch (actual Resume refuses unconnected COM)");
            }

            foreach(int firstRelease in new[]{1,2}){
                Reset();Feed(0x20b,1<<16);Feed(0x20b,2<<16);Acknowledge(true);
                Feed(0x20c,firstRelease<<16);
                Require((bool)viewType.GetProperty("HasHeldUserInput")!.GetValue(view)!,"Releasing one XBUTTON must preserve the other held side button");
                Set(form,"connected",false);Set(form,"lastManualInput",Environment.TickCount64-11000);Call(form,"Poll");
                Require((bool)Get(form,"automaticTakeover")!,"A remaining held side button must prevent idle resume");
                Feed(0x20c,(3-firstRelease)<<16);
                Require(!(bool)viewType.GetProperty("HasHeldUserInput")!.GetValue(view)!,"Both XBUTTON releases must clear held tracking");
            }

            // Drive the actual idle Poll -> Resume path. The memory writer makes
            // the synthetic connected flag match the disconnected COM immediately
            // after dispatch, so Poll cannot invent a real disconnect/worker stop.
            if(forceSlowTest){PumpFor(600);RequireBackgroundTimersFrozen(form);}
            Reset();Feed(0x201,1);Feed(0x202,0);Acknowledge(true);probe.Delivered.Clear();
            var infoType=desktopType.Assembly.GetType("WinPilotTaskDesktop.ProcessIdentity+Info",true)!;
            Set(form,"workerIdentity",Activator.CreateInstance(infoType,[0u,77u,"synthetic-unused-image",0L,"synthetic-unused-user"]));
            Set(form,"childSession",77u);Set(form,"liveSnapshot",new HashSet<uint>(){77u});
            workerWriter.AfterWrite=line=>{if(JsonNode.Parse(line)?["command"]?.ToString()=="resume")Set(form,"connected",false);};
            Set(form,"lastManualInput",Environment.TickCount64-11000);requestCount=Requests().Length;Call(form,"Poll");
            Require(Requests().Length==requestCount+1&&Requests()[^1]["command"]!.ToString()=="resume","Idle must dispatch exactly one memory-worker Resume");
            Require(!(bool)Get(view,"AllowUserInput")!,"Resume must gate user input before its ACK");
            if(forceSlowTest){PumpFor(600);RequireBackgroundTimersFrozen(form);}
            // Force the memory worker to exercise SendWorker's asynchronous
            // write boundary rather than relying on fast local stream writes.
            var slowWrite=new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            if(forceSlowTest)workerWriter.NextWriteGate=slowWrite.Task;
            Require(Feed(0x201,1)&&Feed(0x202,0),"New mouse gesture during pending Resume must wait for a fresh Pause ACK");
            if(forceSlowTest){PumpFor(600);RequireBackgroundTimersFrozen(form);}
            Require(Pending().Count==2&&probe.Delivered.Count==0,"Both requests must be pending without early delivery while the Pause write is in flight");
            if(forceSlowTest){
                Require(Requests()[^1]["command"]!.ToString()=="resume","Controlled slow Pause write must remain queued until explicitly released");
                slowWrite.SetResult(true);
            }
            // SendWorker registers pending before acquiring pipeWrite and awaiting
            // WriteLineAsync. Observe the actual wire write before asserting its
            // command, including when a slow runner yields at that boundary.
            PumpUntil(()=>Requests()[^1]["command"]!.ToString()=="pause","Queued Pause was not written to the memory worker");
            Require(Pending().Count==2&&Requests()[^1]["command"]!.ToString()=="pause"&&probe.Delivered.Count==0,"Resume/Pause race must queue the gesture without early delivery; "+JsonSerializer.Serialize(new{pending=Pending().Count,commands=Requests().Select(r=>r["command"]!.ToString()),delivered=probe.Delivered,acquiring=Get(view,"acquiringInput"),timer=((System.Windows.Forms.Timer)Get(form,"timer")!).Enabled,startupTimer=((System.Windows.Forms.Timer)Get(form,"startupTimer")!).Enabled}));
            Reply("resume",true);PumpUntil(()=>Pending().Count==1,"Resume ACK did not settle");Application.DoEvents();
            Require((bool)Get(form,"paused")!&&probe.Delivered.Count==0&&!(bool)Get(view,"AllowUserInput")!,"Late Resume ACK must not restore AI ownership after newer manual input");
            Reply("pause",true);PumpUntil(()=>!(bool)Get(view,"acquiringInput")!,"New manual gesture did not finish its Pause handshake");
            Require(probe.Delivered.SequenceEqual(new[]{(0x201,1),(0x202,0)})&&(bool)Get(form,"paused")!&&(bool)Get(form,"takeover")!,"Only the newer Pause ACK may replay the original mouse gesture");
            workerWriter.AfterWrite=null;Set(form,"workerIdentity",null);Set(form,"childSession",uint.MaxValue);Set(form,"liveSnapshot",new HashSet<uint>());
            Require((int)client.Connected==0,"COM must remain disconnected after every input/idle test");
            Console.WriteLine("manual input PASS: hover, ordered ACK-gated replay/rejection, compact takeover/login gating, held key/mouse/both XBUTTONs, idle Resume/new Pause ACK race; production RdpView; self-owned messages and memory worker only; COM never connected");
        }finally{
            Set(form,"writer",null);Set(form,"view",null);Set(form,"connected",false);Set(form,"workerAuthenticated",false);
            Set(form,"workerReady",originalReady);Set(form,"liveRefresh",originalLiveRefresh);Set(form,"automaticTakeover",false);Set(form,"takeover",false);Set(form,"workerIdentity",null);
        }
    }
}

sealed class InputProbe:NativeWindow,IDisposable
{
    internal readonly List<(int,int)> Delivered=new();
    internal InputProbe(IntPtr parent){CreateHandle(new CreateParams(){Caption="WinPilot self-message test",Parent=parent,Style=0x40000000,Width=10,Height=10});}
    [DllImport("user32.dll",EntryPoint="SendMessageW")]internal static extern IntPtr Send(IntPtr hwnd,int message,IntPtr wParam,IntPtr lParam);
    protected override void WndProc(ref Message message){
        if(message.Msg is 0x100 or 0x101 or 0x201 or 0x202 or 0x20b or 0x20c){Delivered.Add((message.Msg,message.WParam.ToInt32()));return;}
        base.WndProc(ref message);
    }
    public void Dispose()=>DestroyHandle();
}

sealed class ProbeWorkerWriter:StreamWriter
{
    internal Action<string>? AfterWrite;
    internal Task? NextWriteGate;
    internal ProbeWorkerWriter(Stream stream):base(stream,new UTF8Encoding(false),4096,true){}
    public override Task WriteLineAsync(string? value){
        var gate=NextWriteGate;NextWriteGate=null;
        if(gate!=null)return GatedWrite(value,gate);
        var written=base.WriteLineAsync(value);AfterWrite?.Invoke(value??"");return written;
    }
    async Task GatedWrite(string? value,Task gate){await gate;await base.WriteLineAsync(value);AfterWrite?.Invoke(value??"");}
}
