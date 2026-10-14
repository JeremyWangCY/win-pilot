# Win-Pilot 与 ChatGPT Computer Use 的当前差距

Current implementation update (2026-10-14): desktop input uses mandatory low-level keyboard/mouse hooks, self-tagged injection, mid-action cancellation and fresh observation before resuming. Hook unavailability refuses input; there is no last-input timestamp mode. The actual input desktop is checked with `OpenInputDesktop`. Settings expose only three boolean preferences. See [input-interruption.md](input-interruption.md) and [settings-panel.md](settings-panel.md) for the current contract. `get_window_state` includes accessibility text by default.

The remaining material is the historical comparison and measurements collected before this update; earlier timestamp/permission settings describe that previous implementation.


更新：2026-09-11。

Win-Pilot 的模型可见桌面接口已采用 ChatGPT Windows Computer Use 名称：`list_apps`、`list_windows`、`get_window`、`launch_app`、`get_window_state`、`click`、`press_key`、`type_text`、`scroll`、`drag`、`set_value`、`perform_secondary_action` 和 `activate_window`。返回的 `window: { id, app }` 可直接复用，元素操作使用 `element_index`。

这解决的是 agent 学习成本，不等于运行时已经与 ChatGPT 原生实现完全等价。下表记录实际差距，避免把接口一致误写成任务成功率一致。

| 维度 | Win-Pilot | ChatGPT Computer Use | 结论 |
| --- | --- | --- | --- |
| 桌面接口 | 同名动作和 `window` 对象可直接复用 | 原生 `sky` 运行时 | 已对齐 |
| 基础能力 | SendInput、UI Automation、Windows.Graphics.Capture / PrintWindow | 同样使用 SendInput、UI Automation、Windows.Graphics.Capture | 技术路线对齐 |
| 遮挡窗口 | WGC 优先，PrintWindow 兜底；失败返回 `screenshot_black` | 原生窗口捕获 | 接近；Win-Pilot 需覆盖更多实际窗口类型 |
| 后台操作 | 默认不抢焦点；没有可验证 UIA 路径即返回 `background_unavailable` | 原生运行时具备更成熟的输入与窗口处理 | Win-Pilot 更保守，复杂 Chromium/自绘控件成功率仍较低 |
| 元素可靠性 | 快照、窗口绑定、元素身份和 `expected_name` 校验；变更后强制重新观察 | 原生运行时的截图和 UIA 工作流 | Win-Pilot 的拒绝策略更显式，但也增加一次观察成本 |
| 浏览器 | AI 独立 profile 的 CDP 语义通道、tab/元素令牌、Shadow DOM、网络证据 | ChatGPT 的 Browser Use / 原生环境能力 | Win-Pilot 在自有 Chromium 会话上更可审计；不操作用户浏览器 |
| 失败恢复 | 超时、断连和已分发动作返回 `unknown`，绝不自动重放 | 原生产品有更成熟的端到端恢复 | Win-Pilot 的语义正确，仍需更多真实应用回归 |
| 性能 | PowerShell 守护进程；截图优先的 `get_window_state` 默认跳过 UIA 树/文本扫描，近期热调用约 413 ms | 原生进程内运行时 | 纯视觉观察路径已缩短；需要 `include_text: true` 的无障碍观察仍偏慢 |
| 产品成熟度 | DSH 插件、单一 `computer` 工具和运行时 skill | 深度集成的 ChatGPT 产品能力 | 是当前最大差距：安装、诊断、可观测性和跨版本兼容仍需持续打磨 |

## 真实判断

Win-Pilot 适合浏览器中的结构化操作、常规 Win32 控件、需要不打断用户的后台任务，以及需要明确证据链的自动化。对于自绘画布、复杂 Chromium 控件、拖拽和高频多步桌面编辑，应预期它比 ChatGPT 原生 Computer Use 更慢、也更常返回可解释的拒绝。

下一阶段优先做两件事：收集真实应用回归样本；为拒绝的自绘控件提供经过验证的前台路径，而不是放宽后台点击校验。截图观察已改为默认跳过 UIA 扫描；只有需要元素索引或文档文本时才请求 `include_text: true`。

## 2026-10-13 更新（三）：用户操作即让路

### 补的能力

