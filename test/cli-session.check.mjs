import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { runCliSession } from '../lib/cli-session.js'

const stdin = new PassThrough(), responses = [], waiting = []
const next = () => responses.length ? Promise.resolve(responses.shift()) : new Promise(resolve => waiting.push(resolve))
let stopped = false, ended = false, release
const runtime = {
  async run(request) {
    if (request.action === 'observe') return { ok:true, snapshot_id:'same-session', id:999 }
    if (request.action === 'click') return { ok:request.snapshot_id === 'same-session' && !stopped }
    if (request.action === 'stop') { stopped = true; release?.(); return { ok:true } }
    if (request.action === 'resume') { stopped = false; return { ok:true } }
    if (request.action === 'slow') { await new Promise(resolve => { release = resolve }); return { ok:false, error_code:'control_stopped' } }
    return { ok:false }
  },
  async close() { ended = true; release?.() },
}
const done = runCliSession({ stdin, runtime, stderr:{write() {}}, stdout:{write(line) {
  const value = JSON.parse(line)
  if (waiting.length) waiting.shift()(value); else responses.push(value)
}} })
const send = async request => { stdin.write(JSON.stringify(request) + '\n'); return next() }
const observed = await send({ id:1, action:'observe' })
assert.equal(observed.id, 1, 'transport ids must not be replaced by helper ids')
assert.equal((await send({ id:2, action:'click', snapshot_id:observed.snapshot_id })).ok, true)
stdin.write('{bad json}\n')
assert.equal((await next()).error_code, 'invalid_session_request')
stdin.write(JSON.stringify({ id:3, action:'slow' }) + '\n')
await Promise.resolve()
stdin.write(JSON.stringify({ id:4, action:'stop' }) + '\n')
const cancelled = [await next(), await next()]
assert.ok(cancelled.some(value => value.id === 3 && value.error_code === 'control_stopped'))
assert.ok(cancelled.some(value => value.id === 4 && value.ok))
await send({ id:5, action:'resume' })
assert.equal((await send({ id:6, action:'click', snapshot_id:observed.snapshot_id })).ok, true)
assert.equal((await send({ id:7, action:'session_close' })).cleanup_confirmed, true)
assert.equal(await done, 0)
assert.equal(ended, true)
console.log('CLI session check PASSED (same runtime, request correlation, cancellation, cleanup)')
