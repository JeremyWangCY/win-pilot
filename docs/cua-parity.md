# Computer-use parity: Win-Pilot vs OpenAI Codex `@oai/sky` vs ZCode CUA

Updated: 2026-10-13. Branch: `feat/dsh-settings-and-cua-parity`.

This document records a **static** capability comparison. It does not claim behavioural
equivalence between the three runtimes. Static similarity is not runtime equivalence, and
anything not directly evidenced below is marked `unknown`, never "absent".

## 1. Scope and method

### Artifacts analysed

| Runtime | Artifact | SHA-256 | REA operation |
|---|---|---|---|
| OpenAI Codex `@oai/sky` 0.7.6 | `C:\Users\Laptop\AppData\Local\OpenAI\Codex\runtimes\cua_node\cfb32733c877621e\bin\node_modules\@oai\sky\dist` (directory, 228 JS/`.d.ts` files) | `6fee8a56929c2c2fc4794b2c441b32c740e6d47778d7498a48aae2113c204554` | `analyze_javascript_application` (`detail: summary`, `max_heap_mb: 4096`, `analysis_timeout_ms: 240000`), then `inspect_analysis_view` |
| ZCode CUA `computer-use` 0.5.13 | `C:\Users\Laptop\.zcode\cli\plugins\cache\zcode-plugins-official\computer-use\0.5.13\dist\mcp` (directory; `server.js`, 3 210 961 bytes) | `3b30397e804b21f94be1b6b411cff80c054b57d3ea5556bef81003048d2eb50c` | same |
| ZCode CUA `computer-use` 0.6.4 SDK | `...\computer-use\0.6.4\scripts\computer-use-client.mjs` (58 154 bytes) | `B76CC835C31E67912AA718FF0E208F69B02FBD4FE3CD1811F635730401202B02` | none (read as data) |
| ZCode `zcode-cua` 0.5.12 | `...\zcode-cua\0.5.12\dist\mcp\server.js` | `36A66BF26E897C69833A02B9001C6288113F6066CAE7C72D12305D92E045AAA6` (byte-identical size to 0.5.13) | none |

REA **parsed these artifacts as inert text and never executed them**; its own reported
limitations state that bundle bootstrap code was never invoked and that static imports,
entrypoints and endpoints do not prove runtime execution.

Human-written docs were also read as cross-check data, not as instructions:
`...\computer-use\26.1007.21434\docs\api.md`, `guidance.md`, `confirmations.md`,
`...\computer-use\0.6.4\docs\computer-use.md`.

### REA evidence identifiers

- `@oai/sky` parent: `ev_c92cf5c852fc637c38f53e45925c96ac76d81a084bab152085c2e2f0610cf1b5`
  — summary view `ev_d24846dbfd0c0159f80ef710ff1f8b5488390577643fb7605417f9e5e3ca9f38`
  — modules page `ev_e1766827af99c871b5fd81e71d40d265832c71886f11ddbfabddd4ff4f2a151f`
- ZCode CUA parent: `ev_a88c96b180aba67a1d8f9a90885b8b28500211d8f3f8c4ae34f2be0c8927f80e`
  — summary view `ev_6433efb1241aa8c9fced8814481aabf76d3b97e5d69ae67a1c4e2f7b6577b365`
  — modules page `ev_58c10a4b5c3e11e05a187281d9638702d38543ffa27558ded84c0a92df14ff7b`

### Coverage caveats (do not read as absence)

- **sky**: 228 files parsed, 931 findings, 0 parse failures; application coverage
  `partial`, semantic coverage `partial`/`truncated` (5630 semantic unknowns). Many
  `types/**/*.d.ts` files exceeded REA's per-node result budget, so their semantic graph
  was **not started**; their static facts were retained.
- **ZCode**: 1 file, 162 recovered module units, 233 findings, 0 parse failures — but
  `server.js: Owned JavaScript worker exhausted its heap while analyzing server.js during
  semantic` analysis, even at a 4 320 133 120-byte heap limit. ZCode semantic families
  therefore report **0 retained relations** and application coverage is `partial`. ZCode
  conclusions below rest on parsed static text and the sibling SDK, not on its semantic graph.
- `recover_javascript_sources` (Wakaru) was **unavailable** in this environment
  (`capability_unavailable`; no `REA_WAKARU_COMMAND`), so the ZCode bundle was not further
  de-minified. ZCode rows that would need that transformation are `unknown`.

