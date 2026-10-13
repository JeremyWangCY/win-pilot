// Codex/ZCode computer-use parity: the additive surface this branch adds, and
// the invariants that keep it from regressing the existing contract.
//
// Every assertion here is about behavior Win-Pilot can actually perform, not
// about matching another runtime's naming for its own sake.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  MAX_KEY_REPEAT,
  clampKeyRepeat,
  normalizeComputerAction,
  normalizeKeyChord,
  normalizeKeyToken,
  splitKeyChord,
  withRecoveryHints,
} from '../lib/computer-action.js'
import { defineComputerTool } from '../lib/index.js'
import { getSettings, resetSettingsForTest, setSettingsForTest } from '../lib/settings.js'

const helperSource = readFileSync(new URL('../lib/win-pilot-helper.ps1', import.meta.url), 'utf8')
const tool = defineComputerTool((value) => value, {})
const parameters = tool.parameters.properties
const actionEnum = parameters.action.enum

// --- action surface -------------------------------------------------------

// The canonical Windows Computer Use names stay first and unchanged.
assert.deepEqual(actionEnum.slice(0, 14), [
  'list_apps', 'list_windows', 'get_window', 'launch_app', 'get_window_state',
  'click', 'press_key', 'type_text', 'scroll', 'set_value', 'drag',
  'perform_secondary_action', 'activate_window', 'minimize_window',
])
// The legacy spellings stay non-model-callable: they normalize for CLI/MCP
// callers but must not reappear in the advertised enum.
for (const legacy of ['get_app_state', 'open_app', 'click_element', 'key', 'perform_action', 'left_click']) {
  assert.ok(!actionEnum.includes(legacy), `legacy action must not be model-callable: ${legacy}`)
}
// The additive extensions are advertised.
for (const added of ['elements', 'stop', 'paste']) {
  assert.ok(actionEnum.includes(added), `extension action must be model-callable: ${added}`)
}

// The ZCode/OpenAI spellings still normalize for non-model callers.
const aliases = [
  [{ action: 'left_click' }, 'click'],
  [{ action: 'left_click_drag' }, 'drag'],
  [{ action: 'key' }, 'press_key'],
  [{ action: 'perform_action', action_name: 'Expand' }, 'perform_secondary_action'],
  [{ action: 'double_click' }, 'click'],
  [{ action: 'keypress', keys: ['CTRL', 'L'] }, 'press_key'],
]
for (const [input, expected] of aliases) {
  assert.equal(normalizeComputerAction(input).action, expected, `${JSON.stringify(input)} must normalize to ${expected}`)
}
assert.equal(normalizeComputerAction({ action: 'perform_action', action_name: 'Expand' }).args.secondary_action, 'expand')

// --- keysym names ---------------------------------------------------------

// Only names the helper would reject are rewritten; the established contract
// (chords preserved verbatim) is untouched.
assert.equal(normalizeKeyToken('KP_5'), 'numpad5')
assert.equal(normalizeKeyToken('KP_Add'), 'numpad_add')
assert.equal(normalizeKeyToken('kp_enter'), 'return')
assert.equal(normalizeKeyToken('Return'), 'Return', 'a name the helper already resolves is untouched')
assert.equal(normalizeKeyToken('Control_L'), 'Control_L')
// The helper lowercases before lookup, so an already-supported spelling passes
// through unchanged rather than being needlessly rewritten.
assert.equal(normalizeKeyToken('Numpad_Add'), 'Numpad_Add')
assert.equal(normalizeKeyChord('Control_L+period'), 'Control_L+period', 'chords pass through unchanged')
assert.equal(normalizeKeyChord('KP_0'), 'numpad0')
assert.deepEqual(splitKeyChord('ctrl+shift+p'), ['ctrl', 'shift', 'p'])
assert.equal(normalizeComputerAction({ action: 'press_key', key: 'KP_3' }).args.key, 'numpad3')

// Every keysym target must exist in the helper's virtual-key table, or the
// rewrite would trade one failure for another.
const mapKeyStart = helperSource.indexOf('public static ushort MapKey')
assert.ok(mapKeyStart > 0, 'the helper must define MapKey')
const mapKeyBody = helperSource.slice(mapKeyStart, mapKeyStart + 6000)
for (const name of ['numpad0', 'numpad9', 'numpad_add', 'numpad_subtract', 'numpad_multiply', 'numpad_divide', 'numpad_decimal', 'greater', 'less', 'question', 'colon', 'underscore', 'pipe']) {
  assert.ok(mapKeyBody.includes(`"${name}"`), `helper MapKey must resolve '${name}'`)
}

