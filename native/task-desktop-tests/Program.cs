using System.Diagnostics;
using System.IO.Pipes;
using WinPilotTaskDesktop;

Check(ChildSessionQuery.IsKnown(false,uint.MaxValue,1168),"observed Windows empty-child result");
Check(ChildSessionQuery.IsKnown(true,uint.MaxValue,0),"documented empty child");
Check(ChildSessionQuery.IsKnown(true,3,0),"existing child");
Check(!ChildSessionQuery.IsKnown(false,uint.MaxValue,5),"access denied must remain unknown");
Check(!ChildSessionQuery.IsKnown(false,3,1168),"not-found with a populated ID must remain unknown");
Check(!ChildSessionQuery.IsKnown(false,0,1168),"uninitialized output must remain unknown");
Check(!ChildSessionQuery.IsKnown(false,uint.MaxValue,1722),"RPC failure must remain unknown");

// Live-session resolution. The stale-id case is the confirmed real-world failure:
// WTSGetChildSessionId reported 3 while no session 3 existed at all.
void Resolve(IReadOnlyCollection<uint> live,uint[] baseline,uint parent,uint? reported,uint expected,string message) {
    if(!ChildSessionQuery.TryResolve(live,new HashSet<uint>(baseline),parent,reported,out uint session,out _))throw new Exception("must resolve: "+message);
    Check(session==expected,message+" (got "+session+")");
}
void RejectResolve(IReadOnlyCollection<uint> live,uint[] baseline,uint parent,uint? reported,string message) {
    if(ChildSessionQuery.TryResolve(live,new HashSet<uint>(baseline),parent,reported,out _,out _))throw new Exception("must not resolve: "+message);
}
uint[] baseSessions=[0u,1u,65536u,65537u];
string ownerSid="S-1-5-21-100-200-300-1001",foreignSid="S-1-5-21-400-500-600-1001";
Check(ChildSessionQuery.CanCleanup(new uint[]{0,1,3},new HashSet<uint>(baseSessions),1,3,3,ownerSid,ownerSid),"exited worker can be cleaned up only with independently matching account SID");
Check(!ChildSessionQuery.CanCleanup(new uint[]{0,1,3},new HashSet<uint>(baseSessions),1,3,3,foreignSid,ownerSid),"same username in a different domain is refused by SID");
Check(!ChildSessionQuery.CanCleanup(new uint[]{0,1,3},new HashSet<uint>(baseSessions),1,3,4,ownerSid,ownerSid),"changed parent-child mapping refuses cleanup");
Check(!ChildSessionQuery.CanCleanup(new uint[]{0,1,3},new HashSet<uint>(new uint[]{0,1,3}),1,3,3,ownerSid,ownerSid),"baseline sessions cannot be cleaned up");
Check(!ChildSessionQuery.CanCleanup(new uint[]{0,1,3,4},new HashSet<uint>(baseSessions),1,3,3,ownerSid,ownerSid),"ambiguous new sessions refuse cleanup");
Check(!ChildSessionQuery.CanCleanup(new uint[]{0,1,3},new HashSet<uint>(baseSessions),1,3,3,null,ownerSid),"unknown account refuses cleanup");
Check(!ChildSessionQuery.CanCleanup(new uint[]{0,1},new HashSet<uint>(baseSessions),1,1,1,ownerSid,ownerSid),"parent session cannot be cleaned up");
Check(!ChildSessionQuery.CanCleanup(new uint[]{0,1},new HashSet<uint>(baseSessions),1,3,3,ownerSid,ownerSid),"absent child cannot be cleaned up");
// The real observed case: session 3 was destroyed, yet the child query still returned 3.
RejectResolve(new uint[]{0,1,65536,65537},baseSessions,1,3,"stale child id with no live session must be refused");
// A genuinely new live session is the launch target.
RejectResolve(new uint[]{0,1,2,65536,65537},baseSessions,1,null,"a new session without a parent-child association is not ours");
RejectResolve(new uint[]{0,1,9,65536,65537},baseSessions,1,3,"a unique unrelated new session must not replace the reported child");
Resolve(new uint[]{0,1,2,65536,65537},baseSessions,1,2,2,"reported id agreeing with enumeration");
// Pre-existing sessions and the parent are never adopted, even if reported.
RejectResolve(new uint[]{0,1,65536,65537},baseSessions,1,null,"no new session");
RejectResolve(new uint[]{0,1,2,65536,65537},new uint[]{0,1,2,65536,65537},1,2,"pre-existing session is not ours");
RejectResolve(new uint[]{0,1,65536,65537},baseSessions,1,1,"parent session must never be targeted");
RejectResolve(new uint[]{0,1,65536,65537},baseSessions,1,uint.MaxValue,"sentinel id is not a session");
RejectResolve(new uint[]{0,1,65536,65537},baseSessions,1,null,"empty enumeration");
// Two new sessions are ambiguous: refuse rather than guess.
RejectResolve(new uint[]{0,1,2,3,65536,65537},baseSessions,1,null,"multiple new sessions are ambiguous");
// A reported id must also be live and new, never merely believed.
RejectResolve(new uint[]{0,1,65536,65537},baseSessions,1,9,"reported id absent from enumeration");
RejectResolve(new uint[]{0,1,2,65536,65537},new uint[]{0,1,2,65536,65537},1,2,"reported id already in baseline");
// Listeners (65536/65537) are excluded by LiveSessions, not treated as sessions.
Check(!ChildSessionQuery.TryResolve(new uint[]{0,1,65536,65537},new HashSet<uint>(),1,null,out _,out _),"listeners alone must not resolve a child");