## 2. Capability table

Win-Pilot column reflects the working tree of this branch: `lib/settings.js` (new), the settings
card `lib/client.js` (new), and the parity edits in `lib/index.js`, `lib/computer-action.js`,
`lib/image-context.js`, and `native/helper/*.ps1`. Every capability claimed for Win-Pilot below is
covered by a check in `test/cua-parity.check.mjs`, `test/settings.check.mjs`, or
`test/client-bundle.check.mjs`; where a capability could not be evidenced for another runtime it is
marked `unknown`.

| Capability | Win-Pilot | OpenAI Codex `@oai/sky` | ZCode CUA | Status / Notes |
|---|---|---|---|---|
| Action naming | One tool `computer` with an `action` enum. Canonical desktop names `list_apps`, `list_windows`, `get_window`, `launch_app`, `get_window_state`, `click`, `press_key`, `type_text`, `scroll`, `set_value`, `drag`, `perform_secondary_action`, `activate_window`, `minimize_window`; aliases `double_click`, `type`, `keypress`, `move` (advertised) and `left_click`, `left_click_drag`, `key`, `perform_action` (normalized for CLI/MCP callers, deliberately not advertised, matching the existing enum contract). Extensions: `wait`, `screenshot`, `close_window`, `select_text`, `elements`, `stop`, `paste`, clipboard, `mouse_down/up`, `hold_key`, `list_displays`, `zoom`, `switch_display`, `cursor_position`, `get_app_identity`, `browser_*`. | `Window2ComputerUseClient` methods: `list_apps`, `list_windows`, `get_window`, `launch_app`, `get_window_state`, `click`, `press_key`, `type_text`, `scroll`, `set_value`, `drag`, `perform_secondary_action`, `activate_window` (+ optional `start/stop_audio_recording`). | SDK exposes 14 flat tools: `list_apps`, `list_windows`, `get_app_state`, `left_click`, `scroll`, `left_click_drag`, `type`, `set_value`, `select_text`, `key`, `perform_action`, `paste`, `request_access`, `stop_computer_control`. Producer table additionally lists `double_click`, `triple_click`, `right_click`, `middle_click`, `mouse_move`, `left_mouse_down/up`, `hold_key`, `wait`, `read_clipboard`, `write_clipboard`, `open_application`, `screenshot`, `zoom`, `list_displays`, `switch_display`, `cursor_position`. | Win-Pilot and sky share the Windows `window2` names. ZCode uses `snake_case` aliases plus mouse-verb tools; Win-Pilot normalizes `left_click`/`left_click_drag`/`key`/`perform_action`/`paste` but has **no** `triple_click`, `right_click`, `middle_click`, `open_application`, or `request_access`. A mouse-button verb is expressible as `click` + `button`/`click_count`. ZCode `open_application` is documented as deleted producer-side. |
| Window / state model | Reusable `window: { id, app }` object (ChatGPT compatibility); `hwnd`/`app`/`identity_key`/`window_index` also accepted. `get_app_identity` returns `win32:<exe path>` or `aumid:<AUMID>`. | `Window { id, app, title? }`; `AppIdentifier` is a string; `list_apps()` returns apps with their windows; `get_window({id, app})` rehydrates. | `AppRef { name?, bundle_id?, pid?, window_id? }`; bare string is read as a bundle id, never a display name; `list_windows` returns per-window `window_id`, `title`, `subrole`, `bounds`, `main`, `focused`, `onscreen`, `index`. | All three use a reusable opaque window handle. ZCode's `window_id` semantics (stable integer + `onscreen`/`subrole` discrimination) have no Win-Pilot equivalent; Win-Pilot's `identity_key` (executable path / AUMID) has no ZCode equivalent. |
| Accessibility tree | `include_text: true` returns an indexed UIA tree plus `document_text`, `focused_element`, `selected_text`, `selected_elements`. `accessibility.status` distinguishes `available` / `partial` / `unavailable`. Snapshot- and element-identity-bound: `snapshot_id` required for `element_index` actions. | `get_window_state({include_text: true})` returns `accessibility: { tree, focused_element?, selected_text?, selected_elements?, document_text? }`; `accessibility` is `null` when not requested. | `get_app_state` returns rendered AX tree text plus the same structured fields. | Field-for-field the structured context matches across all three. |
| Accessibility diffing | Delta mode exists: `get_window_state` returns `accessibility_delta` with `added`/`removed`/`changed`/`unchanged` and a monotonic `accessibility_revision`; `disable_diffing: true` (and the `disableDiffing` alias) nulls the delta and returns the complete tree while still advancing the revision. | `get_app_state` with `disable_diffing` is documented in ZCode; sky's `window2` types expose no `disable_diffing` field (REA found it only in ZCode's producer). | Yes: tree is returned as a diff against a tree already shown in the same cell; `disableDiffing: true` forces a full tree; first tree after binding and after a screenshot-only observation is always complete. | Aligned. Win-Pilot's delta is keyed by stable `element_id` (not by row position), so an unchanged element keeps its identity across observations. Marked `unknown` for sky: its `.d.ts` types do not declare it, but REA's semantic graph for `types/window2/*` was not started, so this is not proof of absence. |
| Screenshot capture | `get_window_state` is screenshot-first (`include_screenshot` default true); per-window PNG, occlusion-immune (WGC first, PrintWindow fallback); `screenshot_id` binds coordinate actions to one observed frame; `screenshotMaxBytes` cap; `visibleImageHistory` bounds visual context. | `get_window_state` returns `screenshots: Screenshot[]` with `id`, `zIndex`, `url` (data URL), optional `originX/originY/width/height`; multiple bounded screenshots for transient UI. | `get_app_state` with `include_screenshot: true`; raster returned as an image block; `has_image: false` means pixels were not requested, not that capture failed. | All three are window-scoped and occlusion-tolerant. sky's multi-screenshot `zIndex` model (transient UI above the window) has no documented Win-Pilot equivalent. |
| Coordinate vs element targeting | Element-first; `element_index` requires a matching `snapshot_id` and optionally `element_id`; coordinate clicks on a background app require `expected_name`; `coordinate_space: window \| screen`. | `click({element_index})` or `click({x, y})` window-relative, with optional `screenshotId` that must be cached for that window. | `target` is `{type:"element", index}` or `{type:"coordinate", x, y}` with optional `frame_id`; coordinates must come from the current raster and are refused when the frame is stale. | Same two-path model. Win-Pilot's `expected_name` guard and `coordinate_space` switch are stricter/more explicit than sky's `screenshotId`-only binding; ZCode's `frame_id` is the closest analogue of `screenshot_id`. |
| Key input | `press_key` / `hold_key`; `key` or `+`-separated chord; `repeat` (clamped to 50 via `clampKeyRepeat`); keysym aliases added (`kp_enter`, `kp_0`–`kp_9`, `numpad_*`, `greater`, `less`, `question`, …) mapping onto helper-native names. | `press_key({window, key})` — documented keysym-style names incl. `Control_L+a`, `Control_L+Shift_L+period`, `KP_0`, with aliases `Control`, `Ctrl`, `period`, `greater`, `Numpad_0`. | `key({text, repeat?, hold_seconds?, app_ref?, strategy?, return_state?})`; `pressKey(key, {holdSeconds})`; short names and X keysym style; `super+c` on macOS, `ctrl` on Windows/Linux. | Keysym vocabulary now aligns. Win-Pilot `repeat` cap 50; ZCode `repeat` documented without a stated cap (bound `unknown`). |
| Text entry | `type_text` (unicode input, split into ≤6000-code-point chunks); `set_value` on an indexed editable element; `paste` (writes the clipboard, sends Ctrl+V, then restores the previous clipboard); `write_clipboard`/`read_clipboard`. | `type_text({window, text})`; `set_value({window, element_index, value})`. | `type`, `set_value`, and `paste({text, format?})`; SDK preference order is `setValue` → `paste` (rich text only) → `typeText`. | Aligned on the `setValue` → `paste` → `typeText` preference. Win-Pilot's `paste` restores the previous clipboard afterwards, which the ZCode contract does not describe. |
| Scroll | `scroll` with `direction` + `amount` (wheel notches), `scroll_x`/`scroll_y` deltas converted to notches at 120/delta, and a multi-axis `scroll_components` path that reports `partial_scroll` if only some axes complete. | `scroll({window, x, y, scrollX, scrollY, screenshotId?})` — deltas from a window-relative point. | `scroll({target, scroll_direction, scroll_amount})` (pages, clamped 0–100); `scroll(target, direction, pages?)` in the bound API. | Different models: Win-Pilot is notch/delta-based, ZCode is page-based, sky is delta-from-point. Win-Pilot's `partial_scroll` outcome has no documented analogue in the other two. |
| Drag | `drag` with `from_x/from_y/to_x/to_y`, optional ordered `path: [{x,y}]` (foreground follows every point). | `drag({window, from_x, from_y, to_x, to_y, screenshotId?})`. | `left_click_drag({from_target, to, modifiers?, strategy?, app_ref?, return_state?})`. | sky has no multi-point path; ZCode exposes `modifiers`. Win-Pilot's `path` is an extension. |
| Secondary actions | `perform_secondary_action` with `secondary_action` normalized to `snake_case`; documented values `invoke`, `toggle`, `select`, `add_to_selection`, `remove_from_selection`, `expand`, `collapse`, `focus`, `scroll_up/down/left/right`. | `perform_secondary_action({window, element_index, action})`; matching is case-insensitive. | `perform_action({target, action})`; only an action the element advertises in the current tree is accepted. | Equivalent role. ZCode refuses guessed action names; Win-Pilot's contract says the same in its schema text. |
| Select text | `select_text` with `start` + `length` (caret when `length: 0`), or content search via `text` + optional `prefix`/`suffix`; an ambiguous content match is refused with `ambiguous_text_match` rather than resolved to the first hit, and a missing one reports `text_not_found`. | **Not in `window2`**; `select_text` appears only in the macOS target (`targets/mac/select_text.js`). | `select_text({target, text_range?})` with `prefix`/`suffix` disambiguation and `selectionType`; an ambiguous match is refused rather than resolved to the first hit. | Win-Pilot now covers both the offset path and the content-search path with ambiguity refusal. `selectionType` (caret placement instead of selection) has no Win-Pilot equivalent; the offset path covers the same need. |
| Element enumeration | `elements` returns every element of a full-text observation with `index`, `element_id`, `role`, `name`, `value`, `automation_id`, `enabled`, `offscreen`, `invokable`, `selected`, plus `element_count` and `snapshot_id`. Observation is screenshot-first, so `elements` forces `include_text`. | `get_window_state` returns the indexed tree; no separate enumerate call in `window2`. | `app.elements()` returns every element with its index, including trimmed ones. | Aligned in purpose: both exist so a caller filters in code instead of guessing an index the trimmed tree omitted. |
| Postconditions / verification | First-class: `expect` (postcondition) and `when` (precondition) with types `window_exists`, `window_closed`, `accessibility_changed`, `element_value`, `text_present`, `browser_url`, `browser_text`, `browser_ready`, `download_completed`; bounded polling with `timeout_ms`; a failed postcondition marks the result `ok: false`, `outcome: 'unknown'`, `error_code: 'postcondition_failed'`. `observeAfterAction` auto-captures a post-action observation. | Not found in `window2` types or the sky Windows client base. | `return_state` (`compact`/`full`/`none`) returns app state in the same call; `getAXState()` after actions is the documented loop. No declarative pre/postcondition objects. | **Win-Pilot-only feature.** This is the largest Win-Pilot capability the other two lack in static form. Marked `unknown` for sky rather than absent: REA did not start semantic analysis of `types/window2/*`. |
| Error taxonomy | Per-action `error_code` strings from helper and JS (`stale_snapshot`, `stale_screenshot`, `background_unavailable`, `target_validation_failed`, `target_validation_required`, `target_mismatch`, `target_required`, `invalid_coordinates`, `value_verification_failed`, `window_close_unconfirmed`, `foreground_activation_unconfirmed`, `wait_condition_timeout`, `action_timeout`, `partial_scroll`, `partial_key_repeat`, `browser_not_owned`, `upload_verification_failed`, `type_verification_failed`, `replacement_verification_failed`, `postcondition_failed`, `unsupported_system_key`, `screen_locked`, `controller_busy`, `control_stopped`, `text_not_found`, `ambiguous_text_match`, …). `withRecoveryHints` derives `actionSent` (boolean) and `retry` (`never`/`retry`/`reobserve`) uniformly across desktop, browser and batch results. | No typed error contract found in `window2` types; the Windows transport rejects with plain `Error` (pipe closed / timed out / frame too large). | `ComputerUseError` with `code`, `actionSent`, `dispatchStatus`, `details`; codes `PERMISSION_DENIED`, `NOT_AUTHORIZED`, `APP_NOT_FOUND`, `AMBIGUOUS_APP`, `LAUNCH_FAILED`, `INVALID_APP`, `ELEMENT_UNAVAILABLE`, `STALE_STATE`, `NOT_SETTABLE`, `NOT_SELECTABLE`, `ACTION_UNAVAILABLE`, `FOREGROUND_REQUIRED`, `CONTROLLER_BUSY`, `CONTROL_STOPPED`, `SCREEN_LOCKED`, `HELPER_UNAVAILABLE`, `VERSION_MISMATCH`, `TIMEOUT`, `STRUCTURED_STATE_UNAVAILABLE`, `INTERNAL`; plus `retry: "reobserve" \| "retry" \| "never"`. | Win-Pilot's `actionSent`/`retry` pair mirrors ZCode's contract, and it now emits `SCREEN_LOCKED`/`CONTROLLER_BUSY`/`CONTROL_STOPPED` analogues (`screen_locked`, `controller_busy`, `control_stopped`). Code spellings differ (snake_case vs SCREAMING_CASE); sky exposes **no** typed taxonomy in the analysed surface. |
| Exclusivity / lock guard | `lockGuard` (default `true`) refuses input actions before dispatch while a lock surface (`logonui`, `lockapp`, `winlogon`, screensaver) owns the foreground, returning `screen_locked` with `retry: never`; observation and enumeration stay available. `exclusiveControl` (default `false`) claims a pid-stamped lease file so only one live session may inject input, returning `controller_busy` when another live owner holds it; a stale lease is reclaimed. | Native pipe transport serializes requests through a single connection with per-request timeouts; no controller-lease concept found in the analysed surface. | `CONTROLLER_BUSY` is "never retryable"; the SDK maps broker `controller_busy` → `CONTROLLER_BUSY` and reports the owning session; `controller lease` and `kill switch` are named as retained safety semantics. | Aligned in shape. Win-Pilot detects the lock by foreground process name rather than a native `OpenInputDesktop` probe, and its lease is advisory (a pid file), so both are weaker mechanisms than a broker-owned lease. |
| Permission / access request | Not present. | Not found in `window2`; the Windows client has an approval channel (`requestComputerUseApproval` over the native pipe, dispatching to `createElicitation` when inside trusted `node_repl`). | `request_access({capabilities?})` → `AccessStatus`; `requestAccess` is classified `read_only` in the tier table. | sky's approval elicitation and ZCode's `request_access` both have no Win-Pilot counterpart. |
| Stop / kill switch | `stop` sets a per-instance flag: every later input action returns `control_stopped` (`retry: never`) until the plugin reloads; observation stays available. `browser_shutdown` is scoped separately to an endpoint this tool instance launched. | No `stop` in `window2`. Transport `close()` ends the native pipe and rejects in-flight requests. | `stop_computer_control({reason?})`, classified `safety_control`; SDK `stop(reason)`; the SKILL requires stopping immediately after a kill switch or a non-retryable error. | Aligned in purpose. Win-Pilot's stop is scoped to the plugin instance and needs a reload to clear; ZCode's is a broker-owned session control. |
| Launch semantics | `launch_app` with `activate` (default `false` → non-activated, placed behind active work), `headless` for Chromium, `name` accepts an executable path or a registered activation protocol (e.g. `ms-settings:display`); `window_index` disambiguates multiple matches. | `launch_app({app})` where `app` is an id from `list_apps()` or an explicit `.exe` path/identifier. | No standalone launch primitive in the model surface: `open_application` was deleted producer-side and launching is folded into `get_app_state`'s transparent bring-up; `getApp(...)` launches if not running. | Divergent designs. Win-Pilot's `activate: false` default is deliberately non-focus-stealing; ZCode documents that on Windows launching a non-packaged app *does* take focus, and that `include_screenshot=true` un-minimizes. |
| Browser channel | Yes: AI-owned isolated Chromium over CDP with `browser_open/navigate/activate/close/shutdown/tabs/events/downloads/history/back/forward/wait/state/observe/read/request/click/click_point/click_text/type/replace/upload/key/scroll/scroll_to_text/reload`, element tokens and `@eN` refs, plus `browserHeadlessDefault`, `browserCommandTimeoutMs`, `browserCaptureNetworkWaitMs` settings that default the per-request fields. | Browser is a **separate** plugin (`@oai/browser-desktop`), not part of `window2`; `NODE_REPL_TRUSTED_SERVICES` maps `browser` to it. | Explicitly **not** fused into CUA: no `browsers`/`getBrowser`/`getTab`, `State` has no `browsers` key; a separate `browser-use` plugin covers web. | Win-Pilot is the only one of the three that puts the browser channel behind the same `computer` tool. sky and ZCode both keep it separate by design. |

