import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHostContext, resolveHostContext } from '../lib/host-context.js'
import { createLocalControl, requestLocalControl } from '../lib/local-control.js'

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'win-pilot-context-'))
let settings = { overlay: false, statusPill: false, browserHeadlessDefault: false, desktopEnvironment: 'task' }
const host = createHostContext(() => settings, { directory })
try {
  await host.ready
  const source = resolveHostContext({ env:host.environment(), directory })
  assert.equal((await source.read()).desktopEnvironment, 'task')
  settings = { ...settings, desktopEnvironment: 'current' }
  assert.equal((await source.read()).desktopEnvironment, 'current', 'live changes must reach an existing client')
  assert.equal(resolveHostContext({ env:{}, parentPid:-1, directory }), null, 'unrelated hosts keep their own defaults')
  assert.throws(() => resolveHostContext({ env:{ DSH_SHELL:'1' }, parentPid:-1, directory }), /not connected/)
  settings = { ...settings, desktopEnvironment: 'task' }
  const { stdout } = await promisify(execFile)(process.execPath, ['bin/win-pilot.js', 'status', '--json'], {
    env:{ ...process.env, ...host.environment(), DSH_SHELL:'1' }, windowsHide:true,
  })
  assert.equal(JSON.parse(stdout).desktop_environment, 'task', 'the actual CLI must use the DSH context')
  const implicit = resolveHostContext({ env:{}, parentPid:process.pid, directory })
  assert.equal((await implicit.read()).desktopEnvironment, 'task', 'a directly spawned MCP process can find its host')
  const descendantCode = `import {resolveHostContext} from ${JSON.stringify(pathToFileURL(path.resolve('lib/host-context.js')).href)}; const source=resolveHostContext({env:{},directory:process.argv[1]}); console.log(JSON.stringify(await source?.read()))`
  const launcherCode = `const {execFile}=require('node:child_process');execFile(process.execPath,['--input-type=module','-e',process.argv[1],process.argv[2]],(error,stdout,stderr)=>{process.stdout.write(stdout);process.stderr.write(stderr);process.exitCode=error?1:0})`
  const nested = await promisify(execFile)(process.execPath, ['-e',launcherCode,descendantCode,directory], {windowsHide:true})
  assert.equal(nested.stdout.trim().startsWith('{'), true, 'npx-style discovery returned no host: ' + nested.stderr)
  assert.equal(JSON.parse(nested.stdout).desktopEnvironment, 'task', 'an npx-style intermediate launcher must preserve host discovery')
  let release, drained = false
  const active = new Promise(resolve => { release = resolve })
  source.attach(async () => { await active; drained = true })
  await source.read()
  const preparing = host.prepareReload()
  await new Promise(resolve => setTimeout(resolve, 20))
  assert.equal(drained, false, 'a host reload must wait for a registered child action')
  await assert.rejects(source.read(), /reloading/)
  release()
  await preparing
  assert.equal(drained, true, 'child cleanup must be acknowledged before host replacement')
  host.cancelReload()
  await source.close()
  await host.close()
  await assert.rejects(source.read(), /ENOENT|ECONNREFUSED|closed/)
  assert.throws(() => resolveHostContext({ env:host.environment(), directory }), /ENOENT/)
  const endpoint = createLocalControl(() => ({ ok:true }))
  await endpoint.ready
  const denied = await requestLocalControl({ ...endpoint, token:'wrong' }, { command:'settings' })
  assert.equal(denied.ok, false)
  await endpoint.close()
  console.log('host context check PASSED (real IPC and CLI, live settings, no main-desktop fallback)')
} finally { await host.close(); fs.rmSync(directory, { recursive:true, force:true }) }
