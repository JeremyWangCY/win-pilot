import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Browser-level ws endpoint only: read DevToolsActivePort from an owned profile.
// No discovery requests, redirects, default browser, foreground activation or logging.
const tokens = new Map()
const refStores = new Map()
const refCounters = new Map()
const screenshotTokens = new Map()
const locks = new Set()
const browserConnections = new Map()
const fileChoosers = new Map()
const chooserArms = new Map()
const tabClaims = new Map()
const finalizedTabs = new Set()
const CONNECT_TIMEOUT_MS = 10000
const CONNECTION_IDLE_MS = 5 * 60 * 1000
const COMMAND_TIMEOUT_MS = 12000
const TTL = 60000
const LIMIT = 500
const SCREENSHOT_DIR = path.join(os.tmpdir(), 'win-pilot')

// A CDP command failure is control flow for whoever awaits it, but callers are
// allowed to fire and forget (startup negotiation, event flushes, teardown). Node
// promotes a rejection nobody observed into a fatal uncaught exception, which is
// exactly how one intermittent "CDP command rejected" killed the v0.4.2 tag run,
// the 0.4.4 main run and the v0.4.4 tag run on two different branches. The client
// therefore keeps its own rejection reasons non-fatal and leaves every other
// rejection under Node's default behaviour.
const CDP_REJECTION_MESSAGES = new Set([
  'CDP command rejected',
  'CDP connection closed',
  'CDP connection closed or aborted',
  'CDP aborted',
  'CDP connect timeout',
])
let unhandledCdpGuard = null
function guardUnhandledCdpRejections() {
  if (unhandledCdpGuard) return
  unhandledCdpGuard = reason => {
    const message = reason instanceof Error ? reason.message : String(reason)
    if (CDP_REJECTION_MESSAGES.has(message)) return
    if (/^CDP command timeout \(\d+ms\)/.test(message)) return
    throw reason
  }
  process.on('unhandledRejection', unhandledCdpGuard)
}

function refStoreKey(url, tab, frame = '') {
  return `${url}\u0000${tab}\u0000${frame}`
}

function clearRefStore(url, tab, { counter = false } = {}) {
  for (const [key, store] of refStores) if (store.url === url && store.tab === tab) refStores.delete(key)
  if (counter) refCounters.delete(refStoreKey(url, tab))
  for (const [id, chooser] of fileChoosers) if (chooser.url === url && chooser.tab === tab) fileChoosers.delete(id)
  for (const [captureId, capture] of screenshotTokens) {
    if (capture.url === url && capture.tab === tab) screenshotTokens.delete(captureId)
  }
}

function clearEndpointRefs(url) {
  for (const key of chooserArms.keys()) if (key.startsWith(`${url}\u0000`)) chooserArms.delete(key)
  for (const [key, store] of refStores) if (store.url === url) refStores.delete(key)
  for (const [key, value] of refCounters) if (value.url === url) refCounters.delete(key)
  for (const [key, value] of screenshotTokens) if (value.url === url) screenshotTokens.delete(key)
  for (const [key, value] of fileChoosers) if (value.url === url) fileChoosers.delete(key)
  for (const [key, value] of tabClaims) if (value.url === url) tabClaims.delete(key)
  for (const key of finalizedTabs) if (key.startsWith(`${url}\u0000`)) finalizedTabs.delete(key)
}

function invalidateClaims(url) {
  for (const [key, claim] of tabClaims) if (claim.url === url) {
    tabClaims.delete(key)
    finalizedTabs.add(key)
  }
}

function flattenFrames(tree, parent) {
  return [{ ...tree.frame, parentId: tree.frame.parentId || parent }, ...(tree.childFrames || []).flatMap(child => flattenFrames(child, tree.frame.id))]
}

function frameSupported(frame, main, targets) {
  if (frame.id === main.id) return true
  if (targets.some(target => target.type === 'iframe' && target.targetId === frame.id)) return false
  try { return frame.securityOrigin && frame.securityOrigin !== '://' && frame.securityOrigin === main.securityOrigin && new URL(frame.url).origin === new URL(main.url).origin } catch { return false }
}

function abortableDelay(ms, signal) {
  signal?.throwIfAborted()
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', abort); resolve() }
    const timer = setTimeout(done, ms)
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('CDP aborted')) }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function nextElementRef(url, tab) {
  const key = refStoreKey(url, tab)
  const current = refCounters.get(key)
  const next = current?.next || 1
  refCounters.set(key, { url, tab, next: next + 1 })
  return `@e${next}`
}

function pruneRefStores(url, liveTabs) {
  for (const key of chooserArms.keys()) if (key.startsWith(`${url}\u0000`) && !liveTabs.has(key.split('\u0000')[1])) chooserArms.delete(key)
  for (const [key, store] of refStores) {
    if (store.url === url && !liveTabs.has(store.tab)) refStores.delete(key)
  }
  for (const [key, counter] of refCounters) {
    if (counter.url === url && !liveTabs.has(counter.tab)) refCounters.delete(key)
  }
  for (const [key, capture] of screenshotTokens) {
    if (capture.url === url && !liveTabs.has(capture.tab)) screenshotTokens.delete(key)
  }
  for (const [key, item] of fileChoosers) if (item.url === url && !liveTabs.has(item.tab)) fileChoosers.delete(key)
  for (const [key, item] of tabClaims) if (item.url === url && !liveTabs.has(item.tab)) tabClaims.delete(key)
  for (const key of finalizedTabs) if (key.startsWith(`${url}\u0000`) && !liveTabs.has(key.split('\u0000')[1])) finalizedTabs.delete(key)
}

// A crashed/degraded renderer can report url "" or ":" through CDP. Never let a
// bogus frame URL masquerade as page state: fall back to the target info URL,
// then to 'unknown' so callers can tell "unreadable" from "readable but empty".
function normalizeUrl(...candidates) {
  for (const raw of candidates) {
    if (typeof raw !== 'string') continue
    const trimmed = raw.trim()
    if (trimmed && /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed) && trimmed !== ':') return trimmed
  }
  return 'unknown'
}

// Visible status of a page from what the model can actually act on. An error
// page (site block, no login, crash) exposes a title/body but zero interactive
// controls; report that instead of letting 0 elements read as a quiet success.
function pageStatus(title, elementCount, url, bodyText = '', readyState = '') {
  if (url === 'unknown' && !title && !bodyText) return 'unreadable'
  const t = String(title || '')
  if (/(出错啦|出错了|无法访问|aw,? snap|can't be reached|not available|无法显示)/i.test(t)) return 'page_error'
  if (elementCount === 0) {
    // title can lag or be empty; a 0-control page whose visible body declares an
    // error must not be reported as a plain no_interactive_elements.
    if (/(出错|错误|error|失败|无法访问|cannot|blocked|验证|滑块)/i.test(String(bodyText).slice(0, 160))) return 'page_error'
    if (readyState && readyState !== 'complete') return 'loading'
    return 'no_interactive_elements'
  }
  if (/(错误|error)/i.test(t)) return 'page_error'
  return 'ok'
}

function endpoint(value) {
  if (typeof value !== 'string') {
    throw new Error('browser_endpoint required (use launch_app with name: "msedge" and headless: true to start an isolated browser session first, or pass the returned browser: { endpoint, tab_id })')
  }
  const u = new URL(value)
  if (u.protocol !== 'ws:' || !['127.0.0.1', '[::1]'].includes(u.hostname) ||
      !u.port || u.username || u.password || u.search || u.hash ||
      !/^\/devtools\/browser\/[a-zA-Z0-9-]+$/.test(u.pathname)) {
    throw new Error('Expected explicit loopback browser WebSocket endpoint')
  }
  return u.href
}

async function connect(url, signal, commandTimeoutMs = COMMAND_TIMEOUT_MS, { detachAbortAfterOpen = false } = {}) {
  guardUnhandledCdpRejections()
  signal?.throwIfAborted()
  const ws = new WebSocket(url)
  const pending = new Map()
  const events = []
  let eventSequence = 0
  let sequence = 0
  let dead = false
  let rejectOpen
  const close = () => {
    if (dead) return
    dead = true
    rejectOpen?.(new Error(signal?.aborted ? 'CDP aborted' : 'CDP connection closed'))
    signal?.removeEventListener('abort', close)
    for (const p of pending.values()) p.reject(new Error('CDP connection closed or aborted'))
    pending.clear()
    try { ws.close() } catch { }
  }
  ws.addEventListener('message', event => {
    try {
      const message = JSON.parse(event.data)
      const p = pending.get(message.id)
      if (!p) {
        if (message.method) {
          events.push({ ...message, __seq: ++eventSequence, __receivedMs: Date.now() })
          if (events.length > 5000) events.splice(0, events.length - 5000)
        }
        return
      }
      pending.delete(message.id)
      // Never propagate protocol error text: it can contain page or input data.
      if (message.error) p.reject(new Error('CDP command rejected'))
      else p.resolve(message.result)
    } catch { close() }
  })
  ws.addEventListener('error', close)
  ws.addEventListener('close', close)
  signal?.addEventListener('abort', close, { once: true })
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => { clearTimeout(timer); ws.removeEventListener('open', opened); rejectOpen = null }
      const opened = () => { cleanup(); resolve() }
      const timer = setTimeout(() => { cleanup(); reject(new Error('CDP connect timeout')); close() }, CONNECT_TIMEOUT_MS)
      rejectOpen = error => { cleanup(); reject(error) }
      ws.addEventListener('open', opened, { once: true })
    })
    signal?.throwIfAborted()
    if (detachAbortAfterOpen) signal?.removeEventListener('abort', close)
  } catch (error) { close(); throw error }
  return {
    close,
    isDead() { return dead },
    send(method, params = {}, sessionId, options = {}) {
      const commandSignal = options.signal
      commandSignal?.throwIfAborted()
      // A dead connection refuses the command. Guard the refusal here as well as
      // below: a caller that never awaits must not be able to turn this into an
      // unhandled rejection and take down the host process.
      if (dead) {
        const refused = Promise.reject(new Error('CDP connection closed'))
        refused.catch(() => {})
        return refused
      }
      const command = new Promise((resolve, reject) => {
        const id = ++sequence
        const timeoutMs = Math.max(2000, Math.min(30000, Number(options.timeoutMs ?? commandTimeoutMs) || COMMAND_TIMEOUT_MS))
        let abortHandler = null
        const cleanup = () => {
          clearTimeout(timer)
          if (abortHandler) commandSignal?.removeEventListener('abort', abortHandler)
        }
        const timer = setTimeout(() => {
          if (!pending.has(id)) return
          pending.delete(id)
          cleanup()
          reject(new Error(`CDP command timeout (${timeoutMs}ms): ${method}${params?.type ? `:${params.type}` : ''}`))
          // Control/navigation timeouts invalidate the persistent session.
          // Observation-only commands may opt out: CDP replies are id-correlated,
          // so a late screenshot reply can be ignored safely without discarding
          // an otherwise healthy browser connection.
          if (options.fatalOnTimeout !== false) close()
        }, timeoutMs)
        pending.set(id, {
          resolve: value => { cleanup(); resolve(value) },
          reject: error => { cleanup(); reject(error) },
        })
        if (commandSignal) {
          abortHandler = () => {
            if (!pending.has(id)) return
            pending.delete(id)
            cleanup()
            reject(new Error('CDP aborted'))
          }
          commandSignal.addEventListener('abort', abortHandler, { once: true })
        }
        try { ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })) }
        catch { close() }
      })
      // A rejected CDP command is a normal outcome (late reply after abort, refusal,
      // session teardown). Guard the promise itself at creation time so that even a
      // rejection delivered synchronously from inside the executor (ws.send throwing
      // into close()) is already observed, and a fire-and-forget caller can never
      // surface an unhandled rejection and take down the host. Awaiting callers still
      // receive the original rejection.
      command.catch(() => {})
      return command
    },
    markEvents() { return eventSequence },
    eventBounds() {
      return { first: events[0]?.__seq ?? eventSequence + 1, last: eventSequence }
    },
    eventsSince(mark, { sessionId } = {}) {
      return events
        .filter(event => event.__seq > mark && (!sessionId || event.sessionId === sessionId))
        .map(({ __seq, ...event }) => event)
    },
  }
}

