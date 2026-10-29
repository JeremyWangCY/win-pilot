import {spawn as spawnProcess} from 'node:child_process'
import {randomUUID} from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {isControlMutation} from './control-session.js'
import {assessRemoteConflict,getSessionState} from './remote-session-guard.js'

const nativeHost=path.join(path.dirname(fileURLToPath(import.meta.url)),'task-desktop','win-pilot-task-desktop.exe')
const failure=(code,message,sent=false,action)=>({ok:false,...(action?{action}:{}),error_code:code,message,outcome:sent?'unknown':'not_executed',actionSent:sent,retry:sent?'reobserve':'never',desktop_environment:'task'})

/** File inspection only: does not start a process or prepare a Windows session. */
export function getTaskDesktopAvailability({hostPath=nativeHost}={}) {
  const directory=path.dirname(hostPath)
  const required=[hostPath,...['win-pilot-task-desktop.dll','win-pilot-task-desktop.deps.json','win-pilot-task-desktop.runtimeconfig.json'].map(name=>path.join(directory,name))]
  const missing=required.filter(file=>!fs.existsSync(file))
  const safetyHold=fs.existsSync(path.join(directory,'safety-hold.json'))
  const available=process.platform==='win32'&&missing.length===0&&!safetyHold
  return {available,preview_available:process.platform==='win32'&&missing.length===0,host_present:fs.existsSync(hostPath),required_files_present:missing.length===0,safety_hold:safetyHold,missing_files:missing,
    error_code:safetyHold?'task_desktop_safety_hold':process.platform!=='win32'?'task_desktop_platform_unsupported':missing.length?'task_desktop_host_missing':null,
    message:safetyHold?'独立桌面启动已拦截：先修复会触发 Windows 关闭主桌面 ChatGPT 的启动链路。':process.platform!=='win32'?'独立桌面需要 Windows。':missing.length?'独立桌面原生组件不完整。':'原生组件已安装；连接与执行能力需要在会话建立后验证。'}
}

