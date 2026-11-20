## What this changes

Two threads: the browser channel now reports what a click can actually reach, and the virtual desktop can no longer become permanently unusable.

### Browser channel

- `browser_state` no longer offers controls drawn with `opacity: 0` or without a box, and marks an element a click cannot reach with `covered_by`. A real click on a covered target is refused (`click_intercepted` + `intercepted_by`) instead of reporting a success that landed elsewhere; `force_click: true` overrides.
- `browser_scroll` moves both axes and answers `scroll_no_effect` instead of a false success (`direction: left/right` works).
- `browser_key` covers F1-F24, paging, digits, punctuation, X keysym spellings and the keypad, with the `text`/`code`/`vk` fields a real press needs.
- New actions: `browser_hover`, `browser_select` (label/value/index, listing real options on failure), `browser_screenshot` (viewport / `selector` / `full_page`), `browser_dialog` (report and answer a native dialog instead of stalling the page), `browser_wait` with a CSS `selector`, `browser_click` with `button`/`click_count`.
- Site-specific code replaced by generic options: `allowed_origins`, `csrf_cookie`/`csrf_field`, `json` bodies, `capture_network_bodies`. The bilibili origin exceptions and reply-endpoint parsing are gone.
- Page-side refusals keep their reason; `browser_state` reports `ok`.

Measured on a headless Edge in the virtual desktop: input to a background tab was acknowledged in 5,011 ms versus 15 ms with focus emulation, so focus emulation is enabled per page session (hover 5,345 ms → 308 ms, trusted click 5,184 ms → 145 ms). Captures are bounded per attempt and retried once, because a stalled surface capture used to consume the whole action budget.

### Virtual desktop

- A crashed or closed host used to make `task_desktop_unavailable` permanent (`retry: 'never'`) for the rest of the process. Failures now name the state — `task_desktop_closed`, `task_desktop_host_lost`, `task_desktop_connection_lost`, `task_desktop_cleanup_unconfirmed`, `task_desktop_orphan_session` — with `how_to_recover`, and an orphan's Windows child session id.
- New `task_desktop` action (`task_desktop_command: status | restart`) inspects and rebuilds the desktop without replaying input. `restart` falls back to takeover and otherwise names the session to end.
- A terminal provider is dropped and rebuilt instead of pinning the virtual desktop forever. `close()` still refuses to claim a clean shutdown it did not confirm, and its failure now names the session still holding the desktop.

## Tests

- New `test/browser-fixes.check.mjs` (keys, scroll axes, hover, select, screenshots, selector wait, origin allowlist, occlusion refusal/force, dialog guard) and `test/task-desktop-recovery.check.mjs` (crashed host and closed provider recovery, recovery hints, no replay).
- `WIN_PILOT_NO_HOST_CONTEXT=1` keeps a suite independent of a live host's settings; two suites that failed inside DSH for that reason now pass.
- Browser tests kill the whole Edge process tree, which removes a capture-timeout flake.
- Browser group and desktop group pass locally (16/16 across the touched suites). The desktop-environment-bound suites (`statusbar`) still fail on a clean checkout of this machine.
