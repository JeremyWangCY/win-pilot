// Browser key dispatch for the CDP channel.
//
// A Chrome key event needs three things the desktop helper's parser does not
// provide: a DOM `code`, a Windows virtual key code, and — for printable keys —
// the `text` a real press would insert. Without `text` Chromium accepts the
// event but never inserts a character; without `code`, page handlers that key
// off KeyboardEvent.code ignore the press. `location` separates the physical
// key sides and the numeric keypad.
//
// Accepted spellings (names are case-insensitive):
//   named keys     Enter, Return, Tab, Escape, Backspace, Delete, Insert, Home,
//                  End, PageUp, PageDown, ArrowLeft/Up/Right/Down, Space,
//                  PrintScreen, CapsLock, ContextMenu, F1-F24, Shift/Control/
//                  Alt/Meta as a key of their own
//   characters     a-z, 0-9 and US-layout punctuation, given as the character
//                  itself or by English name (period, comma, slash, question,
//                  greater, underscore, ...), including the shifted variants
//   X keysym side Control_L, Shift_R, Alt_L, Super_L — accepted on modifiers
//   keypad         KP_0-KP_9, Numpad_Add/Subtract/Multiply/Divide/Decimal/Enter
//   modifiers      ctrl/control, shift, alt/option, meta/win/cmd/super (chords
//                  only), as in ctrl+shift+p or Control_L+a

const MODIFIERS = Object.freeze({
  alt: 1, option: 1,
  ctrl: 2, control: 2,
  meta: 4, win: 4, windows: 4, cmd: 4, command: 4, super: 4,
  shift: 8,
})

