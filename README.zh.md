# win-pilot

[English](./README.md) | 中文

![License](https://img.shields.io/badge/license-MIT-blue) ![Platform](https://img.shields.io/badge/platform-Windows-0078D4) ![Node](https://img.shields.io/badge/node-%3E%3D22.12-339933)

Win-Pilot 是面向 Windows Computer Use 的 Agent Plugin。它通过同一个 `computer` 工具操作桌面应用和隔离 Chromium 会话，并让插件、MCP、CLI、Skill 与原生宿主 Adapter 共用完全一致的动作、恢复规则和返回结果。

## 功能

| 功能 | 具体行为 |
|---|---|
| Agent Plugin 包 | `.codex-plugin/plugin.json` 同时携带 MCP Server 与操作 Skill |
| Windows 原生操控 | UI Automation、Win32 输入/窗口管理和按窗口截图 |
| 后台优先 | 受支持的截图与输入路径尽量避免抢占焦点 |
| 隔离浏览器控制 | 启动 Edge 会话并使用与 CDP 页面绑定的目标和令牌 |
| 可恢复协议 | 统一 `ok`、`outcome`、`error_code`、动作后观察与未知结果处理 |
| 通用后备入口 | 支持工具的 Agent 使用 stdio MCP；仅支持 shell 的 Agent 使用 JSON CLI + Skill |
| Schema 可移植性 | 工具 Schema 持续验证 OpenAI 与 Gemini 系列消费者 |

## 环境要求

- Windows 10/11 x64
- Node.js 22.12 或更高版本
- Windows PowerShell 5.1
- 可选 .NET 8 Runtime，用于 WGC 截图
- 支持 Agent Plugin、stdio MCP 或 shell 的 Agent

## 快速开始

### 让 Agent 安装（推荐）

把下面这句话发送给 Windows 机器上的 Agent：

```text
请按照 https://raw.githubusercontent.com/JeremyWangCY/win-pilot/main/AGENT_INSTALL.md 安装并验证 Win-Pilot。
```

Agent 会优先安装完整插件；只有宿主不支持插件时，才回退到 MCP 或 CLI。

### 手动安装

支持插件的宿主可以安装 `JeremyWangCY/win-pilot`。插件包已经包含 `.mcp.json` 和 `skills/win-pilot`。

其他宿主使用：

```powershell
npm install -g win-pilot@latest
win-pilot doctor --probe
```

再通过宿主的插件/工具设置注册本地 MCP Server：

```json
{
  "mcpServers": {
    "win-pilot": { "command": "win-pilot", "args": ["mcp"] }
  }
}
```

已知宿主提供便捷安装器，其他 Agent 仍可使用通用模式：

```powershell
win-pilot install --agent codex
win-pilot install --agent claude
win-pilot install --agent qoder
win-pilot install --agent pi
win-pilot install --agent dsh
win-pilot install --agent mcp
win-pilot install --agent cli
```

验证：

```powershell
win-pilot --version
win-pilot status --json
win-pilot doctor --probe --json
```

预期版本为 `0.1.1`、平台为 `win32`，doctor 的必要检查全部为 `ok`。

### 更新

先结束正在进行的界面任务，再更新 runtime，并重启或重新加载宿主的插件/MCP 进程：

```powershell
npm install -g win-pilot@latest
win-pilot doctor --probe
```

DSH profile 需要单独重启。需要刷新 Win-Pilot 管理的 Skill 副本时重新运行 `win-pilot install`；用户自行维护的自定义 Skill 不会在后台更新。

### 沙箱 Agent

如果沙箱会在每条命令结束后回收子进程，应由宿主的常驻插件或 MCP supervisor 启动 `win-pilot mcp`，不要从一次性命令中强行脱离进程。仅支持 shell 的 Agent 可以调用一次性的 `win-pilot request`。

## 使用方法

插件和 MCP 宿主会获得 `computer` 工具。仅支持 shell 的宿主使用相同的 JSON 接口：

```powershell
win-pilot request --payload '{"action":"list_apps"}' --json
win-pilot request --payload '{"action":"get_window_state","hwnd":12345,"include_text":true}' --json
win-pilot request --payload '{"action":"click","hwnd":12345,"element_index":7,"snapshot_id":"<snapshot>"}' --json
```

| 类别 | 动作 | 主要输入 |
|---|---|---|
| 发现 | `list_apps`、`list_windows`、`get_app_identity` | `app`、`hwnd` |
| 观察 | `get_window_state`、`get_window`、`screenshot` | `include_text`、`include_screenshot` |
| 指针 | `click`、`double_click`、`mouse_move`、`drag`、`scroll` | `x`、`y`、`element_index`、`snapshot_id` |
| 键盘 | `type_text`、`press_key`、`hold_key`、`set_value` | `text`、`key`、`keys`、`duration_ms` |
| 窗口 | `launch_app`、`activate_window`、`minimize_window`、`close_window` | `name`、`hwnd`、`foreground` |
| 浏览器 | `browser_state`、`browser_observe`、`browser_open`、`browser_click`、`browser_click_text`、`browser_click_point`、`browser_type`、`browser_replace`、`browser_key`、`browser_upload` | `browser`、`tab_id`、`browser_element`、`screenshot_id`、`url` |
| 顺序执行 | `wait`、批量 `actions` | `seconds`、`when`、`expect` |

MCP `tools/list` 返回的实时 Schema 是完整参数和默认值的权威定义。

## 工作原理

```text
Windows Agent
  ├─ Agent Plugin ─┐
  ├─ stdio MCP ────┼─> Win-Pilot runtime ─> PowerShell helper ─> UIA / Win32 / WGC
  ├─ CLI + Skill ──┤          └────────────> CDP provider ─────> 隔离 Edge
  └─ 原生 Adapter ─┘
```

Runtime 是深模块，负责动作语义和返回结果。Adapter 只注册和渲染接口，因此一次修复可以覆盖所有宿主。

## 安全与隐私

Win-Pilot 以当前 Windows 用户权限运行，不包含遥测，也不会上传截图。浏览器导航会按任务要求产生正常网络请求。安装插件不会绕过宿主审批、沙箱规则或任务授权。

## 故障排查

| 现象 | 常见原因 | 处理方法 |
|---|---|---|
| 找不到 `computer` | 会话启动后才安装插件/MCP | 重启 Agent 或重新加载 MCP Server |
| MCP 立即退出 | 从一次性沙箱命令启动 | 改由常驻宿主 supervisor 管理 |
| `browser_endpoint required` | 没有自有浏览器会话 | 先以 `headless: true` 启动 Edge |
| 令牌过期 | 目标状态变化或令牌到期 | 重新观察同一目标 |
| doctor 失败 | runtime 条件缺失 | 查看 `win-pilot doctor --probe --json` |

当前兼容构建的诊断文件仍位于 `%TEMP%\win-pilot-diag.log`。

## 开发

```powershell
git clone https://github.com/JeremyWangCY/win-pilot.git
cd win-pilot
npm test
npm pack --dry-run
```

测试覆盖 CLI 公开协议、MCP 发现/调用、插件清单、安装计划，以及自有 Windows/浏览器 fixture。

## 许可证

[MIT](./LICENSE)
