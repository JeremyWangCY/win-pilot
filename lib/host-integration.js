import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { createHostContext } from './host-context.js'
import { getSettings } from './settings.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version
const buildOf = directory => createHash('sha256').update(fs.readFileSync(path.join(directory, 'lib', 'index.js'))).digest('hex')
const runningBuild = buildOf(root)

function installedRoot(ctx) {
  try {
    const base = ctx.fiber.entry.parent.tree.ctx.baseUrl
    const candidate = fileURLToPath(new URL('node_modules/win-pilot/', base))
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate)
  } catch { /* standalone or an older host */ }
  return fs.realpathSync(root)
}

export function createVersionController({ runningVersion = version, runningBuildId = runningBuild,
  installed = () => ({ version, build:runningBuild, reloadable:false }), prepare, reload, cancel } = {}) {
  let phase = 'idle', error = null
  const status = () => {
    try {
      const next = installed()
      const needsReload = next.version !== runningVersion || next.build !== runningBuildId
      return { ok:true, running_version:runningVersion, installed_version:next.version,
        needs_reload:needsReload, can_reload:needsReload && next.reloadable === true,
        restart_required:needsReload && !next.reloadable, reload_state:phase, message:error }
    } catch (cause) { return { ok:false, running_version:runningVersion, installed_version:null,
      needs_reload:false, can_reload:false, restart_required:false, reload_state:phase, message:cause.message } }
  }
  return {
    status,
    async reload() {
      const current = status()
      if (current.ok && !current.needs_reload) return { ok:true, reload_state:'idle' }
      if (!current.ok || !current.can_reload) return { ...current, ok:false, message:'A host restart is required to load this installation.' }
      if (phase === 'waiting' || phase === 'reloading') return { ok:true, reload_state:phase }
      phase = 'waiting'; error = null
      // Return the acknowledgement before replacing the Remote service itself.
      setTimeout(async () => {
        try { await prepare?.(); phase = 'reloading'; await reload(); phase = 'idle' }
        catch (cause) { phase = 'failed'; error = cause.message; cancel?.() }
      }, 0)
      return { ok:true, reload_state:'waiting' }
    },
  }
}

async function loadProtocol() {
  const roots = [root, process.env.DSH_HOST_MODULES,
    process.env.USERPROFILE && path.join(process.env.USERPROFILE, '.dsh', 'profiles', 'desktop', 'node_modules'),
    process.env.APPDATA && path.join(process.env.APPDATA, 'com.jeremy.deepx-workbench', 'runtime', 'node_modules')].filter(Boolean)
  for (const directory of roots) {
    try {
      const require = createRequire(path.join(directory, 'noop.js'))
      return await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-protocol')).href)
    } catch { /* optional host integration */ }
  }
  return null
}

/** Connect only host-owned services; standalone installs remain independent. */
export function installHostIntegration(ctx, { prepare, closeTools, cancel } = {}) {
  if (typeof ctx.inject !== 'function') return
  let host
  const ensureHost = async () => {
    if (!host) host = createHostContext(getSettings)
    await host.ready
    return host
  }
  ctx.inject(['shellEnv'], async scoped => {
    const current = await ensureHost()
    scoped.shellEnv.register({
      name:'win-pilot',
      variables:{
        DSH_WIN_PILOT_CONTEXT:{description:'Win-Pilot settings context owned by this DSH host.'},
        DSH_WIN_PILOT_SETTINGS:{description:'The effective Win-Pilot display and desktop preferences for this execution.'},
      },
      resolve:() => current.environment(),
    })
  })
  ctx.inject(['loader'], async () => {
    await ensureHost()
    const protocol = await loadProtocol()
    if (!protocol) return
    const controller = createVersionController({
      installed() {
        const directory = installedRoot(ctx)
        return { version:JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8')).version,
          build:buildOf(directory), reloadable:directory !== fs.realpathSync(root) && Boolean(ctx.fiber?.runtime && ctx.registry?.delete) }
      },
      prepare:async () => { await Promise.all([host?.prepareReload(), prepare?.()]) },
      cancel:() => { host?.cancelReload(); cancel?.() },
      async reload() {
        const directory = installedRoot(ctx)
        const next = await import(pathToFileURL(path.join(directory, 'lib', 'index.js')).href + '?reload=' + Date.now())
        const plugin = ctx.fiber.runtime.callback
        const fibers = [...ctx.fiber.runtime.fibers].map(fiber => ({ parent:fiber.parent, config:fiber._config, entry:fiber.entry }))
        await closeTools?.()
        // This is the same registry replacement seam used by the host HMR service.
        ctx.registry.delete(plugin)
        for (const previous of fibers) {
          const fiber = previous.parent.registry.plugin(next, previous.config)
          fiber.entry = previous.entry
          if (fiber.entry) fiber.entry.fiber = fiber
          await fiber
        }
      },
    })
    const initializers = []
    class WinPilotRuntimeService extends protocol.TypertRemoteService {
      constructor() { super(ctx, 'winPilotRuntime'); for (const initialize of initializers) initialize.call(this) }
      status() { return controller.status() }
      reload() { return controller.reload() }
    }
    for (const method of ['status', 'reload']) protocol.Remote(WinPilotRuntimeService.prototype[method], {
      kind:'method', name:method, static:false, private:false, addInitializer:initialize => initializers.push(initialize),
    })
    new WinPilotRuntimeService()
  })
  if (typeof ctx.effect === 'function') ctx.effect(() => () => host?.close(), 'win-pilot.host-context')
}
