import assert from 'node:assert/strict'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createControlCoordinator, controlCoordinator, isControlMutation } from '../lib/control-session.js'
import { createWinPilotRuntime } from '../lib/runtime.js'
import { createBrowserProvider } from '../lib/browser-provider.js'
import { applyConfigSnapshot } from '../lib/settings.js'

applyConfigSnapshot({ overlay:false, statusPill:false })
const lockName = `\\\\.\\pipe\\win-pilot-control-test-${randomUUID()}`
// Exercise real OS coordination in a unique namespace, without contending with
// the user's running Win-Pilot instance or another independent test process.
Object.assign(controlCoordinator, createControlCoordinator({lockName:lockName+'-runtime'}))
const c = createControlCoordinator({lockName}), a=c.newSession(), b=c.newSession()
const other = createControlCoordinator({lockName}), outsider=other.newSession()
let finish, started
const ready = new Promise(resolve => {started=resolve})
const pending = c.run(a,{action:'click'},undefined,async () => {started();return await new Promise(resolve=>{finish=()=>resolve({ok:true})})})
await ready
assert.equal((await other.run(outsider,{action:'click'},undefined,async()=>({ok:true}))).error_code,'controller_busy','atomic OS bind excludes another coordinator')
finish(); await pending
assert.equal((await other.run(outsider,{action:'click'},undefined,async()=>({ok:true}))).ok,true,'completion releases lock')

await c.run(a,{action:'mouse_down',button:'left'},undefined,async()=>({ok:true}))
assert.equal((await c.run(b,{action:'click'},undefined,async()=>({ok:true}))).error_code,'controller_busy','held input stays owned between requests')
assert.equal((await c.run(b,{action:'browser_tabs'},undefined,async()=>({ok:true}))).ok,true)
await c.run(a,{action:'mouse_up',button:'left'},undefined,async()=>({ok:true}))
assert.equal((await c.run(b,{action:'click'},undefined,async()=>({ok:true}))).ok,true)

for (const [alias, button] of [['l','left'],['r','right'],['m','middle'],['wheel','middle']]) {
  await c.run(a,{action:'mouse_down',mouse_button:alias},undefined,async()=>({ok:true}))
  assert.deepEqual(c.status(a).held_buttons,[button],'held buttons use the same canonical identity as dispatched input')
  await c.run(a,{action:'mouse_up',button},undefined,async()=>({ok:true}))
  assert.deepEqual(c.status(a).held_buttons,[],'canonical mouse up releases a hold created with an alias')
  assert.equal((await c.run(b,{action:'click'},undefined,async()=>({ok:true}))).ok,true,'released alias must not leave a stale control lease')
  await c.run(a,{action:'mouse_down',button},undefined,async()=>({ok:false,outcome:'unknown'}))
  assert.equal((await c.run(b,{action:'click'},undefined,async()=>({ok:true}))).error_code,'controller_busy','uncertain mouse down keeps its canonical hold owned')
  await c.run(a,{action:'mouse_up',mouse_button:alias},undefined,async()=>({ok:true}))
  assert.deepEqual(c.status(a).held_buttons,[],'aliased mouse up also releases a canonical uncertain hold')
}

let dispatched=0, activeReady
const activeStarted=new Promise(resolve=>{activeReady=resolve})
const live=c.run(a,{action:'browser_navigate'},undefined,signal=>new Promise((resolve,reject)=>{
  dispatched++;activeReady();signal.addEventListener('abort',()=>reject(new Error('possibly sent')),{once:true})
}))
await activeStarted
const queued=c.run(a,{action:'browser_navigate'},undefined,async()=>{dispatched++;return{ok:true}})
c.stop(a)
assert.equal((await live).outcome,'unknown','cancellation after possible dispatch cannot claim not sent')
assert.equal((await queued).error_code,'control_stopped')
assert.equal(dispatched,1)
await c.cleaned(a)
assert.equal(c.resume(a),true)
assert.equal((await c.run(a,{action:'click'},undefined,async()=>({ok:true}))).ok,true)

