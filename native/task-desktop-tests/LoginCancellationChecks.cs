using System.Drawing;
using System.Text;
using System.Windows.Forms;
using WinPilotTaskDesktop;

static class LoginCancellationChecks
{
    sealed class MemoryStore:WindowsLoginStore
    {
        internal int Writes,Deletes;
        internal bool FailSave;
        internal string? SavedAccount;
        internal MemoryStore():base(Guid.NewGuid()){}
        internal override WindowsLogin? Read()=>SavedAccount==null?null:new(SavedAccount,Encoding.Unicode.GetBytes("Synthetic previous value"));
        internal override void Save(WindowsLogin login){Writes++;if(FailSave)throw new InvalidOperationException("Synthetic save failure");SavedAccount=login.Account;}
        internal override void Delete(){Deletes++;SavedAccount=null;}
    }
    sealed class Probe:LoginSettingsDialog
    {
        internal Probe(MemoryStore store,Func<WindowsLogin,Task> validate):base(store,validate){ShowInTaskbar=false;StartPosition=FormStartPosition.Manual;Location=new Point(-32000,-32000);}
        protected override bool ShowWithoutActivation=>true;
        internal TextBox Password=>(TextBox)Controls.Find("windows_password",true).Single();
        internal void Submit(){((TextBox)Controls.Find("windows_account",true).Single()).Text="Example\\User";Password.Text="Synthetic-only";((Button)AcceptButton!).PerformClick();}
        internal bool SaveEnabled=>((Button)AcceptButton!).Enabled;
    }
    static void Require(bool condition,string message){if(!condition)throw new Exception(message);}
    static void PumpUntil(Func<bool> ready)
    {
        var deadline=DateTime.UtcNow.AddSeconds(2);
        while(!ready()&&DateTime.UtcNow<deadline){Application.DoEvents();Thread.Sleep(5);}
        Require(ready(),"Login handler did not finish its cancellation cleanup");
    }
    internal static void Run()
    {
        Exception? failure=null;
        var thread=new Thread(()=>{
            try {
                foreach(bool validationFails in new[]{false,true}) {
                    var store=new MemoryStore(){SavedAccount="Example\\Previous"};
                    var pending=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);WindowsLogin? held=null;
                    using var dialog=new Probe(store,value=>{held=value;return pending.Task;});dialog.Show();dialog.Submit();
                    Require(held!=null&&!dialog.SaveEnabled,"Submit begins one pending validation");
                    dialog.Close();
                    if(validationFails)pending.SetException(new InvalidOperationException("Synthetic late validation failure"));else pending.SetResult();
                    PumpUntil(()=>held!.Password.All(b=>b==0));
                    Require(dialog.Login==null&&store.Writes==0&&store.Deletes==0&&store.SavedAccount=="Example\\Previous","Cancel must preserve existing login, return no secret and suppress late validation results");
                }
                {
                    var store=new MemoryStore();WindowsLogin? held=null;
                    using var dialog=new Probe(store,value=>{held=value;return Task.FromException(new InvalidOperationException("Synthetic validation failure"));});dialog.Show();dialog.Submit();
                    Require(dialog.Visible&&dialog.SaveEnabled&&dialog.Password.Text.Length==0,"Validation failure keeps settings editable without retaining textbox password");
                    Require(dialog.Login==null&&store.Writes==0&&store.Deletes==0&&held!.Password.All(b=>b==0),"Validation failure must not persist or return a password");
                }
                {
                    var store=new MemoryStore(){FailSave=true,SavedAccount="Example\\Previous"};WindowsLogin? held=null;
                    using var dialog=new Probe(store,value=>{held=value;return Task.CompletedTask;});dialog.Show();dialog.Submit();
                    Require(dialog.Visible&&dialog.SaveEnabled&&dialog.Login==null&&held!.Password.All(b=>b==0),"Save failure keeps form open and clears transient password");
                    Require(store.Writes==1&&store.Deletes==0&&store.SavedAccount=="Example\\Previous","Save failure preserves prior credential");
                }
                foreach(bool remember in new[]{false,true}) {
                    var store=new MemoryStore(){SavedAccount="Example\\Previous"};
                    using var dialog=new Probe(store,_=>Task.CompletedTask);dialog.Show();((CheckBox)dialog.Controls.Find("remember_login",true).Single()).Checked=remember;dialog.Submit();
                    Require(dialog.DialogResult==DialogResult.OK&&dialog.Login!=null,"Validated successful settings return a connection credential");
                    Require(store.Writes==(remember?1:0)&&store.Deletes==(remember?0:1),"Remember persists; unchecked explicitly forgets prior login");
                    var held=dialog.Login!;held.Dispose();Require(held.Password.All(b=>b==0),"Caller disposes successful connection credential");
                }
            }catch(Exception e){failure=e;}
        }){IsBackground=true};
        thread.SetApartmentState(ApartmentState.STA);thread.Start();Require(thread.Join(TimeSpan.FromSeconds(15)),"Login cancellation tests did not finish");if(failure!=null)throw failure;
        Console.WriteLine("login cancellation/late success/late failure/validation failure/save failure/remember and forget checks PASSED; actual form handlers, memory store and synthetic validator only");
    }
}
