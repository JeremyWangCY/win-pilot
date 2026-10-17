import assert from 'node:assert/strict'
import fs from 'node:fs'
import { browserAction, releaseBrowserSession } from '../lib/browser-session.js'

// No browser process, network connection, desktop input or filesystem writes.
const commands = []
class MockSocket extends EventTarget {
  constructor() { super(); queueMicrotask(() => this.dispatchEvent(new Event('open'))) }
  send(data) {
    const message = JSON.parse(data)
    commands.push(message)
    let result = {}
    if (message.method === 'Target.getTargets') result = { targetInfos:[{ type:'page', targetId:'tab', url:'https://fixture.test/' }] }
    if (message.method === 'Target.attachToTarget') result = { sessionId:'mock-page-session' }
    if (message.method === 'Page.getFrameTree') result = { frameTree:{ frame:{ id:'main', url:'https://fixture.test/', securityOrigin:'https://fixture.test', loaderId:'load' } } }
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data:JSON.stringify({ id:message.id, result }) })))
  }
  close() { this.dispatchEvent(new Event('close')) }
}
const originalSocket = globalThis.WebSocket
const originalMkdir = fs.mkdirSync
globalThis.WebSocket = MockSocket
fs.mkdirSync = () => {}
const args = { browser_endpoint:'ws://127.0.0.1:9222/devtools/browser/ownership-mock', tab_id:'tab' }
const action = (name, session, extra = {}) => browserAction(name, { ...args, control_session_id:session, ...extra })
try {
  assert.equal((await action('browser_filechooser', 'session-A')).armed, true)
  await assert.rejects(action('browser_claim_tab', 'session-B'), /armed by another control session/,
    'another session must not claim an armed tab and later disable its owner\'s chooser')
  await assert.rejects(action('browser_filechooser', 'session-B'), /armed by another control session/)
  assert.equal(commands.filter(command => command.method === 'Page.setInterceptFileChooserDialog' && command.params.enabled === false).length, 0,
    'rejected takeover must leave the original interception enabled')
  const claim = await action('browser_claim_tab', 'session-A')
  assert.equal(claim.ok, true, 'the chooser owner can claim its own tab')
  assert.equal((await action('browser_finalize', 'session-A', { claim_id:claim.claim_id })).handed_back, true)
  assert.equal(commands.filter(command => command.method === 'Page.setInterceptFileChooserDialog' && command.params.enabled === false).length, 1)
  const nextClaim = await action('browser_claim_tab', 'session-B')
  assert.equal(nextClaim.ok, true, 'handoff permits a new owner')
  await releaseBrowserSession('session-B')
} finally {
  try { await releaseBrowserSession('session-A'); await releaseBrowserSession('session-B') }
  finally { globalThis.WebSocket = originalSocket; fs.mkdirSync = originalMkdir }
}
console.log('PASS: armed chooser ownership blocks foreign claims and permits explicit handoff (pure mock)')
