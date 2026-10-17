# Task desktop / 独立任务桌面

DeepSeek Harness 0.2.0-rc.2+ is the primary integration. In Settings → Win-Pilot, save the computer environment, then start a new task. Updating an already-loaded plugin requires restarting the host before newly added fields can be saved. Existing tasks retain their original desktop and observed targets.

默认关闭。在 DeepSeek Harness 设置 → Win-Pilot 中选择电脑操作环境并保存，再开始新任务。更新已加载的插件后需重启宿主，使新增字段的前后端定义一致；旧任务保持原桌面与已观察目标。

| Setting / 设置 | Behavior / 行为 |
|---|---|
| Current / 当前桌面 | Background-first; model schemas, skills and diagnostics do not advertise an alternate desktop. 后台优先，不向 AI 提供独立桌面选项。 |
| Task / 独立任务桌面 | All native actions, clipboard, observation and recovery use the owned child session. Failure does not fall back to the main desktop. 操作及观察绑定同一子会话，失败不转到主桌面。 |

The compact light window has no native caption. Expand to interact directly. Before manual input is delivered, the worker confirms AI input has stopped. After 10 seconds without input and without a held key/button, the AI can resume. Pin changes always-on-top; close ends only the owned task session. Right-click the toolbar for local sign-in settings.

浅色小窗去掉原生标题栏。放大后直接操作；首次手动输入会等待 AI 停止确认。空闲10秒且没有按住鼠标或按键后，AI 可继续。置顶按钮切换置顶，关闭只清理本窗口拥有的任务会话。右键工具栏可进入本机登录设置。

Windows feature setup may require one UAC authorization. Optional remembered sign-in uses current-user DPAPI and an application-owned Credential Manager entry. Passwords are entered only in the local dialog and do not pass through model messages. Changed Windows users, passwords or policy can require setup again. .NET 8 Windows Desktop Runtime and supported Windows child sessions are required.

首次 Windows 功能准备可能需要一次系统授权。可选记住登录使用当前用户 DPAPI 和应用专用凭据条目，密码不进入模型消息；更换用户、密码或策略后可能需重新设置。需要 .NET 8 Windows Desktop Runtime 与 Windows 子会话支持。

Verification includes pure protocol/routing tests, real DSH Config/volatile integration, production-form layout checks, and explicit authorized live child-session fixture tests. Unit tests do not prove every Windows policy, DPI or monitor layout. No claim is made that every startup application is suppressed or that remembered sign-in was verified after a reboot. Other applications can occupy the single Windows child-session facility.

验证包括协议/路由测试、真实 DSH Config 与动态引用集成、生产窗体检查和授权本机子会话实测。单元测试不代表覆盖所有系统策略、DPI 和多显示器布局；没有宣称禁止全部启动应用，也没有把跨进程记住登录写成已通过重启验证。其他应用可能占用 Windows 子会话。
