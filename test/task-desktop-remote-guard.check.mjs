import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import childProcess from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
import {createTaskDesktopProvider} from '../lib/task-desktop.js'
import {assessRemoteConflict,getSessionState} from '../lib/remote-session-guard.js'

// No real process may start here: both the native host and the probe are injected.
const originalSpawn=childProcess.spawn
childProcess.spawn=()=>{throw new Error('REAL PROCESS START FORBIDDEN IN MOCK TEST')}
syncBuiltinESMExports()

// A minimal stdio fixture that answers exactly like the native host.
function fixture(sid=3){
  let proc,instance
  const seen=[]
  const emit=v=>proc.stdout.write(JSON.stringify(v)+'\n')
  const spawn=(_file,args)=>{
    instance=args.at(-1);proc=new EventEmitter()
    proc.stdout=new PassThrough();proc.stderr=new PassThrough();proc.stdin=new PassThrough()
    proc.kill=()=>{queueMicrotask(()=>{proc.emit('exit',0);proc.stdout.end();proc.emit('close',0)});return true}
    let buffer=''
    proc.stdin.on('data',chunk=>{
      buffer+=chunk;let end
      while((end=buffer.indexOf('\n'))>=0){
        const req=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);seen.push(req)
        const stateResult={ok:true,instance_id:instance,windows_session_id:sid,parent_windows_session_id:1,worker_ready:true,paused:false,connected:true}
        if(req.command==='close'){
          emit({id:req.id,result:{ok:true,cleanup_confirmed:true,instance_id:instance}})
          emit({event:'closed',instance_id:instance,result:{ok:true}})
          queueMicrotask(()=>{proc.emit('exit',0);proc.stdout.end();proc.emit('close',0)})
        } else queueMicrotask(()=>emit({id:req.id,result:stateResult}))
      }
    })
    return proc
  }
  return {spawn,seen}
}

const consoleOnly={ok:true,remote_active:false,console_active:true,child_session_present:false,child_session_id:null,child_sessions_enabled:true,
  sessions:[{session_id:1,user:'me',state:0,child_session:false,client_protocol_type:0,remote:false}]}
const remoteActive={ok:true,remote_active:true,console_active:true,child_session_present:false,child_session_id:null,child_sessions_enabled:true,
  sessions:[{session_id:1,user:'me',state:0,child_session:false,client_protocol_type:0,remote:false},
            {session_id:2,user:'me',state:0,child_session:false,client_protocol_type:2,remote:true}]}
const ownedExposed={ok:true,remote_active:false,console_active:true,child_session_present:true,child_session_id:5,child_sessions_enabled:true,
  sessions:[{session_id:1,user:'me',state:0,child_session:false,client_protocol_type:0,remote:false},
            {session_id:5,user:'me',state:0,child_session:true,client_protocol_type:2,remote:true}]}

// 1. No remote control: opening is allowed and actually reaches the native host.
{
  const f=fixture()
  const p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true}),inspectSessions:()=>consoleOnly})
  const opened=await p.command('login')
  assert.equal(opened.ok,true,'login must proceed when no remote control is attached')
  assert.deepEqual(f.seen.map(x=>x.command),['login'])
  await p.close()
}

// 2. Remote control already attached: refuse BEFORE any native host exists.
for(const command of ['login','open']){
  const f=fixture()
  const p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true}),inspectSessions:()=>remoteActive})
  const result=await p.command(command)
  assert.equal(result.ok,false)
  assert.equal(result.error_code,'task_desktop_remote_in_use',`${command} must refuse while remote control is attached`)
  assert.equal(f.seen.length,0,`${command} must not start a native host or create a session`)
  assert.match(result.message,/远程控制/)
  await p.close()
}

// 3. 'prepare' only enables the OS feature and must not be blocked.
{
  const f=fixture()
  const p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true}),inspectSessions:()=>remoteActive})
  const result=await p.command('prepare')
  assert.equal(result.ok,true,'prepare must not create a session and stays allowed')
  await p.close()
}

// 4. execute() path: the implicit login is also guarded.
{
  const f=fixture()
  const p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true}),inspectSessions:()=>remoteActive})
  const result=await p.execute('click',{x:1,y:1})
  assert.equal(result.ok,false)
  assert.equal(result.error_code,'task_desktop_remote_in_use')
  assert.equal(result.outcome,'not_executed')
  assert.equal(f.seen.length,0,'guarded execute must not touch the native host')
  await p.close()
}

// 5. Idle status exposes the conflict without creating anything.
{
  const f=fixture()
  const p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true}),inspectSessions:()=>remoteActive})
  const status=await p.command('status')
  assert.equal(status.ok,true)
  assert.equal(status.state,'idle')
  assert.equal(status.remote_conflict.allow,false)
  assert.equal(status.remote_conflict.reason,'remote_in_use')
  assert.equal(f.seen.length,0)
  await p.close()
}

// 6. An owned session that is exposed to remote control is a separate verdict.
{
  const verdict=assessRemoteConflict(ownedExposed,{hasOwnedSession:true})
  assert.equal(verdict.allow,false)
  assert.equal(verdict.reason,'owned_session_exposed')
  assert.equal(verdict.child_session_id,5)
  // Without an owned session that same state is not a conflict for a fresh open:
  // the child session is somebody else's, and opening still must not proceed silently.
  const fresh=assessRemoteConflict(ownedExposed,{hasOwnedSession:false})
  assert.equal(fresh.allow,false,'an active remote child session also blocks a new open')
  assert.equal(fresh.reason,'remote_in_use')
}

// 7. A failed probe is a refusal, never a silent allowance.
{
  const verdict=assessRemoteConflict({ok:false,error_code:'task_desktop_probe_failed'})
  assert.equal(verdict.allow,false)
  assert.equal(verdict.reason,'probe_failed')
  const f=fixture()
  const p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true}),inspectSessions:()=>({ok:false,error_code:'task_desktop_probe_failed'})})
  const result=await p.command('login')
  assert.equal(result.ok,false)
  assert.equal(result.error_code,'task_desktop_remote_in_use')
  assert.equal(f.seen.length,0)
  await p.close()
}

// 8. The reverse order: desktop already open, then remote control attaches.
{
  const f=fixture(3)
  let session=consoleOnly
  const p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true}),inspectSessions:()=>session})
  const opened=await p.command('login')
  assert.equal(opened.ok,true)

  const quiet=await p.inspectExposure()
  assert.equal(quiet.running,true)
  assert.equal(quiet.verdict.allow,true,'an open desktop with no remote control is not exposed')

  // Remote control attaches while the desktop stays open.
  session={...consoleOnly,child_session_present:true,child_session_id:3,
    sessions:[...consoleOnly.sessions,{session_id:3,user:'me',state:0,child_session:true,client_protocol_type:2,remote:true}]}
  const exposed=await p.inspectExposure()
  assert.equal(exposed.running,true)
  assert.equal(exposed.verdict.allow,false,'an exposed owned desktop must be reported')
  assert.equal(exposed.verdict.reason,'owned_session_exposed')
  assert.equal(f.seen.filter(x=>x.command==='close').length,0,'inspection must not close anything')
  await p.close()
}

// 9. The probe itself must report structured facts, never throw on a bad install.
{
  const result=getSessionState({hostPath:'C:/definitely/missing/win-pilot-task-desktop.exe'})
  assert.equal(result.ok,false)
  assert.equal(result.error_code,'task_desktop_host_missing')
}

console.log('remote session guard check PASSED')
