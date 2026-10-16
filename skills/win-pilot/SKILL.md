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

`stop` cancels this session's active and queued work and blocks new mutations until an explicit `resume`. Observation remains available. Control actions cannot be batched. Use `control_status` to inspect ownership and `control_release` only when no request or input is held. Native cancellation checks run between OS calls; a blocked call may require helper termination and return an unknown outcome.

Desktop element indexes are stable and sparse within the window identity. Bind each to its returned single-use `snapshot_id`. Apply `accessibility.format` full/delta/no_change against the indicated base revision. `tree_shown_to_model:false` is for hidden programmatic reads and does not advance the model-visible baseline; use `disable_diffing:true` for a fresh full tree.

For rich paste use `paste` with `format: text | html | md` and `text`. Supported original clipboard formats are restored unless the user changed the clipboard meanwhile. Unsupported original data fails before replacement. Markdown conversion supports a limited subset.

Read browser capabilities. `browser_frames` supports same-origin child frames: pass `frame_id`, observe that frame, then use its current semantic references. Cross-origin/OOPIF frames are rejected. Coordinates are supported only for the top frame. The connection is explicit loopback CDP; no user-browser extension is supplied.

Use `browser_claim_tab` when exclusive handoff is needed; retain `claim_id` for mutations and `browser_finalize` to release without activating the tab. Arm `browser_filechooser` before opening a chooser, read its event, and pass the single-use `filechooser_id` plus explicit absolute paths to `browser_upload` within 60 seconds. Claims and chooser events cannot be transferred to another control session.