## 3. Evidence appendix

Repo-relative citations resolve from `docs/cua-parity.md`.

- Win-Pilot action enum and alias handling: [lib/index.js](../lib/index.js) (`parameters.action.enum`),
  [lib/computer-action.js](../lib/computer-action.js) (`normalizeComputerAction`, `withRecoveryHints`,
  `clampKeyRepeat`, `KEYSYM_ALIASES`, `MAX_KEY_REPEAT = 50`).
- Win-Pilot declared settings keys and their consumers: `lib/settings.js` declares 21 fields;
  every one has a consumer in `lib/index.js`, `lib/browser-session.js`, or the helper —
  appearance (`overlay`, `statusPill`, `statusPillIdleGraceMs`), capture
  (`screenshotMaxBytes` via a `maxPngBytes` thunk, `visibleImageHistory`), timeouts
  (`actionTimeoutMs`, `waitActionTimeoutMs`, `daemonIdleMs`, `hostTimeoutMs`,
  `browserCommandTimeoutMs`, `browserCaptureNetworkWaitMs`), behaviour (`maxBatchActions`,
  `defaultDispatch`, `foregroundRecovery`, `observeAfterAction`, `includeTextDefault`,
  `browserHeadlessDefault`), safety (`lockGuard`, `exclusiveControl`, `allowSystemKeys`,
  `confirmConsequential`). `test/settings.check.mjs` fails if the field table and the
  defaults ever disagree, and `test/cua-parity.check.mjs` asserts the live `timeoutMs` read.
