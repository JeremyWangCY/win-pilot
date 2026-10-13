# Win-Pilot 与 ChatGPT Computer Use 的当前差距

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
