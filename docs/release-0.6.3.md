## win-pilot 0.6.3

### Browser channel: report what a click can actually reach

- Invisible (`opacity: 0`) and unreachable controls are no longer offered as actionable, and an element under an overlay carries `covered_by`. A real click on a covered target is **refused** (`click_intercepted` + `intercepted_by`) instead of reporting a success that landed somewhere else — `force_click: true` overrides.
- `browser_scroll` moves both axes; a delta that cannot move anything answers `scroll_no_effect` instead of a false success.
- `browser_key` covers F1-F24, paging, digits, punctuation, X keysym spellings and the keypad, with the `text`/`code`/`vk` fields a real press needs.
- New: `browser_hover`, `browser_select`, `browser_screenshot` (viewport / `selector` / `full_page`), `browser_dialog`, `browser_wait` with a CSS `selector`, `browser_click` with `button`/`click_count`.
- Native JavaScript dialogs are reported (`javascript_dialog_open`) and answered with `browser_dialog` instead of stalling the page until a timeout.
- Site-specific code removed: cross-origin navigation/requests need `allowed_origins`, CSRF uses `csrf_cookie`/`csrf_field`, JSON bodies use `json`, and network evidence uses `capture_network_bodies`.

Performance: input sent to a background tab was acknowledged in 5,011 ms versus 15 ms with focus emulation, so focus emulation is enabled per page session — a hover went from 5,345 ms to 308 ms and a trusted click from 5,184 ms to 145 ms.

### Virtual desktop: no longer permanently unusable

A crashed or closed host used to leave `task_desktop_unavailable` with `retry: 'never'` for the rest of the process, and its Windows child session kept blocking every later attempt. Failures now name the state — `task_desktop_closed`, `task_desktop_host_lost`, `task_desktop_connection_lost`, `task_desktop_cleanup_unconfirmed`, `task_desktop_orphan_session` — with `how_to_recover`, and an orphan's session id. The new `task_desktop` action (`task_desktop_command: status | restart`) inspects and rebuilds the desktop without replaying input.

### Install

```bash
npm install -g https://github.com/JeremyWangCY/win-pilot/releases/download/v0.6.3/win-pilot-0.6.3.tgz
```

Already installed through an agent? Reinstall the same way and restart the host, or point the plugin entry at this package.