Codex 的 Windows 运行时在 `src/input/interruption.rs` 安装**低层键盘/鼠标钩子**（二进制里有 `SetWindowsHookEx`、`"failed to install keyboard hook"`、`"user input was detected in this window; call get_window_state before continuing"`），一旦检测到用户操作就**中止受保护的输入**。Win-Pilot 此前**完全没有**这层能力。

新增 `userActivityGuard`（默认关，按调用传 `user_activity_guard`，接受布尔或秒数）。**没有采用安装钩子**——低层钩子会被杀软/EDR 盯上、需要额外授权路径；改用 `GetLastInputInfo`（系统级"上次真实输入时间"），同样是"你在操作我就退"，但轻得多。

触发时返回 `error_code: 'user_active'`、`action_sent: false`、`retry: 'retry'`、`needs_observation: true`，不发送任何输入。

### 一个必须先验证的前提

这个守卫只有在**Win-Pilot 自己的合成输入不推进该 tick**时才成立，否则它会拦住自己。实测（`test/fixtures/user-activity-probe.ps1`）：

| 输入方式 | 是否推进 tick |
|---|---|
| 后台 PostMessage / SendMessage WM_CHAR、WM_KEYDOWN/UP | **否** |
| 后台 UIA `ValuePattern.SetValue` | **否** |
| 前台 `SendInput` / `keybd_event` | **是**（`keybd_event` 实测推进） |

所以守卫**只在后台 dispatch 生效**，前台模式必须排除——否则会拦自己的输入。这条前提由 fixture 固化，前提被破坏会直接 fail。

### 实测触发证据

| 场景 | 结果 |
|---|---|
| 桌面空闲 407 秒 + 守卫 2 秒 | 不拦（`error_code` 为空） |
| 生成真实输入后 idle=0ms + 守卫 2 秒 | `user_active`、`action_sent=false`、`retry=retry` |
| 同一真实输入 + 守卫 0 | 不拦（可覆盖） |
| 守卫 60 秒 + 观察动作 | 不拦（观察始终可用） |
| `user_activity_guard: true` | 走 2 秒窗口（不是静默关掉） |
| `user_activity_guard: 5`（数值） | 按 5 秒生效 |

变异测试：把 `user_active` 改成别的错误码、去掉"仅后台"限定——两者都会让 `test/user-activity.check.mjs` 失败。

### 仍保留的差距

Win-Pilot 用的是**时间戳轮询**，Codex 用的是**钩子**。差别是：钩子能在输入**发生的那一刻**中止一个已经在进行的动作；轮询只在动作**开始前**判断。对一个动作内部中途发生的用户输入，Win-Pilot 目前的答复是焦点守卫（`focus_changed` + `needs_observation`），而不是中止。完整的中止语义需要把守卫下沉到输入派发循环里，属于后续工作。

## 2026-10-13 更新（二）：焦点策略

### 问题

Win-Pilot 此前会在每次后台动作结束后检查前台窗口是否变化，若变化则**把你刚切过去的窗口压到最底，再用 `AttachThreadInput` + 模拟 ALT/ESC 强行把焦点抢回原窗口**。用户感受到的"抢界面"主要来自这里：它用比原激活更暴力的手段去"纠正"激活，而且当你自己切换窗口时，它会把这个正当操作当成异常并撤销。

### 两家的做法（静态逆向，详见 cua-parity.md）

| | 未授权激活的应对 |
|---|---|
| ZCode CUA | 事前 `prevent_activation` 门 + AX hit-test 坐标点击；`strategy: event` 目标不在前台时**直接拒绝**（`FOREGROUND_REQUIRED`），什么都不发 |
| OpenAI Codex | 事前 `OpenInputDesktop` 等原生检查；输入期间有 **user interruption monitor**，检测到用户操作就**中止并要求重新观察** |

两家都在**防止**或**让路**；Win-Pilot 在**事后反向强抢**。

### 改动

新增 `focusPolicy` 设置（默认 `yield`，也可按调用传 `focus_policy`）：

- **`yield`（默认）**：检测到前台变化时在结果里报告 `focus_changed` / `needs_observation` 并**停止**，不再碰焦点。
- **`restore`**：走新的 `TryRestoreForeground`——只调 `SetForegroundWindow`，**不** attach 线程输入、**不**模拟按键、**不**动 z-order；被 Windows 拒绝就如实报告 `focus_restored: false`。
- **`never`**：完全不观察、不报告。