/** One owned native preview and child-session worker. Never calls the main desktop helper. */
export function createTaskDesktopProvider({hostPath=nativeHost,spawn=spawnProcess,inspectHost=()=>getTaskDesktopAvailability({hostPath}),inspectSessions=()=>getSessionState({hostPath}),timeoutMs=65000,loginTimeoutMs=0,closeTimeoutMs=60000,maxFrameBytes=8*1024*1024,parentSessionId}={}) {
  const instance=randomUUID(),pending=new Map()
  let child=null,state=null,buffer='',closed=false,lost=false,opening=null,shutdownResult=null
  let drainedPromise=Promise.resolve(),drainedResolve,closePromise=null,drained=false,recoverable=false,hostGeneration=0,needsObservation=false
  // One shared read-only verdict; null means "not checked", never "allowed".
  function remoteConflict(){
    try { return assessRemoteConflict(inspectSessions(),{hasOwnedSession:false}) }
    catch (error) { return {allow:false,level:'unknown',reason:'probe_failed',message:error.message} }
  }
  function settle(id,value){const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);p.signal?.removeEventListener('abort',p.abort);p.resolve(value)}
  function disconnect(message){lost=true;state={...state,worker_ready:false,paused:true,state:'disconnected'};for(const [id,p] of pending)settle(id,failure('task_desktop_connection_lost',message,p.sent,p.action))}
  function acceptState(value){
    if(value?.instance_id!==instance)return false
    if(parentSessionId!==undefined&&value.parent_windows_session_id!==parentSessionId)return false
    // Buffered state can arrive after cancellation or process exit. Validate its
    // identity, but never let a late ready event reopen this owned provider.
    if(!closed&&!lost)state={...value};return true
  }
  // Replacement requires an authenticated cleanup ACK and fully drained stdio.
  // A crash or an unconfirmed cleanup must never create a second owned session.
  function recoverHost(){
    if(closed||!lost||!drained||!recoverable||shutdownResult?.ok!==true||shutdownResult.cleanup_confirmed!==true)return false
    ++hostGeneration // Retire old callbacks even before a new observation starts a host.
    child=null;lost=false;buffer='';shutdownResult=null;recoverable=false;drained=false
    state=null;needsObservation=true
    return true
  }
  function ensureHost(previewOnly=false){
    if(child)return true
    if(closed||lost)return false
    try {
      const handle=spawn(hostPath,['--stdio',...(previewOnly?['--preview']:[]),'--instance-id',instance],{windowsHide:!previewOnly,stdio:['pipe','pipe','pipe']})
      child=handle
      const generation=++hostGeneration,current=()=>generation===hostGeneration
      drained=false
      drainedPromise=new Promise(resolve=>{drainedResolve=resolve})
      child.stdout.setEncoding('utf8')
      child.stdout.on('data',chunk=>{
        if(!current())return
        buffer+=chunk
        if(Buffer.byteLength(buffer)>maxFrameBytes){disconnect('Task desktop response exceeded the frame limit.');child.kill();return}
        let end
        while((end=buffer.indexOf('\n'))>=0){
          const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);if(!line)continue
          let value;try{value=JSON.parse(line)}catch{disconnect('Task desktop returned malformed JSON.');child.kill();return}
          if(value.event==='closed'){
            if(value.instance_id!==instance||typeof value.result?.ok!=='boolean'){disconnect('Task desktop shutdown identity mismatch.');child.kill();return}
            shutdownResult=value.result;recoverable=value.recoverable===true;continue
          }
          if(value.event==='state'){if(!acceptState(value.state)){disconnect('Task desktop identity mismatch.');child.kill()}continue}
          const p=pending.get(String(value.id));if(!p)continue
          if(!value.result||typeof value.result!=='object'){disconnect('Task desktop response is missing its result.');child.kill();return}
          if(value.result.instance_id&&!acceptState(value.result)){disconnect('Task desktop identity mismatch.');child.kill();return}
          settle(String(value.id),value.result)
        }
      })
      child.stderr.resume()
      child.once('error',error=>{if(current())disconnect(error.message)})
      child.once('exit',()=>{if(current())disconnect('Task desktop process exited.')})
      // exit does not guarantee that redirected stdout has drained. The closed
      // ACK may still be buffered; only close makes its absence conclusive.
      child.once('close',()=>{if(current()){disconnect('Task desktop process closed.');drained=true;drainedResolve?.()}})
      return true
    }catch(error){disconnect(error.message);return false}
  }
  function send(command,args={},signal){
    if(signal?.aborted)return Promise.resolve(failure('action_aborted','Cancelled before dispatch.'))
    if(!child){const availability=inspectHost();if(!(command==='preview'?availability.preview_available:availability.available))return Promise.resolve(failure(availability.error_code||'task_desktop_unavailable',availability.message))}
    if((closed&&command!=='close')||!ensureHost(command==='preview')||lost)return Promise.resolve(failure('task_desktop_unavailable','Task desktop host is unavailable.'))
    return new Promise(resolve=>{
      const generation=hostGeneration
      const id=randomUUID(),action=args.request?.action
      const entry={resolve,signal,action,sent:false,timer:null,abort:null}
      entry.abort=()=>{
        settle(id,failure('action_aborted','Task desktop action cancelled; observe before retrying.',entry.sent,action))
        if(command==='execute'){state={...state,paused:true};void send('pause').catch(()=>{})}
        else if(['login','open','prepare','retry'].includes(command))void closeOwnedHost().catch(()=>{})
      }
      // Human Windows sign-in stays open until cancellation/window close. The
      // native host still bounds startup once connected; other commands time out.
      const requestTimeout=command==='login'&&loginTimeoutMs===0?null:command==='close'?closeTimeoutMs:command==='login'?Math.max(timeoutMs,loginTimeoutMs):['open','prepare','retry'].includes(command)?Math.max(timeoutMs,180000):timeoutMs
      if(requestTimeout!==null)entry.timer=setTimeout(()=>{settle(id,failure('task_desktop_timeout','Task desktop request timed out; it was not replayed.',entry.sent,action));if(command==='execute'){state={...state,paused:true};void send('pause')}else if(['login','open','prepare','retry'].includes(command))void closeOwnedHost().catch(()=>{})},requestTimeout)
      pending.set(id,entry);signal?.addEventListener('abort',entry.abort,{once:true})
      if(signal?.aborted){entry.abort();return}
      try{entry.sent=true;child.stdin.write(JSON.stringify({...args,id,command})+'\n',error=>{if(error&&generation===hostGeneration){settle(id,failure('task_desktop_write_failed',error.message,true,action));disconnect(error.message)}})}
      catch(error){settle(id,failure('task_desktop_write_failed',error.message,true,action));disconnect(error.message)}
    })
  }
  function closeOwnedHost(){
    if(closePromise)return closePromise
    closed=true
    state={...state,worker_ready:false,paused:true,state:'closing'}
    closePromise=(async()=>{
      if(child&&!lost){const result=await send('close');if(result.ok===false&&!lost){child.kill();throw new Error(result.message)}}
      if(child){
        let timer
        const drained=await Promise.race([drainedPromise.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),closeTimeoutMs)})])
        clearTimeout(timer)
        if(!drained){child.kill();throw new Error('Task desktop did not confirm shutdown.')}
        if(shutdownResult?.ok!==true)throw new Error(shutdownResult?.message||'Task desktop exited without confirming session cleanup.')
      }
    })()
    return closePromise
  }
  const provider={
    name:'windows-child-session',
    getState(){return state?{...state}:null},
    /**
     * Re-check an already-running desktop. The pre-flight guard covers "remote is
     * already attached"; this covers the reverse order, where the user starts
     * remote control after the AI desktop exists and the streamer follows into it.
     * Read-only: it never closes or reconfigures anything.
     */
    async inspectExposure(){
      if(!child)return {ok:true,running:false,verdict:{allow:true,level:'ok',reason:'idle',message:''}}
      const sessionState=inspectSessions()
      const verdict=assessRemoteConflict(sessionState,{hasOwnedSession:true})
      return {ok:true,running:true,windows_session_id:state?.windows_session_id??null,verdict,session_state:sessionState}
    },
    async command(command,args={},signal){
      if(!['status','preview','preview_snapshot','open','login','prepare','retry','pause','resume','takeover','close'].includes(command))return failure('task_desktop_unknown_command','Unsupported task desktop command.')
      if(!child&&command==='close')return {ok:true,cleanup_confirmed:true,instance_id:instance}
      if(!child&&command==='status'){
        const availability=inspectHost()
        // The idle snapshot also reports what remote control would see, so a
        // caller can warn before anything is created.
        const sessionState=availability.available?inspectSessions():null
        const conflict=sessionState?assessRemoteConflict(sessionState,{hasOwnedSession:false}):null
        return availability.available?{ok:true,instance_id:instance,state:'idle',worker_ready:false,connected:false,paused:true,windows_session_id:null,parent_windows_session_id:parentSessionId??null,availability,session_state:sessionState,remote_conflict:conflict}: {...failure(availability.error_code||'task_desktop_unavailable',availability.message),availability}
      }
      if(!child&&!['preview','open','login','prepare'].includes(command))return failure('task_desktop_not_ready','No task desktop has been started.')
      // Creating a child session while remote control is attached silently moves
      // that user's remote screen onto the AI desktop (observed with UU remote,
      // whose streamer does not call WTSGetChildSessionId). Refuse before the
      // Windows session exists rather than after the user's screen has moved.
      // A preview never creates a session, and 'prepare' only enables the OS
      // feature, so both are checked by the caller instead.
      if(!child&&['open','login'].includes(command)) {
        // Availability first: a safety hold must stop the attempt before anything
        // else runs, including a read-only probe.
        const availability=inspectHost()
        if(!availability.available)return {...failure(availability.error_code||'task_desktop_unavailable',availability.message),availability}
        const verdict=remoteConflict()
        if(verdict&&!verdict.allow)return failure('task_desktop_remote_in_use',verdict.message)
      }
      return send(command,args,signal)
    },
    async execute(action,args={},signal){
      if(action==='stop'&&!child)return {ok:true,action,outcome:'completed',actionSent:false,desktop_environment:'task'}
      recoverHost()
      if(closed||lost)return failure('task_desktop_unavailable','The original task desktop worker is unavailable.',false,action)
      if(needsObservation&&isControlMutation({...args,action}))return failure('task_desktop_reobserve_required','The child session ended. Observe the replacement desktop before sending input.',false,action)
      // The implicit open must pass the same remote-control guard as an explicit
      // login; otherwise execute() would be a second, unguarded way in.
      if(!child){
        const availability=inspectHost()
        if(!availability.available)return {...failure(availability.error_code||'task_desktop_unavailable',availability.message),action}
        const conflict=remoteConflict()
        if(conflict&&!conflict.allow)return failure('task_desktop_remote_in_use',conflict.message)
        opening??=send('login',{},signal).finally(()=>{opening=null});const opened=await opening;if(opened.ok===false)return {...opened,action}
      }
      if(action!=='stop'){
        const actual=await send('status',{},signal)
        const sid=actual.windows_session_id,parent=actual.parent_windows_session_id
        if(actual.ok===false)return {...actual,action}
        if(!actual.worker_ready||!Number.isInteger(sid)||sid<=0||!Number.isInteger(parent)||sid===parent)return failure('task_desktop_not_ready',actual.message||'The child-session worker is not ready.',false,action)
        if(actual.paused&&isControlMutation({...args,action}))return failure('task_desktop_paused','Use the task window to resume or return control.',false,action)
      }
      const result=await send('execute',{request:{...args,action}},signal)
      if(result.ok===true&&!isControlMutation({...args,action})&&action!=='stop')needsObservation=false
      return result
    },
    async waitForClose(signal){
      if(!child)return
      if(signal?.aborted)return
      let abort
      try{await Promise.race([drainedPromise,new Promise(resolve=>{abort=resolve;signal?.addEventListener('abort',abort,{once:true})})])}
      finally{signal?.removeEventListener('abort',abort)}
    },
    close:closeOwnedHost,
  }
  return provider
}

export const defaultTaskDesktopProvider=createTaskDesktopProvider()
