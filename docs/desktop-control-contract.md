# Desktop control contract

This document states what Win-Pilot guarantees about taking, yielding and
interrupting control of the Windows desktop. It is a product contract, written
independently; it is not derived from another product's internals.

## Control is borrowed, never seized

- Win-Pilot must not fight the user for the foreground. When the user switches
  windows, that is a valid action and must be honoured, not reverted.
- Background-first is the default posture. Input and observation target the
  window Win-Pilot was asked to operate, not whatever happens to be frontmost.
- A target that cannot be operated without stealing focus is refused with an
  explicit error. Refusing is correct; forcing the foreground is not.
- Win-Pilot never demotes, lowers or pushes aside a window the user activated.

## User input always wins

- Low-level keyboard and mouse hooks guard desktop input. Falling back to
  "last input timestamp" or an idle-time grace window is not acceptable,
  because both miss the case where the user is actively typing in another app.
- User input cancels the active guarded action immediately and requires a fresh
  observation before more input is sent. A stale observation cannot re-arm input.
- If the hooks cannot be installed, guarded input stops and reports the reason.
  It does not silently continue unguarded.
- Cancellation is checked throughout typing, key holds, drags and background
  sequences, not only at the start and end of an action.

## Our own input is not the user's input

- Input injected by Win-Pilot must not interrupt its own action; it is
  self-tagged and ignored by the guard.
- Cleanup releases only the buttons and keys that the cancelled action pressed.
- User input is never suppressed or swallowed.

## Session and desktop preconditions

- The actual input desktop is checked before guarded input; a locked desktop
  refuses input rather than sending keystrokes into a lock screen.
- Input hooks run on a message-loop thread with short callbacks.

## Settings surface

- The settings panel exposes only checkbox and dropdown preferences: no numeric
  input and no mandatory permission switch.
- Capabilities the runtime always needs stay enabled internally rather than
  being offered as a toggle that can only break the product.
