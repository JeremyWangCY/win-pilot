using System.Diagnostics;
using System.Drawing;
using System.Text.Json;
using System.Windows.Forms;

// A non-activating window owned only by this test. It changes its own paint;
// there are no mouse/keyboard calls or reads of another application's windows.
static class CaptureFreshnessProbe
{
    sealed class ProbeWindow:Form{protected override bool ShowWithoutActivation=>true;}
    internal static async Task Run(string executable)
    {
        var done=new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        string directory=Path.GetFullPath("artifacts/wgc-freshness/"+Guid.NewGuid().ToString("D"));Directory.CreateDirectory(directory);
        var thread=new Thread(()=>{
            using var form=new ProbeWindow(){Text="Win-Pilot capture verification",BackColor=Color.Red,Size=new Size(320,180),ShowInTaskbar=false,StartPosition=FormStartPosition.Manual};
            var area=Screen.PrimaryScreen!.WorkingArea;form.Location=new Point(area.Right-form.Width,area.Bottom-form.Height);
            form.Shown+=async(_,_)=>{
                Process? bridge=null;Exception? failure=null;int[]? before=null,after=null,unchanged=null;
                var elapsed=Stopwatch.StartNew();
                try {
                    var start=new ProcessStartInfo(executable){UseShellExecute=false,CreateNoWindow=true,RedirectStandardInput=true,RedirectStandardOutput=true,RedirectStandardError=true};start.ArgumentList.Add("--server");
                    bridge=Process.Start(start)??throw new Exception("WGC test bridge did not start");
                    async Task<int[]> Capture(string name){
                        string file=Path.Combine(directory,name+".png");
                        await bridge.StandardInput.WriteLineAsync(form.Handle.ToInt64()+"\t"+file);await bridge.StandardInput.FlushAsync();
                        string? reply=await bridge.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(8));
                        if(reply?.StartsWith("OK ")!=true)throw new Exception("WGC test capture: "+reply);
                        using var image=new Bitmap(file);var color=image.GetPixel(image.Width/2,image.Height/2);return [color.R,color.G,color.B];
                    }
                    before=await Capture("before");
                    if(before[0]<220||before[1]>30)throw new Exception("WGC test first frame is not the fixture's red client area");
                    // Let the two-buffer pool fill while the server waits on stdin.
                    await Task.Delay(1200);form.BackColor=Color.Lime;form.Refresh();await Task.Delay(120);
                    after=await Capture("after");
                    if(after[1]<220||after[0]>30)throw new Exception("WGC returned an old frame after the fixture changed red to green");
                    await Task.Delay(150);unchanged=await Capture("unchanged");
                    if(unchanged[1]<220||unchanged[0]>30)throw new Exception("WGC could not observe the unchanged fixture again");
                }catch(Exception e){failure=e;}
                finally {
                    if(bridge!=null){bridge.StandardInput.Close();try{await bridge.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(3));}catch{if(!bridge.HasExited)bridge.Kill();}bridge.Dispose();}
                    File.WriteAllText(Path.Combine(directory,"report.json"),JsonSerializer.Serialize(new {ok=failure==null,before,after,unchanged,elapsed_ms=elapsed.ElapsedMilliseconds,error=failure?.Message,scope="Own non-activating color fixture only. No session creation, authentication or system input."},new JsonSerializerOptions(){WriteIndented=true}));
                    form.Close();if(failure==null)done.TrySetResult();else done.TrySetException(failure);
                }
            };
            Application.Run(form);
        }){IsBackground=true};
        thread.SetApartmentState(ApartmentState.STA);thread.Start();
        await done.Task.WaitAsync(TimeSpan.FromSeconds(25));
        Console.WriteLine("actual WGC cached-window repaint freshness PASSED; own non-activating fixture only; "+directory);
    }
}