// Kernel queries on this console process only. No forms, helpers, or session APIs.
uint pid=(uint)Environment.ProcessId;
var identity=ProcessIdentity.Capture(pid);
Check(identity.Pid==pid,"actual PID");
Check(identity.Session==(uint)Process.GetCurrentProcess().SessionId,"primary token session");
Check(identity.Created>0&&!string.IsNullOrEmpty(identity.User),"creation time and user identity");
ProcessIdentity.Verify(pid,identity.Session,Environment.ProcessPath!,identity.Created);
Reject(()=>ProcessIdentity.Verify(pid,identity.Session+1,identity.Image,identity.Created),"different session");
Reject(()=>ProcessIdentity.Verify(pid,identity.Session,identity.Image,identity.Created+1),"reused PID creation time");
Reject(()=>ProcessIdentity.Verify(pid,identity.Session,Path.Combine(Path.GetTempPath(),"wrong-worker.exe"),identity.Created),"different executable");
string pipeName="win-pilot-identity-test-"+Guid.NewGuid();
using(var server=new NamedPipeServerStream(pipeName,PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly))
using(var client=new NamedPipeClientStream(".",pipeName,PipeDirection.InOut,PipeOptions.Asynchronous|PipeOptions.CurrentUserOnly)) {
    var connect=server.WaitForConnectionAsync();await client.ConnectAsync(1000);await connect.WaitAsync(TimeSpan.FromSeconds(1));
    PipeIdentity.Client(server,pid,identity.Session,identity.Image);
    PipeIdentity.Server(client,pid,identity.Session,identity.Image,identity.Created);
    Reject(()=>PipeIdentity.Client(server,pid+1,identity.Session,identity.Image),"forged client PID");
    Reject(()=>PipeIdentity.Server(client,pid+1,identity.Session,identity.Image,identity.Created),"forged server PID");
    Reject(()=>PipeIdentity.Client(server,pid,identity.Session+1,identity.Image),"forged client session");
    Reject(()=>PipeIdentity.Server(client,pid,identity.Session,identity.Image,identity.Created+1),"reused server PID");
}
var writes=new List<(uint,string)>();
void Write(uint session,string marker)=>writes.Add((session,marker));
ExplorerStartupMarker.Prepare(1,3,()=>3,Write);
Check(writes.SequenceEqual(new[]{(3u,"RunStuffHasBeenRun"),(3u,"StartupHasBeenRun")}),"exact session and markers");
foreach(uint bad in new[]{0u,1u,uint.MaxValue}) {
    writes.Clear();Reject(()=>ExplorerStartupMarker.Prepare(1,bad,()=>bad,Write),"invalid or parent marker");Check(writes.Count==0,"invalid target must have no writes");
}
writes.Clear();Reject(()=>ExplorerStartupMarker.Prepare(1,3,()=>4,Write),"changed session before first write");Check(writes.Count==0,"wrong session must have no writes");
writes.Clear();int observations=0;
Reject(()=>ExplorerStartupMarker.Prepare(1,3,()=>++observations==1?3u:4u,Write),"changed session between writes");Check(writes.Count==1,"may not write second marker after target changes");
writes.Clear();using(var cancellation=new CancellationTokenSource()) {
    cancellation.Cancel();try{ExplorerStartupMarker.Prepare(1,3,()=>3,Write,cancellation.Token);throw new Exception("must cancel before write");}catch(OperationCanceledException){}
    Check(writes.Count==0,"cancelled startup must have no writes");
}
Console.WriteLine("native process identity checks PASSED; no desktop or session operations performed");
Console.WriteLine("startup marker target/order/cancellation mock checks PASSED; no registry writes performed");
Console.WriteLine("actual named-pipe peer identity checks PASSED; only this console process participated");

