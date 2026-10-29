import {spawnSync} from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const nativeHost=path.join(path.dirname(fileURLToPath(import.meta.url)),'task-desktop','win-pilot-task-desktop.exe')

const REMOTE_NAMES = Object.freeze({
  0: 'console',
  1: 'shadow',
  2: 'rdp',
  3: 'remote-assistance',
  4: 'console-shadow',
})

/**
 * Read-only inspection of the interactive sessions a remote-control product
 * could pick. Never creates a session, never starts a window.
 *
 * Windows exposes no API that says "do not attach to the child session", and
 * GameViewerServer 4.42.1.2835 does not call WTSGetChildSessionId, so it sees our
 * child session as an ordinary logged-on desktop. This probe reports the facts
 * WTS already publishes so the caller can warn or fall back.
 */
export function getSessionState({hostPath = nativeHost, timeoutMs = 8000} = {}) {
  if(process.platform !== 'win32') return {ok:false, error_code:'task_desktop_platform_unsupported', message:'Session inspection requires Windows.'}
  if(!fs.existsSync(hostPath)) return {ok:false, error_code:'task_desktop_host_missing', message:'Native host is not installed.'}
  try {
    const result = spawnProcessSync(hostPath, ['--session-state'], {timeout:timeoutMs, windowsHide:true, encoding:'utf8'})
    if(result.error) return {ok:false, error_code:'task_desktop_probe_failed', message:result.error.message}
    const text = String(result.stdout ?? '').trim()
    if(!text) return {ok:false, error_code:'task_desktop_probe_failed', message:'Session inspection returned no data.'}
    const parsed = JSON.parse(text)
    if(parsed?.ok !== true) return {ok:false, error_code:'task_desktop_probe_failed', message:parsed?.error ?? 'Session inspection failed.'}
    const sessions = Array.isArray(parsed.sessions) ? parsed.sessions.map(row => ({
      session_id: row.session_id,
      user: row.user,
      state: row.state,
      child_session: row.child_session === true,
      client_protocol_type: row.client_protocol_type,
      remote: row.client_protocol_type !== 0 && row.client_protocol_type !== null,
    })) : []
    return {
      ok:true,
      remote_active: parsed.remote_active === true,
      console_active: parsed.console_active === true,
      child_session_present: parsed.child_session_present === true,
      child_session_id: parsed.child_session_id ?? null,
      child_sessions_enabled: parsed.child_sessions_enabled === true,
      sessions,
    }
  } catch(error) {
    return {ok:false, error_code:'task_desktop_probe_failed', message:error.message}
  }
}

/**
 * Decide whether opening a task desktop is safe right now.
 *
 * Two independent hazards, both observed on this machine:
 *  1. A remote-control product is already attached. UU moves its streamer into a
 *     new child session as soon as one appears, so the user's phone silently
 *     follows the AI desktop.
 *  2. A task desktop is already open and the user then starts remote control.
 *     The same hijack happens, only later.
 *
 * `allow` is the only verdict that permits opening. `warn` permits it when the
 * caller asked to proceed anyway.
 */
export function assessRemoteConflict(sessionState, {hasOwnedSession = false} = {}) {
  if(!sessionState?.ok) {
    return {allow:false, level:'unknown', reason:'probe_failed', message:'无法读取 Windows 会话状态，已拒绝创建独立桌面。', state:sessionState}
  }
  // The child session is itself loopback RDP and is active by definition, so its
  // existence is NOT evidence of an external viewer; treating it as one blocks
  // every healthy run. What is evidence is a remote-control streamer running
  // inside it, which is how UU serves the session once a phone attaches.
  const streamers = sessionState.child_session_streamers ?? []
  if(streamers.length > 0) {
    const names=[...new Set(streamers.map(row => row.name).filter(Boolean))]
    return {
      allow:false, level:'blocked', reason:'owned_session_exposed',
      message:`远程控制已接入独立桌面（会话 ${sessionState.child_session_id}，${names.join(', ') || 'streamer'}）。你的远端看到的是 AI 的桌面。请结束独立桌面，或在远程期间改用当前桌面模式。`,
      child_session_id: sessionState.child_session_id,
      streamers,
    }
  }
  // Our own child session is also excluded here for the same reason.
  const remote = sessionState.sessions.filter(row => row.remote && row.state === 0 && !row.child_session)
  if(remote.length > 0) {
    const names = [...new Set(remote.map(row => REMOTE_NAMES[row.client_protocol_type] ?? ('protocol-' + row.client_protocol_type)))]
    return {
      allow:false, level:'blocked', reason:'remote_in_use',
      message:`检测到远程控制正在进行（${names.join(', ')}）。此时创建独立桌面，远程画面会跟随到独立桌面，而不是你的主桌面。`,
      remote_sessions: remote,
    }
  }
  return {allow:true, level:'ok', reason:'no_conflict', message:'', state:sessionState}
}

const spawnProcessSync = spawnSync
