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
                var pin=form.Controls.Find("task-window-pin",true).OfType<Button>().Single();pin.PerformClick();
                if(form.TopMost)throw new Exception("Pin button did not disable topmost");pin.PerformClick();
                if(!form.TopMost)throw new Exception("Pin button did not restore topmost");
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
    static FieldInfo Field(object target,string name)=>target.GetType().GetField(name,Fields)??throw new MissingMemberException(target.GetType().FullName,name);
    static object? Get(object target,string name)=>Field(target,name).GetValue(target);
    static void Set(object target,string name,object? value)=>Field(target,name).SetValue(target,value);
    static object? Call(object target,string name,params object[] args){
        var method=target.GetType().GetMethod(name,Fields)??throw new MissingMemberException(target.GetType().FullName,name);
        return method.Invoke(target,args);
    }
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
        // 0.6.6 contract: the window stays view-only until Take over, and only
        // Hand back returns control. There is no automaticTakeover field and
        // Poll must not resume after 10 idle seconds. The ActiveX control is
        // never connected to a server; COM Connected stays 0.
        var viewType=desktopType.Assembly.GetType("WinPilotTaskDesktop.RdpView",true)!;
        using var view=(AxHost)Activator.CreateInstance(viewType)!;
        Set(view,"InputIsDown",(Func<int,bool>)(_=>true));
        using var output=new MemoryStream();
        using var workerWriter=new ProbeWorkerWriter(output){AutoFlush=true};
        var originalReady=Get(form,"workerReady");
        var originalLiveRefresh=Get(form,"liveRefresh");
        FreezeBackgroundTimers(form);
        // Poll must not enumerate real sessions. An unfinished in-memory refresh
        // suppresses that background query; Connected remains the real COM zero.
        Set(form,"liveRefresh",new TaskCompletionSource<bool>().Task);
        bool passed=false;
        try{
            var canvas=(Panel)Get(form,"canvas")!;
            ((System.ComponentModel.ISupportInitialize)view).BeginInit();canvas.Controls.Add(view);
            ((System.ComponentModel.ISupportInitialize)view).EndInit();view.CreateControl();
            ((System.Windows.Forms.Timer)Get(view,"inputWindowTimer")!).Stop();
            using var probe=new InputProbe(view.Handle);
            Set(form,"view",view);Set(form,"expanded",false);Set(form,"connected",true);Set(form,"workerAuthenticated",true);Set(form,"previewOnly",false);
            var ready=new TaskCompletionSource<bool>();ready.SetResult(true);Set(form,"workerReady",ready);
            ((TaskCompletionSource<bool>)Get(form,"loginCompleted")!).TrySetResult(true);
            Set(form,"writer",workerWriter);
            viewType.GetField("UserActivity")!.SetValue(view,(Action)(()=>Set(form,"lastManualInput",Environment.TickCount64)));
            Require(form.GetType().GetField("automaticTakeover",Fields)==null,"automaticTakeover must stay removed; only Hand back returns control");
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
            Task<JsonObject> Begin(string name,params object[] args)=>(Task<JsonObject>)Call(form,name,args)!;
            JsonObject AwaitAck(Task<JsonObject> task,string command){
                PumpUntil(()=>Requests().Any(r=>r["command"]!.ToString()==command&&Pending().ContainsKey(r["id"]!.ToString())),command+" was not written to the memory worker");
                Reply(command,true);
                PumpUntil(()=>task.IsCompleted,command+" did not settle");
                if(task.IsFaulted)throw task.Exception!.GetBaseException();
                return task.GetAwaiter().GetResult();
            }
            void IdlePoll(){
                // COM Connected is really 0. Drop the synthetic flag first so Poll
                // does not treat that zero as a fresh disconnect and send pause.
                Set(form,"connected",false);Set(form,"lastManualInput",Environment.TickCount64-11000);
                int before=Requests().Length;Call(form,"Poll");
                Require(Requests().Length==before,"Poll must not write a command after 10 idle seconds");
                Set(form,"connected",true);
            }
            bool Held()=>(bool)viewType.GetProperty("HasHeldUserInput")!.GetValue(view)!;
            static bool TakeOverLabel(string text)=>text is "接管" or "Take over";
            static bool HandBackLabel(string text)=>text is "交还托管" or "Hand back";
            var control=form.Controls.Find("task-window-control",true).OfType<Button>().Single();
            dynamic client=viewType.GetProperty("Client")!.GetValue(view)!;
            Require((int)client.Connected==0,"Test COM must remain disconnected");
            Require(Get(view,"AcquireUserInput")==null,"ConfigureManualInput must leave acquisition disarmed");
            Require(!(bool)Get(view,"AllowUserInput")!&&!(bool)Get(form,"takeover")!&&control.Visible&&TakeOverLabel(control.Text),"Setup must show Take over and must not unlock input");
            if(injectEarlyInputFault){
                Set(view,"AllowUserInput",true);
                Require(!Feed(0x100,65)&&!Feed(0x101,65)&&probe.Delivered.Count==2,"Forced AllowUserInput must be observable as delivery");
                Set(view,"AllowUserInput",false);Call(view,"ReleaseUserInputTracking");probe.Delivered.Clear();Call(form,"UpdateState");
            }
            Require(Feed(0x200)&&Requests().Length==0&&probe.Delivered.Count==0,"Hover must be consumed and must not request control");
            foreach(var (id,value) in new[]{(0x100,65),(0x101,65),(0x201,1),(0x202,0)})Require(Feed(id,value),"View-only gesture must be consumed");
            Require(probe.Delivered.Count==0&&Requests().Length==0&&!(bool)Get(form,"takeover")!&&!Held(),"A gesture must not take over, be delivered, or leave a held button");
            Call(form,"ToggleWindowSize");form.Location=new(-15000,-15000);
            Require((bool)Get(form,"expanded")!&&Get(view,"AcquireUserInput")==null&&!(bool)Get(form,"takeover")!,"Expand is view-only and must not arm acquisition");
            Require(Feed(0x100,66)&&Feed(0x101,66)&&probe.Delivered.Count==0,"Expanded view-only input must not be delivered");
            Call(form,"ToggleWindowSize");form.Location=new(-15000,-15000);
            Require(!(bool)Get(form,"expanded")!&&Feed(0x100,68)&&Feed(0x101,68)&&probe.Delivered.Count==0,"Collapsed view-only input must not be delivered");
            IdlePoll();
            Require(!(bool)Get(form,"takeover")!&&!(bool)Get(view,"AllowUserInput")!,"Idle Poll must not enter takeover");
            int pauses=Requests().Count(r=>r["command"]!.ToString()=="pause");
            control.PerformClick();form.Location=new(-15000,-15000);
            PumpUntil(()=>Requests().Count(r=>r["command"]!.ToString()=="pause")>pauses,"Take over button did not request pause");
            Reply("pause",true);
            PumpUntil(()=>(bool)Get(form,"takeover")!,"Take over button did not finish: state="+Get(form,"state")+" error="+Get(form,"lastError"));
            Require((bool)Get(view,"AllowUserInput")!&&(bool)Get(form,"expanded")!&&HandBackLabel(control.Text),"Take over must unlock input and show Hand back");
            probe.Delivered.Clear();
            Require(!Feed(0x100,67)&&probe.Delivered.SequenceEqual(new[]{(0x100,67)}),"Input after Take over is delivered without another pause");
            Feed(0x101,67);Call(view,"ReleaseUserInputTracking");Require(!Held(),"Release after the delivered key");
            Require(Requests().Count(r=>r["command"]!.ToString()=="pause")==pauses+1,"Take over sends exactly one pause");
            IdlePoll();
            Require((bool)Get(form,"takeover")!&&(bool)Get(view,"AllowUserInput")!,"Ten idle seconds must not hand control back");

            uint ownSession=(uint)System.Diagnostics.Process.GetCurrentProcess().SessionId;
            uint childSessionId=ownSession==77u?78u:77u;
            var infoType=desktopType.Assembly.GetType("WinPilotTaskDesktop.ProcessIdentity+Info",true)!;
            var identityCtor=infoType.GetConstructor(BindingFlags.Instance|BindingFlags.Public|BindingFlags.NonPublic,null,new[]{typeof(uint),typeof(uint),typeof(string),typeof(long),typeof(string)},null)??throw new MissingMemberException(infoType.FullName,".ctor");
            Set(form,"workerIdentity",identityCtor.Invoke(new object[]{0u,childSessionId,"synthetic-unused-image",0L,"synthetic-unused-user"}));
            Set(form,"childSession",childSessionId);Set(form,"liveSnapshot",new HashSet<uint>(){childSessionId});
            int resumes=Requests().Count(r=>r["command"]!.ToString()=="resume");
            control.PerformClick();
            PumpUntil(()=>Requests().Count(r=>r["command"]!.ToString()=="resume")>resumes,"Hand back did not request resume");
            Reply("resume",true);
            PumpUntil(()=>!(bool)Get(form,"takeover")!&&!(bool)Get(form,"paused")!,"Hand back did not return control: state="+Get(form,"state")+" error="+Get(form,"lastError"));
            Require(!(bool)Get(view,"AllowUserInput")!&&TakeOverLabel(control.Text)&&((string?)Get(form,"state"))=="ready","Hand back restores AI ownership only after the resume ACK");

            using(var loginForm=(Form)Activator.CreateInstance(desktopType,[Guid.NewGuid().ToString(),true])!){
                FreezeBackgroundTimers(loginForm);
                Set(loginForm,"view",view);Set(loginForm,"connected",true);Set(loginForm,"previewOnly",false);
                Set(loginForm,"workerAuthenticated",false);Set(loginForm,"writer",null);
                Call(loginForm,"ConfigureManualInput");Call(loginForm,"UpdateState");
                Require(!(bool)Get(view,"AllowUserInput")!,"Windows login stays gated until explicit Take over");
                int before=probe.Delivered.Count;int writes=Requests().Length;
                Require(Feed(0x100,69)&&Feed(0x101,69)&&probe.Delivered.Count==before,"Login view-only input is not delivered");
                var login=(Task<JsonObject>)Call(loginForm,"Pause",true)!;
                PumpUntil(()=>login.IsCompleted,"Login Take over did not finish");
                if(login.IsFaulted)throw login.Exception!.GetBaseException();
                Require(login.Result["ok"]?.GetValue<bool>()==true&&Requests().Length==writes&&(bool)Get(loginForm,"takeover")!&&(bool)Get(view,"AllowUserInput")!,"Explicit login Take over unlocks the sign-in view without a worker");
                Set(loginForm,"view",null);
            }
            Call(view,"ReleaseUserInputTracking");Set(view,"AllowUserInput",false);
            Call(form,"ConfigureManualInput");Call(form,"UpdateState");
            Require(Get(view,"AcquireUserInput")==null&&!(bool)Get(view,"AllowUserInput")!,"Production configuration disarms acquisition");
            var handoff=AwaitAck(Begin("HandOff"),"pause");
            form.Location=new(-15000,-15000);
            Require(handoff["ok"]?.GetValue<bool>()==true&&!(bool)Get(form,"takeover")!&&(bool)Get(form,"awaitingHuman")!&&((string?)Get(form,"state"))=="awaiting_human","hand_off pauses the worker and waits for Take over");
            Require(!(bool)Get(view,"AllowUserInput")!&&TakeOverLabel(control.Text)&&(bool)Get(form,"expanded")!,"hand_off keeps the expanded window view-only");

            JsonObject TakeOver(){var task=Begin("Pause",true);var result=AwaitAck(task,"pause");Require(result["ok"]?.GetValue<bool>()==true&&(bool)Get(form,"takeover")!&&!(bool)Get(form,"awaitingHuman")!,"Take over must pause the worker and clear hand_off");return result;}
            JsonObject HandBack(){var task=Begin("Resume");var result=AwaitAck(task,"resume");return result;}
            TakeOver();
            foreach(var (down,up,key) in new[]{(0x100,0x101,67),(0x201,0x202,1)}){
                if(!(bool)Get(form,"takeover")!)TakeOver();
                Feed(down,key);
                Require(Held(),"A held key or mouse button must be tracked");
                var refused=HandBack();
                Require(refused["ok"]?.GetValue<bool>()!=true&&refused["error_code"]?.ToString()=="task_desktop_control_changed"&&(bool)Get(form,"paused")!,"Held input must stop Hand back from completing");
                Feed(up,down==0x100?key:0);
                Require(!Held(),"Matching release must clear held input");
                var returned=HandBack();
                Require(returned["ok"]?.GetValue<bool>()==true&&!(bool)Get(form,"paused")!&&!(bool)Get(form,"takeover")!&&!(bool)Get(view,"AllowUserInput")!,"Released input must allow Hand back");
            }
            TakeOver();
            foreach(var (down,key,physicalKey) in new[]{(0x100,67,67),(0x201,1,1),(0x20b,1<<16,5),(0x20b,2<<16,6)}){
                Feed(down,key);
                Set(view,"InputIsDown",(Func<int,bool>)(value=>value==physicalKey));
                Require(Held(),"Physical held input must still block Hand back");
                Set(view,"InputIsDown",(Func<int,bool>)(_=>false));
                Require(!Held(),"A missed release must not leave stale held input");
                Set(view,"InputIsDown",(Func<int,bool>)(_=>true));
                Call(view,"ReleaseUserInputTracking");
            }
            var reconciled=HandBack();
            Require(reconciled["ok"]?.GetValue<bool>()==true,"A reconciled release must allow Hand back");
            TakeOver();
            foreach(int firstRelease in new[]{1,2}){
                Call(view,"ReleaseUserInputTracking");
                Feed(0x20b,1<<16);Feed(0x20b,2<<16);Feed(0x20c,firstRelease<<16);
                Require(Held(),"Releasing one XBUTTON must preserve the other held side button");
                var blockedSide=HandBack();
                Require(blockedSide["error_code"]?.ToString()=="task_desktop_control_changed"&&(bool)Get(form,"paused")!,"A remaining side button must prevent Hand back");
                Feed(0x20c,(3-firstRelease)<<16);
                Require(!Held(),"Both XBUTTON releases must clear held tracking");
                var both=HandBack();
                Require(both["ok"]?.GetValue<bool>()==true&&!(bool)Get(form,"takeover")!,"Hand back succeeds after both side buttons are released");
                if(firstRelease==1)TakeOver();
            }

            TakeOver();probe.Delivered.Clear();int deliveredBeforeReturn=probe.Delivered.Count;
            int resumesBeforeInflight=Requests().Count(r=>r["command"]!.ToString()=="resume");
            var slowWrite=new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            if(forceSlowTest)workerWriter.NextWriteGate=slowWrite.Task;
            var inflight=Begin("Resume");
            Require(!(bool)Get(view,"AllowUserInput")!,"Hand back gates input before its ACK");
            Feed(0x201,1);Feed(0x202,0);
            Require(probe.Delivered.Count==deliveredBeforeReturn&&!Requests().Any(r=>r["command"]!.ToString()=="pause"&&Pending().ContainsKey(r["id"]!.ToString())),"A gesture during Hand back must not be delivered or request Pause");
            if(forceSlowTest){PumpFor(600);RequireBackgroundTimersFrozen(form);Require(Requests().Count(r=>r["command"]!.ToString()=="resume")==resumesBeforeInflight,"Slow Hand back must not write resume before the gate opens");slowWrite.SetResult(true);}
            var inflightResult=AwaitAck(inflight,"resume");
            Require(inflightResult["ok"]?.GetValue<bool>()==true&&probe.Delivered.Count==deliveredBeforeReturn&&!(bool)Get(form,"takeover")!,"Hand back ACK must not replay a gesture that arrived while it was in flight");

            Set(form,"previewOnly",false);
            long hwnd=form.Handle.ToInt64();
            var forwarded=Begin("Execute",new JsonObject(){["action"]="get_window_state",["hwnd"]=hwnd});
            Set(form,"previewOnly",true);
            PumpUntil(()=>forwarded.IsCompleted||Pending().Count==1,"Window request did not reach the worker boundary");
            Require(!forwarded.IsCompleted&&Pending().Count==1,"Host must not resolve a child-session HWND in its own session: "+(forwarded.IsCompleted?forwarded.GetAwaiter().GetResult().ToJsonString():"pending"));
            PumpUntil(()=>Requests()[^1]["command"]!.ToString()=="execute","Window request was not written to the worker");
            Require(Requests()[^1]["request"]?["hwnd"]?.GetValue<long>()==hwnd,"Host must forward the opaque hwnd unchanged");
            Reply("execute",true);PumpUntil(()=>forwarded.IsCompleted,"Worker reply did not settle window request");
            Require(forwarded.GetAwaiter().GetResult()["ok"]?.GetValue<bool>()==true,"Host must preserve the authenticated worker result");
            var nativeType=desktopType.Assembly.GetType("WinPilotTaskDesktop.Native",true)!;
            var owns=nativeType.GetMethod("WindowBelongsToOtherSession",BindingFlags.Static|BindingFlags.NonPublic)??throw new MissingMemberException(nativeType.FullName,"WindowBelongsToOtherSession");
            bool Other(IntPtr handle,uint session)=>(bool)owns.Invoke(null,new object[]{handle,session})!;
            Require(!Other(form.Handle,ownSession),"The worker accepts a window in its own session");
            Require(Other(form.Handle,childSessionId),"The worker rejects a window from another session");
            Require(!Other(IntPtr.Zero,ownSession),"A closed window is not another session, so close_window can observe window_not_found");

            // RdpView still queues input when a callback is installed. Production
            // ConfigureManualInput leaves that callback null; this block arms a
            // test gate so a message cannot be delivered before the gate opens.
            int workerCommands=Requests().Length;
            TaskCompletionSource<bool>? gate=null;
            void ArmGate(){
                var next=new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
                gate=next;Set(view,"AllowUserInput",false);
                Set(view,"AcquireUserInput",(Func<Task<bool>>)(async()=>{await next.Task;return true;}));
            }
            void ReleaseGate(){
                Set(view,"AllowUserInput",true);
                (gate??throw new Exception("ACK gate was not armed")).TrySetResult(true);
                PumpUntil(()=>!(bool)Get(view,"acquiringInput")!,"ACK gate did not finish replay");
            }
            Call(view,"BindInputWindows");
            using(var parentReplay=new ReplayProbe(view.Handle,()=>(bool)Get(view,"replayingInput")!)){
                foreach(bool parent in new[]{true,false})foreach(bool posted in new[]{false,true}){
                    probe.Delivered.Clear();parentReplay.Delivered.Clear();ArmGate();
                    IntPtr target=parent?view.Handle:probe.Handle;
                    foreach(var (id,value) in new[]{(0x201,1),(0x202,0)}){
                        if(posted)Require(InputProbe.Post(target,id,new IntPtr(value),IntPtr.Zero),"Self-owned PostMessage must succeed");
                        else InputProbe.Send(target,id,new IntPtr(value),IntPtr.Zero);
                    }
                    PumpUntil(()=>((List<Message>)Get(view,"queuedInput")!).Count==2,"Parent/native-child input did not enter the acquisition queue");
                    Require(probe.Delivered.Count==0&&parentReplay.Delivered.Count==0&&Requests().Length==workerCommands,"Parent/native child input must wait for the ACK gate and must not ask the worker");
                    ReleaseGate();
                    var delivered=parent?parentReplay.Delivered:probe.Delivered;
                    Require(delivered.SequenceEqual(new[]{(0x201,1),(0x202,0)}),"Parent/native child SendMessage/PostMessage must replay once in original order after the gate opens");
                }
            }
            using(var foreign=new ForeignInputProbe(view.Handle)){
                PumpUntil(()=>foreign.Ready.Task.IsCompleted,"Self-owned native child thread did not start");
                if(foreign.Ready.Task.IsFaulted)throw foreign.Ready.Task.Exception!.GetBaseException();
                var child=foreign.Ready.Task.GetAwaiter().GetResult();Call(view,"BindInputWindows");
                int uiThread=Environment.CurrentManagedThreadId;
                foreach(bool posted in new[]{false,true}){
                    child.Delivered.Clear();int acquireThread=0;ArmGate();
                    var acquire=(Func<Task<bool>>)Get(view,"AcquireUserInput")!;
                    Set(view,"AcquireUserInput",(Func<Task<bool>>)(()=>{acquireThread=Environment.CurrentManagedThreadId;return acquire();}));
                    foreach(var (id,value) in new[]{(0x201,1),(0x202,0)}){
                        if(posted)Require(InputProbe.Post(child.Handle,id,new IntPtr(value),IntPtr.Zero),"Cross-thread self PostMessage must succeed");
                        else InputProbe.Send(child.Handle,id,new IntPtr(value),IntPtr.Zero);
                    }
                    PumpUntil(()=>((List<Message>)Get(view,"queuedInput")!).Count==2,"Foreign native child's messages did not marshal to owner UI");
                    Require(acquireThread==uiThread&&child.Delivered.Count==0&&Requests().Length==workerCommands,"Cross-thread input must acquire on the owner UI and wait for the ACK gate");
                    ReleaseGate();
                    Require(child.Delivered.SequenceEqual(new[]{(0x201,1),(0x202,0)})&&child.DeliveryThread!=uiThread,"Cross-thread replay must return to the original child thread in original order");
                }
            }
            Call(form,"ConfigureManualInput");
            Require(Get(view,"AcquireUserInput")==null,"ConfigureManualInput must disarm a test acquisition callback");
            Require((int)client.Connected==0,"COM must remain disconnected after every input test");
            RequireBackgroundTimersFrozen(form);
            passed=true;
            Console.WriteLine("manual input PASS: view-only until Take over, no 10-second hand-back, explicit Hand back, held-input refusal, hand_off, hwnd forward, ACK gate; COM never connected");
        }finally{
            Exception? cleanupFailure=null;
            try{
                Set(form,"writer",null);Set(form,"view",null);Set(form,"connected",false);Set(form,"workerAuthenticated",false);
                Set(form,"workerReady",originalReady);Set(form,"liveRefresh",originalLiveRefresh);
                Set(form,"takeover",false);Set(form,"awaitingHuman",false);Set(form,"workerIdentity",null);
                Set(view,"AcquireUserInput",null);Set(view,"AllowUserInput",false);
            }catch(Exception cleanup){cleanupFailure=cleanup;}
            if(passed&&cleanupFailure!=null)throw cleanupFailure;
        }
    }
}

