## win-pilot 0.6.4

### Universal agent settings (`win-pilot config`) & `browserControl` off by default

- All seven preferences (`overlay`, `statusPill`, `browserHeadlessDefault`, `browserControl`, `ignoreUserInput`, `desktopEnvironment`, `remoteControlPolicy`) now work across every agent (Claude Code, Codex, Qoder, Pi, Antigravity, standalone CLI/MCP, and DeepSeek Harness) via `~/.win-pilot/config.json` (or `WIN_PILOT_CONFIG`) and `win-pilot config [list|get|set|unset|reset|path]`.
- Settings hot-reload on the next operation without restarting MCP servers or sessions, handle UTF-8 BOM safely on Windows, and automatically mirror live DSH edits to `~/.win-pilot/config.json`.
- `browserControl` now defaults to `false` so Win-Pilot does not compete with host-native browser tools; desktop actions keep working and users can enable browser control anytime with `win-pilot config set browserControl true` or the DSH settings panel.
- Added Antigravity plugin manifests (`plugin.json` and `mcp_config.json`) alongside `.codex-plugin/plugin.json` and `.mcp.json`, and updated the local DSH settings card styling with theme-adaptive tokens and state-aware icon tiles.

### Desktop, Task Desktop, and Browser reliability fixes

- **Task desktop startup & teardown**: implicit first-use startup now tries non-interactive `open` before falling back to `login`, avoiding unnecessary credential dialogs on machines where child-session auto-logon works. Session logoff confirmation waits up to 35 seconds, tolerates `ERROR_CTX_WINSTATION_NOT_FOUND (7022)`, and surfaces inner cleanup errors clearly.
- **Modal popup hints & faster helper startup**: `get_window_state` and `post_action_observation` now report `active_popup: { hwnd, pid, title, foreground }` when an owned popup/dialog (such as Save As) is open, and PowerShell helper C# types are cached as content-addressed DLLs in `%LOCALAPPDATA%\win-pilot\helper-cache`.
- **Browser channel fixes**: `browser_click` now checks occlusion before firing DOM clicks, handles synchronous `alert`/`confirm`/`prompt` dialogs immediately via `resolveOnDialog` (`dialog_opened`) without timing out or killing the CDP WebSocket, exempts `browser_dialog` from post-action screenshot failure, and attaches the initial `tab_id` on headless `launch_app` with `url`.
- **Prompt & runtime polish**: removed contradictory `get_window_state` instructions in the runtime skill, aligned static/runtime skills and schema descriptions, made `runtime.close()` idempotent, and fixed `win-pilot desktop` waiting on a failed open.

### Install

```bash
npm install -g https://github.com/JeremyWangCY/win-pilot/releases/download/v0.6.4/win-pilot-0.6.4.tgz
```

Already installed through an agent? Reinstall the same way and restart the host, or point the plugin entry at this package.
