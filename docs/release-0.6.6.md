## win-pilot 0.6.6

### Highlights

- **Explicit Takeover & Human Hand-off (`hand_off` / `wait_for_control`)**:
  - Expanding the Task Desktop window is now strictly view-only — manual input is only unlocked after clicking the explicit **Take over** (`接管`) button, eliminating accidental clicks and surprise 10-second auto-reverts.
  - Added `hand_off` and `wait_for_control` actions to the `computer` tool (and documented the workflow in `SKILL.md`): when sign-in, 2FA, CAPTCHA, or manual steps are needed, AI calls `hand_off` to expand the window and highlight the **Take over** pill, explains what to do, and waits via `wait_for_control` until the user clicks **Hand back** (`交还托管`).
- **Warm Studio UI Redesign**:
  - Unified the DSH settings card (`lib/client.js`) and native Task Desktop window (`Palette.cs`, `Program.cs`) around the Warm Studio palette (`#FFFFFF` / `#F6F5F1` / `#E7E5DE` + single `#3B6EF6` accent, host dark-mode adaptive).
  - Replaced flat WinForms toolbar button with an anti-aliased custom-painted pill button (`接管` / `交还托管`) that scales cleanly at 100%–200% DPI with zero clipping.
- **Task Desktop & Helper Reliability Fixes**:
  - Auto-dismiss Windows 11 child-session `SystemApps\MicrosoftWindows.Client.CBS` (`CrossDeviceResume.exe`) permission error popups inside the Task Desktop worker.
  - Fixed `lib/task-desktop.js` spawning the GUI host with `windowsHide: true` (making non-preview Task Desktop windows invisible on some launches).
  - Fixed `DisplayScale.WatchDetached` inheriting parent stdio pipes and causing a 60s shutdown timeout; shutdown now confirms cleanly in ~6–7 seconds.
  - Fixed `close_window` postconditions (`expect: { type: 'window_closed' }`) in Task Desktop erroneously returning `task_desktop_wrong_window` on already-closed handles.
  - Added `%LOCALAPPDATA%\Microsoft\WindowsApps` alias resolution in `launch_app` (for Store apps like `mspaint`) and clean `launch_failed` / `not_executed` reporting on foreground launch failures.

### Install

```bash
npm install -g win-pilot@0.6.6
```
