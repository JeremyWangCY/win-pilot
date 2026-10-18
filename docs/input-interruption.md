# Input interruption requirements

- Use low-level keyboard/mouse input hooks for guarded desktop input. Do not fall back to GetLastInputInfo or an idle-time grace window.
- User input cancels the active guarded action and requires a fresh get_window_state before more input. Hook initialization/unavailability must explicitly stop guarded input.
- Win-Pilot generated input must not interrupt its own action. Cleanup must release only buttons/keys this action pressed. Never suppress user input.
- Cancellation must be checked throughout typing, holding keys, dragging and background input sequences, not only at action start/end.
- Keep observation available after interruption. A stale observation cannot re-arm input.
- Settings panel contains only checkbox/dropdown preferences; no numeric input or mandatory permission switch. Follow confirmed Codex defaults where they correspond. Required system-key capability remains enabled internally.
- Audit changed and directly related code, fix contradictions/ineffective paths, run meaningful regression checks, push a branch and create a GitHub PR.

See [desktop-control-contract.md](desktop-control-contract.md) for the full
control contract. Windows hooks must run on a message-loop thread with short
callbacks; injected-event flags do not identify the originating application by
themselves, which is why Win-Pilot tags its own input.
