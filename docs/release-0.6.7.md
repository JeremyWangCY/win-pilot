## win-pilot 0.6.7

### Highlights

- **Explicit Task Desktop Teardown (`task_desktop` `close`)**:
  - Added `close` to `task_desktop_command` (`status` / `restart` / `close`), allowing agents to explicitly close the isolated Task Desktop window and cleanly log off its Windows child session at the end of a task instead of leaving the host process alive until host shutdown.
  - Calling `task_desktop { task_desktop_command: "close" }` confirms child-session cleanup (`cleanup_confirmed: true`) and resets the provider to `idle`, so subsequent tasks in the same conversation can reopen a fresh Task Desktop seamlessly.
  - Updated `SKILL.md` and `lib/win-pilot-skill.js` to guide agents to tear down the isolated Task Desktop when finished.

### Install

```bash
npm install -g win-pilot@0.6.7
```