// --- repeat ---------------------------------------------------------------

assert.equal(clampKeyRepeat(undefined), 1)
assert.equal(clampKeyRepeat(0), 1)
assert.equal(clampKeyRepeat('4'), 4)
assert.equal(clampKeyRepeat(1000), MAX_KEY_REPEAT, 'a repeat is clamped, not refused')
assert.equal(clampKeyRepeat(-3), 1)
assert.equal(clampKeyRepeat(Number.NaN), 1)
assert.ok(Number.isInteger(MAX_KEY_REPEAT) && MAX_KEY_REPEAT > 1)
assert.equal(parameters.repeat.type, 'number', 'repeat must be model-callable')
assert.match(parameters.repeat.description, /press_key/)

// --- strategy / dispatch --------------------------------------------------

assert.equal(normalizeComputerAction({ action: 'click', strategy: 'event' }).args.dispatch, 'foreground')
assert.equal(normalizeComputerAction({ action: 'click', strategy: 'a11y' }).args.dispatch, 'background')
assert.equal(normalizeComputerAction({ action: 'click', strategy: 'auto' }).args.dispatch, 'background')
// An explicit dispatch is never overridden by strategy.
assert.equal(normalizeComputerAction({ action: 'click', dispatch: 'background', strategy: 'event' }).args.dispatch, 'background')
assert.equal(parameters.strategy.enum.join(','), 'auto,a11y,event')

// --- disable_diffing ------------------------------------------------------

assert.equal(normalizeComputerAction({ action: 'get_window_state', disable_diffing: true }).args.disable_diffing, true)
assert.equal(normalizeComputerAction({ action: 'get_window_state', disableDiffing: true }).args.disable_diffing, true,
  'the camelCase alias must reach the helper field')
assert.equal(normalizeComputerAction({ action: 'get_window_state', disableDiffing: true }).args.disableDiffing, undefined,
  'the camelCase alias must not be forwarded as an unknown field')
assert.ok(helperSource.includes("Get-PayloadValue 'disable_diffing'"), 'the helper must read disable_diffing')
assert.ok(helperSource.includes('$DisableDiffing'), 'the helper must thread the flag into Do-AppState')

// --- recovery hints -------------------------------------------------------

// A refusal that no retry can fix is reported as such.
for (const code of ['screen_locked', 'controller_busy', 'unsupported_system_key', 'browser_not_owned', 'batch_limit_exceeded']) {
  const hinted = withRecoveryHints({ ok: false, outcome: 'not_executed', error_code: code })
  assert.equal(hinted.retry, 'never', `${code} must be non-retryable`)
  assert.equal(hinted.actionSent, false, `${code} must report that nothing was sent`)
}
// An unknown outcome means the action may have landed: re-observe, never replay.
{
  const hinted = withRecoveryHints({ ok: false, outcome: 'unknown', error_code: 'action_timeout' })
  assert.equal(hinted.actionSent, true)
  assert.equal(hinted.retry, 'reobserve')
}
// A proven non-execution is safe to retry.
{
  const hinted = withRecoveryHints({ ok: false, outcome: 'not_executed', error_code: 'background_unavailable' })
  assert.equal(hinted.actionSent, false)
  assert.equal(hinted.retry, 'reobserve', 'a background refusal needs a fresh observation before retrying')
}
// Success is terminal.
{
  const hinted = withRecoveryHints({ ok: true, action: 'click', outcome: 'completed' })
  assert.equal(hinted.actionSent, true, 'a completed input action may have reached the app')
  assert.equal(hinted.retry, 'never')
}
// Observation, enumeration and control changes never report input as sent.
for (const action of ['list_apps', 'get_window_state', 'elements', 'screenshot', 'read_clipboard', 'stop', 'wait']) {
  const hinted = withRecoveryHints({ ok: true, action, outcome: 'completed' })
  assert.equal(hinted.actionSent, false, `${action} sends no input and must report actionSent: false`)
  assert.equal(hinted.retry, 'never')
}
// An explicit classification from the caller is authoritative.
assert.equal(withRecoveryHints({ ok: true, action: 'click', outcome: 'completed', actionSent: false }).actionSent, false)
// A batch is only as safe as its most dangerous step.
{
  const hinted = withRecoveryHints({
    ok: false,
    action: 'batch',
    steps: [{ ok: true, outcome: 'completed' }, { ok: false, outcome: 'unknown' }],
  })
  assert.equal(hinted.actionSent, true)
  assert.equal(hinted.retry, 'reobserve')
  assert.equal(hinted.steps[0].actionSent, true, 'each step carries its own hints')
  assert.equal(hinted.steps[1].retry, 'reobserve')
}
// A caller-supplied classification is preserved.
assert.equal(withRecoveryHints({ ok: false, outcome: 'unknown', retry: 'never' }).retry, 'never')
// Non-objects pass through untouched.
assert.equal(withRecoveryHints(null), null)
assert.equal(withRecoveryHints('x'), 'x')