async function acquireBrowserConnection(url, signal, commandTimeoutMs) {
  signal?.throwIfAborted()
  let slot = browserConnections.get(url)
  let reused = true
  if (!slot || slot.raw.isDead()) {
    if (slot) invalidateClaims(url)
    if (slot?.timer) clearTimeout(slot.timer)
    slot?.raw.close()
    const raw = await connect(url, signal, commandTimeoutMs, { detachAbortAfterOpen: true })
    const browserId = new URL(url).pathname.split('/').pop().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || randomUUID()
    const downloadDir = path.join(SCREENSHOT_DIR, 'downloads', browserId)
    fs.mkdirSync(downloadDir, { recursive: true })
    slot = { id: randomUUID(), raw, pageSessions: new Map(), monitoredSessions: new Set(), chooserSessions: new Set(), chooserCursors: new Map(), timer: null, downloadDir, downloadsEnabled: false }
    browserConnections.set(url, slot)
    try {
      await raw.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true }, undefined, { signal, timeoutMs: commandTimeoutMs })
      slot.downloadsEnabled = true
    } catch (error) {
      // A protocol rejection only means this Chromium variant does not expose
      // Browser.setDownloadBehavior. A timeout/disconnect is different: the
      // socket is already unhealthy and must never be published as a reusable
      // persistent connection.
      if (raw.isDead()) {
        if (browserConnections.get(url) === slot) browserConnections.delete(url)
        raw.close()
        throw error
      }
      // Browser use remains functional; browser_downloads will report disabled.
    }
    reused = false
  }
  if (slot.timer) {
    clearTimeout(slot.timer)
    slot.timer = null
  }
  let released = false
  const send = (method, params = {}, sessionId, options = {}) =>
    slot.raw.send(method, params, sessionId, {
      signal: options.signal ?? signal,
      timeoutMs: options.timeoutMs ?? commandTimeoutMs,
      fatalOnTimeout: options.fatalOnTimeout,
    })
  return {
    reused,
    sessionId() { return slot.id },
    send,
    markEvents() { return slot.raw.markEvents() },
    eventCursor() { return `${slot.id}:${slot.raw.markEvents()}` },
    eventsSince(mark, options) { return slot.raw.eventsSince(mark, options) },
    eventsAfter(cursor, options) {
      const bounds = slot.raw.eventBounds()
      let mark = 0
      let reset = false
      let truncated = false
      if (cursor) {
        const match = /^([^:]+):(\d+)$/.exec(String(cursor))
        if (!match || match[1] !== slot.id) reset = true
        else mark = Number(match[2])
      }
      if (mark && mark < bounds.first - 1) {
        truncated = true
        mark = bounds.first - 1
      }
      return { events: slot.raw.eventsSince(mark, options), reset, truncated, cursor: `${slot.id}:${bounds.last}` }
    },
    downloadDirectory() { return slot.downloadDir },
    downloadsEnabled() { return slot.downloadsEnabled },
    chooserEnabled(sessionId) { return slot.chooserSessions.has(sessionId) },
    async setChooserEnabled(sessionId, enabled) {
      await send('Page.setInterceptFileChooserDialog', { enabled }, sessionId)
      if (enabled) slot.chooserSessions.add(sessionId)
      else slot.chooserSessions.delete(sessionId)
    },
    chooserEvents(sessionId, advance = true) {
      const result = this.eventsAfter(slot.chooserCursors.get(sessionId), { sessionId })
      if (advance) slot.chooserCursors.set(sessionId, result.cursor)
      return [...(result.truncated || result.reset ? [{ method: 'WinPilot.chooserEventsLost' }] : []), ...result.events]
    },
    async getPageSession(tabId) {
      let sessionId = slot.pageSessions.get(tabId)
      if (!sessionId) {
        const attached = await send('Target.attachToTarget', { targetId: tabId, flatten: true })
        sessionId = attached.sessionId
        slot.pageSessions.set(tabId, sessionId)
      }
      if (!slot.monitoredSessions.has(sessionId)) {
        await send('Page.enable', {}, sessionId)
        await send('Runtime.enable', {}, sessionId)
        await send('Log.enable', {}, sessionId)
        await send('Network.enable', {}, sessionId)
        await send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId)
        slot.monitoredSessions.add(sessionId)
      }
      return sessionId
    },
    dropPageSession(tabId) {
      const sessionId = slot.pageSessions.get(tabId)
      slot.pageSessions.delete(tabId)
      if (sessionId) slot.monitoredSessions.delete(sessionId)
      slot.chooserSessions.delete(sessionId)
      slot.chooserCursors.delete(sessionId)
    },
    prunePageSessions(validTabs) {
      const valid = new Set(validTabs)
      for (const [tabId, sessionId] of slot.pageSessions) if (!valid.has(tabId)) { slot.pageSessions.delete(tabId); slot.monitoredSessions.delete(sessionId) }
    },
    invalidate() {
      if (slot.timer) clearTimeout(slot.timer)
      slot.timer = null
      slot.pageSessions.clear()
      slot.monitoredSessions.clear()
      slot.raw.close()
      invalidateClaims(url)
      if (browserConnections.get(url) === slot) browserConnections.delete(url)
      released = true
    },
    close() {
      if (released) return
      released = true
      slot.timer = setTimeout(() => {
        if (browserConnections.get(url) !== slot) return
        slot.pageSessions.clear()
        slot.monitoredSessions.clear()
        slot.raw.close()
        invalidateClaims(url)
        browserConnections.delete(url)
      }, CONNECTION_IDLE_MS)
      slot.timer.unref?.()
    },
  }
}

// This is a deliberately limited DOM name/role approximation, not a full AX tree.
// Never returns editable text; it may inspect its length so callers can verify
// that a controlled editor actually contains input without leaking the text.
function describe(el) {
  const tag = el.localName
  const actionLabel = /^(发布|发送|提交)$/.test((el.innerText || '').replace(/\s+/g, ' ').trim())
  const role = el.getAttribute('role') || (actionLabel ? 'button' : null) || ({ button: 'button', a: 'link', textarea: 'textbox',
    select: 'combobox', input: el.type === 'file' ? 'file' : ['checkbox', 'radio'].includes(el.type) ? el.type :
      ['button', 'submit', 'reset'].includes(el.type) ? 'button' : 'textbox' }[tag]) ||
    (el.isContentEditable ? 'textbox' : 'generic')
  const labelled = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
    .map(id => el.ownerDocument.getElementById(id)?.textContent || '').join(' ')
  const name = (labelled || el.getAttribute('aria-label') ||
    Array.from(el.labels || []).map(x => x.textContent).join(' ') ||
    el.getAttribute('title') || (el.closest('[contenteditable]') || ['input', 'textarea', 'select'].includes(tag)
      ? '' : el.textContent) || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  const href = tag === 'a' && el.href ? el.href : undefined
  const editable = role === 'textbox'
  const editor = editable && (el.matches('[contenteditable="true"]') || el.querySelector?.('[contenteditable="true"]'))
  const rawValue = el.value ?? (editor ? (editor.innerText || editor.textContent || '') : (el.innerText || el.textContent || ''))
  const hasValue = editable ? Boolean(String(rawValue).trim()) : undefined
  const disabled = Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true')
  const valuePreview = editable ? String(el.value != null ? el.value : (el.innerText || el.textContent || '')).slice(0, 5000) : ''
  const box = el.getBoundingClientRect()
  const rect = { x: Math.round(box.left), y: Math.round(box.top), width: Math.round(box.width), height: Math.round(box.height) }
  return { role, name, rect, ...(href ? { href: href.slice(0, 2000) } : {}), ...(editable ? { has_value: hasValue, value_preview: valuePreview } : {}), ...(disabled ? { disabled: true } : {}) }
}

function keySpec(value) {
  const parts = typeof value === 'string' ? value.split('+').map(part => part.trim()).filter(Boolean) : []
  const rawName = parts.pop() || ''
  const specialNames = { enter: 'Enter', return: 'Enter', tab: 'Tab', escape: 'Escape', esc: 'Escape', backspace: 'Backspace', delete: 'Delete', arrowleft: 'ArrowLeft', arrowup: 'ArrowUp', arrowright: 'ArrowRight', arrowdown: 'ArrowDown', home: 'Home', end: 'End', space: 'Space' }
  const name = specialNames[rawName.toLowerCase()] || rawName
  let modifiers = 0
  for (const part of parts) {
    const bit = { alt: 1, ctrl: 2, control: 2, meta: 4, win: 4, windows: 4, shift: 8 }[part.toLowerCase()]
    if (!bit || (modifiers & bit)) throw new Error('Unsupported key')
    modifiers |= bit
  }
  const special = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, Space: 32 }
  if (/^[a-z]$/i.test(name)) return { key: modifiers & 8 ? name.toUpperCase() : name.toLowerCase(), code: `Key${name.toUpperCase()}`, modifiers, windowsVirtualKeyCode: name.toUpperCase().charCodeAt(0) }
  if (!(name in special)) throw new Error('Unsupported key')
  return { key: name === 'Space' ? ' ' : name, code: name, modifiers,
    windowsVirtualKeyCode: special[name] }
}

