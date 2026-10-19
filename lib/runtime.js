import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineComputerTool, getDaemonPid, runAction, stopDaemon } from './index.js'
import { defaultBrowserProvider } from './browser-provider.js'
import { getTaskDesktopAvailability } from './task-desktop.js'
import { getSettings, applyConfigSnapshot } from './settings.js'
import { resolveHostContext } from './host-context.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
const systemRoot = process.env.SystemRoot || 'C:\\Windows'
const powershell = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
const helper = path.join(__dirname, 'win-pilot-helper.ps1')
const wgc = path.join(__dirname, 'wgc', 'win-pilot-wgc.exe')

function nodeSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  return major > 22 || (major === 22 && minor >= 12)
}

export function getRuntimeStatus({ browserProvider = defaultBrowserProvider, desktopEnvironment = getSettings().desktopEnvironment ?? 'current' } = {}) {
  const daemonPid = getDaemonPid()
  return {
    ok: true,
    name: 'win-pilot',
    version: pkg.version,
    platform: process.platform,
    arch: process.arch,
    node: process.versions.node,
    desktop_environment: desktopEnvironment,
    ...(desktopEnvironment === 'task' ? { task_desktop: getTaskDesktopAvailability() } : {}),
    daemon: { running: Boolean(daemonPid), pid: daemonPid || null },
    providers: {
      desktop: process.platform !== 'win32' ? 'unavailable' : desktopEnvironment === 'task' ? 'windows-child-session' : 'windows-native',
      browser: browserProvider?.name || 'cdp-session',
    },
    capabilities: { browser:browserProvider?.capabilities ?? {} },
  }
}

export async function doctor({ probe = false, signal, desktopEnvironment = getSettings().desktopEnvironment ?? 'current' } = {}) {
  const taskDesktop = desktopEnvironment === 'task' ? getTaskDesktopAvailability() : null
  const checks = [
    { name: 'windows', required: true, ok: process.platform === 'win32', detail: process.platform },
    { name: 'node', required: true, ok: nodeSupported(), detail: process.versions.node },
    { name: 'powershell', required: true, ok: fs.existsSync(powershell), detail: powershell },
    { name: 'helper', required: true, ok: fs.existsSync(helper), detail: helper },
    { name: 'wgc', required: false, ok: fs.existsSync(wgc), detail: wgc },
    ...(taskDesktop ? [
      { name: 'task_desktop_native', required: true, ok: taskDesktop.host_present && taskDesktop.required_files_present, detail: taskDesktop.missing_files.length ? taskDesktop.missing_files.join(', ') : 'Native host files present; session readiness has not been probed.' },
      { name: 'task_desktop_safety_hold', required: true, ok: !taskDesktop.safety_hold, detail: taskDesktop.message },
    ] : []),
  ]

  if (probe && desktopEnvironment === 'task') {
    checks.push({ name:'helper_round_trip', required:true, ok:false, skipped:true, detail:'Task desktop probe is not performed by doctor. No task session is started and the main desktop helper is never used as a fallback.' })
  } else if (probe) {
    const result = await runAction('list_apps', {}, signal)
    checks.push({
      name: 'helper_round_trip',
      required: true,
      ok: result?.ok === true,
      detail: result?.ok ? result.message || 'ok' : result?.message || 'failed',
    })
  }

  return {
    ok: checks.every(check => !check.required || check.ok),
    desktop_environment: desktopEnvironment,
    ...(taskDesktop ? { task_desktop: taskDesktop } : {}),
    checks,
  }
}