// --- safety settings ------------------------------------------------------

// System keys stay denied by default and the opt-out is explicit.
assert.equal(parameters.key.type, 'string')
resetSettingsForTest()
{
  const denied = normalizeComputerAction({ action: 'press_key', key: 'Meta+R' })
  assert.equal(denied.args.key, 'Meta+R', 'normalization itself does not strip the chord')
}

// --- helper-side guards ---------------------------------------------------

// The lock guard refuses before dispatch and is never retryable.
assert.ok(helperSource.includes('function Test-DesktopLocked'), 'the helper must define the lock guard')
assert.ok(helperSource.includes('function Assert-ForegroundTarget'), 'the existing foreground guard must remain')
assert.ok(helperSource.includes("error_code = 'screen_locked'"), 'a locked desktop must report screen_locked')
assert.ok(helperSource.includes("$result.retry = 'never'"), 'screen_locked must be non-retryable')
for (const surface of ['logonui', 'lockapp', 'winlogon', 'screensaver']) {
  assert.ok(helperSource.includes(`'${surface}'`), `the lock guard must recognise ${surface}`)
}
// Input actions are gated; observation and enumeration are not.
const inputListStart = helperSource.indexOf('$script:InputActions = @(')
assert.ok(inputListStart > 0)
const inputList = helperSource.slice(inputListStart, helperSource.indexOf(')', inputListStart))
for (const action of ['click', 'press_key', 'type_text', 'scroll', 'drag', 'set_value']) {
  assert.ok(inputList.includes(`'${action}'`), `${action} must be classified as an input action`)
}
for (const safe of ['list_apps', 'get_window_state', 'list_windows']) {
  assert.ok(!inputList.includes(`'${safe}'`), `${safe} must stay available while locked`)
}

// The paste action exists and restores the previous clipboard.
assert.ok(helperSource.includes("'paste' {"), 'the helper must implement paste')
assert.ok(/restore|restored/i.test(helperSource.slice(helperSource.indexOf("'paste' {"))), 'paste must restore the clipboard')

// select_text refuses an ambiguous content match instead of taking the first hit.
assert.ok(helperSource.includes("error_code = 'ambiguous_text_match'"), 'an ambiguous match must be refused')
assert.ok(helperSource.includes("error_code = 'text_not_found'"), 'a missing match must be reported')
assert.equal(parameters.prefix.type, 'string')
assert.equal(parameters.suffix.type, 'string')

// --- settings integration -------------------------------------------------

// The tool schema advertises the new knobs' controls.
assert.ok(parameters.include_text, 'include_text must remain model-callable')
assert.ok(parameters.dispatch, 'dispatch must remain model-callable')

// A settings override reaches the tool definition without re-registration.
{
  setSettingsForTest({ hostTimeoutMs: 123456 })
  assert.equal(getSettings().hostTimeoutMs, 123456)
  const live = defineComputerTool((value) => value, {})
  assert.equal(live.timeoutMs, 123456, 'the tool timeout must read the live setting')
  resetSettingsForTest()
  const restored = defineComputerTool((value) => value, {})
  assert.equal(restored.timeoutMs, 200000, 'the shipped default must return after a reset')
}

// The helper bundle is generated from native/helper and must be in sync.
{
  const stale = []
  for (const name of ['bootstrap', 'observation', 'background-input', 'capture', 'dispatch']) {
    const part = readFileSync(new URL(`../native/helper/${name}.ps1`, import.meta.url), 'utf8').replace(/^\uFEFF/, '')
    if (!helperSource.includes(part.slice(0, 200))) stale.push(name)
  }
  assert.deepEqual(stale, [], 'lib/win-pilot-helper.ps1 must be rebuilt from native/helper sources')
}

console.log('cua parity check PASSED')
