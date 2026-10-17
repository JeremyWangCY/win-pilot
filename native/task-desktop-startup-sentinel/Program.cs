using System.Diagnostics;
using System.Text.Json;

namespace WinPilotStartupSentinel;
static class Program
{
    static void Main(string[] args)
    {
        if(Environment.UserName!="WDAGUtilityAccount"||args.Length!=4||args[0]!="--events"||args[2]!="--origin")return;
        string file=Path.GetFullPath(args[1]);
        if(!file.StartsWith(@"C:\WinPilotFixture\results\",StringComparison.OrdinalIgnoreCase))return;
        Directory.CreateDirectory(Path.GetDirectoryName(file)!);
        string line=JsonSerializer.Serialize(new { at=DateTimeOffset.UtcNow,origin=args[3],pid=Environment.ProcessId,session=Process.GetCurrentProcess().SessionId,user=Environment.UserName })+Environment.NewLine;
        // Startup can occur in more than one guest session. Retry only this
        // append, never create another sentinel process to make a result pass.
        for(int attempt=0;attempt<10;attempt++)try { using var stream=new FileStream(file,FileMode.Append,FileAccess.Write,FileShare.Read);using var writer=new StreamWriter(stream);writer.Write(line);return; }catch(IOException){Thread.Sleep(50);}
        Environment.ExitCode=2;
    }
}