// Exercise the actual daemon's Int32 contract against opaque worker IDs.
var helperInput=new StringWriter();
var helperOutput=new StringReader("noise\nnull\n[]\n\"ignored\"\n5\n{\"id\":0,\"ok\":false}\n{\"id\":1,\"ok\":true}\n{\"id\":2,\"ok\":true}\n");
var helperProtocol=new HelperProtocol(helperInput,helperOutput);
foreach(string opaqueId in new[]{"bootstrap-123",Guid.NewGuid().ToString()}) {
    var request=new System.Text.Json.Nodes.JsonObject(){["id"]=opaqueId,["action"]="list_displays"};
    var reply=await helperProtocol.Invoke(request);
    Check(reply["ok"]!.GetValue<bool>()&&reply["id"]!.ToString()==opaqueId,"opaque IDs round-trip through Int32 daemon");
    Check(request["id"]!.ToString()==opaqueId,"caller request ID stays unchanged");
}
var helperRequests=helperInput.ToString().Split(Environment.NewLine,StringSplitOptions.RemoveEmptyEntries);
Check(helperRequests.Length==2,"one helper dispatch for each request");
for(int i=0;i<helperRequests.Length;i++)Check(System.Text.Json.Nodes.JsonNode.Parse(helperRequests[i])!["id"]!.GetValue<int>()==i+1,"helper receives sequential Int32 IDs");
try{await helperProtocol.Invoke(new(){["id"]="eof",["action"]="list_displays"});throw new Exception("must reject EOF");}catch(IOException){}
Console.WriteLine("helper Int32/opaque ID mapping and EOF checks PASSED; mocked streams only");

// Opt-in protocol integration: only the read-only display health request.
// Never launches a desktop/session or sends mouse/keyboard input.
int helperFlag=Array.IndexOf(args,"--helper-health");
if(helperFlag>=0) {
    Check(ChildSessionQuery.SessionUserSid(identity.Session,out string sessionSid)&&sessionSid==identity.User,"current session domain-qualified account resolves to actual token SID");
    string helperPath=Path.GetFullPath(args[helperFlag+1]);
    var start=new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System),"WindowsPowerShell","v1.0","powershell.exe")){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true,StandardOutputEncoding=System.Text.Encoding.UTF8};
    foreach(string argument in new[]{"-NoProfile","-ExecutionPolicy","Bypass","-File",helperPath,"-Server"})start.ArgumentList.Add(argument);
    using var helper=Process.Start(start)!;var stderr=helper.StandardError.ReadToEndAsync();
    try {
        var protocol=new HelperProtocol(helper.StandardInput,helper.StandardOutput);
        var response=await protocol.Invoke(new(){["id"]="bootstrap-real-health",["action"]="list_displays"}).WaitAsync(TimeSpan.FromSeconds(30));
        Check(response["ok"]?.GetValue<bool>()==true,"real daemon health");
        Check(response["id"]?.ToString()=="bootstrap-real-health","real daemon opaque ID round-trip");
        Console.WriteLine("actual PowerShell daemon health and Int32 ID contract PASSED; list_displays only");
    } finally {
        helper.StandardInput.Close();
        try{await helper.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3));}catch(TimeoutException){helper.Kill();await helper.WaitForExitAsync();}
        await stderr;
    }
}

