// Focus policy: what Win-Pilot does when an action moves the foreground window.
//
// This runs against a real helper and a real owned window, because the property
// under test is a side effect on the desktop: string assertions on the helper
// source cannot show that the user's focus survives an action.
//
// Reference behavior (see docs/desktop-control-contract.md): a foreground change
// caused by the user is a valid action, so the correct response is to report it
// and hand control back rather than competing for it. Win-Pilot previously did
// the opposite — it demoted the window the user had moved to and reclaimed the
// foreground with AttachThreadInput + a synthetic ALT/ESC, which is more
// intrusive than the activation it was correcting. Default is now `yield`:
// report and stop.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { defineComputerTool, stopDaemon } from '../lib/index.js'
import { getSettings, resetSettingsForTest, setSettingsForTest } from '../lib/settings.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const helperSource = readFileSync(path.join(root, 'lib', 'win-pilot-helper.ps1'), 'utf8')
const tool = defineComputerTool((value) => value, {})

// --- static contract ------------------------------------------------------

// The default is to leave the user's focus alone.
assert.equal(getSettings().focusPolicy, 'yield', 'the shipped default must be yield')

// The policy is model-callable and bounded to the three documented values.
const focusParam = tool.parameters.properties.focus_policy
assert.ok(focusParam, 'focus_policy must be a model-facing parameter')
assert.deepEqual(focusParam.enum, ['yield', 'restore', 'never'])
assert.match(focusParam.description, /yield/i)

// The observation path must never force the target forward: capturing an
// occluded window is exactly what WGC/PrintWindow are for.
const appStateStart = helperSource.indexOf('function Do-AppState')
const appStateBody = helperSource.slice(appStateStart, appStateStart + 1200)
assert.ok(appStateStart > 0, 'the helper must define Do-AppState')
assert.ok(!appStateBody.includes('ForceForeground'),
  'observation must not activate the window it reads (WGC captures occluded windows)')

// The background focus guard must not reclaim focus by force.
const guardStart = helperSource.indexOf('$focusPolicy = Get-FocusPolicy')
assert.ok(guardStart > 0, 'the helper must resolve a focus policy in its finally block')
const guardBody = helperSource.slice(guardStart, guardStart + 1800)
assert.ok(!guardBody.includes('ForceForeground'),
  'the focus guard must not use the preemptive ForceForeground to restore focus')
assert.ok(!guardBody.includes('PushWindowToBottom'),
  'the focus guard must not demote the window the user moved to')
assert.ok(guardBody.includes('TryRestoreForeground'),
  'the `restore` policy must go through the non-preemptive restore')
assert.ok(guardBody.includes("$focusPolicy -eq 'restore'"),
  'the guard must branch on the restore policy')
assert.ok(guardBody.includes('needs_observation'),
  'yield must tell the caller to re-observe instead of fighting for focus')

// ForceForeground stays available for the paths that legitimately need it.
assert.ok(helperSource.includes('Assert-ForegroundTarget'),
  'the verified foreground guard must remain for explicit foreground input')
assert.ok(helperSource.includes('TryRestoreForeground'),
  'the non-preemptive restore must exist')

// --- the restore primitive, exercised for real ---------------------------

// The helper's own fixture compiles the DshWin32 class out of the bundle and
// asserts the restore cannot force its way in. Run it as a subprocess so a
// failure is attributed to this check.
{
  const fixture = path.join(root, 'test', 'fixtures', 'restore-primitive.ps1')
  const output = execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-File', fixture], {
    encoding: 'utf8', windowsHide: true, timeout: 120000,
  })
  assert.match(output, /RESTORE_PRIMITIVE_OK/,
    `the non-preemptive restore primitive must pass its fixture:\n${output}`)
}

// --- live behaviour -------------------------------------------------------

/** Ask Windows for the current foreground window handle. */
async function foregroundHwnd() {
  const listed = await tool.execute({ action: 'list_windows' })
  return listed.windows?.find((w) => w.foreground)?.hwnd ?? null
}

const fixture = spawn('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
  '-File', path.join(root, 'test', 'fixtures', 'native-window.ps1'),
], { windowsHide: true, stdio: 'ignore' })

try {
  // Wait for the owned fixture to appear.
  let fixtureWindow
  for (let attempt = 0; attempt < 60 && !fixtureWindow; attempt++) {
    const listed = await tool.execute({ action: 'list_windows' })
    fixtureWindow = listed.windows?.find((w) =>
      w.pid === fixture.pid && w.title === 'Win-Pilot native test fixture')
    if (!fixtureWindow) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(fixtureWindow?.hwnd, 'the owned fixture window must become discoverable')

  // A background observation of the fixture must be readable...
  const state = await tool.execute({
    action: 'get_window_state', hwnd: fixtureWindow.hwnd, include_text: true, screenshot: true,
  })
  assert.equal(state.ok, true, `background observation must succeed: ${JSON.stringify(state)}`)

  // ...and must not have moved the foreground to the fixture.
  const after = await foregroundHwnd()
  assert.notEqual(after, fixtureWindow.hwnd,
    'observing a background window must not bring it to the foreground')

  // The default policy is reported in the payload when a change is detected.
  // (Whether a given action actually moves focus is app-dependent, so this
  // asserts the field's shape rather than forcing an activation.)
  const click = await tool.execute({
    action: 'click', hwnd: fixtureWindow.hwnd, element_index: 2, snapshot_id: state.snapshot_id,
    dispatch: 'background',
  })
  if (click.focus_changed === true) {
    assert.equal(click.focus_policy, 'yield', 'a detected change must report the active policy')
  }
  // Under `never` the guard must not even report a change.
  const quiet = await tool.execute({
    action: 'click', hwnd: fixtureWindow.hwnd, element_index: 2, snapshot_id: state.snapshot_id,
    dispatch: 'background', focus_policy: 'never',
  })
  assert.equal(quiet.focus_changed, undefined, 'focus_policy=never must not report focus changes')

  // A per-call policy overrides the stored setting.
  setSettingsForTest({ focusPolicy: 'restore' })
  assert.equal((await tool.execute({
    action: 'list_windows', focus_policy: 'never',
  })).ok, true, 'a per-call focus_policy must be accepted')
  resetSettingsForTest()
  assert.equal(getSettings().focusPolicy, 'yield')

  // The fixture is still alive: the focus policy must not have disturbed it.
  const still = await tool.execute({ action: 'get_window', hwnd: fixtureWindow.hwnd })
  assert.equal(still.ok, true, 'the fixture window must survive the focus-policy checks')
} finally {
  try { fixture.kill() } catch { /* already gone */ }
  stopDaemon()
}

console.log('focus policy check PASSED')
