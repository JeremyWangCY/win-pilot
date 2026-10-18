// The native window has no locale seat from the harness, so it follows the
// Windows display language: Chinese locales get Chinese, everything else gets
// English. Strings live here rather than inline so a surface cannot ship with a
// half-translated state machine, which is what happened when each label was
// written in place.
using System.Globalization;

static class UiText
{
    // A display language can be set per user; CurrentUICulture tracks it.
    internal static readonly bool Chinese =
        CultureInfo.CurrentUICulture.TwoLetterISOLanguageName.Equals("zh", StringComparison.OrdinalIgnoreCase);

    static string T(string zh, string en) => Chinese ? zh : en;

    internal static string WindowTitle => T("Win-Pilot · 任务桌面", "Win-Pilot · Task desktop");
    internal static string MenuLoginSettings => T("登录设置…", "Sign-in settings…");
    internal static string PreviewCanvas => T("任务画面", "Task view");
    internal static string WaitConnecting => T("等待连接…", "Waiting to connect…");
    internal static string PreviewBadge => T("○ 窗口预览", "○ Window preview");
    internal static string CloseWindow => T("关闭任务窗口", "Close the task window");
    internal static string PinToggle => T("切换置顶", "Toggle always-on-top");
    internal static string ResizeToggle => T("放大任务窗口", "Expand the task window");
    internal static string ResizeCollapse => T("收回悬浮窗", "Collapse the task window");
    internal static string HintResize => T("放大 / 收回 · 放大后可直接操作，空闲10秒交还 AI", "Expand / collapse · when expanded you can operate it; it hands back to the AI after 10 idle seconds");
    internal static string HintPin => T("置顶 / 取消置顶", "Always on top / normal");
    internal static string HintClose => T("关闭任务窗口", "Close the task window");

    // Window state badge. Every state must be translated: a missing entry would
    // fall through to the raw state key.
    internal static string Badge(string state, bool paused) => state switch
    {
        "ready" => paused ? T("● 已暂停", "● Paused") : T("● 运行就绪", "● Ready"),
        "login_settings" => T("● 首次登录设置", "● Sign-in setup needed"),
        "awaiting_windows_login" => T("● 请登录 Windows", "● Sign in to Windows"),
        "connecting" => T("● 正在连接", "● Connecting"),
        "takeover" => T("● 人工接管", "● You have control"),
        "needs_preparation" => T("● 需要准备", "● Preparation needed"),
        "error" => T("● 连接失败", "● Connection failed"),
        "disconnected" => T("● 已断开", "● Disconnected"),
        _ => T("● 待连接", "● Not connected"),
    };

    internal static string NoticeUnavailable(string message) =>
        T("暂时无法连接独立桌面\n\n", "The separate desktop is not available yet\n\n") + message +
        T("\n\n不会切换到你的主桌面执行操作。", "\n\nNothing will be run on your main desktop instead.");

    internal static string TaskDesktopTitle => T("Win-Pilot · 独立桌面登录设置", "Win-Pilot · Task desktop sign-in");
    internal static string LoginHeading => T("首次设置 Windows 登录信息", "Set up Windows sign-in");
    internal static string LoginIntro => T(
        "请填写当前 Windows 用户的密码（不是 PIN）。勾选记住后，\nWin-Pilot 会使用 Windows 加密保存，后续自动取回登录。",
        "Enter the password for the current Windows user (not the PIN).\nIf you keep it, Win-Pilot stores it with Windows encryption and reuses it.");
    internal static string AccountLabel => T("Windows 账号（域\\用户名 或邮箱）", "Windows account (DOMAIN\\user or email)");
    internal static string PasswordLabel => T("Windows 密码", "Windows password");
    internal static string RememberLogin => T("在本机记住登录，后续自动连接", "Remember sign-in on this machine");
    internal static string ValidateAndSave => T("验证并保存", "Verify and save");
    internal static string ClearSaved => T("清除已保存登录", "Clear saved sign-in");
    internal static string Cancel => T("取消", "Cancel");
    internal static string Verifying => T("正在验证 Windows 登录…", "Verifying Windows sign-in…");
    internal static string SavedLoginHint => T("已保存登录信息；输入新密码可更新，也可清除。", "Saved sign-in found. Enter a new password to update it, or clear it.");
    internal static string SavedLoginUnavailable => T("保存的登录信息暂时不可用，可重新设置或清除。", "The saved sign-in is unavailable; set it again or clear it.");
    internal static string ClearedLogin => T("已清除保存的登录信息。", "Saved sign-in cleared.");