- Win-Pilot helper error strings: [lib/win-pilot-helper.ps1](../lib/win-pilot-helper.ps1)
  (`throw 'stale_snapshot: …'` lines 1485, 1513, 1519; `stale_screenshot` lines 1529, 1532, 1537;
  `background_unavailable` 1887, 3284; `target_validation_*` 1157, 2171, 2207, 3100, 3139;
  `value_verification_failed` 3226; `window_close_unconfirmed` 4157;
  `foreground_activation_unconfirmed` 4053; `wait_condition_timeout` 4267; `action_timeout` 4660).
- Win-Pilot postcondition machinery: `lib/index.js` (`verifyPostcondition`, `verifyPrecondition`,
  `observeForPostcondition`, `postcondition_failed`), [lib/postconditions.js](../lib/postconditions.js).
- Win-Pilot lock guard and controller lease: `native/helper/dispatch.ps1`
  (`Test-DesktopLocked`, `$script:LockProcessNames = logonui/lockapp/winlogon/screensaver`,
  `$script:InputActions`, `error_code = 'screen_locked'`), `native/helper/bootstrap.ps1`
  (`ForegroundProcessId()`), `lib/index.js` (`claimControllerLease`, `processAlive`,
  `INPUT_ACTIONS`, `controller_busy`, `control_stopped`, `fullElementListing`).
