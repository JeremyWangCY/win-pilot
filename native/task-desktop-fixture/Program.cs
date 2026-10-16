using System.Diagnostics;
using System.Text.Json;

namespace WinPilotTaskFixture;

static class Program
{
    internal static string EventPath = "";
    internal static void Record(string name, object? detail=null)
    {
        string line=JsonSerializer.Serialize(new { at=DateTimeOffset.UtcNow, name, pid=Environment.ProcessId, session=Process.GetCurrentProcess().SessionId, detail })+Environment.NewLine;
        // Only this fixture owns the file; UI events are serialized on its STA.
        File.AppendAllText(EventPath,line);
    }
    [STAThread]
    static void Main(string[] args)
    {
        string allowed;
        if(args.Length==2&&args[0]=="--events"&&Environment.UserName=="WDAGUtilityAccount") {
            EventPath=Path.GetFullPath(args[1]);allowed=@"C:\WinPilotFixture\results\";
        } else if(args.Length==8&&args[0]=="--host-test"&&Guid.TryParse(args[1],out var instance)&&args[2]=="--session"&&int.TryParse(args[3],out int target)&&args[4]=="--parent-session"&&int.TryParse(args[5],out int parent)&&args[6]=="--events"&&target>0&&parent>0&&target!=parent&&Process.GetCurrentProcess().SessionId==target) {
            allowed=Path.Combine(Path.GetTempPath(),"win-pilot","host-fixture-"+instance)+Path.DirectorySeparatorChar;
            EventPath=Path.GetFullPath(args[7]);
        } else return;
        if(!EventPath.StartsWith(allowed,StringComparison.OrdinalIgnoreCase))return;
        Directory.CreateDirectory(allowed);
        ApplicationConfiguration.Initialize();
        var form=new Form { Text="Win-Pilot Input Fixture",Width=650,Height=360,StartPosition=FormStartPosition.CenterScreen };
        var title=new Label { Text="Isolated task desktop input fixture",Dock=DockStyle.Top,Height=52,Padding=new Padding(16),AccessibleName="Fixture title" };
        var input=new TextBox { Name="FixtureInput",AccessibleName="Fixture input",Left=24,Top=86,Width=570 };
        var button=new Button { Name="FixtureIncrement",AccessibleName="Fixture increment",Text="Increment",Left=24,Top=144,Width=140,Height=40 };
        var count=new Label { Name="FixtureCount",AccessibleName="Fixture count",Text="Clicks: 0",Left=190,Top=156,AutoSize=true };
        int clicks=0;
        input.TextChanged+=(_,_)=>Record("text_changed",new { text=input.Text });
        button.Click+=(_,_)=>{count.Text="Clicks: "+(++clicks);Record("clicked",new { clicks,text=input.Text });};
        form.Controls.AddRange([title,input,button,count]);
        form.Shown+=(_,_)=>{Record("shown",new { hwnd=form.Handle.ToInt64() });input.Focus();};
        form.FormClosed+=(_,_)=>Record("closed");
        Record("started");
        Application.Run(form);
    }
}
