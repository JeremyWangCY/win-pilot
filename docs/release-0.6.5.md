## win-pilot 0.6.5

### Fixes & Polish

- **Browser screenshots (`viewport` / `element` / `selector` / `full_page`)**: disable `Emulation.setFocusEmulationEnabled` around `Page.captureScreenshot`, bound per-attempt timeouts so retries actually run, and wake throttled headless background tabs via `Page.bringToFront` on retry (zero desktop focus impact in headless mode), eliminating 25s compositor hangs on headless Edge/Chromium and Windows CI.
- **DSH Desktop host module resolution**: automatically detect the running DSH host's `app.asar/dsh/node_modules` for both `@deepseek-ai/schemastery` and `@deepseek-ai/dsh-typert-protocol`, fixing settings projection and runtime version connection on newer DSH Desktop builds.
- **Cleaner DSH settings card**: removed the redundant "Overridden" pill next to the reset icon and hid the noisy "Offline" chip when the optional runtime service is not connected.

### Install

```bash
npm install -g https://github.com/JeremyWangCY/win-pilot/releases/download/v0.6.5/win-pilot-0.6.5.tgz
```