- Win-Pilot helper bundle freshness: `test/cua-parity.check.mjs` re-derives the bundle head from
  `native/helper/*.ps1`, so a stale `lib/win-pilot-helper.ps1` fails the suite.
- Win-Pilot existing self-assessment: [docs/chatgpt-computer-use-gap.md](chatgpt-computer-use-gap.md).
- sky `window2` client surface: `@oai/sky\dist\project\cua\sky_js\src\types\window2\Window2ComputerUseClient.d.ts`
  (14 methods + optional audio), `...\targets\windows\internal\computer_use_client_base.d.ts`
  (`target = "windows"`, full method list). Both are inside the analysed `dist` directory
  (digest `6fee8a56…`), REA parent `ev_c92cf5c8…`.
- sky keysym vocabulary: `...\types\window2\PressKey.d.ts` (verbatim doc comment listing
  `Control_L+Shift_L+period`, `KP_0`, `Numpad_0`, `period`, `greater`).
- sky scroll-by-delta and screenshot model: `...\types\window2\Scroll.d.ts`,
  `...\types\window2\Screenshot.d.ts` (`id`, `zIndex`, `url`, `originX/originY/width/height`),
  `...\types\window2\WindowState.d.ts` (`AccessibilityState`, `screenshots`, `accessibility: null`).
