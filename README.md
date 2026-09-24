# win-pilot

English | [中文](./README.zh.md)

![License](https://img.shields.io/badge/license-MIT-blue) ![Platform](https://img.shields.io/badge/platform-Windows-0078D4) ![Node](https://img.shields.io/badge/node-%3E%3D22.12-339933)

Win-Pilot is an Agent Plugin for Windows Computer Use. It gives Windows agents one consistent `computer` tool for desktop applications and isolated Chromium sessions, with the same actions, recovery rules, and results across plugin, MCP, CLI, skill, and native-host integrations.

## Features

| Feature | Concrete behavior |
|---|---|
| Agent Plugin package | `.codex-plugin/plugin.json` bundles the MCP server and operating skill |
| Native Windows control | UI Automation, Win32 input/window management, and window-scoped screenshots |
| Background-first actions | Supported capture and input paths avoid unnecessary focus stealing |
| Isolated browser control | Launches Edge sessions and controls them through CDP-bound targets and tokens |
| Recoverable protocol | Stable `ok`, `outcome`, `error_code`, post-action observations, and unknown-outcome handling |
| Universal fallbacks | Local stdio MCP for tool-aware agents; JSON CLI plus skill for shell-capable agents |
| Schema portability | Tool schema is validated for OpenAI- and Gemini-family consumers |
| DSH provider lifecycle | On DSH 0.1.7+, claims the exclusive `computerUse` provider slot; older DSH keeps the legacy tool-only path |

## Requirements

- Windows 10/11 x64
- Node.js 22.12 or newer
- Windows PowerShell 5.1
- Optional .NET 8 runtime for WGC capture
- An Agent Plugin host, stdio MCP client, or shell-capable agent

## Quick Start

### Install with your Agent (recommended)

Send this single instruction to an agent on the Windows machine:

```text
Install and verify Win-Pilot by following https://raw.githubusercontent.com/JeremyWangCY/win-pilot/main/AGENT_INSTALL.md
```

The agent will prefer the complete plugin, then fall back to MCP or CLI only when its host lacks plugin support.

### Manual installation

Plugin-capable hosts can install `JeremyWangCY/win-pilot`. The package contains both `.mcp.json` and `skills/win-pilot`.

For other hosts:

```powershell
npm install -g win-pilot@latest
win-pilot doctor --probe
```

Register this local MCP server through the host's normal plugin/tool settings:

```json
{
  "mcpServers": {
    "win-pilot": { "command": "win-pilot", "args": ["mcp"] }
  }
}
```

Convenience installers are provided for known hosts, while generic modes remain available for every other agent:

```powershell
win-pilot install --agent codex
win-pilot install --agent claude
win-pilot install --agent qoder
win-pilot install --agent pi
win-pilot install --agent dsh
win-pilot install --agent mcp
win-pilot install --agent cli
```

Verify with:

```powershell
win-pilot --version
win-pilot status --json
win-pilot doctor --probe --json
```

Expected: version `0.1.4`, platform `win32`, and every required doctor check marked `ok`.

### Updating

Finish active UI tasks, update the runtime, and restart or reload the host's plugin/MCP process:

```powershell
npm install -g win-pilot@latest
win-pilot doctor --probe
```

DSH profiles must be restarted separately. Re-run `win-pilot install` when you want its managed skill copy refreshed; user-maintained custom skills are not updated in the background.

### Sandboxed agents

When a sandbox reaps children after every command, configure `win-pilot mcp` in the host's persistent plugin or MCP supervisor. Do not detach a process from an ephemeral command. Shell-only agents can use one-shot `win-pilot request` calls.

## Usage

MCP and plugin hosts expose `computer`. Shell-only hosts use the identical JSON interface:

```powershell
win-pilot request --payload '{"action":"list_apps"}' --json
win-pilot request --payload '{"action":"get_window_state","hwnd":12345,"include_text":true}' --json
win-pilot request --payload '{"action":"click","hwnd":12345,"element_index":7,"snapshot_id":"<snapshot>"}' --json
```

| Family | Actions | Main inputs |
|---|---|---|
| Discovery | `list_apps`, `list_windows`, `get_app_identity` | `app`, `hwnd` |
| Observation | `get_window_state`, `get_window`, `screenshot` | `include_text`, `include_screenshot` |
| Pointer | `click`, `double_click`, `mouse_move`, `drag`, `scroll` | `x`, `y`, `element_index`, `snapshot_id` |
| Keyboard | `type_text`, `press_key`, `hold_key`, `set_value` | `text`, `key`, `keys`, `duration_ms` |
| Windows | `launch_app`, `activate_window`, `minimize_window`, `close_window` | `name`, `hwnd`, `foreground` |
| Browser | `browser_state`, `browser_observe`, `browser_open`, `browser_click`, `browser_click_text`, `browser_click_point`, `browser_type`, `browser_replace`, `browser_key`, `browser_upload` | `browser`, `tab_id`, `browser_element`, `screenshot_id`, `url` |
| Sequencing | `wait`, batched `actions` | `seconds`, `when`, `expect` |

The live MCP `tools/list` result is authoritative for the complete parameter schema and defaults.

## How it works

```text
Windows Agent
  ├─ Agent Plugin ─┐
  ├─ stdio MCP ────┼─> Win-Pilot runtime ─> PowerShell helper ─> UIA / Win32 / WGC
  ├─ CLI + Skill ──┤          └────────────> CDP provider ─────> isolated Edge
  └─ Native Adapter┘
```

The runtime is the deep module: it owns action semantics and results. Adapters only register and render its interface, so fixes remain local and every host receives the same behavior.

## Security and privacy

Win-Pilot runs with the Windows user's permissions. It contains no telemetry and does not upload screenshots. Browser navigation makes ordinary network requests to requested sites. Installing the plugin does not bypass host approvals, sandbox rules, or task authorization.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `computer` is absent | Plugin/MCP added after session start | Restart the agent or reload MCP servers |
| MCP exits immediately | Started inside an ephemeral sandbox command | Move it to the persistent host supervisor |
| `browser_endpoint required` | No owned browser exists | Launch Edge with `headless: true` first |
| Token is stale | Target state changed or token expired | Observe the same target again |
| Doctor fails | Runtime prerequisite missing | Inspect `win-pilot doctor --probe --json` |
| `computer use provider ... already registered` | Another DSH computer-use provider is enabled | Keep only one desktop provider enabled |

Compatibility-build diagnostics currently use `%TEMP%\win-pilot-diag.log`.

## Development

```powershell
git clone https://github.com/JeremyWangCY/win-pilot.git
cd win-pilot
npm test
npm pack --dry-run
```

Tests exercise the public CLI protocol, MCP discovery/calls, plugin manifest, installation plans, and owned Windows/browser fixtures.

## License

[MIT](./LICENSE)
