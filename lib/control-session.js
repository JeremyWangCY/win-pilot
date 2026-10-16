import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { normalizeComputerAction } from './computer-action.js'

const DESKTOP_MUTATIONS = new Set([
  'click', 'double_click', 'press_key', 'type', 'type_text', 'keypress', 'move', 'mouse_move',
  'scroll', 'drag', 'set_value', 'perform_secondary_action', 'mouse_down', 'mouse_up',
  'hold_key', 'select_text', 'activate_window', 'close_window', 'minimize_window',
  'write_clipboard', 'paste', 'launch_app', 'switch_display',
])
const BROWSER_READS = new Set([
  'browser_state', 'browser_observe', 'browser_read', 'browser_tabs', 'browser_events',
  'browser_downloads', 'browser_history', 'browser_wait', 'browser_frames', 'browser_capabilities',
])
export function isControlMutation(request = {}) {
  if (Array.isArray(request.actions)) return request.actions.some(isControlMutation)
  const action = normalizeComputerAction(request).action
  if (DESKTOP_MUTATIONS.has(action)) return true
  if (action === 'browser_finalize') return request.activate === true
  return String(action || '').startsWith('browser_') && !BROWSER_READS.has(action)
}

const refused = (request, code, message, controller) => ({
  ok: false, action: Array.isArray(request.actions) ? 'batch' : request.action,
  outcome: 'not_executed', error_code: code, message, actionSent: false, retry: 'never',
  ...(controller ? { controller } : {}),
})
const defaultLock = () => {
  const user = createHash('sha256').update(os.userInfo().username + os.homedir()).digest('hex').slice(0, 24)
  return process.platform === 'win32' ? `\\\\.\\pipe\\win-pilot-control-${user}` : path.join(os.tmpdir(), `win-pilot-control-${user}.sock`)
}

/** The OS pipe bind is atomic and vanishes on process death; no stale PID-file takeover. */
export function createControlCoordinator({ lockName = defaultLock() } = {}) {
  const sessions = new Map()
  let tail = Promise.resolve(), active = null, lock = null, lockOwner = null
  const stateFor = id => {
    if (!sessions.has(id)) sessions.set(id, { stopped: false, closed: false, generation: 0, holds: new Set(), calls: new Set(), needsCleanup:false })
    return sessions.get(id)
  }
  const owner = () => lockOwner ? { pid: process.pid, session_id: lockOwner, input_held: stateFor(lockOwner).holds.size > 0 } : null
  const releaseLock = async id => {
    if (!lock || lockOwner !== id) return
    const server = lock; lock = null; lockOwner = null
    await new Promise(resolve => server.close(resolve))
  }
  const acquireLock = async id => {
    if (lockOwner === id) return true
    if (lock) return false
    const server = net.createServer(socket => socket.destroy())
    const bound = await new Promise((resolve, reject) => {
      server.once('error', error => error.code === 'EADDRINUSE' || error.code === 'EACCES' ? resolve(false) : reject(error))
      server.listen(lockName, () => resolve(true))
    })
    if (!bound) { server.close(); return false }
    server.unref(); lock = server; lockOwner = id
    return true
  }
  function trackHolds(state, request, result) {
    if (Array.isArray(request.actions)) {
      for (let index = 0; index < (result?.steps?.length ?? 0); index++) trackHolds(state, request.actions[index], result.steps[index])
      return
    }
    const { action, args } = normalizeComputerAction(request)
    if (action === 'mouse_down' && (result?.ok || result?.outcome === 'unknown')) state.holds.add(args.button ?? 'left')
    if (action === 'mouse_up' && result?.ok) state.holds.delete(args.button ?? 'left')
  }
  return {
    newSession() { const id = randomUUID(); stateFor(id); return id },
    status(id) { const state = stateFor(id); return { session_id: id, stopped: state.stopped, closed: state.closed, active: active?.id === id, held_buttons:[...state.holds], controller: owner() } },
    async wait(id) { await Promise.allSettled([...stateFor(id).calls].map(call => call.settled)) },
    stop(id) {
      const state = stateFor(id); state.stopped = true; state.generation++
      const cleanup = lockOwner === id || state.holds.size > 0
      if (cleanup) state.needsCleanup = true
      for (const call of state.calls) call.controller.abort(new Error('control_stopped'))
      return { cleanup, was_active: active?.id === id }
    },
    resume(id) {
      const state = stateFor(id)
      if (state.closed || state.calls.size || state.holds.size || state.needsCleanup) return false
      state.generation++; state.stopped = false; return true
    },
    async release(id) {
      const state = stateFor(id)
      if (state.calls.size || state.holds.size || state.needsCleanup) return false
      await releaseLock(id); return true
    },
    async cleaned(id) { const state = stateFor(id); state.holds.clear(); state.needsCleanup = false; await releaseLock(id) },
    async close(id, cleanup) {
      const state = stateFor(id); const stopped = this.stop(id); state.closed = true
      await Promise.allSettled([...state.calls].map(call => call.settled))
      if (stopped.cleanup) await cleanup?.()
      await this.cleaned(id); sessions.delete(id)
    },
    idle() { return !active && sessions.size === 0 },
    async run(id, request, externalSignal, operation) {
      const state = stateFor(id), generation = state.generation, mutation = isControlMutation(request)
      if (state.closed || (state.stopped && mutation)) return refused(request, 'control_stopped', 'This control session was stopped; explicitly resume before sending new input.')
      const controller = new AbortController()
      const signal = externalSignal ? AbortSignal.any([externalSignal, controller.signal]) : controller.signal
      let finish, settledResolve
      const done = new Promise(resolve => { finish = resolve })
      const settled = new Promise(resolve => { settledResolve = resolve })
      const call = { controller, settled }; state.calls.add(call)
      const previous = tail; tail = previous.catch(() => {}).then(() => done)
      const aborted = () => refused(request, state.stopped ? 'control_stopped' : 'action_aborted', 'Request cancelled before dispatch.')
      let removeAbort = () => {}, entered = false, acquired = false
      try {
        if (signal.aborted) return aborted()
        await Promise.race([previous, new Promise(resolve => {
          const abort = () => resolve(); signal.addEventListener('abort', abort, { once: true })
          removeAbort = () => signal.removeEventListener('abort', abort)
        })])
        if (signal.aborted || generation !== state.generation || state.closed) return aborted()
        if (mutation) {
          acquired = await acquireLock(id)
          if (!acquired) return refused(request, 'controller_busy', 'Another control session is currently sending or holding input.', owner())
        }
        if (signal.aborted || generation !== state.generation) return aborted()
        active = { id, request, call }; entered = true
        const result = await operation(signal)
        if (mutation) trackHolds(state, request, result)
        return result
      } catch (error) {
        if (entered && mutation) return { ok:false, action:request.action ?? 'batch', outcome:'unknown', actionSent:true, retry:'reobserve', error_code:signal.aborted ? 'action_aborted' : 'action_failed', message:error?.message || String(error) }
        return refused(request, signal.aborted ? 'action_aborted' : 'controller_unavailable', error?.message || String(error))
      } finally {
        removeAbort(); if (active?.call === call) active = null
        if (acquired && lockOwner === id && state.holds.size === 0 && !state.needsCleanup) await releaseLock(id)
        state.calls.delete(call); finish(); settledResolve()
      }
    },
  }
}

export const controlCoordinator = createControlCoordinator()