export function createWinPilotRuntime({ signal, browserProvider, desktopEnvironment, taskDesktopProvider, activityReporter } = {}) {
  if (desktopEnvironment !== undefined && !['current','task'].includes(desktopEnvironment)) throw new TypeError('desktopEnvironment must be current or task')
  let hostContext, hostContextError
  try { hostContext = resolveHostContext() } catch (error) { hostContextError = error }
  if (hostContext) applyConfigSnapshot(hostContext.initial)
  const environment = desktopEnvironment ?? getSettings().desktopEnvironment ?? 'current'
  const currentEnvironment = () => hostContext ? getSettings().desktopEnvironment : environment
  let closed = false
  let draining = false
  const pending = new Set()
  let computer = null
  const lifecycle = new AbortController()
  const getComputer = () => (computer ||= defineComputerTool(tool => tool, {}, {
    browserProvider, ...(hostContext ? {} : { desktopEnvironment:environment }), taskDesktopProvider, activityReporter,
  }))
  const refresh = async () => {
    if (hostContextError) throw hostContextError
    if (hostContext) applyConfigSnapshot(await hostContext.read())
  }
  const execute = async (request, options = {}) => {
    if (closed) return { ok: false, action: request?.action || '', message: 'runtime is closed' }
    if (draining && !['stop','control_status','control_release'].includes(request?.action)) return {ok:false,action:request?.action || '',
      error_code:'runtime_reloading',outcome:'not_executed',actionSent:false,message:'The DSH host is reloading; reconnect this runtime after it finishes.'}
    if (!request || typeof request !== 'object' || Array.isArray(request)) {
      return { ok: false, action: '', message: 'request must be a JSON object' }
    }
    // Cancellation and inspection of existing ownership remain available even
    // after the originating host has disconnected or begun reloading.
    if ((hostContext || hostContextError) && !['stop','control_status','control_release'].includes(request.action)) {
      try { await refresh() }
      catch (error) { return { ok:false, action:request.action, error_code:'host_settings_unavailable',
        message:error.message, outcome:'not_executed', actionSent:false, retry:'never' } }
    }
    const signals = [signal, options.signal, lifecycle.signal].filter(Boolean)
    return getComputer().execute(request, { signal: AbortSignal.any(signals) })
  }
  const executeRequest = async (request, options) => {
    const work = execute(request, options)
    pending.add(work)
    try { return await work } finally { pending.delete(work) }
  }
  hostContext?.attach(async () => {
    draining = true
    while (pending.size) await Promise.allSettled([...pending])
    closed = true
    lifecycle.abort(new Error('runtime_reloaded'))
    await computer?.close?.()
  })
  const mergeBound = (defaults, request = {}) => ({
    ...defaults,
    ...request,
    ...(defaults.window || request.window ? { window: { ...(defaults.window || {}), ...(request.window || {}) } } : {}),
    ...(defaults.browser || request.browser ? { browser: { ...(defaults.browser || {}), ...(request.browser || {}) } } : {}),
  })
  const act = (action, payload = {}, options = {}) => {
    if (!action || typeof action !== 'string') {
      return Promise.resolve({ ok: false, action: action || '', message: 'action must be a non-empty string' })
    }
    return executeRequest({ ...payload, action }, options)
  }
  const bind = (defaults = {}) => {
    if (!defaults || typeof defaults !== 'object' || Array.isArray(defaults)) throw new TypeError('bound defaults must be an object')
    const boundDefaults = mergeBound({}, defaults)
    return Object.freeze({
      run(request = {}, options = {}) {
        return executeRequest(mergeBound(boundDefaults, request), options)
      },
      act(action, payload = {}, options = {}) {
        if (!action || typeof action !== 'string') {
          return Promise.resolve({ ok: false, action: action || '', message: 'action must be a non-empty string' })
        }
        return executeRequest({ ...mergeBound(boundDefaults, payload), action }, options)
      },
      bind(more = {}) {
        return bind(mergeBound(boundDefaults, more))
      },
    })
  }
  return {
    status: () => hostContextError
      ? { ...getRuntimeStatus({browserProvider, desktopEnvironment:'current'}), ok:false, desktop_environment:'unavailable',
          error_code:'host_settings_unavailable', message:hostContextError.message,
          providers:{desktop:'unavailable', browser:browserProvider?.name || 'cdp-session'} }
      : getRuntimeStatus({ browserProvider, desktopEnvironment:currentEnvironment() }),
    inspect: async () => { await refresh(); return getRuntimeStatus({ browserProvider, desktopEnvironment:currentEnvironment() }) },
    doctor: async options => { await refresh(); return doctor({ ...options, signal: options?.signal || signal, desktopEnvironment:currentEnvironment() }) },
    run: executeRequest,
    act,
    bind,
    taskDesktop: (command, args = {}, options = {}) => getComputer().taskDesktop(command, args, options.signal || signal),
    waitForTaskDesktopClose: options => getComputer().waitForTaskDesktopClose(options?.signal || signal),
    async close() {
      closed = true
      lifecycle.abort(new Error('runtime_closed'))
      await computer?.close?.()
      await hostContext?.close()
    },
  }
}
