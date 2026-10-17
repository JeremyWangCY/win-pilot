// Model-facing Computer Use argument normalization and action capability sets.

export const OBSERVE_AFTER_ACTIONS = new Set([
  'click', 'drag', 'scroll', 'press_key', 'type_text', 'set_value', 'wait', 'mouse_move',
])

export const FOREGROUND_RECOVERY_ACTIONS = new Set([
  'click', 'press_key', 'type_text', 'scroll', 'drag', 'mouse_down', 'mouse_up', 'hold_key',
])

/** Upper bound on a single `repeat` request; larger values are clamped, not refused. */
export const MAX_KEY_REPEAT = 50

/**
 * Clamp a requested key repeat count.
 *
 * `repeat` exists so a model does not spend one tool call per keypress. The
 * bound keeps one request from turning into an unbounded burst of input.
 * @param value - requested repeat count; anything non-finite counts as 1.
 * @returns an integer in 1..{@link MAX_KEY_REPEAT}.
 */
export function clampKeyRepeat(value) {
  const n = Math.floor(Number(value))
  if (!Number.isFinite(n) || n <= 1) return 1
  return Math.min(n, MAX_KEY_REPEAT)
}

// Refusals that no retry can turn into success: the request itself is
// unsupported, or the environment refuses input outright. Retrying these only
// burns turns, so they are reported `retry: 'never'` regardless of outcome.
const NEVER_RETRYABLE = new Set([
  'screen_locked',
  'controller_busy',
  'control_stopped',
  'runtime_closed',
  'browser_not_owned',
  'batch_limit_exceeded',
  'invalid_postcondition',
  'invalid_precondition',
  'invalid_batch_step',
  'nested_batch_not_allowed',
  'unsupported_action',
])

// Outcomes that prove nothing reached the target. These are safe to reissue
// after the caller repairs whatever refused them.
const NOT_EXECUTED = new Set(['not_executed'])

// Outcomes where the action may already have been delivered. Never replay
// these blindly: the caller must re-observe first.
const UNCERTAIN = new Set(['unknown'])

// Actions that inject no input at all: observation, enumeration, and control
// changes. Their `actionSent` is always false — reporting true would tell a
// caller that something may have reached the application when nothing did.
const OBSERVATION_ACTIONS = new Set([
  'list_apps', 'list_windows', 'get_window', 'get_window_state', 'get_app_identity',
  'screenshot', 'elements', 'read_clipboard', 'list_displays', 'cursor_position',
  'browser_state', 'browser_observe', 'browser_read', 'browser_tabs', 'browser_events',
  'browser_downloads', 'browser_history', 'browser_wait', 'browser_request',
  'browser_frames', 'browser_filechooser', 'browser_claim_tab',
  'stop', 'resume', 'control_status', 'control_release', 'wait', 'zoom',
])

// Actions that change control state rather than reaching an application.
const CONTROL_ACTIONS = new Set(['stop', 'resume', 'control_status', 'control_release', 'browser_shutdown', 'browser_close', 'browser_finalize'])

/**
 * Classify one action result for retry safety.
 *
 * This mirrors the ChatGPT/ZCode contract: `actionSent` states whether the
 * action may already have reached the application, and `retry` tells the caller
 * what to do next. It is derived from data Win-Pilot already reports, so it adds
 * no new failure modes — it only makes the existing semantics explicit and
 * uniform across desktop, browser, and batch results.
 * @param value - one action result (or a batch result carrying `steps`).
 * @returns the same object with `actionSent` and `retry` filled in.
 */
export function withRecoveryHints(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  if (Array.isArray(value.steps)) {
    const steps = value.steps.map((step) => withRecoveryHints(step))
    // A batch is only as safe as its most dangerous step.
    const sent = steps.some((step) => step?.actionSent === true)
    const uncertain = steps.some((step) => step && UNCERTAIN.has(step.outcome))
    return {
      ...value,
      steps,
      actionSent: sent,
      retry: value.retry ?? (uncertain || sent ? 'reobserve' : 'retry'),
    }
  }
  const action = typeof value.action === 'string' ? value.action : ''
  const code = typeof value.error_code === 'string' ? value.error_code : ''
  const outcome = typeof value.outcome === 'string' ? value.outcome : (value.ok === true ? 'completed' : '')
  // An explicit classification from the caller is authoritative: it knows things
  // this heuristic cannot (a control change, an observation, a lease refusal).
  let actionSent = typeof value.actionSent === 'boolean' ? value.actionSent
    : typeof value.action_sent === 'boolean' ? value.action_sent : undefined
  if (actionSent === undefined) {
    if (NEVER_RETRYABLE.has(code)) actionSent = false
    else if (OBSERVATION_ACTIONS.has(action) || CONTROL_ACTIONS.has(action)) actionSent = false
    else if (NOT_EXECUTED.has(outcome)) actionSent = false
    else if (UNCERTAIN.has(outcome)) actionSent = true
    else actionSent = value.ok === true
  }
  let retry
  if (NEVER_RETRYABLE.has(code)) retry = 'never'
  else if (actionSent && value.ok !== true) retry = 'reobserve'
  else if (value.ok === true) retry = 'never'
  else if (value.retry_safe === true) retry = 'retry'
  else retry = 'reobserve'
  return { ...value, actionSent, retry: value.retry ?? retry }
}