同时**删除观察路径的强制前台**：`Do-AppState` 不再对目标调 `ForceForeground`（WGC 本就支持遮挡捕获，读 UIA 树也不需要前台）。`activate_window` 与显式 `dispatch: foreground` 的已验证激活路径保持不变。

### 一个被实测否定的方案

原计划调用 `LockSetForegroundWindow` 做事前门。**实测不可行**：该 API 只对**拥有前台窗口的进程**生效，helper 永远在后台，调用返回 `False` 且 `GetLastError=5`（`ERROR_ACCESS_DENIED`）；加锁后实测仍能抢到前台。因此**未采用**，避免留下无效代码。

### 验证

- `test/focus-policy.check.mjs`：默认值为 `yield`；观察路径不含 `ForceForeground`；守卫不含 `ForceForeground`/`PushWindowToBottom`；`focus_policy: never` 不报告变化；按调用覆盖生效；并对真实 helper 跑 `test/fixtures/restore-primitive.ps1`（`TryRestoreForeground` 的 IL 为 94 字节 vs `ForceForeground` 390 字节，对无效句柄返回 `False` 而非强抢）。
- 实测守卫确实触发：动作进行中制造真实前台变化 → `yield` 报 `focus_changed=true`、`needs_observation=true` 且**不争抢**；`never` 完全静默。
- 变异测试确认判别力：把 `ForceForeground` 放回守卫、把 `PushWindowToBottom` 放回守卫、让观察重新强制前台——三者都会让检查失败。

## 2026-10-13 更新

本节记录本轮补齐的项，以及仍然保留的差距。逐能力的静态对照（含 REA 证据 id 与产物摘要）见 [cua-parity.md](./cua-parity.md)。

已补齐：

- **恢复语义**：每个结果新增 `actionSent` 与 `retry`（`never` / `retry` / `reobserve`），与 ZCode 的契约对齐。锁定屏幕、控制器占用、系统键拒绝等一律 `retry: never`；`outcome: unknown` 一律 `actionSent: true` 且要求先重新观察。
- **锁屏保护**：`lockGuard`（默认开）。LogonUI/LockApp/Winlogon/屏保占据前台时，输入动作在派发前返回 `screen_locked`，不发送任何输入；观察与枚举仍然可用。
- **独占控制**：`exclusiveControl`（默认关）。开启后同一时间只有一个存活会话可注入输入，占用方返回 `controller_busy`；租约为 pid 标记文件，持有者已退出时可回收。
- **停止开关**：新增 `stop` 动作，停止后输入动作返回 `control_stopped`，避免中断后的排队调用继续操作。
- **元素全量枚举**：新增 `elements` 动作，返回完整元素表（含被裁剪项），调用方在代码中过滤而不是猜索引。
- **按键**：支持 X keysym 拼写（`KP_0`–`KP_9`、`Numpad_Add`、`Control_L`、`greater`、`question`、`underscore` 等），helper 的 `MapKey` 补齐小键盘与符号虚拟键；新增 `repeat`（单次派发内重复，上限 50）。
- **粘贴**：新增 `paste` 动作（写剪贴板后发送 Ctrl+V），适用于富文本与不接受逐字符输入的目标；粘贴后恢复原剪贴板内容。
- **策略别名**：`strategy: auto|a11y|event` 映射到既有 `dispatch`；`disable_diffing` 返回完整无障碍树而非增量。
- **select_text 消歧**：支持 `prefix` / `suffix`；仍然歧义时返回 `ambiguous_text_match` 并拒绝，而不是选中第一个匹配。
- **用户设置**：注册 `win-pilot` 设置命名空间（热重载）并提供 DSH 设置页卡片。

仍然保留：

- 自绘控件（canvas / 复杂 Chromium 控件）的后台路径成功率仍低于前台；拒绝时返回可解释的错误而不是放宽校验。
- 高频多步桌面编辑仍比原生 Computer Use 慢（PowerShell 守护进程 + 每步观察）。
- 无 `requestAccess` 能力协商：Win-Pilot 依赖宿主自身的权限/审批机制。
- 跨运行时行为等价性未验证；`docs/cua-parity.md` 只记录静态证据，未知项一律标为 unknown。