// An abandoned queued call from the same session must not release/clear the active call.
let blockedFinish, blockedReady
const blockedStarted=new Promise(resolve=>{blockedReady=resolve})
const held=c.run(a,{action:'click'},undefined,async()=>{blockedReady();return await new Promise(resolve=>{blockedFinish=()=>resolve({ok:true})})})
await blockedStarted
const abort=new AbortController()
const abandoned=c.run(a,{action:'click'},abort.signal,async()=>{throw new Error('must not dispatch')})
abort.abort();assert.equal((await abandoned).outcome,'not_executed')
assert.equal((await other.run(outsider,{action:'click'},undefined,async()=>({ok:true}))).error_code,'controller_busy')
blockedFinish();await held

// A crashed process releases the pipe without PID-file reclamation or a lease TTL.
const moduleUrl=new URL('../lib/control-session.js',import.meta.url).href
const child=spawn(process.execPath,['--input-type=module','-e',`import{createControlCoordinator}from${JSON.stringify(moduleUrl)};const c=createControlCoordinator({lockName:${JSON.stringify(lockName)}});const id=c.newSession();await c.run(id,{action:'click'},undefined,()=>new Promise(()=>{setInterval(()=>{},1000);process.send('ready')}));`],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']})
try {
  await once(child,'message')
  assert.equal((await c.run(a,{action:'click'},undefined,async()=>({ok:true}))).error_code,'controller_busy')
  child.kill();await once(child,'exit')
  assert.equal((await c.run(a,{action:'click'},undefined,async()=>({ok:true}))).ok,true,'OS releases crash-held control')
} finally { if(child.exitCode===null && child.signalCode===null)child.kill() }

const calls=[]
let notifyStarted
const notified=new Promise(resolve=>{notifyStarted=resolve})
const provider=createBrowserProvider({execute:async(action,args,signal)=>{
  calls.push({action,session:args.control_session_id})
  if(args.pause)return await new Promise((resolve,reject)=>{notifyStarted();signal.addEventListener('abort',()=>reject(Object.assign(new Error('sent then stopped'),{outcome:'unknown'})),{once:true})})
  return{ok:true,action,outcome:'completed',tabs:[]}
}})
const runtime=createWinPilotRuntime({browserProvider:provider}), independent=createWinPilotRuntime({browserProvider:provider})
try {
  const inFlight=runtime.act('browser_navigate',{pause:true})
  await notified
  const waiting=runtime.act('browser_navigate')
  const stopped=runtime.act('stop')
  assert.equal((await inFlight).outcome,'unknown')
  assert.equal((await waiting).error_code,'control_stopped')
  assert.equal((await stopped).ok,true)
  for(const action of ['browser_open','browser_navigate','browser_request','browser_click','browser_upload','browser_reload','browser_scroll','browser_key','launch_app','paste','left_click','left_click_drag','key','perform_action']) {
    assert.equal(isControlMutation({action}),true)
    const before=calls.length
    assert.equal((await runtime.act(action)).error_code,'control_stopped',action)
    assert.equal(calls.length,before,'no provider dispatch after stop')
  }
  assert.equal((await runtime.act('browser_tabs')).ok,true,'read stays available')
  assert.equal((await independent.act('browser_navigate')).ok,true,'stop is isolated to caller session')
  assert.notEqual(calls.at(-1).session,calls[0].session)
  const independentSession=calls.at(-1).session
  await independent.run({actions:[{action:'browser_navigate',control_session_id:calls[0].session}]})
  assert.equal(calls.at(-1).session,independentSession,'batch item cannot override the trusted host session')
  const partial=await independent.run({actions:[{action:'browser_navigate'},null]})
  assert.equal(partial.outcome,'unknown','invalid later step must not label an already mutated batch unexecuted')
  assert.equal((await runtime.act('resume')).ok,true)
  assert.equal((await runtime.act('browser_navigate')).ok,true)
  const unsafeBatch=await runtime.run({actions:[{action:'browser_navigate'},{action:'stop'}]})
  assert.equal(unsafeBatch.outcome,'not_executed','control actions cannot deadlock inside a batch')
  await runtime.close()
  assert.equal((await independent.act('browser_navigate')).ok,true,'closing one runtime does not stop another')
} finally {await runtime.close();await independent.close()}
await c.close(a);await c.close(b);await other.close(outsider)
console.log('PASS: atomic control/crash release, held-input ownership, session stop/resume, queued cancellation, provider isolation and close')
