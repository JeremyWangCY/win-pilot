using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;

namespace WinPilotTaskDesktop;

// RunEx's TASK_RUN_USE_SESSION_ID targets the already logged-on child session.
// No password, permanent trigger, service installation, or host input is used.
static class ChildSessionTask
{
    internal static async Task Start(uint session,string configPath,Task authenticatedReady,CancellationToken cancellation,Func<uint,bool> live,Action<string,object?>? stage=null,Action<bool>? cleanupConfirmed=null)
    {
        void Stage(string name,object? detail=null)=>stage?.Invoke(name,detail);
        using var self=WindowsIdentity.GetCurrent();
        string sid=self.User!.Value,executable=Environment.ProcessPath!;
        string name="Win-Pilot-Task-"+Guid.NewGuid().ToString("N");
        var objects=new List<object>();
        dynamic? folder=null,running=null,registeredTask=null;bool registered=false,dispatchAttempted=false;
        T Keep<T>(T value)where T:class{objects.Add(value);return value;}
        void Verify()
        {
            cancellation.ThrowIfCancellationRequested();
            if(File.Exists(Path.Combine(AppContext.BaseDirectory,"safety-hold.json")))throw new InvalidOperationException("启动已被安全拦截。");
            if(session==0)throw new InvalidOperationException("目标子会话编号无效。");
            if(session==(uint)Process.GetCurrentProcess().SessionId)throw new InvalidOperationException("目标子会话与宿主会话相同。");
            // Liveness comes from the host's cached enumeration, so this never blocks
            // the UI thread; a false result means the child session is really gone.
            if(!live(session))throw new InvalidOperationException("目标子会话已消失（会话 "+session+" 不在活动列表中）。");
        }
        try {
            Verify();
            // Gate on a completed logon for this account, not on explorer.exe. The
            // worker is launched through the Task Scheduler, and requiring a shell
            // would wrongly couple startup to a shell that may be suppressed.
            using var logonWait=CancellationTokenSource.CreateLinkedTokenSource(cancellation);
            logonWait.CancelAfter(TimeSpan.FromSeconds(120));
            var deadline=DateTime.UtcNow.AddSeconds(120);bool loggedOn=false;
            do {
                Verify();
                // WTS user queries can block while the session is still initializing,
                // so they stay off the UI thread too.
                if(await Task.Run(()=>ChildSessionQuery.SessionUserSid(session,out string targetSid)&&targetSid==sid,cancellation).WaitAsync(logonWait.Token)){loggedOn=true;break;}
                await Task.Delay(250,logonWait.Token);
            }while(DateTime.UtcNow<deadline);
            if(!loggedOn)throw new InvalidOperationException("独立会话的 Windows 桌面尚未完成登录。");
            Stage("worker_logon_ready",session);
            dynamic service=Keep(Activator.CreateInstance(Type.GetTypeFromProgID("Schedule.Service")!)!);service.Connect();
            folder=Keep((object)service.GetFolder("\\"));dynamic definition=Keep((object)service.NewTask(0));
            dynamic principal=Keep((object)definition.Principal);principal.UserId=sid;principal.LogonType=3;principal.RunLevel=new WindowsPrincipal(self).IsInRole(WindowsBuiltInRole.Administrator)?1:0;
            dynamic settings=Keep((object)definition.Settings);settings.Enabled=true;settings.AllowDemandStart=true;settings.DisallowStartIfOnBatteries=false;settings.StopIfGoingOnBatteries=false;settings.ExecutionTimeLimit="PT0S";
            dynamic actions=Keep((object)definition.Actions);dynamic action=Keep((object)actions.Create(0));
            action.Path=executable;action.Arguments="--worker \""+configPath+"\"";action.WorkingDirectory=AppContext.BaseDirectory;
            Verify();
            dynamic task=Keep((object)folder.RegisterTaskDefinition(name,definition,2,sid,null,3,null));registeredTask=task;registered=true;
            Verify();
            Stage("worker_task_registered",name);
            dispatchAttempted=true;running=Keep((object)task.RunEx(null,4,(int)session,null));
            Stage("worker_task_started",session);
            // Record scheduler execution state, not credentials or task arguments.
            // Successful registration/RunEx can still leave a task queued or fail
            // before the application entry point.
            Stage("worker_task_dispatch",new{state=(int)running.State,engine_pid=(int)running.EnginePID,last_result=(int)task.LastTaskResult});
            // RunEx success alone does not establish the worker's identity. The
            // pipe server verifies its real PID, token session, image and user.
            var readyDeadline=DateTime.UtcNow.AddSeconds(30);
            while(!authenticatedReady.IsCompleted&&DateTime.UtcNow<readyDeadline){
                await Task.WhenAny(authenticatedReady,Task.Delay(1000,cancellation));cancellation.ThrowIfCancellationRequested();
                if(!authenticatedReady.IsCompleted)Stage("worker_task_progress",new{state=(int)running.State,engine_pid=(int)running.EnginePID,last_result=(int)task.LastTaskResult});
            }
            await authenticatedReady.WaitAsync(TimeSpan.FromSeconds(1),cancellation);
            Stage("worker_authenticated",session);
        }finally {
            bool stopped=!dispatchAttempted||authenticatedReady.IsCompletedSuccessfully;
            if(!authenticatedReady.IsCompletedSuccessfully&&running is not null&&registeredTask is not null)try{
                running.Stop();var stopDeadline=DateTime.UtcNow.AddSeconds(3);
                do{dynamic instances=Keep((object)registeredTask.GetInstances(0));if((int)instances.Count==0){stopped=true;break;}await Task.Delay(100);}while(DateTime.UtcNow<stopDeadline);
            }catch{}
            cleanupConfirmed?.Invoke(stopped);Stage("worker_task_cleanup",new{confirmed=stopped});
            if(registered&&folder is not null)try{folder.DeleteTask(name,0);}catch(Exception e){File.WriteAllText(configPath+".task-cleanup-error",name+": "+e.Message);}
            for(int i=objects.Count-1;i>=0;i--)if(Marshal.IsComObject(objects[i]))Marshal.FinalReleaseComObject(objects[i]);
        }
    }
}