    internal static string StatusPill => T("Win-Pilot 运行中", "Win-Pilot running");

    // Failure messages travel to the caller as JSON message and are shown to the
    // user by the JS layer, so they need the same treatment as labels. Keyed by the
    // Chinese source string: the call sites stay readable, and a missing key simply
    // falls through to the original text rather than throwing.
    static readonly System.Collections.Generic.Dictionary<string,string> FailureEnglish = new()
    {
    {"执行工具正在结束，拒绝新操作。", "The tool is shutting down; new operations are refused."},
    {"目标子会话已改变。", "The target child session changed."},
    {"执行工具未就绪、已断开或启动已被拦截。", "The tool is not ready, has disconnected, or startup is blocked."},
    {"任务窗口已停止连接，请重新打开窗口。", "The task window stopped connecting; reopen the window."},
    {"执行工具返回无效结果。", "The tool returned an invalid result."},
    {"缺少任务桌面执行工具。", "The task-desktop tool is missing."},
    {"当前窗口仅供预览，不执行电脑动作。", "This window is preview-only; no computer action is executed."},
    {"不支持的窗口命令。", "Unsupported window command."},
    {"无法确认独立执行工具已停止。", "Cannot confirm the task-desktop tool has stopped."},
    {"当前窗口已有连接，请使用「重试工具」或结束后重新连接。", "This window already has a connection. Use \"retry tool\" or reconnect after ending it."},
    {"执行工具正在连接。", "The tool is connecting."},
    {"无法枚举 Windows 会话，未建立连接：", "Cannot enumerate Windows sessions; no connection was made: "},
    {"任务桌面已暂停或断开，未执行操作。", "The task desktop is paused or disconnected; nothing was executed."},
    {"独立桌面启动已被拦截。", "Task-desktop startup is blocked by the safety hold."},
    {"任务窗口正在结束，拒绝新操作。", "The task window is closing; new operations are refused."},
    {"无法读取 Windows 子会话配置，错误 ", "Cannot read the Windows child-session configuration, error "},
    {"已取消首次登录设置，未创建 Windows 会话。", "First-time sign-in was cancelled; no Windows session was created."},
    {"控制状态已改变，请重新观察。", "Control state changed; observe again."},
    {"手动操作或控制状态已改变，未交还 AI。", "Manual input or the control state changed; not handed back to the AI."},
    {"原独立桌面执行工具已退出。", "The original task-desktop tool has exited."},
    {"停止执行工具未获确认：", "Stopping the tool was not confirmed: "},
    {"已有活动子会话，请结束现有会话后连接。", "An active child session exists; end it before connecting."},
    {"任务已暂停。", "The task is paused."},
    {"任务窗口正在结束，拒绝恢复操作。", "The task window is closing; restore refused."},
    {"独立桌面操作已被安全拦截。", "Task-desktop operations are blocked by the safety hold."},
    {"连接已取消，未创建 Windows 会话。", "Connection cancelled; no Windows session was created."},
    {"窗口不属于独立任务桌面。", "That window does not belong to the task desktop."},
    {"独立执行工具尚未就绪。", "The task-desktop tool is not ready yet."},
    {"任务桌面正在连接，请稍后观察状态。", "The task desktop is connecting; check its state shortly."},
    {"当前窗口仅供预览，不建立 Windows 会话。", "This window is preview-only; no Windows session is created."},
    {"当前连接不能安全重试执行工具。", "The current connection cannot safely restart the tool."}
    };

    internal static string Failure(string message)
    {
        if (Chinese) return message;
        foreach (var pair in FailureEnglish)
            if (message.StartsWith(pair.Key, StringComparison.Ordinal))
                return pair.Value + message[pair.Key.Length..];
        return message;
    }
}
