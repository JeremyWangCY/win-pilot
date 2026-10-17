using System.Text.Json.Nodes;

namespace WinPilotTaskDesktop;

static class DesktopReadiness
{
    internal static async Task WaitAsync(Func<Task<JsonObject>> probe,CancellationToken cancellation=default)
    {
        using var budget=CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        budget.CancelAfter(TimeSpan.FromSeconds(20));
        try {
            while(true) {
                budget.Token.ThrowIfCancellationRequested();
                var health=await probe().WaitAsync(budget.Token);
                if(health["ok"]?.GetValue<bool>()!=true)throw new IOException("独立桌面执行工具启动自检失败："+health["message"]?.ToString());
                if(health["input_desktop_ready"]?.GetValue<bool>()==true)return;
                await Task.Delay(100,budget.Token);
            }
        }catch(OperationCanceledException)when(!cancellation.IsCancellationRequested){throw new IOException("Windows 已登录，但独立输入桌面在启动预算内尚未就绪；未发送任何输入。");}
    }
}
