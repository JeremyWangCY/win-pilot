import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {PassThrough} from 'node:stream'
import {createTaskDesktopProvider} from '../lib/task-desktop.js'
import {createWinPilotRuntime} from '../lib/runtime.js'
import {controlCoordinator,createControlCoordinator} from '../lib/control-session.js'
import {setSettingsForTest,resetSettingsForTest} from '../lib/settings.js'
import {randomUUID} from 'node:crypto'
import childProcess from 'node:child_process'
import {syncBuiltinESMExports} from 'node:module'
// Every native host below is an in-memory fixture. Also fail immediately if a
// routing regression tries to launch any real helper or main-desktop process.
const originalSpawn=childProcess.spawn
childProcess.spawn=()=>{throw new Error('REAL PROCESS START FORBIDDEN IN MOCK TEST')}
syncBuiltinESMExports()
Object.assign(controlCoordinator,createControlCoordinator({lockName:`\\\\.\\pipe\\task-desktop-test-${randomUUID()}`}))
function fixture({sid=3,holdExecute=false,holdLogin=false,closeOk=true,holdCommands=[],holdClose=false,exitBeforeAck=false,omitAck=false}={}) {
  const seen=[];let proc,instance,paused=false,previewOnly=false,finishClose
  const emit=value=>proc.stdout.write(JSON.stringify(value)+'\n')
  const state=()=>({ok:true,instance_id:instance,preview_only:previewOnly,windows_session_id:previewOnly?null:sid,parent_windows_session_id:1,worker_ready:!previewOnly,paused,connected:!previewOnly})
  const spawn=(_file,args)=>{
    instance=args.at(-1);previewOnly=args.includes('--preview');proc=new EventEmitter();proc.stdout=new PassThrough();proc.stderr=new PassThrough();proc.stdin=new PassThrough();proc.kill=()=>{queueMicrotask(()=>{proc.emit('exit',0);proc.stdout.end();proc.emit('close',0)});return true}
    let buffer='';proc.stdin.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const req=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);seen.push(req)
      if(req.command==='execute'&&holdExecute)continue
      if(req.command==='login'&&holdLogin)continue
      if(holdCommands.includes(req.command))continue
      if(req.command==='pause')paused=true
      if(req.command==='resume')paused=false
      const result=req.command==='execute'?{ok:true,action:req.request.action,outcome:'completed'}:previewOnly&&['open','login','prepare'].includes(req.command)?{ok:false,error_code:'task_desktop_preview_only'}:state()
      if(req.command==='close'){
        finishClose=()=>{
          const drain=()=>{emit({id:req.id,result});if(!omitAck)emit({event:'closed',instance_id:instance,result:{ok:closeOk,...(!closeOk?{message:'fixture cleanup unconfirmed'}:{})}});if(!exitBeforeAck)proc.emit('exit',0);proc.stdout.end();proc.emit('close',0)}
          if(exitBeforeAck){proc.emit('exit',0);setImmediate(drain)}else drain()
        }
        if(!holdClose)queueMicrotask(finishClose)
      }else queueMicrotask(()=>emit({id:req.id,result}))
    }})
    return proc
  }
  return {spawn,seen,get proc(){return proc},finishClose:()=>finishClose(),emitReady:()=>emit({event:'state',state:state()})}
}
{
  const f=fixture(),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true})})
  const abort=new AbortController();abort.abort()
  assert.equal((await p.command('login',{},abort.signal)).error_code,'action_aborted')
  assert.equal(f.proc,undefined,'already-cancelled login must not create a native host')
  await p.close()
}
for(const command of ['login','open','prepare','retry']){
  const f=fixture({holdCommands:[command],holdClose:true}),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true})})
  if(command==='retry')await p.command('open')
  const abort=new AbortController(),startup=p.command(command,{},abort.signal)
  abort.abort()
  assert.equal((await startup).error_code,'action_aborted')
  assert.equal(f.seen.filter(x=>x.command==='close').length,1,`${command} cancellation must immediately close its owned host`)
  f.emitReady()
  assert.equal(p.getState().worker_ready,false,'late ready cannot revive a cancelled startup')
  assert.equal(p.getState().paused,true)
  const count=f.seen.length
  assert.equal((await p.execute('type_text',{text:'cancelled'})).outcome,'not_executed')
  assert.equal((await p.command('resume')).ok,false)
  assert.equal(f.seen.length,count,'cancelled startup must not dispatch more work or replace the host')
  const closing=p.close();assert.equal(p.close(),closing,'all callers must observe the same shutdown outcome')
  f.finishClose();await closing
}
{
  const f=fixture({holdLogin:true}),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true})})
  const abort=new AbortController(),active=p.execute('type_text',{text:'never dispatched'},abort.signal)
  abort.abort();assert.equal((await active).error_code,'action_aborted')
  await p.close()
  assert.deepEqual(f.seen.map(x=>x.command),['login','close'],'cancelling implicit login cannot send the original input')
}
for(const closeOk of [true,false]){
  const f=fixture({exitBeforeAck:true,closeOk}),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true})})
  await p.command('open')
  if(closeOk)await p.close()
  else await assert.rejects(p.close(),/fixture cleanup unconfirmed/,'buffered negative cleanup ACK must retain its native error')
  assert.equal((await p.execute('click')).outcome,'not_executed')
}
{
  const f=fixture(),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true})})
  await p.command('open')
  let finished=false
  const waiting=p.waitForClose().then(()=>{finished=true})
  f.proc.emit('exit',0)
  assert.equal((await p.command('resume')).ok,false,'exit immediately revokes dispatch')
  f.emitReady();assert.equal(p.getState().worker_ready,false,'buffered ready after exit must not restore readiness')
  const closing=p.close()
  await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false,'waitForClose must wait for stdio to drain')
  const instance=p.getState().instance_id
  f.proc.stdout.write(JSON.stringify({event:'closed',instance_id:instance,result:{ok:true,cleanup_confirmed:true}})+'\n')
  f.proc.stdout.end();f.proc.emit('close',0)
  await closing;await waiting
}
{
  const f=fixture({exitBeforeAck:true,omitAck:true}),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true})})
  await p.command('open')
  await assert.rejects(p.close(),/without confirming session cleanup/,'stdio drain without a cleanup ACK must remain a failure')
  await assert.rejects(p.close(),/without confirming session cleanup/,'repeated close cannot hide a previous cleanup failure')
}
{
  const f=fixture({holdClose:true}),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true}),closeTimeoutMs:20})
  await p.command('open')
  const closing=p.close();f.proc.emit('exit',0)
  await assert.rejects(closing,/did not confirm shutdown/,'an exited process whose streams never close must have a bounded cleanup wait')
}
{
  const f=fixture(),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:false,preview_available:true,safety_hold:true})})
  const preview=await p.command('preview')
  assert.equal(preview.preview_only,true)
  assert.equal(preview.worker_ready,false)
  assert.equal((await p.command('open')).error_code,'task_desktop_preview_only')
  assert.equal((await p.command('login')).error_code,'task_desktop_preview_only')
  assert.equal((await p.command('prepare')).error_code,'task_desktop_preview_only')
  assert.equal((await p.execute('type_text',{text:'must stay refused'})).error_code,'task_desktop_not_ready')
  assert.equal(f.seen.some(x=>x.command==='execute'),false,'a preview process must not receive computer actions')
  await p.close()
}
{
  const f=fixture({holdLogin:true}),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true}),timeoutMs:15})
  const abort=new AbortController();let settled=false
  const login=p.command('login',{},abort.signal).then(value=>{settled=true;return value})
  await new Promise(resolve=>setTimeout(resolve,50))
  assert.equal(settled,false,'human login must outlive an ordinary request timer')
  abort.abort();assert.equal((await login).error_code,'action_aborted','human sign-in must remain cancellable')
  await p.close()
}
{
  const f=fixture(),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true})})
  assert.equal((await p.command('login')).worker_ready,true)
  assert.equal(f.seen[0].command,'login','explicit Windows sign-in must reach only the owned native host')
  await p.close()
}
{
  const f=fixture(),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true})})
  assert.equal((await p.command('status')).state,'idle')
  assert.equal((await p.command('pause')).error_code,'task_desktop_not_ready')
  assert.equal(f.proc,undefined,'status and pause may not create a task window')
  assert.equal((await p.execute('stop')).ok,true);assert.equal(f.seen.length,0,'stop must not create a replacement host')
  assert.equal((await p.execute('type_text',{text:'fixture'})).ok,true)
  assert.equal(f.seen[0].command,'login','a selected task desktop must offer the system sign-in flow on first use')
  assert.equal(f.seen.filter(x=>x.command==='execute').length,1)
  await p.command('pause')
  assert.equal((await p.execute('type_text',{text:'refused'})).error_code,'task_desktop_paused')
  assert.equal((await p.execute('screenshot')).ok,true,'observation remains available while paused')
  await p.close()
}
{
  const f=fixture({closeOk:false}),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true})})
  await p.execute('get_window')
  await assert.rejects(p.close(),/fixture cleanup unconfirmed/,'native exit alone must not claim complete cleanup')
}
{
  const f=fixture({sid:1}),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true})})
  assert.equal((await p.execute('click',{x:1,y:2})).outcome,'not_executed')
  assert.equal(f.seen.some(x=>x.command==='execute'),false,'same Windows session must never receive input')
  await p.close()
}
{
  const f=fixture({holdExecute:true}),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true}),timeoutMs:2000})
  const abort=new AbortController(),active=p.execute('type_text',{text:'once'},abort.signal)
  while(!f.seen.some(x=>x.command==='execute'))await new Promise(resolve=>setTimeout(resolve,1))
  abort.abort();assert.equal((await active).outcome,'unknown')
  assert.equal(f.seen.filter(x=>x.command==='execute').length,1,'cancelled mutation cannot be replayed')
  await p.close()
}
{
  const f=fixture({holdExecute:true}),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true}),timeoutMs:2000})
  const active=p.execute('click',{x:4,y:5})
  while(!f.seen.some(x=>x.command==='execute'))await new Promise(resolve=>setTimeout(resolve,1))
  f.proc.emit('exit',1);f.proc.stdout.end();f.proc.emit('close',1);assert.equal((await active).outcome,'unknown')
  assert.equal((await p.execute('click')).outcome,'not_executed','dead host cannot be silently replaced')
  await assert.rejects(p.close(),/without confirming session cleanup/)
}
{
  const seen=[],commands=[]
  const provider={execute:async(action,args)=>{seen.push({action,args});return {ok:true,action,outcome:'completed'}},command:async name=>{commands.push(name);return {ok:true}},close:async()=>{commands.push('close')}}
  setSettingsForTest({desktopEnvironment:'task'})
  const runtime=createWinPilotRuntime({taskDesktopProvider:provider})
  assert.equal((await runtime.act('type_text',{text:'task'})).ok,true)
  setSettingsForTest({desktopEnvironment:'current'})
  await runtime.act('get_window',{app:'fixture'})
  assert.equal(seen.at(-1).action,'get_window','existing task keeps its environment after setting changes')
  assert.equal(seen.find(x=>x.action==='type_text').args.dispatch,'foreground')
  assert.equal(seen.filter(x=>x.action==='screenshot').length,1,'post action observation uses the same isolated provider')
  await runtime.act('stop');assert.ok(commands.includes('pause'))
  await runtime.close();assert.ok(commands.includes('close'))
  resetSettingsForTest()
}