/**
 * X keysym style key names that Win-Pilot's helper does NOT already accept.
 *
 * Only these are rewritten in the request. Names the helper already resolves
 * (`Return`, `Escape`, `Control_L`, `ctrl`, `+`-separated chords, …) pass through
 * untouched, so the long-standing model-facing contract is unchanged; this table
 * is purely additive and exists so a request written for the ZCode or ChatGPT
 * runtime runs unchanged here.
 */
const KEYSYM_ALIASES = new Map(Object.entries({
  kp_enter: 'return',
  numpad_enter: 'return',
  greater: 'greater',
  less: 'less',
  question: 'question',
  colon: 'colon',
  quote: 'apostrophe',
  grave: 'grave',
  underscore: 'underscore',
  pipe: 'pipe',
  kp_add: 'numpad_add',
  kp_subtract: 'numpad_subtract',
  kp_multiply: 'numpad_multiply',
  kp_divide: 'numpad_divide',
  kp_decimal: 'numpad_decimal',
}))

for (let digit = 0; digit <= 9; digit++) {
  KEYSYM_ALIASES.set(`kp_${digit}`, `numpad${digit}`)
  KEYSYM_ALIASES.set(`numpad_${digit}`, `numpad${digit}`)
}

/**
 * Normalize one key token, leaving names the helper already understands as-is.
 * @param token - one key or modifier token from a chord.
 * @returns the helper-compatible token.
 */
export function normalizeKeyToken(token) {
  const raw = String(token ?? '').trim()
  if (!raw) return raw
  const lower = raw.toLowerCase().replace(/[\s-]+/g, '_')
  return KEYSYM_ALIASES.get(lower) ?? raw
}

