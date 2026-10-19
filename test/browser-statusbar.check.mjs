import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { defineComputerTool, stopDaemon } from '../lib/index.js'
import { activityDirectory } from '../lib/activity.js'

const before = new Set(fs.existsSync(activityDirectory()) ? fs.readdirSync(activityDirectory()) : [])
const endpoint = 'ws://127.0.0.1:9/devtools/browser/win-pilot-status-test'
const tool = defineComputerTool(value => value, {})
try {
  await tool.execute({ action: 'browser_state', browser_endpoint: endpoint })
  const own = fs.readdirSync(activityDirectory()).filter(name => name.endsWith('.json') && !before.has(name))
  assert.equal(own.length, 1, 'browser action must write its own activity lease')
  const statePath = path.join(activityDirectory(), own[0])
  await new Promise(resolve => setTimeout(resolve, 650))
  let state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
  assert.ok(state.expires > Date.now(), 'status must remain visible between consecutive tool calls instead of flashing')
  const hideDeadline = Date.now() + 8000
  while (fs.existsSync(statePath) && Date.now() < hideDeadline) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  assert.equal(fs.existsSync(statePath), false, 'status must hide after the idle grace period')
} finally {
  stopDaemon()
  await tool.close()
}
console.log('PASS browser statusbar lifecycle')