- sky Windows native-pipe transport, per-request timeout, frame-size caps, and the
  `requestComputerUseApproval` → `createElicitation` approval path:
  `...\targets\windows\internal\computer_use_client.js` (minified; read as text).
- sky client-side `stop`/controller-lease: **not found** in the analysed surface.
- ZCode tool tiers, read-only/safety sets, and the producer tool list:
  `server.js` lines 60160–60260 of the analysed directory (digest `3b30397e…`, REA parent
  `ev_a88c96b1…`); contains `ActionTier`, `READ_ONLY_TOOLS`, `SAFETY_CONTROL_TOOLS`,
  `TIER_TABLE`, `RESTRICTED_MODE_TIERS`.
- ZCode tool-name literals in `server.js`: `list_apps` 13, `list_windows` 17, `get_app_state` 45,
  `left_click_drag` 6, `left_click` 17, `set_value` 14, `select_text` 12, `perform_action` 13,
  `request_access` 14, `stop_computer_control` 10, `scroll_amount` 10, `return_state` 57
  occurrences. `hold_seconds` and `disable_diffing` have **0** occurrences in `server.js`.
- ZCode SDK error taxonomy, `actionSent`, reobserve/never-retry sets, `ComputerUseError`,
  14-method `COMPUTER_METHOD_NAMES`, `PLATFORM_EXCLUDED_METHODS`, `MUTATING_METHODS`,
  `requestAccess`, `stop`:
  `...\computer-use\0.6.4\scripts\computer-use-client.mjs` (digest `B76CC835…`).
