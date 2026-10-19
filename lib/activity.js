import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createLocalControl } from './local-control.js'

export const activityDirectory = () => path.join(os.tmpdir(), 'win-pilot', 'activity')
const waiting = new Set(['login_settings', 'awaiting_login', 'awaiting_windows_login', 'needs_preparation', 'preparing', 'connecting', 'pausing', 'paused', 'takeover', 'error', 'disconnected'])

/** Each owner writes its own lease; a renderer aggregates, never overwrites peers. */
export function createActivityReporter({ launch, handleControl, stateFor = () => null, directory = activityDirectory(), graceMs = 5000 } = {}) {
  const records = new Map()
  let endpoint, timer, starting, closed = false
  const fileFor = id => path.join(directory, `${endpoint.id}-${id}.json`)
  const publishUnsafe = () => {
    if (closed || !endpoint) return
    const now = Date.now()
    for (const [id, record] of records) {
      const external = stateFor(id, record.environment)
      if (!record.ended) {
        if (external && waiting.has(external)) record.state = external
        else if (record.active > 0) record.state = 'running'
        else record.state = 'idle'
      }
      if (record.active === 0 && !waiting.has(record.state) && now >= record.until) {
        fs.rmSync(fileFor(id), { force: true }); records.delete(id); continue
      }
      const value = { id, owner:endpoint.id, pid:process.pid, environment:record.environment, state:record.state,
        expires:now + 7000, endpoint:endpoint.endpoint, token:endpoint.token }
      const file = fileFor(id), temporary = file + '.tmp'
      fs.writeFileSync(temporary, JSON.stringify(value), { mode:0o600 })
      fs.renameSync(temporary, file)
    }
    if (!records.size) { clearInterval(timer); timer = null }
  }
  const publish = () => { try { publishUnsafe() } catch { /* UI failure never replays or rejects a completed action. */ } }
  const start = async () => {
    if (starting) return starting
    starting = (async () => {
      fs.mkdirSync(directory, { recursive:true, mode:0o700 })
      endpoint = createLocalControl(async request => {
        if (!records.has(request.session_id) || !['pause', 'resume', 'end'].includes(request.command)) throw new Error('Unknown activity control target')
        const result = await handleControl(request.command, request.session_id)
        if (result?.ok) {
          const record = records.get(request.session_id)
          if (record) {
            record.ended = request.command === 'end'
            record.state = record.ended ? 'ended' : request.command === 'pause' ? 'paused' : 'running'
            record.until = Date.now() + graceMs
          }
          publish()
        }
        return result
      })
      await endpoint.ready
      await launch?.()
    })()
    return starting
  }
  return {
    async begin(id, environment) {
      if (closed) return
      await start()
      const record = records.get(id) || { active:0, environment, state:'running', until:0 }
      record.environment = environment; record.active++; record.ended = false
      record.until = Date.now() + graceMs; records.set(id, record)
      publish()
      if (!timer) { timer = setInterval(publish, 1000); timer.unref?.() }
    },
    finish(id) {
      const record = records.get(id)
      if (!record) return
      record.active = Math.max(0, record.active - 1)
      record.until = Date.now() + graceMs
      publish()
    },
    remove(id) {
      records.delete(id)
      if (endpoint) fs.rmSync(fileFor(id), { force:true })
    },
    async close() {
      closed = true; clearInterval(timer)
      await starting?.catch(() => {})
      // Keep a short, non-interactive completion lease so a cold renderer can
      // still show a quick one-shot command after its owner has exited.
      for (const [id, record] of records) if (endpoint) {
        try { fs.writeFileSync(fileFor(id), JSON.stringify({ id, owner:endpoint.id, pid:process.pid,
          environment:record.environment, state:'ended', expires:Date.now() + graceMs }), { mode:0o600 }) } catch { /* expiry remains bounded */ }
      }
      records.clear()
      await endpoint?.close()
    },
  }
}
