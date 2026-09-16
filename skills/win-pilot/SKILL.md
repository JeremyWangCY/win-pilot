---
name: win-pilot
description: Operate Windows desktop applications and Win-Pilot-owned Chromium sessions through the computer tool or win-pilot CLI. Use for visual, UI Automation, window-management, and browser interaction tasks on Windows.
---

# Win-Pilot Computer Use

Use the `computer` tool when the host exposes it. Otherwise call the CLI with a complete JSON request:

```powershell
win-pilot request --payload '{"action":"list_apps"}' --json
```

Observe before acting. Reuse returned window objects, browser targets, `snapshot_id`, `screenshot_id`, and element references only with the state that produced them. Prefer semantic elements and text actions over coordinates.

Desktop coordinates are window-local when a window target is supplied. Background dispatch never implies permission to foreground a window. Use foreground control only when the task permits it.

For browser work, launch an isolated Edge session through `launch_app` before browser actions unless an existing Win-Pilot browser target was supplied. Keep its `{ endpoint, tab_id }` through the task.

Treat `outcome: "unknown"`, stale tokens, and `needs_observation` as recovery signals: inspect the same target before retrying. Never repeat a consequential mutation solely because its response was lost or timed out.

Do not invent window handles, element indexes, coordinates, browser endpoints, tab IDs, URLs, or success. Use post-action observations when they already prove the result; avoid redundant screenshots.
