// User-activity guard: refuse background input while the user is using the
// desktop.
//
// This is the Codex "guarded input" posture (its Windows runtime installs a
// keyboard hook in src/input/interruption.rs and aborts input on user activity)
// implemented with GetLastInputInfo instead of a hook.
//
// The property is only meaningful if Win-Pilot's OWN synthetic input does not
// advance the tick it reads, so that premise is asserted here too, by fixture.
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

assert.equal(getSettings().userActivityGuard, false, 'the shipped default must be off')
const param = tool.parameters.properties.user_activity_guard
assert.ok(param, 'user_activity_guard must be a model-facing parameter')
assert.equal(param.type, 'boolean')

// The guard must be scoped to background dispatch: real foreground input
// advances the same tick, so guarding there would always trip on our own input.
const guardStart = helperSource.indexOf("if ($dispatchMode -eq 'background' -and $script:InputActions -contains $Action)")
assert.ok(guardStart > 0, 'the helper must scope the activity guard to background dispatch')
const guardBody = helperSource.slice(guardStart, guardStart + 900)
assert.ok(guardBody.includes("'user_active'"), 'the guard must report user_active')
assert.ok(guardBody.includes("$result.action_sent = $false"),
  'a refused action must report that nothing was sent')
assert.ok(guardBody.includes("$result.retry = 'retry'"),
  'a refused action must be retry-safe, not a hard stop')
assert.match(helperSource, /function Test-UserActivity/, 'the helper must define the activity probe')
assert.match(helperSource, /LastInputIdleMs\(\)/, 'the probe must read the system last-input tick')
assert.match(helperSource, /Get-UserActivityGraceSeconds/,
  'the helper must accept a per-call activity window')

// A boolean and a number are both accepted, so a slow host can widen the window.
assert.match(helperSource, /\$raw -is \[bool\]/, 'user_activity_guard must accept a boolean')
assert.match(helperSource, /TryParse/, 'user_activity_guard must accept a numeric window')

// --- the premise, measured by fixture ------------------------------------

// If Win-Pilot's own background input advanced the tick, the guard would refuse
// its own actions. The fixture asserts PostMessage/SendMessage/UIA do not.
{
  const fixture = path.join(root, 'test', 'fixtures', 'user-activity-probe.ps1')
  const output = execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-File', fixture], {
    encoding: 'utf8', windowsHide: true, timeout: 120000,
  })
  assert.match(output, /USER_ACTIVITY_PREMISE_OK/,
    `the own-input premise must hold:\n${output}`)
}

// --- live behaviour -------------------------------------------------------

function runHelper(action, payload) {
  return new Promise((resolve) => {
    const child = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(root, 'lib', 'win-pilot-helper.ps1'),
      '-Action', action, '-PayloadStdin', '-TimeoutMs', '30000',
    ], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', (d) => { out += d })
    child.on('close', () => {
      const first = out.indexOf('{'); const last = out.lastIndexOf('}')
      try { resolve(JSON.parse(out.slice(first, last + 1))) }
      catch { resolve({ parse_error: out.slice(0, 200) }) }
    })
    child.stdin.end(JSON.stringify(payload))
  })
}