async function capturePageScreenshot(send, commandTimeoutMs = COMMAND_TIMEOUT_MS) {
  try {
    const observationOptions = { timeoutMs: Math.max(10000, commandTimeoutMs), fatalOnTimeout: false }
    const metrics = await send('Page.getLayoutMetrics', {}, observationOptions)
    const shot = await send('Page.captureScreenshot', { format: 'png', fromSurface: true }, observationOptions)
    if (!shot?.data) return null
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true })
    const file = path.join(SCREENSHOT_DIR, `disp-${randomUUID().replaceAll('-', '')}.png`)
    fs.writeFileSync(file, Buffer.from(shot.data, 'base64'), { flag: 'wx', mode: 0o600 })
    const viewport = metrics?.cssVisualViewport || metrics?.cssContentSize || {}
    const width = Math.max(1, Math.round(viewport.clientWidth || viewport.width || 1))
    const height = Math.max(1, Math.round(viewport.clientHeight || viewport.height || 1))
    return { path: file, screenshot_id: randomUUID().replaceAll('-', ''), width, height, viewport: { coordinate_space: 'browser_viewport', x: 0, y: 0, width, height, scale: 1 }, method: 'cdp_page_capture_screenshot' }
  } catch {
    return null
  }
}

/**
 * browserAction(action, { browser_endpoint, tab_id?, element?, text?, key? }, signal?)
 * state without tab_id lists pages; all other calls require an exact tab_id.
 * Tokens and short refs live in this Node process, expire after 60s without state refresh,
 * and are invalidated by navigation/detachment or name/role changes. No input retries.
 */
