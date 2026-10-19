import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import { createHash } from 'node:crypto'
import { createActivityReporter } from '../lib/activity.js'
import { createWinPilotRuntime } from '../lib/runtime.js'
import { setSettingsForTest, resetSettingsForTest } from '../lib/settings.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const received = []
let rendererError = ''
let state = 'running'
setSettingsForTest({ statusPill:false, overlay:false })
const activity = createActivityReporter({
  stateFor:() => state,
  launch:async () => {
    const renderer = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'lib/winpilot-statusbar.ps1')],
      { windowsHide:true, stdio:['ignore','ignore','pipe'] })
    renderer.stderr.on('data', value => { rendererError += value })
    renderer.stderr.unref()
    renderer.unref()
    const version = createHash('sha256').update(fs.readFileSync(path.join(root,'lib/winpilot-statusbar.ps1'))).digest('hex').toUpperCase()
    const ready = path.join(os.tmpdir(),'win-pilot','renderer.ready')
    for (let attempt = 0; attempt < 150; attempt++) {
      try {
        const value = JSON.parse(fs.readFileSync(ready,'utf8'))
        if (value.version === version) { process.kill(value.pid,0); return }
      } catch { }
      await new Promise(resolve => setTimeout(resolve,100))
    }
    throw new Error('Activity renderer did not initialize: ' + rendererError)
  },
  handleControl:async (command, id) => {
    received.push({command,id}); state = command === 'pause' ? 'paused' : 'running'; return {ok:true}
  },
})
const runtime = createWinPilotRuntime()
try {
  await activity.begin('activity-ui-test', 'task')
  let window
  for (let attempt = 0; attempt < 100 && !window; attempt++) {
    const listed = await runtime.act('list_windows')
    window = listed.windows?.find(value => value.title === 'Win-Pilot controls')
    if (!window) await new Promise(resolve => setTimeout(resolve, 200))
  }
  assert.ok(window, 'the real non-activating controls window must be visible: ' + rendererError)
  for (const [command, names] of [['pause',['暂停','Pause']],['resume',['继续','Resume']],['end',['结束控制','End']]]) {
    let confirmed = false
    for (let attempt = 0; attempt < 8 && !confirmed; attempt++) {
      const observed = await runtime.act('get_window_state', {hwnd:window.hwnd,include_text:true,include_screenshot:false})
      const button = observed.elements?.find(element => names.includes(element.name) && element.enabled)
      if (!button) { await new Promise(resolve => setTimeout(resolve, 250)); continue }
      const clicked = await promisify(execFile)('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass',
        '-File',path.join(root,'test/fixtures/activity-control.ps1'),'-Window',String(window.hwnd),'-Name',button.name], {windowsHide:true,timeout:15000})
      assert.match(clicked.stdout, /ACTIVITY_CONTROL_SENT/)
      for (let wait = 0; wait < 30 && !received.some(value => value.command === command); wait++) await new Promise(resolve => setTimeout(resolve, 100))
      confirmed = received.some(value => value.command === command)
      // Never repeat a possibly delivered button click.
      break
    }
    assert.ok(confirmed, `the real ${command} button must reach its owning runtime`)
  }
  assert.deepEqual(received.map(value => value.command), ['pause','resume','end'])
  assert.ok(received.every(value => value.id === 'activity-ui-test'))
  console.log('activity controls check PASSED (real rendered buttons, accessibility actions, scoped local IPC)')
} finally { await runtime.close(); await activity.close(); resetSettingsForTest() }