/** Read the system idle time, optionally generating real input first. */
function idleMs(generateInput) {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class IdleFixture {
  [StructLayout(LayoutKind.Sequential)] public struct LII { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LII p);
  [DllImport("kernel32.dll")] public static extern uint GetTickCount();
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte s, uint f, IntPtr e);
  public static int Idle() {
    LII l = new LII();
    l.cbSize = (uint)Marshal.SizeOf(typeof(LII));
    if (!GetLastInputInfo(ref l)) return -1;
    return (int)(GetTickCount() - l.dwTime);
  }
  public static void Press() { keybd_event(0x10, 0, 0, IntPtr.Zero); keybd_event(0x10, 0, 2, IntPtr.Zero); }
}
"@
${generateInput ? '[IdleFixture]::Press()' : ''}
[IdleFixture]::Idle()
`
  return Number(execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-Command', script], {
    encoding: 'utf8', windowsHide: true, timeout: 60000,
  }).trim())
}

const fixtureProcess = spawn('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
  '-File', path.join(root, 'test', 'fixtures', 'native-window.ps1'),
], { windowsHide: true, stdio: 'ignore' })

try {
  let target
  for (let attempt = 0; attempt < 60 && !target; attempt++) {
    const listed = await tool.execute({ action: 'list_windows' })
    target = (listed.windows ?? []).find((w) =>
      w.pid === fixtureProcess.pid && w.title === 'Win-Pilot native test fixture')
    if (!target) await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(target?.hwnd, 'the owned fixture window must become discoverable')

  // An idle desktop must not be blocked (the guard is not a blanket refusal).
  //
  // Wait for the system to be genuinely idle first: a previous run of this or
  // any other check may have left real input within the activity window, which
  // would make this negative case flaky rather than meaningful.
  let idleNow = idleMs(false)
  for (let attempt = 0; attempt < 40 && idleNow < 2500; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    idleNow = idleMs(false)
  }
  const idleRun = await runHelper('click', {
    hwnd: target.hwnd, element_index: 1,
    dispatch: 'background', focus_policy: 'never', user_activity_guard: 2,
  })
  assert.notEqual(idleRun.error_code, 'user_active',
    `an idle desktop must not be refused (idle=${idleNow}ms): ${JSON.stringify(idleRun)}`)

  // Real input must block it, and the refusal must be retry-safe with nothing sent.
  const freshIdle = idleMs(true)
  assert.ok(freshIdle < 2000, `the probe must produce fresh input (idle=${freshIdle}ms)`)
  const activeRun = await runHelper('click', {
    hwnd: target.hwnd, element_index: 1,
    dispatch: 'background', focus_policy: 'never', user_activity_guard: 2,
  })
  assert.equal(activeRun.error_code, 'user_active',
    `recent real input must be refused: ${JSON.stringify(activeRun)}`)
  assert.equal(activeRun.action_sent, false, 'a refused action must send nothing')
  assert.equal(activeRun.retry, 'retry', 'a refusal must be retry-safe')
  assert.equal(activeRun.needs_observation, true, 'a refusal must ask for re-observation')
  assert.equal(activeRun.ok, false, 'a refusal is not ok')

  // The same real input must not block once the guard is off.
  const offRun = await runHelper('click', {
    hwnd: target.hwnd, element_index: 1,
    dispatch: 'background', focus_policy: 'never', user_activity_guard: 0,
  })
  assert.notEqual(offRun.error_code, 'user_active',
    `guard=0 must override the guard: ${JSON.stringify(offRun)}`)

  // `true` must use the documented window, not silently mean "off": generate real
  // input and confirm the boolean form refuses.
  idleMs(true)
  const trueRun = await runHelper('click', {
    hwnd: target.hwnd, element_index: 1,
    dispatch: 'background', focus_policy: 'never', user_activity_guard: true,
  })
  assert.equal(trueRun.error_code, 'user_active',
    `guard=true must use the 2s window: ${JSON.stringify(trueRun)}`)

  // An explicit per-call numeric window must work too.
  idleMs(true)
  const numericRun = await runHelper('click', {
    hwnd: target.hwnd, element_index: 1,
    dispatch: 'background', focus_policy: 'never', user_activity_guard: 5,
  })
  assert.equal(numericRun.error_code, 'user_active',
    `a numeric window must be honoured: ${JSON.stringify(numericRun)}`)

  // Observation must never be blocked by the activity guard.
  const observed = await runHelper('get_window', {
    hwnd: target.hwnd, dispatch: 'background', user_activity_guard: 60,
  })
  assert.notEqual(observed.error_code, 'user_active',
    'observation must stay available while the guard is active')

  // Settings integration: a stored value reaches the request the tool builds.
  setSettingsForTest({ userActivityGuard: true })
  assert.equal(getSettings().userActivityGuard, true, 'a stored value must reach live reads')
  resetSettingsForTest()
  assert.equal(getSettings().userActivityGuard, false, 'reset must restore the default')
} finally {
  try { fixtureProcess.kill() } catch { /* already gone */ }
  stopDaemon()
}

console.log('user activity guard check PASSED')