export async function browserAction(action, args = {}, signal) {
  const observeAlias = action === 'browser_observe'
  if (observeAlias) action = 'browser_state'
  if (!['browser_frames', 'browser_filechooser', 'browser_claim_tab', 'browser_finalize', 'browser_open', 'browser_navigate', 'browser_activate', 'browser_close', 'browser_shutdown', 'browser_tabs', 'browser_events', 'browser_downloads', 'browser_history', 'browser_back', 'browser_forward', 'browser_wait', 'browser_state', 'browser_read', 'browser_request', 'browser_click', 'browser_click_point', 'browser_click_text', 'browser_type', 'browser_replace', 'browser_upload', 'browser_key', 'browser_scroll', 'browser_scroll_to_text', 'browser_reload'].includes(action)) throw new Error('Unsupported browser action')
  if (observeAlias && !args.tab_id) throw new Error('Exact tab_id required for browser_observe')
  const url = endpoint(args.browser_endpoint)
  if (args.tab_id !== undefined && (typeof args.tab_id !== 'string' || !args.tab_id)) throw new Error('Exact tab_id required')
  if (['browser_frames', 'browser_filechooser', 'browser_claim_tab', 'browser_finalize', 'browser_activate', 'browser_close', 'browser_events', 'browser_history', 'browser_back', 'browser_forward', 'browser_wait'].includes(action) && !args.tab_id) throw new Error('Exact tab_id required')
  if (!(action === 'browser_upload' && args.filechooser_id) && !['browser_frames', 'browser_filechooser', 'browser_claim_tab', 'browser_finalize', 'browser_shutdown', 'browser_tabs', 'browser_events', 'browser_downloads', 'browser_history', 'browser_back', 'browser_forward', 'browser_wait', 'browser_state', 'browser_read', 'browser_request', 'browser_open', 'browser_navigate', 'browser_activate', 'browser_close', 'browser_scroll', 'browser_scroll_to_text', 'browser_click_point', 'browser_click_text', 'browser_reload'].includes(action) && (!args.tab_id || typeof args.element !== 'string')) throw new Error('tab_id and element token/ref required')
  if (action === 'browser_open' && (!args.url || !['http:', 'https:'].includes(new URL(args.url).protocol))) throw new Error('HTTP(S) URL required')
  if (action === 'browser_navigate' && (!args.url || !['http:', 'https:'].includes(new URL(args.url).protocol))) throw new Error('HTTP(S) URL required')
  if (['browser_type', 'browser_replace'].includes(action) && typeof args.text !== 'string') throw new Error('text required')
  let uploadFiles = null
  if (action === 'browser_upload') {
    if (!Array.isArray(args.files) || args.files.length < 1 || args.files.length > 20) throw new Error('files must contain 1..20 absolute file paths')
    uploadFiles = args.files.map((file) => {
      if (typeof file !== 'string' || !file || !path.isAbsolute(file)) throw new Error('browser_upload requires explicit absolute file paths')
      const resolved = path.resolve(file)
      let stat
      try { stat = fs.statSync(resolved) } catch { throw new Error('browser_upload file not found') }
      if (!stat.isFile()) throw new Error('browser_upload accepts files only')
      return resolved
    })
  }
  if (action === 'browser_click_point') {
    if (!args.tab_id) throw new Error('tab_id required')
    if (typeof args.screenshot_id !== 'string' || !args.screenshot_id) throw new Error('screenshot_id required for browser_click_point')
    if (!Number.isFinite(Number(args.x)) || !Number.isFinite(Number(args.y))) throw new Error('finite x/y required for browser_click_point')
  }
  if (action === 'browser_scroll_to_text' && (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 2000)) throw new Error('non-empty text up to 2000 characters required')
  if (action === 'browser_click_text' && (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 200)) throw new Error('non-empty text up to 200 characters required')
  if (action === 'browser_wait') {
    const waitFor = args.browser_wait_for || 'ready'
    if (!['ready', 'url_change', 'text'].includes(waitFor)) throw new Error('browser_wait_for must be ready, url_change, or text')
    if (waitFor === 'url_change' && (typeof args.expected_url !== 'string' || !args.expected_url)) throw new Error('expected_url required for browser_wait url_change')
    if (waitFor === 'text' && (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 2000)) throw new Error('non-empty text up to 2000 characters required for browser_wait text')
    if (args.browser_wait_timeout_ms !== undefined && (!Number.isFinite(Number(args.browser_wait_timeout_ms)) || Number(args.browser_wait_timeout_ms) < 0 || Number(args.browser_wait_timeout_ms) > 30000)) throw new Error('browser_wait_timeout_ms must be 0..30000')
  }
  if (args.capture_network_wait_ms !== undefined && (!Number.isFinite(Number(args.capture_network_wait_ms)) || Number(args.capture_network_wait_ms) < 0 || Number(args.capture_network_wait_ms) > 10000)) throw new Error('capture_network_wait_ms must be 0..10000')
  if (args.frame_id !== undefined && (typeof args.frame_id !== 'string' || !args.frame_id)) throw new Error('Exact frame_id required')
  if (action === 'browser_upload' && args.filechooser_id && args.element) throw new Error('Use element or filechooser_id, not both')
  const key = action === 'browser_key' ? keySpec(args.key) : null
  signal?.throwIfAborted()
  if (locks.has(url)) throw new Error('Browser endpoint busy')
  locks.add(url)
  let cdp
  let mutationStarted = false
  let inputSessionId
  const pendingReleases = new Map()
  // Per-call CDP command budget: error pages / heavy pages can exceed the
  // default; clamp to 2s..30s so a hung page still fails legibly and fast.
  const commandTimeoutMs = Math.max(2000, Math.min(30000, Number(args.command_timeout_ms) || COMMAND_TIMEOUT_MS))
  // A full action includes several commands and a capture. Honor a caller's
  // longer per-command timeout and the documented 30s wait without silently
  // aborting the entire call at the old fixed 15s deadline.
  const budget = AbortSignal.timeout(Math.min(45000, Math.max(15000, commandTimeoutMs * 3 + 5000, action === 'browser_wait' ? Number(args.browser_wait_timeout_ms ?? 10000) + 5000 : 0)))
  const combined = signal ? AbortSignal.any([signal, budget]) : budget
  const startMutation = () => { combined.throwIfAborted(); mutationStarted = true }
  try {
    for (const [token, item] of tokens) if (item.expires < Date.now()) tokens.delete(token)
    for (const [key, store] of refStores) if (store.expires < Date.now()) refStores.delete(key)
    for (const [key, capture] of screenshotTokens) if (capture.expires < Date.now()) screenshotTokens.delete(key)
    for (const [key, chooser] of fileChoosers) if (chooser.expires < Date.now()) fileChoosers.delete(key)
    cdp = await acquireBrowserConnection(url, combined, commandTimeoutMs)
    const eventMark = cdp.markEvents()
    combined.throwIfAborted()
    if (action === 'browser_shutdown') {
      startMutation()
      for (const [token, item] of tokens) if (item.url === url) tokens.delete(token)
      clearEndpointRefs(url)
      await cdp.send('Browser.close')
      cdp.invalidate()
      return { ok: true, browser_closed: true, outcome: 'completed' }
    }
    if (action === 'browser_downloads') {
      const collected = cdp.eventsAfter(args.event_cursor)
      const retained = cdp.eventsAfter()
      const downloads = new Map()
      for (const event of retained.events) {
        if (event.method === 'Browser.downloadWillBegin') {
          const p = event.params || {}
          let safeUrl = 'unknown'
          try { const u = new URL(p.url); safeUrl = u.origin + u.pathname } catch { }
          downloads.set(p.guid, {
            guid: p.guid,
            suggested_filename: path.basename(String(p.suggestedFilename || 'download')).slice(0, 240),
            url: safeUrl,
            state: 'in_progress',
          })
        } else if (event.method === 'Browser.downloadProgress') {
          const p = event.params || {}
          const item = downloads.get(p.guid) || { guid: p.guid, state: 'in_progress' }
          item.state = p.state || item.state
          if (Number.isFinite(p.receivedBytes)) item.received_bytes = p.receivedBytes
          if (Number.isFinite(p.totalBytes)) item.total_bytes = p.totalBytes
          downloads.set(p.guid, item)
        }
      }
      let files = []
      try {
        files = fs.readdirSync(cdp.downloadDirectory(), { withFileTypes: true })
          .filter(entry => entry.isFile())
          .slice(0, 100)
          .map(entry => {
            const file = path.join(cdp.downloadDirectory(), entry.name)
            const stat = fs.statSync(file)
            return { name: entry.name, path: file, bytes: stat.size, modified_ms: stat.mtimeMs }
          })
      } catch { }
      return {
        ok: true,
        browser_session_id: cdp.sessionId(),
        downloads_enabled: cdp.downloadsEnabled(),
        downloads: [...downloads.values()].slice(-100),
        files,
        event_cursor: collected.cursor,
        events_reset: collected.reset,
        events_truncated: collected.truncated,
        outcome: 'completed',
      }
    }
    if (action === 'browser_open') {
      startMutation()
      const { targetId } = await cdp.send('Target.createTarget', { url: args.url, background: true })
      return { ok: true, tab_id: targetId, requested_url: args.url, outcome: 'dispatched', observation_required: true }
    }
    const { targetInfos } = await cdp.send('Target.getTargets')
    const pages = targetInfos.filter(t => t.type === 'page')
    const liveTabs = new Set(pages.map(page => page.targetId))
    cdp.prunePageSessions([...liveTabs])
    pruneRefStores(url, liveTabs)
    if (action === 'browser_tabs' || (action === 'browser_state' && args.tab_id === undefined)) {
      // Privacy default: a dirty shared profile leaks session state through tab
      // URLs/titles (ntp queries, sync dialogs). List ids only; opt in with
      // include_url when the task genuinely needs to match a tab by its URL.
      const listed = pages.map(t => args.include_url
        ? { tab_id: t.targetId, url: normalizeUrl(t.url), title: t.title }
        : { tab_id: t.targetId })
      return { ok: true, pages: listed, tab_count: listed.length, include_url: !!args.include_url, browser_session_id: cdp.sessionId(), event_cursor: cdp.eventCursor(), outcome: 'completed' }
    }
    if (!pages.some(t => t.targetId === args.tab_id)) throw new Error('Exact page tab_id not found')
    const claimKey = refStoreKey(url, args.tab_id)
    const readActions = ['browser_tabs', 'browser_events', 'browser_frames', 'browser_state', 'browser_read', 'browser_history', 'browser_wait', 'browser_downloads']
    if (action !== 'browser_claim_tab' && !readActions.includes(action)) {
      const claim = tabClaims.get(claimKey)
      if (finalizedTabs.has(claimKey)) throw new Error('Tab finalized; claim it again before acting')
      if (args.claim_id !== undefined && !claim) throw new Error('Stale claim_id; claim tab again')
      if (claim && args.claim_id !== claim.id) throw new Error('Exact claim_id required for claimed tab')
      if (claim && (claim.sessionId !== cdp.sessionId() || claim.controlSessionId !== args.control_session_id)) throw new Error('Stale or wrong-session claim_id')
    }
    const sessionId = await cdp.getPageSession(args.tab_id)
    inputSessionId = sessionId
    const send = async (method, params = {}, options) => {
      const key = method === 'Input.dispatchKeyEvent' ? `key:${params.code || params.key}` : method === 'Input.dispatchMouseEvent' ? `mouse:${params.button}` : null
      if (params.type === 'keyDown') pendingReleases.set(key, { method, params:{ ...params, type:'keyUp', modifiers:0 } })
      if (params.type === 'mousePressed') pendingReleases.set(key, { method, params:{ ...params, type:'mouseReleased', buttons:0 } })
      const value = await cdp.send(method, params, sessionId, options)
      if (params.type === 'keyUp' || params.type === 'mouseReleased') pendingReleases.delete(key)
      return value
    }
    if (action === 'browser_claim_tab') {
      if (chooserArms.has(claimKey) && chooserArms.get(claimKey) !== args.control_session_id) throw new Error('File chooser is armed by another control session')
      const existing = tabClaims.get(claimKey)
      if (existing && args.claim_id !== existing.id) throw new Error('Tab already claimed; exact claim_id required')
      if (existing && (existing.sessionId !== cdp.sessionId() || existing.controlSessionId !== args.control_session_id)) throw new Error('Stale or wrong-session claim_id')
      const id = existing?.id || randomUUID()
      tabClaims.set(claimKey, { id, url, tab: args.tab_id, sessionId: cdp.sessionId(), controlSessionId: args.control_session_id })
      finalizedTabs.delete(claimKey)
      return { ok: true, tab_id: args.tab_id, claim_id: id, browser_session_id: cdp.sessionId(), outcome: 'completed' }
    }
    if (action === 'browser_finalize') {
      if (!tabClaims.has(claimKey)) throw new Error('Claimed tab required for finalize')
      combined.throwIfAborted()
      startMutation()
      if (chooserArms.has(claimKey) || cdp.chooserEnabled(sessionId)) await cdp.setChooserEnabled(sessionId, false)
      chooserArms.delete(claimKey)
      await cdp.send('Target.detachFromTarget', { sessionId })
      cdp.dropPageSession(args.tab_id)
      tabClaims.delete(claimKey)
      finalizedTabs.add(claimKey)
      for (const [token, item] of tokens) if (item.url === url && item.tab === args.tab_id) tokens.delete(token)
      clearRefStore(url, args.tab_id)
      return { ok: true, tab_id: args.tab_id, handed_back: true, activated: false, outcome: 'completed' }
    }
    if (action === 'browser_events') {
      const collected = cdp.eventsAfter(args.event_cursor, { sessionId })
      const output = []
      for (const event of collected.events) {
        const p = event.params || {}
        if (event.method === 'Runtime.consoleAPICalled') {
          output.push({ kind: 'console', level: p.type || 'log', text: (p.args || []).map(arg => String(arg.value ?? arg.description ?? '')).join(' ').slice(0, 1000), timestamp: p.timestamp })
        } else if (event.method === 'Runtime.exceptionThrown') {
          output.push({ kind: 'exception', text: String(p.exceptionDetails?.text || p.exceptionDetails?.exception?.description || 'JavaScript exception').slice(0, 1000), timestamp: p.timestamp })
        } else if (event.method === 'Log.entryAdded') {
          let safeUrl = undefined
          try { const u = new URL(p.entry?.url || ''); safeUrl = u.origin + u.pathname } catch { }
          output.push({ kind: 'log', level: p.entry?.level || 'info', source: p.entry?.source || 'other', text: String(p.entry?.text || '').slice(0, 1000), ...(safeUrl ? { url: safeUrl } : {}), timestamp: p.entry?.timestamp })
        } else if (event.method === 'Network.responseReceived') {
          let safeUrl = 'unknown'
          try { const u = new URL(p.response?.url || ''); safeUrl = u.origin + u.pathname } catch { }
          output.push({ kind: 'response', url: safeUrl, status: p.response?.status, mime_type: p.response?.mimeType, resource_type: p.type })
        } else if (event.method === 'Network.loadingFailed') {
          output.push({ kind: 'network_failed', request_id: p.requestId, resource_type: p.type, error: String(p.errorText || '').slice(0, 300), canceled: Boolean(p.canceled), blocked_reason: p.blockedReason })
        } else if (event.method === 'Page.lifecycleEvent') {
          output.push({ kind: 'lifecycle', name: p.name, loader_id: p.loaderId, timestamp: p.timestamp })
        }
        if (output.length >= 200) break
      }
      return {
        ok: true,
        tab_id: args.tab_id,
        browser_session_id: cdp.sessionId(),
        events: output,
        event_cursor: collected.cursor,
        events_reset: collected.reset,
        events_truncated: collected.truncated || output.length >= 200,
        outcome: 'completed',
      }
    }
    const { frameTree } = await send('Page.getFrameTree')
    const frames = flattenFrames(frameTree)
    if (action === 'browser_frames') {
      // Chromium may omit out-of-process children from this renderer's tree.
      // Correlate omitted frame owners from this tab's DOM rather than listing
      // iframe targets belonging to arbitrary other tabs in the browser.
      const world = await send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'win-pilot-dom' })
      const owners = await send('Runtime.evaluate', { contextId: world.executionContextId, expression: `(() => {
        const result = [], seen = new Set(), roots = [document]; let scanned = 0;
        for (let i=0;i<roots.length;i++) for (const node of roots[i].querySelectorAll('*')) {
          if (++scanned > 50000 || result.length >= 500) return result;
          if (node.shadowRoot) roots.push(node.shadowRoot);
          if (node.localName !== 'iframe' && node.localName !== 'frame') continue;
          result.push(node);
          try { if (node.contentDocument && !seen.has(node.contentDocument)) { seen.add(node.contentDocument); roots.push(node.contentDocument); } } catch {}
        }
        return result;
      })()` })
      const ownerProps = await send('Runtime.getProperties', { objectId: owners.result.objectId, ownProperties: true })
      const omitted = []
      for (const property of ownerProps.result.filter(property => /^\d+$/.test(property.name) && property.value?.objectId)) {
        const { node } = await send('DOM.describeNode', { objectId: property.value.objectId })
        if (!node.frameId || frames.some(frame => frame.id === node.frameId) || omitted.some(frame => frame.frame_id === node.frameId)) continue
        const target = targetInfos.find(target => target.type === 'iframe' && target.targetId === node.frameId)
        omitted.push({ frame_id: node.frameId, ...(target ? { url: target.url } : {}), supported: false, reason: 'frame_context_unavailable_or_oopif' })
      }
      return { ok: true, tab_id: args.tab_id, frames: [...frames.map(frame => ({ frame_id: frame.id, parent_frame_id: frame.parentId, url: frame.url, name: frame.name || '', navigation_id: frame.loaderId, supported: Boolean(frameSupported(frame, frameTree.frame, targetInfos)), ...(!frameSupported(frame, frameTree.frame, targetInfos) ? { reason: 'cross_origin_or_oopif_not_supported' } : {}) })), ...omitted], capabilities: { same_origin_frames: true, cross_origin_frames: false, oopif: false, filechooser: 'explicit_arm_required', tab_claim: true, tab_finalize: true }, scope: 'renderer frame tree and DOM frame owners; closed shadow roots excluded', outcome: 'completed' }
    }
    if (action === 'browser_filechooser') {
      if (chooserArms.has(claimKey) && chooserArms.get(claimKey) !== args.control_session_id) throw new Error('File chooser is armed by another control session')
      if (args.claim_id !== undefined && args.claim_id !== tabClaims.get(claimKey)?.id) throw new Error('Wrong claim_id')
      if (finalizedTabs.has(claimKey)) throw new Error('Tab finalized; claim it again before arming file chooser')
      startMutation()
      if (!chooserArms.has(claimKey)) cdp.chooserEvents(sessionId)
      chooserArms.set(claimKey, args.control_session_id)
      await cdp.setChooserEnabled(sessionId, true)
      for (const event of cdp.chooserEvents(sessionId)) {
        const p = event.params || {}
        if (event.method === 'WinPilot.chooserEventsLost') {
          for (const [key, item] of fileChoosers) if (item.url === url && item.tab === args.tab_id) fileChoosers.delete(key)
        } else if (event.method === 'Page.frameNavigated' || event.method === 'Page.frameDetached') {
          const id = p.frame?.id || p.frameId
          for (const [key, item] of fileChoosers) if (item.url === url && item.tab === args.tab_id && (id === frameTree.frame.id || item.frameId === id)) fileChoosers.delete(key)
        } else if (event.method === 'Page.fileChooserOpened') {
          if (!event.__receivedMs || event.__receivedMs + TTL < Date.now()) continue
          const frame = frames.find(frame => frame.id === p.frameId)
          if (!frame || !p.backendNodeId || !frameSupported(frame, frameTree.frame, targetInfos)) continue
          for (const [key, item] of fileChoosers) if (item.url === url && item.tab === args.tab_id) fileChoosers.delete(key)
          fileChoosers.set(randomUUID(), { url, tab: args.tab_id, controlSessionId:args.control_session_id, frameId: frame.id, frameUrl: frame.url, pageUrl: frameTree.frame.url, loaderId: frame.loaderId, mainLoaderId: frameTree.frame.loaderId, backendNodeId: p.backendNodeId, mode: p.mode, expires: event.__receivedMs + TTL })
        }
      }
      return { ok: true, tab_id: args.tab_id, armed: true, filechoosers: [...fileChoosers].filter(([, item]) => item.url === url && item.tab === args.tab_id && item.expires >= Date.now() && frames.some(frame => frame.id === item.frameId && frame.loaderId === item.loaderId) && frameTree.frame.loaderId === item.mainLoaderId).map(([id, item]) => ({ filechooser_id: id, frame_id: item.frameId, mode: item.mode, expires_in_ms: item.expires - Date.now() })), outcome: 'completed' }
    }
    // Resolve compact references before choosing a world. Frame references never
    // silently fall back to the main document, even after a frame is detached.
    let suppliedToken = args.element
    if (typeof suppliedToken === 'string' && /^@?e[1-9]\d*$/.test(suppliedToken)) {
      const ref = suppliedToken.startsWith('@') ? suppliedToken : `@${suppliedToken}`
      suppliedToken = [...refStores.values()].filter(store => store.controlSessionId === args.control_session_id && store.url === url && store.tab === args.tab_id && store.expires >= Date.now()).map(store => store.refs.get(ref)).find(Boolean)
      if (!suppliedToken) throw new Error('Stale or wrong-tab element ref')
    }
    const suppliedItem = tokens.get(suppliedToken)
    if (suppliedItem && (suppliedItem.controlSessionId !== args.control_session_id || suppliedItem.url !== url || suppliedItem.tab !== args.tab_id)) throw new Error('Stale or wrong-session/tab element token')
    if (args.filechooser_id) {
      const knownChooser = fileChoosers.get(args.filechooser_id)
      if (knownChooser && knownChooser.controlSessionId !== args.control_session_id) throw new Error('Stale or wrong-session filechooser_id')
      for (const event of cdp.chooserEvents(sessionId, false)) {
        const id = event.params?.frame?.id || event.params?.frameId
        if (['Page.fileChooserOpened', 'WinPilot.chooserEventsLost', 'Page.frameNavigated', 'Page.frameDetached'].includes(event.method)) {
          for (const [key, item] of fileChoosers) if (item.url === url && item.tab === args.tab_id && (['Page.fileChooserOpened', 'WinPilot.chooserEventsLost'].includes(event.method) || id === frameTree.frame.id || id === item.frameId)) fileChoosers.delete(key)
        }
      }
    }
    const chooser = args.filechooser_id ? fileChoosers.get(args.filechooser_id) : null
    if (args.filechooser_id && (!chooser || chooser.controlSessionId !== args.control_session_id || chooser.url !== url || chooser.tab !== args.tab_id || chooser.expires < Date.now() || chooser.mainLoaderId !== frameTree.frame.loaderId || chooser.pageUrl !== frameTree.frame.url || !frames.some(frame => frame.id === chooser.frameId && frame.loaderId === chooser.loaderId && frame.url === chooser.frameUrl))) throw new Error('Stale or wrong-session/tab filechooser_id')
    const selectedFrameId = args.frame_id || suppliedItem?.frameId || chooser?.frameId || frameTree.frame.id
    const selectedFrame = frames.find(frame => frame.id === selectedFrameId)
    if (!selectedFrame && targetInfos.some(target => target.type === 'iframe' && target.targetId === selectedFrameId)) throw new Error('Cross-origin or OOPIF frame not supported')
    if (!selectedFrame) throw new Error('Stale or wrong-tab frame_id not found; refresh browser_frames')
    if (!frameSupported(selectedFrame, frameTree.frame, targetInfos)) throw new Error('Cross-origin or OOPIF frame not supported')
    if (selectedFrame.id !== frameTree.frame.id && ['browser_click_text', 'browser_click_point', 'browser_reload', 'browser_back', 'browser_forward', 'browser_history'].includes(action)) throw new Error('Action requires main frame; use frame element refs for clicks')
    if (suppliedItem && suppliedItem.frameId !== selectedFrame.id) throw new Error('Wrong-frame element token')
    const { executionContextId } = await send('Page.createIsolatedWorld', { frameId: selectedFrame.id, worldName: 'win-pilot-dom' })
    if (!executionContextId) throw new Error('Frame execution context unavailable')
    const evaluate = params => send('Runtime.evaluate', { ...params, contextId: executionContextId })
    const navigation = await send('Page.getNavigationHistory').catch(() => ({ currentIndex: -1, entries: [] }))
    const historyEntries = Array.isArray(navigation.entries) ? navigation.entries : []
    const currentHistoryIndex = Number.isInteger(navigation.currentIndex) ? navigation.currentIndex : -1
    // A crashed or blocked renderer reports url "" or ":" here; normalize once
    // and reuse for the expected_url guard, token binding and the state reply.
    const pageUrl = normalizeUrl(frameTree.frame.url, pages.find(t => t.targetId === args.tab_id)?.url)
    if (args.expected_url !== undefined && !['browser_wait', 'browser_back', 'browser_forward'].includes(action) && args.expected_url !== pageUrl) throw new Error('Page URL changed; refresh browser_state before acting')
    if (action === 'browser_history') {
      const entries = historyEntries.slice(-50).map((entry, index) => ({
        entry_id: entry.id,
        index: Math.max(0, historyEntries.length - 50) + index,
        url: normalizeUrl(entry.url),
        title: String(entry.title || '').slice(0, 500),
        transition_type: entry.transitionType || 'unknown',
      }))
      return {
        ok: true,
        tab_id: args.tab_id,
        current_index: currentHistoryIndex,
        entry_count: historyEntries.length,
        can_go_back: currentHistoryIndex > 0,
        can_go_forward: currentHistoryIndex >= 0 && currentHistoryIndex < historyEntries.length - 1,
        entries,
        outcome: 'completed',
      }
    }
    if (action === 'browser_back' || action === 'browser_forward') {
      const delta = action === 'browser_back' ? -1 : 1
      const nextIndex = currentHistoryIndex + delta
      if (nextIndex < 0 || nextIndex >= historyEntries.length) {
        return { ok: false, tab_id: args.tab_id, outcome: 'not_executed', error_code: action === 'browser_back' ? 'no_back_history' : 'no_forward_history' }
      }
      startMutation()
      await send('Page.navigateToHistoryEntry', { entryId: historyEntries[nextIndex].id })
      for (const [token, item] of tokens) if (item.url === url && item.tab === args.tab_id) tokens.delete(token)
      clearRefStore(url, args.tab_id)
      return { ok: true, tab_id: args.tab_id, from_index: currentHistoryIndex, to_index: nextIndex, requested_url: normalizeUrl(historyEntries[nextIndex].url), outcome: 'dispatched', observation_required: true }
    }
    if (action === 'browser_wait') {
      const waitFor = args.browser_wait_for || 'ready'
      const timeoutMs = Math.max(0, Math.min(30000, Number(args.browser_wait_timeout_ms ?? 10000)))
      const started = Date.now()
      let last = { ready_state: '', url: pageUrl, text_found: false }
      while (true) {
        combined.throwIfAborted()
        const observed = await evaluate({
          expression: `(() => ({ ready_state: document.readyState || '', url: location.href || '', text_found: ${JSON.stringify(waitFor === 'text' ? args.text.trim() : '')} ? (document.body?.innerText || document.body?.textContent || '').includes(${JSON.stringify(waitFor === 'text' ? args.text.trim() : '')}) : false }))()`,
          returnByValue: true,
        })
        const value = observed?.result?.value || {}
        last = { ready_state: value.ready_state || '', url: normalizeUrl(value.url, pageUrl), text_found: Boolean(value.text_found) }
        const matched = waitFor === 'ready'
          ? last.ready_state === 'complete'
          : waitFor === 'url_change'
            ? last.url !== args.expected_url
            : last.text_found
        if (matched) {
          return { ok: true, tab_id: args.tab_id, wait_for: waitFor, waited_ms: Date.now() - started, ...last, outcome: 'completed' }
        }
        if (Date.now() - started >= timeoutMs) {
          return { ok: false, tab_id: args.tab_id, wait_for: waitFor, waited_ms: Date.now() - started, ...last, outcome: 'not_executed', error_code: 'browser_wait_timeout' }
        }
        await abortableDelay(100, combined)
      }
    }
    if (action === 'browser_read') {
      const live = await evaluate({ expression: `(() => ({ title: document.title || '', text: (document.body?.innerText || document.body?.textContent || '').slice(0, 50000), readyState: document.readyState }))()`, returnByValue: true })
      const value = live?.result?.value || {}
      return { tab_id: args.tab_id, url: pageUrl, frame_id: selectedFrame.id, frame_url: selectedFrame.url, title: value.title || '', ready_state: value.readyState || '', text: value.text || '', outcome: 'completed', ok: true }
    }
    if (action === 'browser_request') {
      const target = new URL(args.url || '')
      if (!['http:', 'https:'].includes(target.protocol)) throw new Error('HTTP(S) URL required')
      const current = new URL(selectedFrame.url)
      if (target.origin !== current.origin && target.hostname !== 'api.bilibili.com') throw new Error('browser_request target origin is not allowed')
      const method = String(args.method || 'GET').toUpperCase()
      if (!['GET','POST','DELETE'].includes(method)) throw new Error('Unsupported browser_request method')
      if (method !== 'GET' && args.allow_mutation !== true) throw new Error('browser_request mutation requires allow_mutation:true')
      if (method !== 'GET') startMutation()
      const response = await evaluate({ awaitPromise: true, returnByValue: true, expression: `(async()=>{const f=${JSON.stringify(target.href)};const method=${JSON.stringify(method)};const form=${JSON.stringify(args.form||{})};if(${JSON.stringify(Boolean(args.csrf_from_cookie))}){const m=document.cookie.match(/(?:^|;\\s*)bili_jct=([^;]+)/);if(m)form.csrf=decodeURIComponent(m[1])}const r=await fetch(f,{method,credentials:'include',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:method==='GET'?undefined:new URLSearchParams(form).toString()});return{status:r.status,text:(await r.text()).slice(0,50000)}})()` })
      const value = response?.result?.value || {}
      let business = {}; try { business = JSON.parse(value.text || '') } catch {}
      return { tab_id: args.tab_id, url: target.href, status: value.status, business_code: business.code, business_message: business.message, response_text: value.text, outcome: 'completed', ok: value.status >= 200 && value.status < 400 }
    }
    if (action === 'browser_navigate') {
      const target = new URL(args.url)
      const current = new URL(selectedFrame.url)
      const sameBilibiliSite = current.hostname.endsWith('.bilibili.com') && target.hostname.endsWith('.bilibili.com')
      if (target.origin !== current.origin && !sameBilibiliSite) throw new Error('browser_navigate target origin is not allowed')
      startMutation()
      const result = await send('Page.navigate', { url: target.href, frameId: selectedFrame.id })
      for (const [token, item] of tokens) if (item.url === url && item.tab === args.tab_id) tokens.delete(token)
      clearRefStore(url, args.tab_id)
      return { tab_id: args.tab_id, requested_url: target.href, frame_id: result.frameId, outcome: 'dispatched', observation_required: true, ok: true }
    }
    if (action === 'browser_close') {
      startMutation()
      const { success } = await cdp.send('Target.closeTarget', { targetId: args.tab_id })
      if (!success) throw new Error('Tab close failed')
      for (const [token, item] of tokens) if (item.url === url && item.tab === args.tab_id) tokens.delete(token)
      clearRefStore(url, args.tab_id, { counter: true })
      tabClaims.delete(claimKey)
      finalizedTabs.delete(claimKey)
      chooserArms.delete(claimKey)
      cdp.dropPageSession(args.tab_id)
      return { ok: true, tab_id: args.tab_id, outcome: 'completed' }
    }
    if (action === 'browser_activate') {
      startMutation()
      await cdp.send('Target.activateTarget', { targetId: args.tab_id })
      return { ok: true, tab_id: args.tab_id, outcome: 'completed' }
    }
    const docObject = await evaluate({ expression: 'document' })
    if (!docObject.result?.objectId || docObject.exceptionDetails) throw new Error('Frame document unavailable')
    const { node: root } = await send('DOM.describeNode', { objectId: docObject.result.objectId })
    const documentId = root.backendNodeId
    const frameUrl = selectedFrame.url
    const frameId = selectedFrame.id
    const captureBoundScreenshot = async () => {
      const screenshot = await capturePageScreenshot(send, commandTimeoutMs)
      combined.throwIfAborted()
      if (screenshot) {
        screenshotTokens.set(screenshot.screenshot_id, {
          url, tab: args.tab_id, controlSessionId:args.control_session_id, documentId: frameId === frameTree.frame.id ? documentId : (await send('DOM.getDocument', { depth: 0 })).root.backendNodeId, pageUrl,
          width: screenshot.width, height: screenshot.height,
          expires: Date.now() + TTL,
        })
      }
      return screenshot
    }
    const call = async (objectId, functionDeclaration, arguments_ = []) => {
      const result = await send('Runtime.callFunctionOn', { objectId, functionDeclaration,
        arguments: arguments_.map(value => ({ value })), returnByValue: true })
      if (result.exceptionDetails) throw new Error('Element stale or DOM operation rejected')
      return result.result.value
    }
    if (action === 'browser_state') {
      // Collect visible controls in-page once, including open shadow roots. Avoid
      // three protocol roundtrips per invisible node on large Chromium pages.
      const collected = await send('Runtime.evaluate', { contextId: executionContextId, expression: `(() => {
        const nodes = []; let visited = 0;
        function walk(root) {
          for (const el of root.querySelectorAll('*')) {
            if (++visited > 50000 || nodes.length > ${LIMIT}) { nodes.scanTruncated = true; return; }
             if ((el.matches('button,a[href],input,textarea,select,[role],[tabindex],[contenteditable="true"]') ||
                 /^(发布|发送|提交)$/.test((el.innerText || '').replace(/\s+/g, ' ').trim())) &&
                el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && el.type !== 'hidden') nodes.push(el);
            if (el.shadowRoot) walk(el.shadowRoot);
          }
        }
         walk(document);
         // Long comment feeds can contain hundreds of reply/like links before
         // the active editor and submit controls. Keep actionable controls in
         // the bounded snapshot instead of letting document order hide them.
         const priority = el => el.matches('button,input,textarea,select,[contenteditable="true"],[role="button"],[role="textbox"]') ? 0 : 1;
         nodes.sort((a,b) => priority(a) - priority(b));
         return nodes;
      })()` })
      if (collected.exceptionDetails) throw new Error('Page observation failed')
      const properties = await send('Runtime.getProperties', { objectId: collected.result.objectId, ownProperties: true })
      const controls = properties.result.filter(p => /^\d+$/.test(p.name) && p.value?.objectId)
      // targetInfo title lags behind loading; the live document title decides
      // whether an error page is recognizable as such.
       const live = await send('Runtime.evaluate', { contextId: executionContextId, expression: `(() => { const visibleText = ${args.include_visible_text ? `(() => { const out = []; const seen = new Set(); const roots = [document]; for (let i = 0; i < roots.length; i++) for (const host of roots[i].querySelectorAll('*')) if (host.shadowRoot) roots.push(host.shadowRoot); for (const root of roots) { const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let node; while ((node = walker.nextNode()) && out.join(' ').length < 10000) { const text = (node.nodeValue || '').replace(/\\s+/g, ' ').trim(); const parent = node.parentElement; if (!text || !parent || seen.has(text)) continue; const rect = parent.getBoundingClientRect(); if (rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth && getComputedStyle(parent).visibility !== 'hidden') { seen.add(text); out.push(text); } } } return out.join(' '); })()` : `''`}; return { title: document.title || '', body: (document.body && document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, ${args.include_body_text ? 20000 : 300}), visibleText, readyState: document.readyState }; })()`,
        returnByValue: true })
      const liveTitle = live?.result?.value?.title || ''
      const bodyText = live?.result?.value?.body || ''
      const visibleText = live?.result?.value?.visibleText || ''
      const readyState = live?.result?.value?.readyState || ''
      const elements = []
      const refKey = refStoreKey(url, args.tab_id, frameId) + '\u0000' + (args.control_session_id || '')
      const previousRefStore = refStores.get(refKey)
      const previousRefsByToken = new Map()
      if (previousRefStore?.documentId === documentId && previousRefStore?.pageUrl === pageUrl) {
        for (const [ref, token] of previousRefStore.refs) previousRefsByToken.set(token, ref)
      }
      const refs = new Map()
      const observationId = randomUUID().replaceAll('-', '')
      for (const control of controls.slice(0, LIMIT)) {
        const object = control.value
        const info = await call(object.objectId, `function(){
          if (!this.isConnected || !this.getClientRects().length || getComputedStyle(this).visibility === 'hidden' || this.type === 'hidden') return null;
          return (${describe})(this);
        }`)
        if (!info) continue
        if (!args.include_editable_text && info.value_preview !== undefined) delete info.value_preview
        const { node } = await send('DOM.describeNode', { objectId: object.objectId })
        let token
        for (const [id, item] of tokens) {
          if (item.controlSessionId === args.control_session_id && item.url === url && item.tab === args.tab_id && item.documentId === documentId && item.frameId === frameId && item.frameUrl === frameUrl && item.pageUrl === pageUrl &&
              item.backendNodeId === node.backendNodeId && item.name === info.name && item.role === info.role) { token = id; break }
        }
        token ||= randomUUID()
        tokens.set(token, { url, tab: args.tab_id, controlSessionId:args.control_session_id, frameId, frameUrl, documentId, pageUrl, backendNodeId: node.backendNodeId,
          ...info, expires: Date.now() + TTL })
        const ref = previousRefsByToken.get(token) || nextElementRef(url, args.tab_id)
        refs.set(ref, token)
        elements.push({ ref, element: token, frame_id: frameId, ...info })
      }
      refStores.set(refKey, { url, tab: args.tab_id, controlSessionId:args.control_session_id, frameId, frameUrl, documentId, pageUrl, observationId, refs, expires: Date.now() + TTL })
      while (tokens.size > 4000) tokens.delete(tokens.keys().next().value)
      const title = liveTitle || pages.find(t => t.targetId === args.tab_id)?.title || ''
      // browser_state preserves raw UUID element tokens for compatibility.
      // browser_observe is the agent-facing compact view: refs are sufficient to act,
      // while keeping UUIDs out of the model context saves tokens without reducing capability.
      const elements_out = observeAlias
        ? elements.map(({ element, ...item }) => item)
        : elements
      const status = pageStatus(title, elements_out.length, pageUrl, bodyText, readyState)
      const authRequired = /(登录后|请先登录|登录即可|扫码登录|立即登录)/i.test(bodyText)
      const editableCount = elements_out.filter(item => item.role === 'textbox').length
      const stateScreenshot = args.with_screenshot ? await captureBoundScreenshot() : null
      return {
        tab_id: args.tab_id,
        browser_session_id: cdp.sessionId(),
        observation_id: observationId,
        url: pageUrl,
        title,
        frame_id: frameId,
        frame_url: frameUrl,
        rect_coordinate_space: 'selected_frame_viewport',
        navigation_id: selectedFrame.loaderId || undefined,
        capabilities: { same_origin_frames: true, cross_origin_frames: false, oopif: false, filechooser: cdp.chooserEnabled(sessionId), tab_claim: true, tab_finalize: true },
        ready_state: readyState,
        can_go_back: currentHistoryIndex > 0,
        can_go_forward: currentHistoryIndex >= 0 && currentHistoryIndex < historyEntries.length - 1,
        event_cursor: cdp.eventCursor(),
        auth_required: authRequired,
        editable_count: editableCount,
        // page_status makes a blocked/crashed/degraded page legible instead of
        // reading as a quiet success with zero elements. The visible body text
        // gives the model direct evidence of what the page actually says.
        page_status: status,
         ...((args.include_body_text || elements_out.length === 0 || status !== 'ok') && bodyText ? { body_text: bodyText } : {}),
        ...(args.include_visible_text && visibleText ? { visible_text: visibleText } : {}),
        elements: elements_out,
        truncated: controls.length > LIMIT || properties.result.some(p => p.name === 'scanTruncated' && p.value?.value),
        scope: 'selected frame document and open shadow roots; scan capped at 50000 nodes',
        ...(stateScreenshot ? { screenshot: stateScreenshot } : { ...(args.with_screenshot ? { screenshot_error: 'page capture unavailable' } : {}) }),
      }
    }
    if (action === 'browser_click_point') {
      if (frameId !== frameTree.frame.id) throw new Error('Screenshot point coordinates require the main frame')
      const capture = screenshotTokens.get(args.screenshot_id)
      if (!capture || capture.controlSessionId !== args.control_session_id || capture.expires < Date.now() || capture.url !== url || capture.tab !== args.tab_id ||
          capture.documentId !== documentId || capture.pageUrl !== pageUrl) {
        throw new Error('Stale or wrong-tab browser screenshot')
      }
      const x = Number(args.x)
      const y = Number(args.y)
      if (x < 0 || y < 0 || x >= capture.width || y >= capture.height) throw new Error('browser_click_point coordinates outside observed screenshot')
      startMutation()
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 })
      const screenshot = await captureBoundScreenshot()
      return { tab_id: args.tab_id, ok: true, outcome: 'dispatched', observation_required: true, click_point: { x, y },
        ...(screenshot ? { screenshot } : { screenshot_error: 'post-action page capture unavailable' }) }
    }
    if (action === 'browser_scroll') {
      if (!args.tab_id) throw new Error('tab_id required')
      const dx = Number(args.scroll_x ?? 0)
      const dy = Number(args.scroll_y ?? (args.direction === 'up' ? -700 : args.direction === 'down' ? 700 : 0))
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 10000 || Math.abs(dy) > 10000) throw new Error('scroll delta out of range')
      startMutation()
      const moved = await send('Runtime.evaluate', { contextId: executionContextId, expression: `(() => {
        const amount = ${JSON.stringify(dy)};
        const visible = el => { const r = el.getBoundingClientRect(); return r.width > 120 && r.height > 120 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
        const scrollables = [...document.querySelectorAll('*')].filter(el => {
          if (!visible(el) || el.scrollHeight <= el.clientHeight + 4) return false;
          const s = getComputedStyle(el); return /(auto|scroll)/.test(s.overflowY);
        }).map(el => { const r = el.getBoundingClientRect(); return { el, area: Math.max(0, Math.min(innerWidth,r.right)-Math.max(0,r.left)) * Math.max(0,Math.min(innerHeight,r.bottom)-Math.max(0,r.top)) }; }).sort((a,b) => b.area-a.area);
        const target = scrollables[0]?.el;
        if (target) { target.scrollBy(0, amount); return { container: target.tagName.toLowerCase(), class_name: String(target.className || '').slice(0,120), top: target.scrollTop, height: target.scrollHeight, viewport: target.clientHeight }; }
        window.scrollBy(0, amount); return { container: 'document', x: window.scrollX, y: window.scrollY, height: Math.max(document.body?.scrollHeight || 0, document.documentElement?.scrollHeight || 0), viewport: innerHeight };
      })()`, returnByValue: true })
      const screenshot = await captureBoundScreenshot()
      const position = moved?.result?.value || {}
      return { tab_id: args.tab_id, ok: true, outcome: 'completed', scroll_x: dx, scroll_y: dy, scroll_position: position, ...(screenshot ? { screenshot } : { screenshot_error: 'post-action page capture unavailable' }) }
    }
    if (action === 'browser_scroll_to_text') {
      // This is intentionally a read-directed scroll only: it never clicks or
      // edits. Prefer the smallest visible rendered element containing the
      // complete requested text, so a matching page wrapper cannot win.
      startMutation()
      const located = await send('Runtime.evaluate', { contextId: executionContextId, expression: `(() => {
        const needle = ${JSON.stringify(args.text.trim())};
        const compact = value => String(value || '').replace(/\\s+/g, ' ').trim();
        const candidates = [];
        let seen = 0;
        const roots = [document]; for (let i = 0; i < roots.length; i++) for (const host of roots[i].querySelectorAll('*')) if (host.shadowRoot) roots.push(host.shadowRoot);
        outer: for (const root of roots) for (const el of root.querySelectorAll('*')) {
          if (++seen > 50000) break outer;
          const text = compact(el.innerText);
          if (!text.includes(needle)) continue;
          const rect = el.getBoundingClientRect();
          const style = getComputedStyle(el);
          if (!rect.width || !rect.height || style.visibility === 'hidden' || style.display === 'none') continue;
          candidates.push({ el, textLength: text.length, area: rect.width * rect.height });
        }
        candidates.sort((a, b) => a.textLength - b.textLength || a.area - b.area);
        const chosen = candidates[0];
        if (!chosen) return { found: false, scanned: seen };
        chosen.el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
        const rect = chosen.el.getBoundingClientRect();
        return { found: true, scanned: seen, tag: chosen.el.tagName.toLowerCase(), class_name: String(chosen.el.className || '').slice(0, 160), rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, scroll: { x: window.scrollX, y: window.scrollY } };
      })()`, returnByValue: true })
      const screenshot = await captureBoundScreenshot()
      return { tab_id: args.tab_id, ok: true, outcome: 'completed', ...(located?.result?.value || { found: false }), ...(screenshot ? { screenshot } : { screenshot_error: 'post-action page capture unavailable' }) }
    }
    if (action === 'browser_click_text') {
      // Some web apps draw tabs and menu items with plain containers, so no
      // ARIA/button token exists. This remains constrained to an exact visible
      // label in the already selected tab and reports the chosen geometry.
      startMutation()
      const located = await send('Runtime.evaluate', { contextId: executionContextId, expression: `(() => {
        const needle = ${JSON.stringify(args.text.trim())};
        const compact = value => String(value || '').replace(/\\s+/g, ' ').trim();
        const choices = []; let seen = 0;
        const roots = [document]; for (let i = 0; i < roots.length; i++) for (const host of roots[i].querySelectorAll('*')) if (host.shadowRoot) roots.push(host.shadowRoot);
        outer: for (const root of roots) for (const source of root.querySelectorAll('*')) {
          if (++seen > 50000) break outer;
          if (compact(source.innerText) !== needle) continue;
          const el = source.closest('button,a,[role="button"],[tabindex],li,div,span') || source;
          const rect = el.getBoundingClientRect(); const style = getComputedStyle(el);
          if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight || style.visibility === 'hidden' || style.display === 'none') continue;
          choices.push({ el, textLength: compact(el.innerText).length, area: rect.width * rect.height });
        }
        choices.sort((a, b) => a.textLength - b.textLength || a.area - b.area);
        const chosen = choices[0]; if (!chosen) return { found: false, scanned: seen };
        chosen.el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const rect = chosen.el.getBoundingClientRect(); return { found: true, scanned: seen, tag: chosen.el.tagName.toLowerCase(), class_name: String(chosen.el.className || '').slice(0, 160), point: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) } };
      })()`, returnByValue: true })
      const value = located?.result?.value || { found: false }
      if (value.found) {
        // Text-directed clicks often target animated menus on heavy pages. Keep
        // the caller's larger command budget, but do not let an aggressively
        // low global value make the three mouse steps flake below five seconds.
        const clickTimeout = Math.max(5000, commandTimeoutMs)
        await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: value.point.x, y: value.point.y }, { timeoutMs: clickTimeout })
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: value.point.x, y: value.point.y, button: 'left', buttons: 1, clickCount: 1 }, { timeoutMs: clickTimeout })
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: value.point.x, y: value.point.y, button: 'left', buttons: 0, clickCount: 1 }, { timeoutMs: clickTimeout })
      }
      const screenshot = await captureBoundScreenshot()
      return { tab_id: args.tab_id, ok: true, outcome: 'completed', ...value, ...(screenshot ? { screenshot } : { screenshot_error: 'post-action page capture unavailable' }) }
    }
    if (action === 'browser_reload') {
      startMutation()
      await send('Page.reload', { ignoreCache: Boolean(args.ignore_cache) })
      for (const [token, item] of tokens) if (item.url === url && item.tab === args.tab_id) tokens.delete(token)
      clearRefStore(url, args.tab_id)
      return { tab_id: args.tab_id, ok: true, outcome: 'dispatched', observation_required: true }
    }
    let elementToken = suppliedToken
    let item = tokens.get(elementToken)
    if (chooser) {
      const resolved = await send('DOM.resolveNode', { backendNodeId: chooser.backendNodeId, executionContextId })
      const info = await call(resolved.object.objectId, `function(){ if (!this.isConnected || this.localName !== 'input' || this.type !== 'file' || this.disabled) throw new Error('stale chooser'); return (${describe})(this); }`)
      if (chooser.mode === 'selectSingle' && uploadFiles.length !== 1) throw new Error('File chooser accepts one file')
      item = { url, tab: args.tab_id, frameId, frameUrl, documentId, pageUrl, backendNodeId: chooser.backendNodeId, ...info }
    }
    if (!item || item.url !== url || item.tab !== args.tab_id || item.documentId !== documentId || item.frameId !== frameId || item.frameUrl !== frameUrl || item.pageUrl !== pageUrl) throw new Error('Stale or wrong-tab element token')
    if (action === 'browser_upload' && item.role !== 'file') throw new Error('browser_upload target is not a file input')
    const { object } = await send('DOM.resolveNode', { backendNodeId: item.backendNodeId, executionContextId })
    const beforeText = ['browser_type', 'browser_replace'].includes(action)
      ? await call(object.objectId, `function(){ const e=this.matches('[contenteditable="true"]') ? this : this.querySelector?.('[contenteditable="true"]'); return this.value != null ? this.value : (e ? (e.innerText || e.textContent || '') : (this.innerText || this.textContent || '')); }`)
      : ''
    if (action !== 'browser_upload') startMutation()
    if (args.capture_network) await send('Network.enable')
    const clickPoint = await call(object.objectId, `function(expected, action, trusted){
      const info = (${describe})(this);
      if (!this.isConnected || info.name !== expected.name || info.role !== expected.role ||
          (!arguments[5] && (!this.getClientRects().length || getComputedStyle(this).visibility === 'hidden')) ||
          this.matches(':disabled') || this.closest('[inert]') || this.getAttribute('aria-disabled') === 'true') throw new Error('stale');
      if (action === 'browser_click' && trusted) {
        this.scrollIntoView({ block: 'center', inline: 'center' });
        const r = this.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }
      if (action === 'browser_click') { this.click(); return null; }
      if (action === 'browser_upload') {
        if (!(this.localName === 'input' && this.type === 'file' && !this.disabled && this.getAttribute('aria-disabled') !== 'true')) throw new Error('not a file input');
        return null;
      }
      if (['browser_type', 'browser_replace'].includes(action) && !(this.isContentEditable ||
          (this.localName === 'textarea' && !this.readOnly) ||
          (this.localName === 'input' && !this.readOnly && ['text','search','email','url','tel','password','number'].includes(this.type)))) throw new Error('not editable');
      this.focus({preventScroll:true});
      if (this.getRootNode().activeElement !== this) throw new Error('focus failed');
      if (action === 'browser_replace') {
        const start = Number.isInteger(arguments?.[2]) ? arguments[2] : null;
        const end = Number.isInteger(arguments?.[3]) ? arguments[3] : null;
        if (start !== null || end !== null) {
          const editable = this.matches('[contenteditable="true"]') ? this : this.querySelector?.('[contenteditable="true"]');
          if (!editable) throw new Error('range replacement requires contenteditable editor');
          const text = editable.innerText || editable.textContent || '';
          if (start === null || end === null || start < 0 || end < start || end > text.length) throw new Error('invalid replacement range');
          const range = editable.ownerDocument.createRange();
          const walker = editable.ownerDocument.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
          let pos = 0, a = null, b = null, ao = 0, bo = 0, node;
          while ((node = walker.nextNode())) { const next = pos + node.nodeValue.length; if (!a && start <= next) { a=node; ao=start-pos; } if (!b && end <= next) { b=node; bo=end-pos; break; } pos=next; }
          if (!a || !b) throw new Error('replacement range not found');
          range.setStart(a, ao); range.setEnd(b, bo); const selection=this.ownerDocument.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        } else if (this.isContentEditable) {
          const editable = this.matches('[contenteditable="true"]') ? this : this.querySelector?.('[contenteditable="true"]');
          if (!editable) throw new Error('contenteditable editor not found');
          const range = editable.ownerDocument.createRange(); range.selectNodeContents(editable);
          const selection = editable.ownerDocument.getSelection(); selection.removeAllRanges(); selection.addRange(range);
        } else {
          this.select();
          if (this.selectionStart !== 0 || this.selectionEnd !== this.value.length) throw new Error('selection failed');
        }
      }
    }`, [{ name: item.name, role: item.role }, action, Boolean(args.trusted_input), args.start, args.end, Boolean(chooser)])
    if (action === 'browser_click' && args.trusted_input) {
      // CDP content quads use page viewport coordinates, whereas DOM rectangles
      // in a child world use its local viewport. Never feed those local values
      // into the top-level Input dispatcher.
      let point = clickPoint && Number.isFinite(clickPoint.x) && Number.isFinite(clickPoint.y) ? clickPoint : null
      if (frameId !== frameTree.frame.id) {
        const geometry = await send('DOM.getContentQuads', { backendNodeId: item.backendNodeId })
        const quad = geometry.quads?.find(quad => quad.length === 8 && quad.every(Number.isFinite))
        if (!quad) throw new Error('Frame click geometry unavailable')
        point = { x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4 }
      }
      if (!point) throw new Error('click target geometry unavailable')
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y })
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', buttons: 1, clickCount: 1 })
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', buttons: 0, clickCount: 1 })
      // Some framework controls (notably dynamically mounted editors) attach
      // their submit handler through a delegated DOM listener that does not
      // react to CDP mouse input after a rerender. Keep this fallback explicit
      // and opt-in so ordinary trusted clicks retain physical semantics.
      if (args.dom_fallback) await call(object.objectId, 'function(){ this.click(); }')
    }
    if (action === 'browser_upload') {
      if (chooser) fileChoosers.delete(args.filechooser_id)
      startMutation()
      await send('DOM.setFileInputFiles', { files: uploadFiles, backendNodeId: item.backendNodeId })
      const expectedNames = uploadFiles.map(file => path.basename(file))
      const verified = await call(object.objectId, `function(expected){
        const actual = Array.from(this.files || []).map(file => file.name);
        return actual.length === expected.length && actual.every((name, index) => name === expected[index]);
      }`, [expectedNames])
      if (!verified) return { tab_id: args.tab_id, ok: false, outcome: 'unknown', error_code: 'upload_verification_failed', needs_observation: true,
        message: 'File selection was dispatched but the browser file input could not be verified; observe the same target before proceeding' }
    }
    if (['browser_type', 'browser_replace'].includes(action)) await send('Input.insertText', { text: args.text })
    if (action === 'browser_type') {
      await call(object.objectId, `function(){
        if (!this.isContentEditable && !this.querySelector?.('[contenteditable="true"]'))
          this.dispatchEvent(new Event('input', { bubbles: true }));
        if (!this.isContentEditable && !this.querySelector?.('[contenteditable="true"]'))
          this.dispatchEvent(new Event('change', { bubbles: true }));
      }`)
      const verified = await call(object.objectId, `function(expected, before){
        const e=this.matches('[contenteditable="true"]') ? this : this.querySelector?.('[contenteditable="true"]');
        const value = this.value != null ? this.value : '';
        const text = e ? (e.innerText || e.textContent || '') : (this.isContentEditable || !(this.localName === 'input' || this.localName === 'textarea')
          ? (this.innerText || this.textContent || '') : value);
        return text === expected || text === before + expected || text.endsWith(expected);
      }`, [args.text, beforeText])
      if (!verified) return { tab_id: args.tab_id, ok: false, outcome: 'unknown', error_code: 'type_verification_failed', needs_observation: true,
        message: 'Text input was dispatched but the editable value did not contain the requested text; observe the field before proceeding' }
    }
      if (action === 'browser_replace') {
      // Verification must cover every editable branch: <input>/<textarea> value,
      // contenteditable textContent, and custom widgets that only mirror the
      // text through a child. Controlled (React) inputs get an input event so
      // the framework commits before we read back.
      await call(object.objectId, `function(){
        if (!this.isContentEditable && !this.querySelector?.('[contenteditable="true"]')) {
          this.dispatchEvent(new Event('input', { bubbles: true }));
          this.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }`)
      const expectedReplacement = Number.isInteger(args.start) && Number.isInteger(args.end)
        ? `${String(beforeText).slice(0, args.start)}${args.text}${String(beforeText).slice(args.end)}` : args.text
      const verified = await call(object.objectId, `function(expected){
        const e=this.matches('[contenteditable="true"]') ? this : this.querySelector?.('[contenteditable="true"]');
        const value = this.value != null ? this.value : '';
        const text = e ? (e.innerText || e.textContent || '') : (this.isContentEditable || !(this.localName === 'input' || this.localName === 'textarea')
          ? (this.innerText || this.textContent || '') : value);
        const text2 = ((e ? (e.innerText || e.textContent || '') : (this.innerText || '') )).replace(/\\u00a0/g, ' ');
        return value === expected || text === expected || text2 === expected;
      }`, [expectedReplacement])
      if (!verified) {
        // The text was inserted, but the resulting value could not be confirmed.
        // Never report this as success: flag it for post-mutation observation so
        // the caller must browser_state before trusting the field content.
        return {
          tab_id: args.tab_id,
          ok: false,
          outcome: 'unknown',
          error_code: 'replacement_verification_failed',
          needs_observation: true,
          message: 'Replacement text was inserted but the resulting field value could not be verified (controlled input or editor); run browser_state and observe the field before proceeding',
        }
      }
    }
    if (action === 'browser_key') {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key })
    }
    const screenshot = await captureBoundScreenshot()
    // A submit handler may schedule its request after a render commit. Let a
    // caller extend this bounded evidence window instead of treating a late
    // response as a reason to restart the whole browser workflow.
    if (args.capture_network) await abortableDelay(Number(args.capture_network_wait_ms) || 1500, combined)
    const rawNetwork = args.capture_network ? cdp.eventsSince(eventMark, { sessionId }).filter(e => ['Network.responseReceived','Network.loadingFailed'].includes(e.method)) : []
    const network = args.capture_network ? await Promise.all(rawNetwork.map(async e => {
      if (e.method === 'Network.loadingFailed') return { method: e.method, error: e.params.errorText, url: (() => { try { const u=new URL(e.params.url); return u.origin+u.pathname } catch { return 'unknown' } })() }
      const out = { method: e.method, url: (() => { try { const u=new URL(e.params.response.url); return u.origin+u.pathname } catch { return 'unknown' } })(), status: e.params.response.status, mime_type: e.params.response.mimeType }
      if (out.url.endsWith('/x/v2/reply/add')) { try { const b=await send('Network.getResponseBody',{requestId:e.params.requestId}); const j=JSON.parse(b.body); out.business_code=j.code; out.business_message=typeof j.message==='string'?j.message.slice(0,160):undefined; if(j.data&&typeof j.data==='object') out.business_data_keys=Object.keys(j.data).slice(0,20); if(j.data?.rpid!==undefined) out.comment_id=String(j.data.rpid) } catch {} }
      return out
    })) : undefined
    return { tab_id: args.tab_id, ok: true, ...(action === 'browser_upload' ? { outcome: 'completed', uploaded_count: uploadFiles.length } : {}), ...(args.trusted_input && action === 'browser_click' ? { click_point: clickPoint } : {}), ...(network ? { network_events: network } : {}), ...(screenshot ? { screenshot } : { screenshot_error: 'post-action page capture unavailable' }) }
  } catch (error) {
    if (mutationStarted) {
      error.outcome = 'unknown'
      if (args.tab_id) {
        for (const [token, item] of tokens) if (item.url === url && item.tab === args.tab_id) tokens.delete(token)
        clearRefStore(url, args.tab_id)
      }
    }
    throw error
  } finally {
    // Cancellation must not suppress the matching release of input already
    // submitted. This only releases this call's own CDP keys/buttons.
    for (const release of pendingReleases.values()) {
      try { await cdp?.send(release.method, release.params, inputSessionId, { signal:AbortSignal.timeout(2000), timeoutMs:2000, fatalOnTimeout:false }) }
      catch { /* Mutation remains unknown; never replay its down/click/text. */ }
    }
    cdp?.close()
    locks.delete(url)
  }
}

