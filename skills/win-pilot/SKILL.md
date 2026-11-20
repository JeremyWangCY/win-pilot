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

The virtual desktop (task desktop) is a separate Windows child session. When a desktop action reports `task_desktop_closed`, `task_desktop_host_lost`, `task_desktop_connection_lost`, `task_desktop_cleanup_unconfirmed`, or `task_desktop_orphan_session`, never fall back to the user's real desktop on your own: call `task_desktop` with `task_desktop_command: "status"`, then `"restart"`. A restart tears down a dead or closed host and creates a fresh one, and nothing is replayed, so observe again afterwards. When the answer names an orphaned child session (for example `logoff 6`), that Windows session has to be ended before any desktop can start; report that exact command to the user instead of retrying in a loop.

Do not invent window handles, element indexes, coordinates, browser endpoints, tab IDs, URLs, or success. Use post-action observations when they already prove the result; avoid redundant screenshots.

`stop` cancels this session's active and queued work and blocks new mutations until an explicit `resume`. Observation remains available. Control actions cannot be batched. Use `control_status` to inspect ownership and `control_release` only when no request or input is held. Native cancellation checks run between OS calls; a blocked call may require helper termination and return an unknown outcome.

Desktop element indexes are stable and sparse within the window identity. Bind each to its returned single-use `snapshot_id`. Apply `accessibility.format` full/delta/no_change against the indicated base revision. `tree_shown_to_model:false` is for hidden programmatic reads and does not advance the model-visible baseline; use `disable_diffing:true` for a fresh full tree.

For rich paste use `paste` with `format: text | html | md` and `text`. Supported original clipboard formats are restored unless the user changed the clipboard meanwhile. Unsupported original data fails before replacement. Markdown conversion supports a limited subset.

Read browser capabilities. `browser_frames` supports same-origin child frames: pass `frame_id`, observe that frame, then use its current semantic references. Cross-origin/OOPIF frames are rejected. Coordinates are supported only for the top frame. The connection is explicit loopback CDP; no user-browser extension is supplied.

Use `browser_claim_tab` when exclusive handoff is needed; retain `claim_id` for mutations and `browser_finalize` to release without activating the tab. Arm `browser_filechooser` before opening a chooser, read its event, and pass the single-use `filechooser_id` plus explicit absolute paths to `browser_upload` within 60 seconds. Claims and chooser events cannot be transferred to another control session.

A snapshot reports what a click can actually reach: controls drawn with `opacity: 0` or without a layout box are omitted, and a control under an overlay carries `covered_by`. A real click on a covered target is refused with `error_code: "click_intercepted"` and `intercepted_by` instead of reporting success; dismiss the overlay, or pass `force_click: true` when the overlay is intentional.

`browser_click` accepts `button` (left/right/middle) and `click_count` (1-3); a non-left button or a multi-click is dispatched as real CDP input. `browser_hover` reveals hover-only menus before you click. `browser_select` chooses a native `<option>` by `text` (label), `option_value`, or `option_index` and returns the resulting value; `option_not_found` lists the real options. `browser_scroll` honours both axes, so use `scroll_x` or `direction: left/right` for horizontal content; a delta that cannot move anything returns `scroll_no_effect` rather than a false success. `browser_screenshot` captures the viewport by default, or one element with `selector` / `full_page: true`.

A native JavaScript dialog blocks the whole page: actions return `error_code: "javascript_dialog_open"` with the dialog type and message instead of hanging. Answer it with `browser_dialog` (`accept: true|false`, `prompt_text` for prompts) before continuing.

`browser_wait` waits for document readiness, a text change, `url_change` against `expected_url`, or a CSS `selector`. Cross-origin navigation and requests are limited to the current frame's origin unless you pass the target in `allowed_origins`; there are no implicit site exceptions. `browser_request` sends form encoding by default and JSON with `json`, and copies a named cookie into a form field with `csrf_cookie`/`csrf_field`.
