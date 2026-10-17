# win-pilot

English | [中文](./README.zh.md)

![License](https://img.shields.io/badge/license-MIT-blue) ![Platform](https://img.shields.io/badge/platform-Windows-0078D4) ![Node](https://img.shields.io/badge/node-%3E%3D22.12-339933)

Win-Pilot provides Windows computer use with DeepSeek Harness as its primary integration. Its `computer` tool operates in the current desktop or an optional separate Windows task session, with a compact visible window for pause and manual takeover. Plugin, MCP, CLI and native integrations share the same runtime.

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
| DSH provider lifecycle | Requires DSH 0.2.0-rc.2+ for Config forms; claims the exclusive `computerUse` provider slot |
| Optional task desktop | Windows child session with a compact 432×300 frameless window and automatic manual takeover |

## Requirements

- Windows 10/11 x64
- Node.js 22.12 or newer
- Windows PowerShell 5.1
- Optional .NET 8 runtime for WGC capture
- .NET 8 Windows Desktop Runtime for the optional task desktop
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

Expected for this release: version `0.2.0`, platform `win32`, and every required doctor check marked `ok`. Doctor checks installed prerequisites; a successful connection is required to verify a task session.

### Settings

In DeepSeek Harness **0.2.0-rc.2 or later**, open **Settings → Win-Pilot** or the plugin detail page. The host projects the plugin's `Config`. Display preferences apply immediately; the desktop environment applies to new tasks.

| Preference | Default | Effect |
|---|---|---|
| `overlay` | `true` | Show the operation cursor |
| `statusPill` | `true` | Show the running status pill |
| `browserHeadlessDefault` | `false` | Run browsers without a visible window |

`desktopEnvironment` defaults to `current`; `task` selects the separate task window. Save the setting and start a new task. Existing tasks keep their original desktop so observed targets cannot silently change. With the option off, model schemas, runtime skills and diagnostics do not advertise the task-desktop option. With it on, native actions, observations, clipboard and recovery stay in that task desktop; failure never redirects work to the main desktop. Browser actions require a browser launched by the same task.

The light, frameless window defaults to 432×300. Its toolbar contains expand/restore, pin and close. In the expanded view, click, drag or type to take over: AI input stops before your first gesture is delivered. After 10 seconds without manual input, control returns to the AI; a held button or key prevents that return. The compact view is read-only. Right-click the toolbar for local sign-in settings. Complete Windows feature setup and local sign-in once; optionally remember credentials using the current Windows user's DPAPI and Credential Manager. Passwords stay in the local dialog. This mode requires .NET 8 Windows Desktop Runtime and working Windows child-session support. A Windows user change, credential change or system policy may require setup again; it is not a virtual machine.

After updating an already-loaded plugin, restart DeepSeek Harness before saving new settings. See [task desktop](./docs/task-desktop.md) for behavior and verification limits.

Use `win-pilot desktop --preview` to view the native window without creating a session or running computer actions. `win-pilot desktop` is the normal connection entry and respects the connection hold. Source builds use `npm run build:desktop`; checks without Windows sessions use `npm run test:desktop`. These additions have not been published to npm or GitHub.

Numeric limits and input policy use internal defaults; old settings cannot change them. Required Windows/Meta system keys stay enabled internally. Confirmed Codex behavior guides background input, lock checks, user-interruption cancellation, focus yielding, and window text reads. CLI/MCP installs without a harness use the built-in defaults.

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

Version 0.2.0 adds session-scoped `stop` / `resume`, queued and active request cancellation, and atomic per-user control ownership. Observation remains available after stopping. Desktop accessibility uses stable sparse indexes and model-visible `full` / `delta` / `no_change` trees; hidden observations do not advance that baseline. Rich `paste` accepts `format: text | html | md` and restores supported original clipboard formats unless the user changes the clipboard meanwhile. Markdown conversion covers a limited subset.

Browser additions are `browser_frames`, `browser_filechooser`, `browser_claim_tab`, and `browser_finalize`. Same-origin child frames use `frame_id` and semantic references; cross-origin/OOPIF frames are explicitly rejected. Claims bind to the current control session: keep `claim_id` for mutations, then finalize to release without activating the tab. Arm a chooser before opening it, read its event, and pass the single-use `filechooser_id` plus explicit absolute paths to `browser_upload` within 60 seconds. The provider uses explicit loopback CDP and does not include a user-browser extension.

Native cancellation checks run between OS calls. A blocked UIA/system call may require bounded process termination and return an unknown outcome; inspect before further input. Clipboard restoration has no OS-level compare-and-swap guarantee.

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
npm run build:wgc
npm run build:desktop
npm run test:desktop
npm test
npm pack --dry-run
```

Tests exercise the public CLI protocol, MCP discovery/calls, plugin manifest, installation plans, and owned Windows/browser fixtures.

## License

[MIT](./LICENSE)
