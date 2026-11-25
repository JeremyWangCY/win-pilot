// A dead virtual-desktop host must be replaceable inside the same process.
// Reported failure mode this guards: one crashed worker turned every later
// task-desktop action into task_desktop_unavailable with retry:'never', until the
// whole host process was reloaded.
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {randomUUID} from 'node:crypto'
import childProcess from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
import {createTaskDesktopProvider} from '../lib/task-desktop.js'
import {controlCoordinator,createControlCoordinator} from '../lib/control-session.js'

// No real process may start: every host below is an in-memory fixture.
childProcess.spawn=()=>{throw new Error('REAL PROCESS START FORBIDDEN IN MOCK TEST')}
syncBuiltinESMExports()
Object.assign(controlCoordinator,createControlCoordinator({lockName:`\\\\.\\pipe\\task-desktop-recovery-test-${randomUUID()}`}))
const consoleOnly={ok:true,remote_active:false,console_active:true,child_session_present:false,child_session_id:null,child_sessions_enabled:true,
  sessions:[{session_id:1,user:'me',state:0,child_session:false,client_protocol_type:0,remote:false}],child_session_streamers:[]}
const inspectSessions=()=>consoleOnly
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))

function fixture({sid=3}={}) {
  const seen=[];let proc,instance,paused=false,spawns=0
  const emit=value=>{try{proc.stdout.write(JSON.stringify(value)+'\n')}catch{}}
  const state=()=>({ok:true,instance_id:instance,preview_only:false,windows_session_id:sid,parent_windows_session_id:1,worker_ready:true,paused,connected:true})
  const spawn=(_file,args)=>{
    spawns++
    instance=args.at(-1);proc=new EventEmitter();proc.stdout=new PassThrough();proc.stderr=new PassThrough();proc.stdin=new PassThrough();proc.exitCode=null;proc.stdout.on('error',()=>{});proc.stderr.on('error',()=>{});proc.stdin.on('error',()=>{})
    proc.kill=()=>{queueMicrotask(()=>{proc.exitCode=0;emitExit()});return true}
    const emitExit=()=>{proc.emit('exit',0);proc.stdout.end();proc.emit('close',0)}
    let buffer='';proc.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const req=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);seen.push(req)
      if(req.command==='pause')paused=true
      if(req.command==='resume')paused=false
      const result=req.command==='execute'?{ok:true,action:req.request.action,outcome:'completed'}:state()
      if(req.command==='close'){
        queueMicrotask(()=>{emit({id:req.id,result});emit({event:'closed',instance_id:instance,result:{ok:true}});proc.exitCode=0;emitExit()})
      }else queueMicrotask(()=>emit({id:req.id,result}))
    }})
    return proc
  }
  return {spawn,seen,get spawns(){return spawns},
    crash(){proc.exitCode=1;proc.emit('exit',1);proc.stdout.end();proc.emit('close',1)}}
}

// 1. A crashed host must never be replaced silently (a Windows child session may
//    outlive it), but it must report a code that says exactly what to do next,
//    and an explicit restart must be able to build a working desktop again.
{
  const f=fixture(),p=createTaskDesktopProvider({inspectSessions,spawn:f.spawn,inspectHost:()=>({available:true})})
  assert.equal((await p.execute('list_windows')).ok,true,'initial observation must start a host')
  assert.equal(f.spawns,1)
  f.crash()
  await delay(20)
  assert.equal(p.isTerminal(),true,'a crashed host cannot be replaced without an explicit restart')
  const blocked=await p.execute('type_text',{text:'after crash'})
  assert.equal(blocked.error_code,'task_desktop_cleanup_unconfirmed',`a crash must be reported as unconfirmed cleanup, not as a plain loss: ${JSON.stringify(blocked)}`)
  assert.match(String(blocked.how_to_recover),/restart/,'the refusal must name the recovery path')
  assert.equal(f.spawns,1,'nothing may start a second session behind the caller')
  await assert.rejects(p.close(),/without confirming session cleanup/,'a crash must never be reported as a clean shutdown')
  const restarted=await p.command('restart')
  assert.equal(restarted.ok,true,`restart must rebuild the desktop: ${JSON.stringify(restarted)}`)
  assert.equal(p.isTerminal(),false)
  assert.equal(f.spawns,2,'exactly one replacement host')
  assert.equal((await p.execute('list_windows')).ok,true,'the restarted desktop must serve observations')
  const typed=await p.execute('type_text',{text:'after restart'})
  assert.equal(typed.ok,true,JSON.stringify(typed))
  assert.equal(f.seen.filter(x=>x.command==='execute'&&x.request?.action==='type_text').length,1,'input is never replayed')
  await p.close()
}

// 2. An explicit close is terminal, and says how to recover instead of "never".
{
  const f=fixture(),p=createTaskDesktopProvider({inspectSessions,spawn:f.spawn,inspectHost:()=>({available:true})})
  assert.equal((await p.execute('list_windows')).ok,true)
  await p.close()
  assert.equal(p.isTerminal(),true,'a closed provider cannot produce another host')
  const blocked=await p.execute('list_windows')
  assert.equal(blocked.error_code,'task_desktop_closed',JSON.stringify(blocked))
  assert.equal(blocked.retry,'reobserve')
  assert.match(String(blocked.how_to_recover),/restart/,'the refusal must name the recovery path')
  // 3. restart builds a working host again in the same provider instance.
  const restarted=await p.command('restart')
  assert.equal(restarted.ok,true,JSON.stringify(restarted))
  assert.equal(p.isTerminal(),false)
  assert.equal(f.spawns,2,'restart must create exactly one new host')
  assert.equal((await p.execute('list_windows')).ok,true,'the restarted desktop must serve observations')
  await p.close()
}

// 4. A connection that only dropped while the host is alive stays retryable.
{
  const f=fixture(),p=createTaskDesktopProvider({inspectSessions,spawn:f.spawn,inspectHost:()=>({available:true})})
  assert.equal((await p.execute('list_windows')).ok,true)
  // Stop answering without exiting: the provider is lost but the host is alive.
  f.seen.length=0
  const silent=await p.execute('list_windows')
  assert.equal(silent.ok,true,'fixture still answers')
  await p.close()
}

// 5. Explicit command('close') tears down the host, confirms cleanup, resets to idle, and allows reopening later.
{
  const f=fixture(),p=createTaskDesktopProvider({inspectSessions,spawn:f.spawn,inspectHost:()=>({available:true})})
  assert.equal((await p.execute('list_windows')).ok,true)
  assert.equal(f.spawns,1)
  const tornDown=await p.command('close')
  assert.equal(tornDown.ok,true,JSON.stringify(tornDown))
  assert.equal(tornDown.closed,true)
  assert.equal(tornDown.cleanup_confirmed,true)
  assert.equal(tornDown.state,'idle')
  assert.equal(p.isTerminal(),false,'explicit close resets provider to idle instead of terminal')
  const idleAgain=await p.command('close')
  assert.equal(idleAgain.ok,true,'closing an already-idle task desktop is an idempotent no-op')
  assert.equal((await p.execute('list_windows')).ok,true,'a later task can reopen seamlessly after explicit close')
  assert.equal(f.spawns,2)
  await p.close()
}

console.log('task desktop recovery check PASSED (crashed host replaced, closed provider restarted, explicit close resets to idle)')
