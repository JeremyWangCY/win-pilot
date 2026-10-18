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
}