for(const {ack,confirmed,canRecover} of [
  {ack:true,confirmed:true,canRecover:true},
  {ack:true,confirmed:false,canRecover:false},
  {ack:false,confirmed:true,canRecover:false},
]){
  const f=fixture(),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true}),closeTimeoutMs:100})
  await p.command('open')
  const old=f.proc,instance=p.getState().instance_id
  old.emit('exit',0)
  if(ack)old.stdout.write(JSON.stringify({event:'closed',instance_id:instance,recoverable:true,result:{ok:true,cleanup_confirmed:confirmed}})+'\n')
  // An exit is insufficient: wait for the cleanup ACK and stream drain.
  assert.equal((await p.execute('screenshot')).ok,false)
  assert.equal(f.proc,old)
  old.stdout.end();old.emit('close',0)
  if(canRecover){
    assert.equal((await p.execute('click',{x:1,y:2})).error_code,'task_desktop_reobserve_required')
    assert.equal(f.proc,old,'input alone cannot start a replacement')
    old.emit('error',new Error('late error before replacement'))
    assert.equal((await p.execute('screenshot')).ok,true,'a new observation recovers after confirmed cleanup')
    assert.notEqual(f.proc,old)
    old.emit('close',0)
    assert.equal((await p.execute('click',{x:1,y:2})).ok,true,'late old events cannot break the replacement')
    assert.equal(f.seen.filter(x=>x.command==='execute'&&x.request.action==='click').length,1)
    await p.close()
  }else{
    assert.equal((await p.execute('screenshot')).ok,false,'unconfirmed cleanup must block recovery')
    assert.equal(f.proc,old)
    if(ack)await p.close();else await assert.rejects(p.close(),/without confirming session cleanup/)
  }
}

{
  const f=fixture({holdExecute:true}),p=createTaskDesktopProvider({spawn:f.spawn,inspectHost:()=>({available:true}),timeoutMs:2000})
  const active=p.execute('type_text',{text:'must not replay'})
  while(!f.seen.some(x=>x.command==='execute'))await new Promise(resolve=>setTimeout(resolve,1))
  const old=f.proc,instance=p.getState().instance_id
  old.stdout.write(JSON.stringify({event:'closed',instance_id:instance,recoverable:true,result:{ok:true,cleanup_confirmed:true}})+'\n')
  old.emit('exit',0);old.stdout.end();old.emit('close',0)
  assert.equal((await active).outcome,'unknown')
  assert.equal((await p.execute('click')).error_code,'task_desktop_reobserve_required')
  assert.equal(f.seen.filter(x=>x.command==='execute'&&x.request.action==='type_text').length,1,'recovery cannot replay input with an unknown outcome')
  await p.close()
  assert.equal((await p.execute('screenshot')).ok,false,'explicit close permanently blocks recovery')
}
console.log('task desktop provider and trusted routing check PASSED')
childProcess.spawn=originalSpawn
syncBuiltinESMExports()
