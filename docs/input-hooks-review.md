# Input hooks and settings review

Baseline: `e0dce217ffcdc0f15adc142ecee9f3209841a956`.
Scope: current Config forms, desktop input dispatch, input monitoring, cleanup,
result classification, and directly related launch/scroll paths.

## Standards

The independent review found that interruption could skip `AttachThreadInput`
detachment, and that background range scrolling used nonexistent UIA methods.
Both were repaired: successful attachments are released in `finally`, and
range scrolling uses bounded `RangeValuePattern.SetValue` with an interruption
check before every change. Static follow-up found no further blocking findings.

## Spec

The independent review found missing protection for paste/application launch,
missing interruption checks on `TransformPattern.Move`, and missing cleanup for
independent background mouse-down actions. Those findings were repaired and
covered by the dispatch/background fixtures. Paste now restores previous text
in `finally` without overwriting text copied by the user during cancellation.
The root agent completed the follow-up inspection and regression validation.

Additional audit repairs: stop covers all desktop input actions; partial repeat
and multi-axis results preserve previous dispatch; cursor/status preferences are
independent; application identity may span multiple processes; a delegated
launch must prove process ancestry and cannot adopt an unrelated notification.
Guessed popup closing and obsolete settings registrations were removed. Desktop
form verification also exposed ALT/ESC injection during foreground activation:
activation now preserves an already active target and sends no synthetic keys.

## Validation

- Real Windows hooks: self-tagged input, user takeover, fresh-observation races,
  unavailable/stopped monitor, cancellable sleep, and input passthrough.
- Real native input on owned fixture windows: hold, typing and dragging stop
  on interruption and release injected keys/buttons.
- Real PowerShell function bodies with mock transports: background sequences,
  partial dispatch, releases after timeout, range limits, paste restoration,
  monitor refusal, and unrelated-process rejection.
- Config/client checks: three live booleans, loader entry binding, hot updates,
  rejected save/reset and draft retention. Config integration checks actual
  schemastery/cosmokit references; these checks do not exercise Electron Loader.

The implementation follows the reference's observed interruption contract; the
proprietary Codex source is not available. Windows can silently remove a low-level
hook after callback timeout without providing a query for that condition. The
monitor uses short callbacks on its own message-loop thread and refuses input
on detected startup/thread/callback failures; it does not switch to timestamp
polling. A synchronous UIA call or already-submitted input cannot be undone by
cancellation; uncertain partial dispatch requires fresh observation.