export async function releaseBrowserSession(controlSessionId) {
  const errors = []
  for (const [key, claim] of [...tabClaims]) if (claim.controlSessionId === controlSessionId) {
    try {
      const deadline = AbortSignal.timeout(5000)
      while (locks.has(claim.url)) await abortableDelay(10, deadline)
      await browserAction('browser_finalize', { browser_endpoint:claim.url, tab_id:claim.tab, claim_id:claim.id, control_session_id:controlSessionId }, deadline)
    }
    catch (error) { errors.push(error) }
  }
  // Chooser interception can also be armed without a claim. Release only the
  // owned tab attachment, keeping the browser and other tab sessions alive.
  for (const [key, owner] of [...chooserArms]) if (owner === controlSessionId) {
    const [url, tab] = key.split('\u0000')
    const slot = browserConnections.get(url)
    const sessionId = slot?.pageSessions.get(tab)
    try {
      if (sessionId) await slot.raw.send('Page.setInterceptFileChooserDialog', { enabled:false }, sessionId, { signal:AbortSignal.timeout(2000), timeoutMs:2000, fatalOnTimeout:false })
      slot?.chooserSessions.delete(sessionId)
      chooserArms.delete(key)
      for (const [id, item] of fileChoosers) if (item.controlSessionId === controlSessionId) fileChoosers.delete(id)
    } catch (error) { errors.push(error) }
  }
  for (const map of [tokens, refStores, screenshotTokens]) for (const [id, item] of map) if (item.controlSessionId === controlSessionId) map.delete(id)
  if (errors.length) throw new AggregateError(errors, 'Browser session cleanup failed')
}
