import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineComputerTool, stopDaemon } from '../lib/index.js'

const statePath = path.join(os.tmpdir(), 'win-pilot', 'status.state')
try { fs.unlinkSync(statePath) } catch { }
const endpoint = 'ws://127.0.0.1:9/devtools/browser/win-pilot-status-test'
const tool = defineComputerTool(value => value, {})
try {
  await tool.execute({ action: 'browser_state', browser_endpoint: endpoint })
  assert.ok(fs.existsSync(statePath), 'browser action must write status state')
  await new Promise(resolve => setTimeout(resolve, 650))
  let state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  assert.equal(state.show, true, 'status must remain visible between consecutive tool calls instead of flashing')
  const hideDeadline = Date.now() + 8000
  while (state.show !== false && Date.now() < hideDeadline) {
    await new Promise(resolve => setTimeout(resolve, 50))
    state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  }
  assert.equal(state.show, false, 'status must hide after the idle grace period')
} finally {
  stopDaemon()
}
console.log('PASS browser statusbar lifecycle')