if(args.Contains("--credential-roundtrip")) {
    // Only a new random WinPilot/.../Tests GUID target is used. No application
    // credential or Windows password is read, verified or overwritten.
    var store=new WindowsLoginStore(Guid.NewGuid());
    byte[] expected=System.Text.Encoding.Unicode.GetBytes("Synthetic-only-测试-"+Guid.NewGuid());
    try {
        Check(store.Read()==null,"fresh test credential must not exist");
        using(var value=new WindowsLogin("TEST-DOMAIN\\TestUser",expected.ToArray()))store.Save(value);
        using(var restored=store.Read()) {
            Check(restored!=null&&restored.Account=="TEST-DOMAIN\\TestUser"&&restored.Password.SequenceEqual(expected),"real DPAPI + generic Windows credential Unicode round-trip");
            byte[] held=restored!.Password;restored.Dispose();Check(held.All(b=>b==0),"recovered password buffer cleared on dispose");
        }
        using(var replacement=new WindowsLogin("second@example.invalid",System.Text.Encoding.Unicode.GetBytes("Replacement-synthetic-only")))store.Save(replacement);
        using(var restored=store.Read())Check(restored?.Account=="second@example.invalid","same own target supports replacement");
        store.Delete();store.Delete();Check(store.Read()==null,"delete is idempotent and credential is absent");
        using var oversized=new WindowsLogin("TEST-DOMAIN\\TestUser",new byte[1026]);Reject(()=>store.Save(oversized),"oversized secret is refused before persistence");
        Console.WriteLine("real DPAPI/CredWrite/CredRead/replacement/delete checks PASSED; synthetic GUID-scoped Win-Pilot test credential only");
    }finally{store.Delete();System.Security.Cryptography.CryptographicOperations.ZeroMemory(expected);}
}
if(args.Contains("--rdp-credentials")) {
    Exception? failure=null;
    var probe=new Thread(()=>{
        try {
            using var form=new System.Windows.Forms.Form();
            using var rdp=new CredentialProbeView();
            ((System.ComponentModel.ISupportInitialize)rdp).BeginInit();form.Controls.Add(rdp);((System.ComponentModel.ISupportInitialize)rdp).EndInit();form.CreateControl();rdp.CreateControl();
            RdpCredentials.ConfigureChildSession(rdp.Client,true);
            using var synthetic=new WindowsLogin("TEST-DOMAIN\\TestUser",System.Text.Encoding.Unicode.GetBytes("Synthetic-only-never-connected"));
            RdpCredentials.ApplyLogin(rdp.Client,synthetic);
            dynamic client=rdp.Client;
            Check((string)client.UserName=="TestUser"&&(string)client.Domain=="TEST-DOMAIN"&&(int)client.Connected==0,"real RDP credential setters without Connect");
        }catch(Exception e){failure=e;}
    });
    probe.SetApartmentState(ApartmentState.STA);probe.Start();Check(probe.Join(TimeSpan.FromSeconds(20)),"RDP setter probe completes");if(failure!=null)throw failure;
    Console.WriteLine("installed RDP COM credential/identity setters PASSED; no Connect, authentication, input or Windows session operations");
}
if(args.Contains("--login-dialog")) {
    Exception? failure=null;
    var probe=new Thread(()=>{
        try {
            var store=new WindowsLoginStore(Guid.NewGuid());
            using var dialog=new LoginSettingsPreview(store){ShowInTaskbar=false,StartPosition=System.Windows.Forms.FormStartPosition.Manual,Location=new System.Drawing.Point(-32000,-32000)};
            var account=(System.Windows.Forms.TextBox)dialog.Controls.Find("windows_account",true).Single();account.Text="Example\\User";
            var password=(System.Windows.Forms.TextBox)dialog.Controls.Find("windows_password",true).Single();
            Check(password.UseSystemPasswordChar&&password.MaxLength==512,"password field is masked and bounded");
            dialog.Show();System.Windows.Forms.Application.DoEvents();dialog.PerformLayout();
            using var image=new System.Drawing.Bitmap(dialog.Width,dialog.Height);dialog.DrawToBitmap(image,new System.Drawing.Rectangle(0,0,dialog.Width,dialog.Height));
            string file=Path.GetFullPath("artifacts/task-desktop-login-settings.png");Directory.CreateDirectory(Path.GetDirectoryName(file)!);image.Save(file,System.Drawing.Imaging.ImageFormat.Png);
            Check(dialog.Login==null&&store.Read()==null,"rendering and closing an untouched settings form saves no login");
        }catch(Exception e){failure=e;}
    });
    probe.SetApartmentState(ApartmentState.STA);probe.Start();Check(probe.Join(TimeSpan.FromSeconds(20)),"login settings render completes");if(failure!=null)throw failure;
    Console.WriteLine("login settings render/masked field/no-save checks PASSED; offscreen own form, no real credential target or authentication");
}
if(args.Contains("--capture-freshness"))try{await CaptureFreshnessProbe.Run(Path.GetFullPath("lib/wgc/win-pilot-wgc.exe"));}catch(Exception e){Console.Error.WriteLine(e.Message);Environment.ExitCode=1;}
if(args.Contains("--login-cancellation"))try{LoginCancellationChecks.Run();}catch(Exception e){Console.Error.WriteLine(e.Message);Environment.ExitCode=1;}
if(args.Contains("--desktop-readiness"))try{
    int probes=0;
    await DesktopReadiness.WaitAsync(()=>Task.FromResult(new System.Text.Json.Nodes.JsonObject(){["ok"]=true,["input_desktop_ready"]=++probes>=2}));
    Check(probes==2,"worker readiness must wait for actual input desktop, not only helper JSON health");
    using var cancelled=new CancellationTokenSource();cancelled.Cancel();int cancelledProbes=0;
    try{await DesktopReadiness.WaitAsync(()=>{cancelledProbes++;return Task.FromResult(new System.Text.Json.Nodes.JsonObject(){["ok"]=true,["input_desktop_ready"]=false});},cancelled.Token);throw new Exception("cancelled readiness must not succeed");}catch(OperationCanceledException){}
    Check(cancelledProbes==0,"cancelled startup must not dispatch more helper health");
    using(var duringWait=new CancellationTokenSource(TimeSpan.FromMilliseconds(40))) {
        try{await DesktopReadiness.WaitAsync(()=>Task.FromResult(new System.Text.Json.Nodes.JsonObject(){["ok"]=true}),duringWait.Token);throw new Exception("unknown input desktop must never announce ready");}catch(OperationCanceledException){}
    }
    try{await DesktopReadiness.WaitAsync(()=>Task.FromResult(new System.Text.Json.Nodes.JsonObject(){["ok"]=false,["message"]="synthetic helper failure"}));throw new Exception("failed helper must not announce ready");}catch(IOException){}
    Console.WriteLine("desktop readiness transition, cancellation and helper failure checks PASSED; probe-only fake health, no session or input");
}catch(Exception e){Console.Error.WriteLine(e.Message);Environment.ExitCode=1;}

static void Check(bool valid,string message){if(!valid)throw new Exception(message);}
static void Reject(Action action,string message){try{action();}catch(InvalidOperationException){return;}throw new Exception("must reject: "+message);}

sealed class CredentialProbeView:System.Windows.Forms.AxHost
{
    internal CredentialProbeView():base("8B918B82-7985-4C24-89DF-C33AD2BBFBCD"){}
    internal object Client=>GetOcx();
}

sealed class LoginSettingsPreview:LoginSettingsDialog
{
    internal LoginSettingsPreview(WindowsLoginStore store):base(store){}
    protected override bool ShowWithoutActivation=>true;
}