const NAMED = Object.freeze({
  enter: { key: 'Enter', code: 'Enter', vk: 13 },
  return: { key: 'Enter', code: 'Enter', vk: 13 },
  tab: { key: 'Tab', code: 'Tab', vk: 9 },
  escape: { key: 'Escape', code: 'Escape', vk: 27 },
  esc: { key: 'Escape', code: 'Escape', vk: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  delete: { key: 'Delete', code: 'Delete', vk: 46 },
  del: { key: 'Delete', code: 'Delete', vk: 46 },
  insert: { key: 'Insert', code: 'Insert', vk: 45 },
  ins: { key: 'Insert', code: 'Insert', vk: 45 },
  home: { key: 'Home', code: 'Home', vk: 36 },
  end: { key: 'End', code: 'End', vk: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', vk: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  up: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  down: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  space: { key: ' ', code: 'Space', vk: 32 },
  printscreen: { key: 'PrintScreen', code: 'PrintScreen', vk: 44 },
  capslock: { key: 'CapsLock', code: 'CapsLock', vk: 20 },
  contextmenu: { key: 'ContextMenu', code: 'ContextMenu', vk: 93 },
  shift: { key: 'Shift', code: 'ShiftLeft', vk: 16, location: 1 },
  control: { key: 'Control', code: 'ControlLeft', vk: 17, location: 1 },
  ctrl: { key: 'Control', code: 'ControlLeft', vk: 17, location: 1 },
  alt: { key: 'Alt', code: 'AltLeft', vk: 18, location: 1 },
  meta: { key: 'Meta', code: 'MetaLeft', vk: 91, location: 1 },
  super: { key: 'Meta', code: 'MetaLeft', vk: 91, location: 1 },
  win: { key: 'Meta', code: 'MetaLeft', vk: 91, location: 1 },
})

// [unshifted character, shifted character, DOM code, virtual key code]
const CHARACTERS = Object.freeze([
  ['`', '~', 'Backquote', 192],
  ['-', '_', 'Minus', 189],
  ['=', '+', 'Equal', 187],
  ['[', '{', 'BracketLeft', 219],
  [']', '}', 'BracketRight', 221],
  ['\\', '|', 'Backslash', 220],
  [';', ':', 'Semicolon', 186],
  ["'", '"', 'Quote', 222],
  [',', '<', 'Comma', 188],
  ['.', '>', 'Period', 190],
  ['/', '?', 'Slash', 191],
  ['1', '!', 'Digit1', 49],
  ['2', '@', 'Digit2', 50],
  ['3', '#', 'Digit3', 51],
  ['4', '$', 'Digit4', 52],
  ['5', '%', 'Digit5', 53],
  ['6', '^', 'Digit6', 54],
  ['7', '&', 'Digit7', 55],
  ['8', '*', 'Digit8', 56],
  ['9', '(', 'Digit9', 57],
  ['0', ')', 'Digit0', 48],
])

const CHARACTER_NAMES = Object.freeze({
  backquote: '`', grave: '`', tilde: '~',
  minus: '-', hyphen: '-', dash: '-', underscore: '_',
  equal: '=', equals: '=', plus: '+',
  bracketleft: '[', leftbracket: '[', braceleft: '{',
  bracketright: ']', rightbracket: ']', braceright: '}',
  backslash: '\\', bar: '|', pipe: '|',
  semicolon: ';', colon: ':',
  quote: "'", apos: "'", apostrophe: "'", dquote: '"', quotedbl: '"',
  comma: ',', less: '<', lt: '<',
  period: '.', dot: '.', greater: '>', gt: '>',
  slash: '/', question: '?', questionmark: '?',
  exclamation: '!', exclam: '!',
  at: '@',
  hash: '#', numbersign: '#',
  dollar: '$',
  percent: '%',
  caret: '^', asciicircum: '^',
  ampersand: '&',
  asterisk: '*', star: '*',
  parenleft: '(', parenright: ')',
})

const KEYPAD = Object.freeze({
  kp_0: { key: '0', code: 'Numpad0', vk: 96, text: '0' },
  kp_1: { key: '1', code: 'Numpad1', vk: 97, text: '1' },
  kp_2: { key: '2', code: 'Numpad2', vk: 98, text: '2' },
  kp_3: { key: '3', code: 'Numpad3', vk: 99, text: '3' },
  kp_4: { key: '4', code: 'Numpad4', vk: 100, text: '4' },
  kp_5: { key: '5', code: 'Numpad5', vk: 101, text: '5' },
  kp_6: { key: '6', code: 'Numpad6', vk: 102, text: '6' },
  kp_7: { key: '7', code: 'Numpad7', vk: 103, text: '7' },
  kp_8: { key: '8', code: 'Numpad8', vk: 104, text: '8' },
  kp_9: { key: '9', code: 'Numpad9', vk: 105, text: '9' },
  numpad_0: { key: '0', code: 'Numpad0', vk: 96, text: '0' },
  numpad_1: { key: '1', code: 'Numpad1', vk: 97, text: '1' },
  numpad_2: { key: '2', code: 'Numpad2', vk: 98, text: '2' },
  numpad_3: { key: '3', code: 'Numpad3', vk: 99, text: '3' },
  numpad_4: { key: '4', code: 'Numpad4', vk: 100, text: '4' },
  numpad_5: { key: '5', code: 'Numpad5', vk: 101, text: '5' },
  numpad_6: { key: '6', code: 'Numpad6', vk: 102, text: '6' },
  numpad_7: { key: '7', code: 'Numpad7', vk: 103, text: '7' },
  numpad_8: { key: '8', code: 'Numpad8', vk: 104, text: '8' },
  numpad_9: { key: '9', code: 'Numpad9', vk: 105, text: '9' },
  numpad_add: { key: '+', code: 'NumpadAdd', vk: 107, text: '+' },
  kp_add: { key: '+', code: 'NumpadAdd', vk: 107, text: '+' },
  numpad_subtract: { key: '-', code: 'NumpadSubtract', vk: 109, text: '-' },
  kp_subtract: { key: '-', code: 'NumpadSubtract', vk: 109, text: '-' },
  numpad_multiply: { key: '*', code: 'NumpadMultiply', vk: 106, text: '*' },
  kp_multiply: { key: '*', code: 'NumpadMultiply', vk: 106, text: '*' },
  numpad_divide: { key: '/', code: 'NumpadDivide', vk: 111, text: '/' },
  kp_divide: { key: '/', code: 'NumpadDivide', vk: 111, text: '/' },
  numpad_decimal: { key: '.', code: 'NumpadDecimal', vk: 110, text: '.' },
  kp_decimal: { key: '.', code: 'NumpadDecimal', vk: 110, text: '.' },
  numpad_enter: { key: 'Enter', code: 'NumpadEnter', vk: 13 },
  kp_enter: { key: 'Enter', code: 'NumpadEnter', vk: 13 },
})

const CHARS = new Map()
for (const [plain, shifted, code, vk] of CHARACTERS) {
  CHARS.set(plain, { code, vk, shift: false })
  CHARS.set(shifted, { code, vk, shift: true })
}

/** Split a chord into its parts; the last part is the key, the rest modifiers. */
function splitChord(value) {
  if (typeof value !== 'string') throw new Error('Unsupported key')
  const parts = value.split('+').map(part => part.trim()).filter(Boolean)
  if (!parts.length) throw new Error('Unsupported key')
  return parts
}

/**
 * Parse a key name or chord into CDP Input.dispatchKeyEvent parameters.
 * Throws `Unsupported key` — the same message the desktop path uses — for
 * anything that cannot be mapped, so callers report one stable error.
 */
export function keySpec(value) {
  const parts = splitChord(value)
  const rawName = parts.pop()
  let modifiers = 0
  for (const part of parts) {
    const bit = MODIFIERS[part.toLowerCase().replace(/_(l|r)$/, '')]
    if (!bit || (modifiers & bit)) throw new Error('Unsupported key')
    modifiers |= bit
  }
  const name = rawName.replace(/_(l|r)$/i, '').toLowerCase()

  const fn = /^f([1-9]|1\d|2[0-4])$/.exec(name)
  if (fn) {
    const index = Number(fn[1])
    return { key: `F${index}`, code: `F${index}`, modifiers,
      windowsVirtualKeyCode: 111 + index, nativeVirtualKeyCode: 111 + index, location: 0 }
  }

  const keypad = KEYPAD[name]
  if (keypad && !parts.length) {
    return { key: keypad.key, code: keypad.code, modifiers,
      windowsVirtualKeyCode: keypad.vk, nativeVirtualKeyCode: keypad.vk, location: 3,
      ...(keypad.text && !(modifiers & 6) ? { text: keypad.text } : {}) }
  }

  if (/^[a-z]$/.test(name)) {
    const upper = name.toUpperCase()
    const shifted = (modifiers & 8) !== 0
    return { key: shifted ? upper : name, code: `Key${upper}`, modifiers,
      windowsVirtualKeyCode: upper.charCodeAt(0), nativeVirtualKeyCode: upper.charCodeAt(0), location: 0,
      ...(shifted && !(modifiers & 6) ? { text: upper } : {}) }
  }

  const named = NAMED[name]
  if (named) {
    return { key: named.key, code: named.code, modifiers,
      windowsVirtualKeyCode: named.vk, nativeVirtualKeyCode: named.vk, location: named.location ?? 0,
      ...(named.key === ' ' && !(modifiers & 6) ? { text: ' ' } : {}) }
  }

  const char = CHARACTER_NAMES[name] ?? (rawName.length === 1 ? rawName : null)
  const charInfo = char ? CHARS.get(char) : null
  if (charInfo) {
    const combined = modifiers | (charInfo.shift ? 8 : 0)
    return { key: char, code: charInfo.code, modifiers: combined,
      windowsVirtualKeyCode: charInfo.vk, nativeVirtualKeyCode: charInfo.vk, location: 0,
      ...(combined & 6 ? {} : { text: char }) }
  }

  throw new Error('Unsupported key')
}

/** keyDown/keyUp parameter pair for one press of a parsed key. */
export function keyEvents(spec, repeat = 1) {
  const events = []
  // Always keyDown, never rawKeyDown: only `text` decides whether a character is
  // inserted, and a plain keyDown keeps cancellation/release tracking uniform.
  for (let index = 0; index < Math.max(1, Math.min(50, Number(repeat) || 1)); index++) {
    events.push({ type: 'keyDown', ...spec })
    events.push({ type: 'keyUp', ...spec, text: undefined })
  }
  return events
}
