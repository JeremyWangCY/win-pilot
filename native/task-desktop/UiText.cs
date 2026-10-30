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
    internal static string PreviewBadge => T("窗口预览", "Window preview");
    internal static string CloseWindow => T("关闭任务窗口", "Close the task window");
    internal static string PinToggle => T("切换置顶", "Toggle always-on-top");
    internal static string ResizeToggle => T("放大任务窗口", "Expand the task window");
    internal static string ResizeCollapse => T("收回悬浮窗", "Collapse the task window");
    internal static string HintResize => T("放大后可接管，空闲 10 秒交还", "Expand to take over · hands back after 10s idle");
    internal static string HintPin => T("置顶 / 取消置顶", "Always on top / normal");
    internal static string HintClose => T("关闭任务窗口", "Close the task window");

    // Window state badge. Every state must be translated: a missing entry would
    // fall through to the raw state key.
    internal static string Badge(string state, bool paused) => state switch
    {
        "running" => T("执行中", "Running"),
        "preparing" => T("等待系统授权", "Waiting for system permission"),
        "awaiting_login" => T("等待登录", "Waiting for sign-in"),
        "pausing" => T("正在暂停", "Pausing"),
        "ready" => paused ? T("已暂停", "Paused") : T("运行就绪", "Ready"),
        "login_settings" => T("首次登录设置", "Sign-in setup needed"),
        "awaiting_windows_login" => T("请登录 Windows", "Sign in to Windows"),
        "connecting" => T("正在连接", "Connecting"),
        "takeover" => T("人工接管", "You have control"),
        "needs_preparation" => T("需要准备", "Preparation needed"),
        "error" => T("连接失败", "Connection failed"),
        "disconnected" => T("已断开", "Disconnected"),
        _ => T("待连接", "Not connected"),
    };

    internal static string NoticeUnavailable(string message) =>
        T("独立桌面不可用\n\n", "Task desktop unavailable\n\n") + message;

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
    {"当前连接不能安全重试执行工具。", "The current connection cannot safely restart the tool."},
            {"Windows 未启动独立桌面启用程序。", "Windows did not start the standalone-desktop enabler."},
        {"Windows 尚未启用独立桌面。", "Windows has not enabled the standalone desktop yet."},
        {"会话启动已被拦截。", "Session startup is blocked by the safety hold."},
        {"启动标记已被安全拦截。", "Startup markers are blocked by the safety hold."},
        {"未完成子会话启动隔离：", "Child-session startup isolation did not complete: "},
        {"子会话已改变，已停止旧执行工具。", "The child session changed; the previous tool was stopped."},
        {"任务桌面连接已断开；没有切换到主桌面。", "The task desktop disconnected; nothing was moved to your main desktop."},
        {"RDP 状态读取失败：", "Cannot read the RDP state: "},
        {"执行工具启动失败：", "The tool failed to start: "},
        {"请在本机登录设置窗口完成首次设置，勾选记住后可自动连接。", "Finish first-time setup in the sign-in window; tick remember to connect automatically."},
        {"已清除无法使用的保存登录，请重新填写 Windows 密码。", "The unusable saved sign-in was cleared; enter your Windows password again."},
        {"独立桌面测试暂时停用：已观察到新会话触发 Windows 修复应用包并关闭主桌面的 ChatGPT。启动隔离修复并验证之前，不再创建或注销会话。", "Standalone-desktop testing is paused: creating a new session was observed to trigger a Windows repair of an app package and close the ChatGPT window on the main desktop. No sessions are created or signed out until startup isolation is fixed and verified."},
        {"Windows 子会话功能尚未启用，请先完成首次设置。", "The Windows child-session feature is not enabled yet; finish first-time setup first."},
        {"首次启用独立桌面，请完成 Windows 的系统授权。", "Enabling the standalone desktop for the first time needs a Windows system authorisation."},
        {"正在建立 Windows 子会话，等待独立执行工具握手…", "Creating the Windows child session; waiting for the tool handshake…"},
        {"Windows 登录先于启动隔离完成，已拒绝继续启动工具。", "Windows sign-in finished before startup isolation; tool startup was refused."},
        {"RDP 已断开，原因 ", "RDP disconnected, reason "},
        {"RDP 控件没有启用子会话连接，已拒绝普通远程连接。", "The RDP control did not enable a child-session connection; a plain remote connection was refused."},
        {"正在使用 Windows 当前登录状态连接；如系统要求登录，请在系统窗口完成。", "Connecting with the current Windows sign-in; if the system asks you to sign in, use the system window."},
        {"任务窗口已停止。", "The task window has stopped."},
        {"任务桌面启动已取消。", "Task-desktop startup was cancelled."},
        {"正在重试任务工具；保留当前 Windows 登录。", "Retrying the task tool; the current Windows sign-in is kept."},
        {"子会话身份校验失败。", "Child-session identity verification failed."},
        {"执行工具用户身份不匹配。", "The tool is running as a different user."},
        {"执行工具不属于已准备的目标子会话。", "The tool does not belong to the prepared target child session."},
        {"执行工具启动已被拦截。", "Tool startup is blocked by the safety hold."},
        {"执行工具未完成启动自检。", "The tool did not complete its startup self-check."},
        {"任务窗口已停止，拒绝执行工具就绪。", "The task window has stopped; tool readiness was refused."},
        {"本次工具启动已经结束，拒绝迟到的就绪消息。", "This tool startup has already ended; a late readiness message was refused."},
        {"执行工具响应过大。", "The tool response was too large."},
        {"子会话执行工具已断开。", "The child-session tool disconnected."},
        {"停止执行工具未获确认。", "Stopping the tool was not confirmed."},
        {"本次连接未取得可验证的会话归属；仅断开本窗口，没有注销其他会话。", "This connection did not establish verifiable session ownership; only this window was disconnected, no other session was signed out."},
        {"无法枚举会话以确认归属：", "Cannot enumerate sessions to confirm ownership: "},
        {"安全拦截生效，未注销本次会话。", "The safety hold is active; this session was not signed out."},
        {"Windows 父子会话关联或用户身份已改变，未执行注销。", "The Windows parent/child session link or user identity changed; no sign-out was performed."},
        {"子会话注销尚未确认；未自动重试。", "Child-session sign-out is unconfirmed; it was not retried automatically."},
        {"会话清理未获确认：", "Session cleanup was not confirmed: "},
        {"未取得可验证的会话归属；没有自动注销会话。", "No verifiable session ownership was established; no session was signed out automatically."},
        {"独立桌面启动安全拦截生效，未启动任何程序。", "The standalone-desktop startup safety hold is active; no program was launched."},
        {"执行程序被 Windows 启动到了宿主会话，已拒绝启动操控工具。", "Windows launched the executable into the host session; the control tool was refused."},
        {"任务桌面宿主用户不匹配。", "The task-desktop host user does not match."},
        {"任务桌面宿主未确认启动授权。", "The task-desktop host did not confirm startup authorisation."},
        {"独立桌面启动安全拦截生效。", "The standalone-desktop startup safety hold is active."},

        {"请输入 Windows 账号。", "Enter your Windows account."},
        {"账号格式应为 域\\用户名 或邮箱。", "The account must be DOMAIN\\user or an email address."},
        {"Windows 未接受该登录信息，请检查账号密码（不是 PIN）。", "Windows rejected these credentials; check the password (not the PIN)."},
        {"请使用当前 Windows 用户的账号，不能连接其他用户的桌面。", "Use the current Windows user's account; another user's desktop cannot be connected."},
        {"无法确认当前 Windows 用户。", "Cannot confirm the current Windows user."},
        {"登录信息长度不受支持。", "These credentials have an unsupported length."},
        {"登录信息超过 Windows 保存限制。", "These credentials exceed the Windows storage limit."},
        {"Windows 无法保存 Win-Pilot 登录信息。", "Windows cannot save the Win-Pilot sign-in."},
        {"无法读取 Win-Pilot 登录设置，请在「登录设置」重新设置或清除。", "Cannot read the Win-Pilot sign-in; set it again or clear it in Sign-in settings."},
        {"无法清除 Win-Pilot 登录设置。", "Cannot clear the Win-Pilot sign-in."},
        {"Win-Pilot 保存的登录信息无法使用，请在「登录设置」重新设置或清除。", "The saved Win-Pilot sign-in is unusable; set it again or clear it in Sign-in settings."},
        {"Windows 无法保护或恢复 Win-Pilot 登录信息，请重新设置。", "Windows cannot protect or recover the Win-Pilot sign-in; set it again."},
        {"Windows 子会话凭据配置未生效。", "The Windows child-session credential configuration did not take effect."},
        {"Windows 自动登录配置未生效。", "The Windows automatic sign-in configuration did not take effect."},
        {"观察到多个候选子会话，已拒绝猜测。", "Several candidate child sessions were seen; refusing to guess."},
        {"新会话与 Windows 父子会话关联尚未一致，未取得目标归属。", "The new session and the Windows parent/child link do not agree yet; no target ownership was obtained."},
        {"尚未观察到本次新建的子会话。", "The newly created child session has not been observed yet."},
        {"无法枚举 Windows 会话：", "Cannot enumerate Windows sessions: "},
        {"独立桌面执行工具启动自检失败：", "The standalone-desktop tool failed its startup self-check: "},
        {"Windows 已登录，但独立输入桌面在启动预算内尚未就绪；未发送任何输入。", "Windows has signed in, but the standalone input desktop was not ready within the startup budget; no input was sent."},
        {"独立桌面执行工具已退出，未返回当前请求的响应。", "The standalone-desktop tool exited without returning a response to this request."},
        {"进程缺少用户身份。", "The process has no user identity."},
        {"执行进程身份或所属会话不匹配。", "The tool process identity or its session does not match."},
        {"执行工具管道进程身份不匹配。", "The tool pipe process identity does not match."},
        {"任务桌面宿主管道身份不匹配。", "The task-desktop host pipe identity does not match."},
        {"无法映射远程按键。", "Cannot map this remote key."},
        {"启动已被安全拦截。", "Startup is blocked by the safety hold."},
        {"目标子会话编号无效。", "The target child-session id is invalid."},
        {"目标子会话与宿主会话相同。", "The target child session is the same as the host session."},
        {"目标子会话已消失（会话 ", "The target child session disappeared (session "},
        {" 不在活动列表中）。", " is not in the active list)."},
        {"独立会话的 Windows 桌面尚未完成登录。", "The standalone session's Windows desktop has not finished signing in."},
        {"拒绝标记主桌面或无效会话。", "Refusing to mark the main desktop or an invalid session."},
        {"目标子会话已改变，未继续标记。", "The target child session changed; marking was not continued."},
        {"无效的会话启动标记。", "Invalid session startup marker."},
        {"Windows 会话启动信息尚未准备好。", "The Windows session startup information is not ready yet."},
        {"\n\n已清除无法使用的保存登录，请重新填写 Windows 密码。", "\n\nThe unusable saved sign-in was cleared; enter your Windows password again."},
        {"\n\n保存的登录信息也无法清除：", "\n\nThe saved sign-in could not be cleared either: "},
        {"\n\n已取消重新设置，未创建 Windows 会话。", "\n\nRe-setup was cancelled; no Windows session was created."},
        {"当前窗口已有连接，请使用「重试工具」或结束后重新连接。", "This window already has a connection; use retry tool or reconnect after ending it."},
        {"启动隔离时序未验证成功，已停止任务。", "Startup-isolation timing was not verified; the task was stopped."},
        {"；需要检查本机子会话和 Windows 登录条件。", "; check the local child-session and Windows sign-in conditions."},
    };

    // Some messages splice a value into the middle, e.g. ("session " + id + " is not
    // in the active list"). A single match cannot translate those, so every mapped
    // fragment is replaced wherever it appears and the spliced value passes through.
    internal static string Failure(string message)
    {
        if (Chinese) return message;
        var result = message;
        foreach (var pair in FailureEnglish.OrderByDescending(pair => pair.Key.Length))
        {
            if (result.Contains(pair.Key, StringComparison.Ordinal))
                result = result.Replace(pair.Key, pair.Value, StringComparison.Ordinal);
        }
        return result;
    }
}