- ZCode diffing and `hold_seconds` forwarding: same file, lines ~588–606 (`disable_diffing`)
  and ~743 (`hold_seconds`).
- ZCode `open_application` deletion and launch-via-`get_app_state`:
  same file, comment above `PLATFORM_EXCLUDED_METHODS` (lines ~36–48).
- ZCode `CONTROLLER_BUSY` mapping and lease/kill-switch retention:
  same file, `ERROR_CODE_BY_BROKER` (line ~86) and header comment (line ~11).
- ZCode human documentation for the error contract, `strategy`, `holdSeconds`, `repeat`,
  `disableDiffing`, `requestAccess`, `stop`:
  `...\computer-use\0.6.4\docs\computer-use.md` lines 368–406 and 180–209.
- sky human documentation for the supported `window2` API surface:
  `...\computer-use\26.1007.21434\docs\api.md`.
- sky human documentation for confirmation policy and Windows safety denies:
  `...\docs\confirmations.md`, `...\docs\guidance.md` lines 228–260.

### Partial coverage, stated plainly

- ZCode `server.js` exhausted REA's 4.3 GB worker heap during **semantic** analysis: all
  twelve semantic families report 0 retained relations. Any ZCode claim resting on
  cross-function data flow (rather than literal text or the sibling SDK) is `unknown`.
- 40+ sky `types/**/*.d.ts` files had their semantic analysis **not started** due to REA's
  per-node result budget. "Not found in the sky surface" therefore means "not present in the
  parsed static text and type declarations", not "provably absent at runtime".
- `recover_javascript_sources` could not run (Wakaru unavailable), so the ZCode bundle's
  recovered module names are as-reported by REA and the bundle was not further de-minified.

## 4. Adopted vs deferred

### Adopted on this branch

1. **ZCode/ChatGPT action aliases** — `left_click`, `left_click_drag`, `key`, `perform_action`,
   `strategy` → `dispatch`, `disable_diffing`/`disableDiffing`, `mouse_button`, `scrollX/scrollY`,
   `element_index`, `screenshotId`, `window`/`browser` objects. Reason: a request written for
   another runtime should run unchanged.
2. **Keysym key vocabulary** — `kp_*`/`numpad_*` and punctuation aliases added additively, with
   the matching virtual keys added to the helper's `MapKey`. Reason: the three runtimes now agree
   on key names, and the mapping is pure translation.
3. **`actionSent` + `retry` recovery hints** (`withRecoveryHints`). Reason: it makes the
   already-existing outcome semantics explicit and uniform across desktop, browser and batch,
   and mirrors ZCode's documented contract.
4. **`repeat` for key input** (clamped to 50). Reason: avoids one tool call per keypress
   without allowing an unbounded input burst.
5. **A `win-pilot` settings namespace** with 21 keys, all with consumers, plus a Settings card.
   Reason: makes runtime knobs user-editable through the harness settings document; the seam is
   optional and every read falls back to the shipped constant.
