import { browserAction, releaseBrowserSession } from './browser-session.js'

export const browserCapabilities = Object.freeze({
  same_origin_frames: true,
  cross_origin_frames: false,
  oopif: false,
  open_shadow_roots: true,
  filechooser: 'explicit_arm_required',
  tab_claim: true,
  tab_finalize: true,
  browser_connection: 'explicit_loopback_cdp',
  user_browser_extension: false,
})

export function createBrowserProvider({
  name = 'cdp-session',
  execute = browserAction,
  capabilities = execute === browserAction ? browserCapabilities : {},
  closeSession = execute === browserAction ? releaseBrowserSession : async () => {},
} = {}) {
  if (typeof execute !== 'function') throw new TypeError('browser provider execute must be a function')
  return Object.freeze({
    name,
    capabilities: Object.freeze({ ...capabilities }),
    closeSession,
    execute(action, args = {}, signal) {
      return execute(action, args, signal)
    },
  })
}

export const defaultBrowserProvider = createBrowserProvider()
