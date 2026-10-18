import assert from 'node:assert/strict'
import cp from 'node:child_process'
import { EventEmitter } from 'node:events'
import { syncBuiltinESMExports } from 'node:module'

// Exercise the real tool/JSONL dispatcher against an explicit native boundary
// double. This test must never change the user's clipboard or send mouse/key
// input to the current foreground window. Native clipboard transaction behavior
// is covered separately by clipboard-format.check.mjs with a DataObject fixture.
const originalSpawn = cp.spawn
const dispatched = []
let clipboard = ''
cp.spawn = (_exe, argv) => {
  assert.ok(argv.includes('-Server'), 'features must use the native JSONL boundary')
  const child = new EventEmitter()
  child.unref = () => {}
  child.kill = () => { queueMicrotask(() => child.emit('close', 0)); return true }
  for (const name of ['stdin', 'stdout', 'stderr']) {
    child[name] = new EventEmitter()
    for (const method of ['unref', 'resume', 'setEncoding']) child[name][method] = () => {}
  }
  child.stdin.write = data => {
    const request = JSON.parse(data)
    dispatched.push(request)
    const { action } = request
    let result
    if (action === 'write_clipboard') {
      clipboard = request.text
      result = { ok: true, action, length: clipboard.length }
    } else if (action === 'read_clipboard') result = { ok: true, action, text: clipboard }
    else if (action === 'list_displays') result = { ok: true, action, display_count: 1,
      displays: [{ index: 1, id: 'fixture-display', primary: true,
        bounds: { x: 0, y: 0, width: 1024, height: 768 },
        working_area: { x: 0, y: 0, width: 1024, height: 728 } }] }
    else if (action === 'mouse_down' || action === 'mouse_up') result = { ok: true, action, button: request.button }
    else if (action === 'hold_key') result = { ok: true, action, key: request.key, duration_ms: request.duration_ms }
    else throw new Error(`Unexpected native action in feature fixture: ${action}`)
    queueMicrotask(() => child.stdout.emit('data', `${JSON.stringify({ ...result, id: request.id })}\n`))
    return true
  }
  return child
}
syncBuiltinESMExports()
const { defineComputerTool, stopDaemon } = await import('../lib/index.js')
try {

// 1. defineComputerTool schema assertions
const tool = defineComputerTool((def) => def)
assert.equal(tool.name, 'computer')
const params = tool.parameters.properties

const expectedActions = [
  'read_clipboard',
  'write_clipboard',
  'mouse_down',
  'mouse_up',
  'hold_key',
  'list_displays',
]

for (const act of expectedActions) {
  assert.ok(
    params.action.enum.includes(act),
    `action enum must include '${act}', current enum: ${JSON.stringify(params.action.enum)}`
  )
}

// button property schema
assert.ok(params.button, 'button parameter must be present')
assert.equal(params.button.type, 'string')
assert.deepEqual(params.button.enum, ['left', 'right', 'middle', 'wheel', 'back', 'forward'])
assert.equal(
  params.button.description,
  'Mouse button for click and mouse_down/mouse_up (default left). wheel is an alternative name for the middle button; back and forward are the physical extended buttons.'
)

// duration_ms property schema
assert.ok(params.duration_ms, 'duration_ms parameter must be present')
assert.equal(params.duration_ms.type, 'number')
assert.equal(
  params.duration_ms.description,
  'Hold duration in milliseconds for hold_key (default 500, max 10000).'
)

// 2. Clipboard requests execute and round-trip through the JSONL fixture.
const testPayload = `dsh-test-clipboard-payload-${Date.now()}-${Math.random().toString(36).slice(2)}`
const writeRes = await tool.execute({
  action: 'write_clipboard',
  text: testPayload,
})
assert.ok(writeRes, 'write_clipboard must return a result object')
assert.equal(writeRes.ok, true, `write_clipboard should succeed: ${JSON.stringify(writeRes)}`)
assert.equal(writeRes.action, 'write_clipboard')
assert.equal(writeRes.length, testPayload.length)

const readRes = await tool.execute({
  action: 'read_clipboard',
})
assert.ok(readRes, 'read_clipboard must return a result object')
assert.equal(readRes.ok, true, `read_clipboard should succeed: ${JSON.stringify(readRes)}`)
assert.equal(readRes.action, 'read_clipboard')
assert.equal(readRes.text, testPayload, 'read_clipboard must return the text that was written')

// Also verify round-trip with empty text
const writeEmptyRes = await tool.execute({
  action: 'write_clipboard',
  text: '',
})
assert.equal(writeEmptyRes.ok, true, 'write_clipboard with empty text should succeed')
assert.equal(writeEmptyRes.length, 0)

const readEmptyRes = await tool.execute({
  action: 'read_clipboard',
})
assert.equal(readEmptyRes.ok, true, 'read_clipboard after empty write should succeed')
assert.equal(readEmptyRes.text, '', 'read_clipboard should return empty string')

// 3. Display response shape through the native boundary fixture.
const displaysRes = await tool.execute({
  action: 'list_displays',
})
assert.ok(displaysRes, 'list_displays must return a result object')
assert.equal(displaysRes.ok, true, `list_displays should succeed: ${JSON.stringify(displaysRes)}`)
assert.equal(displaysRes.action, 'list_displays')
assert.ok(
  typeof displaysRes.display_count === 'number' && displaysRes.display_count >= 1,
  `display_count must be >= 1, got ${displaysRes.display_count}`
)
assert.ok(
  Array.isArray(displaysRes.displays) && displaysRes.displays.length >= 1,
  'displays must be a non-empty array'
)

for (const disp of displaysRes.displays) {
  assert.ok(typeof disp.index === 'number' && disp.index >= 1, 'display index must be 1-based number')
  assert.ok(typeof disp.id === 'string' && disp.id.length > 0, 'display id must be non-empty string')
  assert.ok(typeof disp.primary === 'boolean', 'display primary must be boolean')

  assert.ok(disp.bounds, 'display bounds must be defined')
  assert.equal(typeof disp.bounds.x, 'number')
  assert.equal(typeof disp.bounds.y, 'number')
  assert.ok(typeof disp.bounds.width === 'number' && disp.bounds.width > 0, 'bounds.width must be positive')
  assert.ok(typeof disp.bounds.height === 'number' && disp.bounds.height > 0, 'bounds.height must be positive')

  assert.ok(disp.working_area, 'display working_area must be defined')
  assert.equal(typeof disp.working_area.x, 'number')
  assert.equal(typeof disp.working_area.y, 'number')
  assert.ok(typeof disp.working_area.width === 'number' && disp.working_area.width > 0, 'working_area.width must be positive')
  assert.ok(typeof disp.working_area.height === 'number' && disp.working_area.height > 0, 'working_area.height must be positive')
}

// 4. Also exercise mouse_down, mouse_up, and hold_key through execute()
const mouseDownRes = await tool.execute({
  action: 'mouse_down',
  button: 'left',
  x: 50,
  y: 50,
  dispatch: 'background',
})
assert.ok(mouseDownRes, 'mouse_down should return a result')
assert.equal(mouseDownRes.ok, true, `mouse_down should succeed: ${JSON.stringify(mouseDownRes)}`)
assert.equal(mouseDownRes.action, 'mouse_down')
assert.equal(mouseDownRes.button, 'left')

const mouseUpRes = await tool.execute({
  action: 'mouse_up',
  button: 'left',
  x: 50,
  y: 50,
  dispatch: 'background',
})
assert.ok(mouseUpRes, 'mouse_up should return a result')
assert.equal(mouseUpRes.ok, true, `mouse_up should succeed: ${JSON.stringify(mouseUpRes)}`)
assert.equal(mouseUpRes.action, 'mouse_up')
assert.equal(mouseUpRes.button, 'left')

const holdKeyRes = await tool.execute({
  action: 'hold_key',
  key: 'Shift',
  duration_ms: 60,
  dispatch: 'background',
})
assert.ok(holdKeyRes, 'hold_key should return a result')
assert.equal(holdKeyRes.ok, true, `hold_key should succeed: ${JSON.stringify(holdKeyRes)}`)
assert.equal(holdKeyRes.action, 'hold_key')
assert.equal(holdKeyRes.key, 'Shift')
assert.equal(holdKeyRes.duration_ms, 60)

assert.deepEqual(dispatched.map(request => request.action), [
  'write_clipboard', 'read_clipboard', 'write_clipboard', 'read_clipboard',
  'list_displays', 'mouse_down', 'mouse_up', 'hold_key',
], 'tool must dispatch each native request exactly once')
for (const action of ['mouse_down', 'mouse_up']) {
  const request = dispatched.find(request => request.action === action)
  assert.equal(request.dispatch, 'background')
  assert.equal(request.x, 50)
  assert.equal(request.y, 50)
  assert.equal(request.button, 'left')
}
const held = dispatched.find(request => request.action === 'hold_key')
assert.equal(held.key, 'Shift')
assert.equal(held.duration_ms, 60)
assert.equal(held.dispatch, 'background')
console.log('features check PASSED (real tool/JSONL pipeline; native boundary mocked, no OS clipboard/input)')
} finally {
  stopDaemon()
  cp.spawn = originalSpawn
  syncBuiltinESMExports()
}
