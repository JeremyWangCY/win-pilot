import assert from 'node:assert/strict'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { installHostIntegration } from '../lib/host-integration.js'
import { applyConfigSnapshot, resetSettingsForTest } from '../lib/settings.js'
import { resolveHostContext } from '../lib/host-context.js'

const modules = process.env.DSH_HOST_MODULES || path.join(process.env.APPDATA || '', 'com.jeremy.deepx-workbench', 'runtime', 'node_modules')
const require = createRequire(path.join(modules, 'noop.js'))
let Context, Service, ShellEnvRegistry, remoteMethods
try {
  ;({ Context, Service } = require('@deepseek-ai/cordis'))
  ;({ ShellEnvRegistry } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-shell-env')).href))
  ;({ remoteMethods } = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-typert-protocol')).href))
} catch { console.log('host integration check SKIPPED (DSH host packages unavailable)'); process.exit(0) }
const root = new Context()
const shell = root.plugin({ apply(ctx) { new ShellEnvRegistry(ctx) } })
const loader = root.plugin({ apply(ctx) { new Service(ctx, 'loader') } })
let mode = 'task'
applyConfigSnapshot({ overlay:false, statusPill:false, browserHeadlessDefault:false, desktopEnvironment:{get:() => mode} })
const owner = root.plugin({ apply(ctx) { installHostIntegration(ctx) } })
try {
  await Promise.all([shell, loader, owner])
  let environment, runtime
  for (let attempt = 0; attempt < 100; attempt++) {
    environment = root.get('shellEnv')?.collect({})
    runtime = root.get('winPilotRuntime')
    if (environment?.DSH_WIN_PILOT_CONTEXT && runtime) break
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  assert.ok(environment?.DSH_WIN_PILOT_CONTEXT, 'the real shell registry must publish the settings context')
  const source = resolveHostContext({ env:environment })
  assert.equal((await source.read()).desktopEnvironment, 'task')
  mode = 'current'
  assert.equal((await source.read()).desktopEnvironment, 'current')
  assert.ok(runtime, 'the real Cordis registry must expose the version service')
  assert.deepEqual(remoteMethods(runtime).map(value => value.method), ['status','reload'])
  assert.equal(runtime.status().ok, true)
  assert.equal(typeof runtime.status().running_version, 'string')
  console.log('host integration check PASSED (real Cordis, shell env registry, Remote metadata, live configuration)')
} finally { await owner.dispose(); await shell.dispose(); await loader.dispose(); resetSettingsForTest() }
