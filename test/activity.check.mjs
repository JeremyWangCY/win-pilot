import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createActivityReporter } from '../lib/activity.js'
import { requestLocalControl } from '../lib/local-control.js'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'win-pilot-activity-'))
const controls = []
let state = 'running'
const first = createActivityReporter({ directory, launch:async () => {}, stateFor:() => state,
  handleControl:async (command, id) => { controls.push({ command, id }); state = command === 'pause' ? 'paused' : 'running'; return { ok:true } },
})
const second = createActivityReporter({ directory, launch:async () => {}, handleControl:async () => ({ ok:true }) })
const read = () => fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => JSON.parse(fs.readFileSync(path.join(directory, name))))
try {
  await first.begin('first', 'task')
  await second.begin('second', 'current')
  assert.equal(read().length, 2, 'concurrent owners must not overwrite each other')
  const record = read().find(value => value.id === 'first')
  assert.equal((await requestLocalControl(record, { command:'pause', session_id:'first' })).ok, true)
  assert.equal(read().find(value => value.id === 'first').state, 'paused')
  assert.deepEqual(controls, [{ command:'pause', id:'first' }])
  first.finish('first')
  assert.equal(read().find(value => value.id === 'first').state, 'paused', 'pausing keeps the control surface visible')
  assert.equal((await requestLocalControl(record, { command:'resume', session_id:'first' })).ok, true)
  assert.equal((await requestLocalControl(record, { command:'end', session_id:'first' })).ok, true)
  assert.equal(read().find(value => value.id === 'first').state, 'ended')
  await second.close()
  assert.equal(read().find(value => value.id === 'first').state, 'ended', 'ending a peer does not hide another owner')
  assert.equal(read().find(value => value.id === 'second').endpoint, undefined, 'closed processes leave no active control capability')
  console.log('activity check PASSED (independent leases, real IPC controls, paused/ended lifecycle)')
} finally { await first.close(); await second.close(); fs.rmSync(directory, { recursive:true, force:true }) }