sealed class InputProbe:NativeWindow,IDisposable
{
    internal readonly List<(int,int)> Delivered=new();
    internal int DeliveryThread;
    internal InputProbe(IntPtr parent){CreateHandle(new CreateParams(){Caption="WinPilot self-message test",Parent=parent,Style=0x40000000,Width=10,Height=10});}
    [DllImport("user32.dll",EntryPoint="SendMessageW")]internal static extern IntPtr Send(IntPtr hwnd,int message,IntPtr wParam,IntPtr lParam);
    [DllImport("user32.dll",EntryPoint="PostMessageW")]internal static extern bool Post(IntPtr hwnd,int message,IntPtr wParam,IntPtr lParam);
    protected override void WndProc(ref Message message){
        if(message.Msg is 0x100 or 0x101 or 0x201 or 0x202 or 0x20b or 0x20c){DeliveryThread=Environment.CurrentManagedThreadId;Delivered.Add((message.Msg,message.WParam.ToInt32()));return;}
        base.WndProc(ref message);
    }
    public void Dispose()=>DestroyHandle();
}

sealed class ForeignInputProbe:IDisposable
{
    internal readonly TaskCompletionSource<InputProbe> Ready=new(TaskCreationOptions.RunContinuationsAsynchronously);
    readonly Thread thread;
    uint nativeThread;
    [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
    [DllImport("user32.dll",EntryPoint="PostThreadMessageW")]static extern bool PostThread(uint thread,int message,IntPtr wParam,IntPtr lParam);
    internal ForeignInputProbe(IntPtr parent){
        thread=new Thread(()=>{
            try{nativeThread=GetCurrentThreadId();using var child=new InputProbe(parent);Ready.SetResult(child);Application.Run();}
            catch(Exception error){Ready.TrySetException(error);}
        }){IsBackground=true};thread.SetApartmentState(ApartmentState.STA);thread.Start();
    }
    public void Dispose(){
        if(nativeThread!=0)PostThread(nativeThread,0x12,IntPtr.Zero,IntPtr.Zero);
        long deadline=Environment.TickCount64+2000;
        // Native child destruction can notify its parent; keep that owner's
        // message pump alive instead of blocking it in Thread.Join.
        while(thread.IsAlive&&Environment.TickCount64<deadline){Application.DoEvents();Thread.Sleep(2);}
        if(thread.IsAlive)throw new Exception("Self-owned native child thread did not stop");
    }
}

sealed class ReplayProbe:NativeWindow,IDisposable
{
    internal readonly List<(int,int)> Delivered=new();
    readonly Func<bool> replaying;
    internal ReplayProbe(IntPtr window,Func<bool> isReplaying){replaying=isReplaying;AssignHandle(window);}
    protected override void WndProc(ref Message message){
        if(message.Msg is 0x201 or 0x202&&replaying())Delivered.Add((message.Msg,message.WParam.ToInt32()));
        base.WndProc(ref message);
    }
    public void Dispose()=>ReleaseHandle();
}

sealed class ProbeWorkerWriter:StreamWriter
{
    internal Task? NextWriteGate;
    internal ProbeWorkerWriter(Stream stream):base(stream,new UTF8Encoding(false),4096,true){}
    public override Task WriteLineAsync(string? value){
        var gate=NextWriteGate;NextWriteGate=null;
        if(gate!=null)return GatedWrite(value,gate);
        return base.WriteLineAsync(value);
    }
    async Task GatedWrite(string? value,Task gate){await gate;await base.WriteLineAsync(value);}
}