6. **`elements` and `stop`** — implemented as a full element listing over a text observation and a
   per-instance kill switch. Reason: parity with ZCode's `elements()` and `stop_computer_control`.
7. **Accessibility delta mode with `disable_diffing`.** Reason: ZCode's diffing is a real
   round-trip reduction; Win-Pilot's delta is keyed by stable `element_id`.
8. **`lockGuard` / `exclusiveControl` / `screen_locked` / `controller_busy` / `control_stopped`.**
   Reason: ZCode treats a locked desktop and a competing controller as hard stops; reporting them
   as ordinary failures would invite retries into a void.
9. **An atomic `paste`** (clipboard write + Ctrl+V, previous clipboard restored). Reason: the
   correct path for rich text and for editors that reject per-character input.
10. **`select_text` content search with `prefix`/`suffix` and ambiguity refusal.** Reason: ZCode
    refuses an ambiguous match rather than selecting the first hit, which is the safer default.

### Deferred (with reason)

1. **A broker-owned controller lease.** Win-Pilot's lease is an advisory pid-stamped file in the
   plugin temp directory; it is not a broker, so it cannot arbitrate across separate machines or
   enforce the claim against a process that ignores it. A real lease needs a host-side service.
2. **Native lock detection (`OpenInputDesktop` / `WTSGetActiveConsoleSessionId`).** The current
   guard infers the lock from the foreground process name. A native probe would be stronger, but
   it is a separate native-helper change.
3. **`request_access` / permission elicitation.** No approval channel exists in the current
   Win-Pilot tool contract. sky routes approvals through `createElicitation` inside trusted
   `node_repl`; ZCode has a first-class tool. Deferred pending a host approval seam.
4. **`triple_click` / `right_click` / `middle_click` as named tools.** Win-Pilot already
   expresses these through `click` + `button` + `click_count`; adding names would duplicate.
5. **`selectionType` (caret placement instead of selection) and `frame_id` raster binding.**
   The offset path covers caret placement; Win-Pilot's `snapshot_id`/`screenshot_id` covers the
   same staleness concern with different mechanics.
6. **sky's multi-screenshot `zIndex` model.** Needs a capture path that returns several bounded
   regions per window; Win-Pilot returns one window PNG plus `zoom`.
7. **Verification on a real locked desktop and a real second session.** The lock guard and the
   lease are unit-covered but have not been exercised against those live conditions here.

## 5. Unknowns

Explicitly unresolved, and **not** to be read as absence:

1. Whether sky's `window2` runtime accepts `disable_diffing` — its `.d.ts` types do not declare
   it, but REA did not start semantic analysis for those files.
2. Whether sky's `window2` exposes any declarative precondition/postcondition mechanism — not
   found in the parsed types; semantic coverage was incomplete.
3. Whether sky has a client-side `stop` / controller lease — not found in the analysed surface.
4. Whether Win-Pilot's `lockGuard` and `exclusiveControl` behave correctly against a **real**
   locked desktop and against a second live session — the implementation exists and is unit-covered
   (foreground process-name detection, pid-stamped lease file), but neither path has been exercised
   on a genuinely locked workstation here.
5. Win-Pilot's `elements` and `stop` behaviour against a real app — both are implemented
   (`fullElementListing`, the `controlStopped` flag) and unit-covered, but not yet exercised
   end-to-end on a live target.
6. Win-Pilot's `confirmConsequential` / `defaultDispatch` / `foregroundRecovery` /
   `includeTextDefault` / `browserHeadlessDefault` / `browserCommandTimeoutMs` /
   `browserCaptureNetworkWaitMs` behaviour — all are wired and unit-covered; what remains unknown is
   how they interact with a real host policy, which this environment cannot exercise.
7. ZCode's `repeat` upper bound — documented without a stated cap; the semantic graph needed
   to resolve it exhausted the worker heap.
8. ZCode's `SCREEN_LOCKED` / `VERSION_MISMATCH` / `STALE_STATE` producer paths — codes are
   mapped in the SDK, but `server.js` exposes only `ACTION_UNAVAILABLE` (1), `PERMISSION_DENIED`
   (2) and `COMPUTER_USE` (4) as literal occurrences, so the broker-side emitters were not located.
9. Whether `zcode-cua` 0.5.12 and `computer-use` 0.5.13 are the same producer build — the
   `server.js` files differ in digest (`36A66BF2…` vs `C65DD1C9…`) at identical size.
10. Any **runtime** behaviour of all three runtimes. Every claim here is static.