/** Split a `+`-separated chord into its trimmed tokens. */
export function splitKeyChord(chord) {
  return String(chord ?? '')
    .split('+')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/**
 * Normalize a key or `+`-separated chord, mapping only keysym spellings the
 * helper would otherwise reject.
 * @param value - a key name or chord such as `KP_5` or `Control_L+period`.
 * @returns the chord in the form the helper expects.
 */
export function normalizeKeyChord(value) {
  const tokens = splitKeyChord(value)
  if (tokens.length === 0) return ''
  return tokens.map(normalizeKeyToken).join('+')
}

export function normalizeComputerAction(input = {}) {
  const args = { ...(input || {}) }
  const requestedAction = String(args.action || 'list_apps')
  let action = requestedAction

  if (action === 'double_click') {
    action = 'click'
    if (args.click_count === undefined) args.click_count = 2
  } else if (action === 'left_click') {
    action = 'click'
  } else if (action === 'type') {
    action = 'type_text'
  } else if (action === 'keypress') {
    action = 'press_key'
    if (args.key === undefined && Array.isArray(args.keys) && args.keys.length > 0) {
      args.key = args.keys.map(String).join('+')
    }
  } else if (action === 'move') {
    action = 'mouse_move'
  }
  // ZCode/ChatGPT spellings that map onto the same canonical actions.
  if (action === 'left_click_drag') {
    action = 'drag'
  } else if (action === 'key') {
    action = 'press_key'
  } else if (action === 'perform_action') {
    action = 'perform_secondary_action'
    if (args.secondary_action === undefined && args.action_name !== undefined) args.secondary_action = args.action_name
  }
  // `strategy` is the ZCode name for Win-Pilot's `dispatch`; `event` is global
  // input (foreground) and `a11y`/`auto` prefer the background path.
  if (args.dispatch === undefined && typeof args.strategy === 'string') {
    const strategy = args.strategy.toLowerCase()
    if (strategy === 'event') args.dispatch = 'foreground'
    else if (strategy === 'a11y' || strategy === 'auto') args.dispatch = 'background'
  }
  // `disable_diffing` (ZCode/Computer Use spelling) asks for a complete
  // accessibility tree instead of a delta; the helper reads the same field name.
  if (args.disable_diffing === undefined && args.disableDiffing !== undefined) {
    args.disable_diffing = args.disableDiffing
  }
  delete args.disableDiffing
  args.action = action
  if (typeof args.key === 'string' && args.key) {
    args.key = normalizeKeyChord(args.key)
  }
  if (args.window && typeof args.window === 'object' && !Array.isArray(args.window)) {
    if (args.hwnd === undefined && args.window.id !== undefined) args.hwnd = args.window.id
    if (args.app === undefined && args.window.app !== undefined) args.app = args.window.app
  }
  if (args.browser && typeof args.browser === 'object' && !Array.isArray(args.browser)) {
    if (args.browser_endpoint === undefined && args.browser.endpoint !== undefined) args.browser_endpoint = args.browser.endpoint
    if (args.tab_id === undefined && args.browser.tab_id !== undefined) args.tab_id = args.browser.tab_id
  }
  if (args.element === undefined && args.element_index !== undefined) args.element = args.element_index
  if (args.button === undefined && args.mouse_button !== undefined) args.button = args.mouse_button
  if (typeof args.button === 'string') {
    const mouseButton = args.button.toLowerCase()
    if (mouseButton === 'l') args.button = 'left'
    else if (mouseButton === 'r') args.button = 'right'
    else if (mouseButton === 'm' || mouseButton === 'wheel') args.button = 'middle'
  }
  if (args.screenshot === undefined && args.include_screenshot !== undefined) {
    args.screenshot = args.include_screenshot
  }
  if (args.scroll_x === undefined && args.scrollX !== undefined) args.scroll_x = args.scrollX
  if (args.scroll_y === undefined && args.scrollY !== undefined) args.scroll_y = args.scrollY
  if (action === 'launch_app') {
    if (args.name === undefined) args.name = args.app
    delete args.app
  }
  if (args.screenshot_id === undefined && args.screenshotId !== undefined) {
    args.screenshot_id = args.screenshotId
  }
  if (action === 'zoom' && args.path === undefined && typeof args.screenshot_path === 'string') {
    args.path = args.screenshot_path
  }
  if (action === 'zoom') delete args.screenshot_path
  if (action === 'perform_secondary_action' && typeof args.secondary_action === 'string') {
    args.secondary_action = args.secondary_action.trim().toLowerCase().replace(/[\s-]+/g, '_')
  }
  if ((requestedAction === 'scroll' || action === 'scroll')
      && (args.scroll_x !== undefined || args.scroll_y !== undefined)) {
    const sx = Number(args.scroll_x || 0)
    const sy = Number(args.scroll_y || 0)
    const component = (delta, positive, negative) => ({
      amount: Math.max(1, Math.round(Math.abs(delta) / 120)),
      direction: delta > 0 ? positive : negative,
    })
    if (sx !== 0 && sy !== 0) {
      args.scroll_components = [
        component(sx, 'right', 'left'),
        component(sy, 'down', 'up'),
      ]
      Object.assign(args, args.scroll_components[0])
    } else if (sx !== 0) {
      Object.assign(args, component(sx, 'right', 'left'))
    } else if (sy !== 0) {
      Object.assign(args, component(sy, 'down', 'up'))
    }
  }

  if (requestedAction === 'drag' && Array.isArray(args.path) && args.path.length >= 2) {
    const pointXY = (point) => Array.isArray(point)
      ? (point.length >= 2 ? [Number(point[0]), Number(point[1])] : null)
      : (point && typeof point === 'object'
          && Number.isFinite(Number(point.x))
          && Number.isFinite(Number(point.y))
          ? [Number(point.x), Number(point.y)] : null)
    const first = pointXY(args.path[0])
    const last = pointXY(args.path.at(-1))
    if (first && last) {
      args.from_x = first[0]
      args.from_y = first[1]
      args.to_x = last[0]
      args.to_y = last[1]
    }
  }

  if (['click', 'scroll', 'drag'].includes(requestedAction)
      && Array.isArray(args.keys)
      && args.keys.length > 0
      && args.modifiers === undefined) {
    args.modifiers = args.keys.map((key) => String(key)).join(',')
  }

  return { requestedAction, action, args }
}
