import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createLocalControl, requestLocalControl } from './local-control.js'

export const hostContextDirectory = () => path.join(os.tmpdir(), 'win-pilot', 'hosts')
const editable = ['overlay', 'statusPill', 'browserHeadlessDefault', 'desktopEnvironment']
function ancestorPids(parentPid) {
  if (!Number.isSafeInteger(parentPid) || parentPid <= 0) return []
  if (process.platform === 'win32') {
    const script = `Add-Type -AssemblyName System.Management; $cursorId=${parentPid}; for($i=0;$i -lt 24 -and $cursorId -gt 0;$i++){ $cursorId; try { $entry=New-Object System.Management.ManagementObject("Win32_Process.Handle='$cursorId'"); $nextId=[int]$entry.ParentProcessId; $entry.Dispose(); if($nextId -eq $cursorId){break}; $cursorId=$nextId } catch { break } }; exit 0`
    try {
      return execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'),
        ['-NoProfile','-Command',script], {windowsHide:true,encoding:'utf8',timeout:5000}).trim().split(/\s+/).map(Number).filter(Number.isSafeInteger)
    } catch (error) { if (process.env.WIN_PILOT_DEBUG === '1') console.error(error.message); return [parentPid] }
  }
  const result = []
  for (let cursor = parentPid; cursor > 0 && result.length < 24 && !result.includes(cursor);) {
    result.push(cursor)
    try { cursor = Number(fs.readFileSync(`/proc/${cursor}/status`,'utf8').match(/^PPid:\s+(\d+)/m)?.[1] || 0) } catch { break }
  }
  return result
}
export function validateHostSettings(value) {
  if (!value || !['current', 'task'].includes(value.desktopEnvironment)
    || editable.slice(0, 3).some(key => typeof value[key] !== 'boolean')) throw new Error('The DSH Win-Pilot settings are unavailable or invalid')
  return Object.fromEntries(editable.map(key => [key, value[key]]))
}

export function createHostContext(getSettings, { directory = hostContextDirectory() } = {}) {
  const clients = new Map()
  let draining = false
  const control = createLocalControl(request => {
    if (request.command === 'client_closed') { clients.delete(request.client_id); return {ok:true} }
    if (request.command !== 'settings') throw new Error('Unsupported host-context request')
    if (draining) throw new Error('The DSH Win-Pilot runtime is reloading; reconnect after it finishes')
    if (request.client && Number.isSafeInteger(request.client.pid) && request.client.pid > 0
      && typeof request.client.endpoint === 'string' && typeof request.client.token === 'string') clients.set(request.client.id, request.client)
    return { ok: true, settings: validateHostSettings(getSettings()) }
  })
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const file = path.join(directory, `${control.id}.json`)
  const ready = control.ready.then(() => {
    fs.writeFileSync(file, JSON.stringify({ pid: process.pid, endpoint: control.endpoint, token: control.token,
      settings: validateHostSettings(getSettings()) }), { mode: 0o600 })
  })
  return {
    ready, file,
    environment() { return { DSH_WIN_PILOT_CONTEXT: file, DSH_WIN_PILOT_SETTINGS: JSON.stringify(validateHostSettings(getSettings())) } },
    async prepareReload() {
      draining = true
      await Promise.all([...clients.values()].map(async client => {
        try { process.kill(client.pid, 0) } catch { clients.delete(client.id); return }
        const result = await requestLocalControl(client, {command:'drain'}, {timeoutMs:240000})
        if (!result?.ok || !result.cleanup_confirmed) throw new Error('A DSH child runtime did not confirm control cleanup')
        clients.delete(client.id)
      }))
    },
    cancelReload() { draining = false },
    async close() { await ready.catch(() => {}); fs.rmSync(file, { force: true }); await control.close() },
  }
}

export function resolveHostContext({ env = process.env, parentPid = process.ppid, directory = hostContextDirectory() } = {}) {
  let file = env.DSH_WIN_PILOT_CONTEXT
  if (!file) {
    let matches = [], descriptors = []
    try {
      descriptors = fs.readdirSync(directory).filter(name => name.endsWith('.json')).map(name => path.join(directory, name))
        .flatMap(candidate => { try { return [{file:candidate,pid:JSON.parse(fs.readFileSync(candidate, 'utf8')).pid}] } catch { return [] } })
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    // npx and shell launchers insert processes between an MCP server and DSH.
    // Bind only to the nearest actual ancestor, never another running host.
    const parents = descriptors.some(value => value.pid === parentPid) ? [parentPid]
      : descriptors.length ? ancestorPids(parentPid) : []
    for (const pid of parents) {
      matches = descriptors.filter(value => value.pid === pid).map(value => value.file)
      if (matches.length) break
    }
    if (matches.length > 1) throw new Error('Multiple DSH Win-Pilot contexts match this process; an explicit context is required')
    file = matches[0]
  }
  if (!file) {
    if (env.DSH_SHELL === '1') throw new Error('DSH Win-Pilot settings are not connected; reload the Win-Pilot plugin before using CLI or MCP')
    return null
  }
  // Resolve only the context selected by the host. A missing/broken context never
  // chooses the current desktop or borrows settings from another host.
  const descriptor = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!Number.isSafeInteger(descriptor.pid) || descriptor.pid <= 0 || typeof descriptor.endpoint !== 'string' || typeof descriptor.token !== 'string') throw new Error('Invalid DSH Win-Pilot context')
  process.kill(descriptor.pid, 0)
  let client
  return {
    initial: validateHostSettings(env.DSH_WIN_PILOT_SETTINGS ? JSON.parse(env.DSH_WIN_PILOT_SETTINGS) : descriptor.settings),
    attach(drain) {
      client = createLocalControl(async request => {
        if (request.command !== 'drain') throw new Error('Unsupported runtime lifecycle request')
        await drain()
        return {ok:true,cleanup_confirmed:true}
      })
    },
    async read() {
      await client?.ready
      const result = await requestLocalControl(descriptor, { command: 'settings',
        ...(client ? {client:{id:client.id,pid:process.pid,endpoint:client.endpoint,token:client.token}} : {}) })
      if (result?.ok !== true) throw new Error(result?.message || 'DSH Win-Pilot settings could not be read')
      return validateHostSettings(result.settings)
    },
    async close() {
      if (!client) return
      await requestLocalControl(descriptor, {command:'client_closed',client_id:client.id}).catch(() => {})
      await client.close()
    },
  }
}
