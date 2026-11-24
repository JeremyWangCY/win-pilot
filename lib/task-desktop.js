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
  let drainedPromise=Promise.resolve(),drainedResolve,closePromise=null,drained=false,recoverable=false,hostGeneration=0,needsObservation=false,hostGone=false
  // A host that ended without confirming cleanup may have left its Windows child
  // session behind. That must keep being reported by close(), even after the
  // provider recovered, so a leaked session is never silently declared clean.
  let cleanupUnconfirmed=false
  // One shared read-only verdict; null means "not checked", never "allowed".
  function remoteConflict(){
    try { return assessRemoteConflict(inspectSessions(),{hasOwnedSession:false}) }
    catch (error) { return {allow:false,level:'unknown',reason:'probe_failed',message:error.message} }
  }
  const stateWaiters=new Set()
  function notifyStateWaiters(kind,payload){for(const waiter of [...stateWaiters])try{waiter(kind,payload)}catch{}}
  function settle(id,value){const p=pending.get(id);if(!p)return;pending.delete(id);clearTimeout(p.timer);p.signal?.removeEventListener('abort',p.abort);p.resolve(value)}
  function disconnect(message){lost=true;state={...state,worker_ready:false,paused:true,state:'disconnected'};notifyStateWaiters('disconnected',message);for(const [id,p] of pending)settle(id,failure('task_desktop_connection_lost',message,p.sent,p.action))}
  function acceptState(value){
    if(value?.instance_id!==instance)return false
    if(parentSessionId!==undefined&&value.parent_windows_session_id!==parentSessionId)return false
    // Buffered state can arrive after cancellation or process exit. Validate its
    // identity, but never let a late ready event reopen this owned provider.
    if(!closed&&!lost){state={...value};notifyStateWaiters('state',state)}
    // A host that reaches worker_ready owns its child session: whatever a previous
    // host may have leaked is gone, because a new session cannot start while one
    // is still active.
    if(value.worker_ready===true)cleanupUnconfirmed=false
    return true
  }
  // Replacement requires an authenticated cleanup ACK and fully drained stdio:
  // a crash must never create a second session while the first one may still
  // exist. A crashed host therefore stays terminal, and the caller is told
  // exactly how to recover (the Windows child session usually outlives the host).
  const hostAlive=()=>Boolean(child)&&!hostGone&&child.exitCode===null&&!child.killed
  function canRecover(){
    if(closed||!lost)return false
    if(hostAlive())return false
    return drained&&recoverable&&shutdownResult?.ok===true&&shutdownResult.cleanup_confirmed===true
  }
  function recoverHost(){
    if(!canRecover())return false
    ++hostGeneration // Retire old callbacks even before a new observation starts a host.
    child=null;lost=false;buffer='';shutdownResult=null;recoverable=false;drained=false;hostGone=false
    state=null;needsObservation=true
    return true
  }
  function ensureHost(previewOnly=false){
    if(child)return true
    if(closed||lost)return false
    try {
      const handle=spawn(hostPath,['--stdio',...(previewOnly?['--preview']:[]),'--instance-id',instance],{windowsHide:false,stdio:['pipe','pipe','pipe']})
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
      child.once('error',error=>{if(current()){hostGone=true;cleanupUnconfirmed=shutdownResult?.ok!==true;disconnect(error.message)}})
      child.once('exit',()=>{if(current()){hostGone=true;cleanupUnconfirmed=shutdownResult?.ok!==true;disconnect('Task desktop process exited.')}})
      // exit does not guarantee that redirected stdout has drained. The closed
      // ACK may still be buffered; only close makes its absence conclusive.
      child.once('close',()=>{if(current()){hostGone=true;cleanupUnconfirmed=shutdownResult?.ok!==true;disconnect('Task desktop process closed.');drained=true;drainedResolve?.()}})
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
      // A failed close is only actionable if it names what is still holding the
      // desktop: a Windows child session that outlived its host blocks every
      // later attempt until it is ended.
      const orphanNote=()=>{try{const id=inspectSessions()?.child_session_id??null;return id!==null?` Child session ${id} is still active: end it with "logoff ${id}" before reusing the task desktop.`:''}catch{return ''}}
      if(child&&!lost){const result=await send('close');if(result.ok===false&&!lost){child.kill();throw new Error(result.message+orphanNote())}try{child.stdin.end()}catch{}}
      if(child){
        let timer
        const drained=await Promise.race([drainedPromise.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),closeTimeoutMs)})])
        clearTimeout(timer)
        if(!drained){child.kill();throw new Error('Task desktop did not confirm shutdown.'+orphanNote())}
        if(shutdownResult?.ok!==true)throw new Error((shutdownResult?.message||'Task desktop exited without confirming session cleanup.')+orphanNote())
      }
      // No host left to ask, but an earlier one died without confirming cleanup:
      // its child session may still exist, so this close is not clean either.
      if(cleanupUnconfirmed)throw new Error('Task desktop exited without confirming session cleanup.'+orphanNote())
    })()
    return closePromise
  }
  const NON_FALLBACK_OPEN_ERRORS = new Set([
    'action_aborted',
    'task_desktop_occupied',
    'task_desktop_safety_hold',
    'task_desktop_preview_only',
    'task_desktop_closed',
    'task_desktop_connection_lost',
  ])
  // Prefer non-interactive `open` first so machines with working child-session
  // auto-logon (or saved credentials) connect without blocking on a modal login
  // dialog. Fall back to `login` only when preparation or credentials are needed.
  async function openOrLogin(signal){
    const opened=await send('open',{},signal)
    if(opened.ok===true&&opened.worker_ready===true)return opened
    if(NON_FALLBACK_OPEN_ERRORS.has(opened.error_code))return opened
    if(signal?.aborted||closed||lost)return opened
    return send('login',{},signal)
  }
  const provider={
    name:'windows-child-session',
    getState(){return state?{...state}:null},
    /** True when this provider can never produce a host again without a restart. */
    isTerminal(){return closed||(lost&&!canRecover())},
    canRecover(){return canRecover()},
    restart(signal){return provider.command('restart',{},signal)},
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
      if(!['status','preview','preview_snapshot','open','login','prepare','retry','pause','resume','takeover','hand_off','close','restart'].includes(command))return failure('task_desktop_unknown_command','Unsupported task desktop command.')
      if(command==='restart'){
        // Explicit recovery: tear down whatever is left (a dead host, or one that
        // stopped answering) and create a fresh owned host. Nothing is replayed.
        if(child&&!hostGone){try{await closeOwnedHost()}catch{try{child.kill()}catch{}}}
        child=null
        closed=false;lost=false;drained=false;hostGone=false;buffer='';shutdownResult=null;recoverable=false;state=null;needsObservation=true;closePromise=null;opening=null;cleanupUnconfirmed=false
        const availability=inspectHost()
        if(!availability.available)return {...failure(availability.error_code||'task_desktop_unavailable',availability.message),availability}
        const conflict=remoteConflict()
        if(conflict&&!conflict.allow)return failure('task_desktop_remote_in_use',conflict.message)
        const opened=await openOrLogin(signal)
        if(opened.ok===false&&opened.error_code==='task_desktop_occupied'){
          // A child session left behind by a host that died cannot be opened anew,
          // and takeover needs a worker this host does not have yet. Report the
          // orphan by id with the exact next step instead of a dead end.
          const taken=await send('takeover',{},signal)
          if(taken.ok)return {...taken,recovered_by:'takeover'}
          const orphan=inspectSessions()?.child_session_id??null
          return {...failure('task_desktop_orphan_session',
            `A previous child session${orphan?` (session ${orphan})`:''} is still active, so a new one cannot start and it cannot be taken over.`,false,'restart'),
            orphan_child_session_id:orphan,retry:'never',
            how_to_recover:`End the orphaned session (logoff ${orphan??'<id>'} from an elevated shell, or close the task window), then call task_desktop restart again.`}
        }
        return opened
      }
      if(!child&&command==='close')return {ok:true,cleanup_confirmed:true,instance_id:instance}
      if(!child&&command==='status'){
        const availability=inspectHost()
        // The idle snapshot also reports what remote control would see, so a
        // caller can warn before anything is created.
        const sessionState=availability.available?inspectSessions():null
        const conflict=sessionState?assessRemoteConflict(sessionState,{hasOwnedSession:false}):null
        return availability.available?{ok:true,instance_id:instance,state:'idle',worker_ready:false,connected:false,paused:true,windows_session_id:null,parent_windows_session_id:parentSessionId??null,availability,session_state:sessionState,remote_conflict:conflict,orphan_child_session_id:sessionState?.child_session_id??null}: {...failure(availability.error_code||'task_desktop_unavailable',availability.message),availability}
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
    /** Wait until the user clicks "Hand back" (resume) on the task window. */
    waitForControl({ timeoutMs = 300000, signal } = {}) {
      if (signal?.aborted) return Promise.resolve(failure('action_aborted', 'Wait for control was cancelled.'))
      if (!child || closed || lost) return Promise.resolve(failure('task_desktop_not_ready', 'No active task desktop is connected.'))
      const isReturned = (s) => s && s.worker_ready === true && s.paused === false && s.takeover !== true && s.awaiting_human !== true
      if (isReturned(state)) {
        needsObservation = true
        return Promise.resolve({ ok: true, control_returned: true, observation_required: true, state: { ...state } })
      }
      return new Promise((resolve) => {
        let settled = false
        const finish = (result) => {
          if (settled) return
          settled = true
          stateWaiters.delete(onState)
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          resolve(result)
        }
        const onState = (kind, payload) => {
          if (kind === 'disconnected') return finish(failure('task_desktop_connection_lost', String(payload || 'Task desktop disconnected while waiting for control.')))
          if (isReturned(payload)) {
            needsObservation = true
            finish({ ok: true, control_returned: true, observation_required: true, state: { ...payload } })
          }
        }
        const onAbort = () => finish(failure('action_aborted', 'Wait for control was cancelled.'))
        const timer = setTimeout(() => finish(failure('wait_for_control_timeout', 'Timed out waiting for the user to hand control back.')), Math.max(1000, timeoutMs))
        timer.unref?.()
        stateWaiters.add(onState)
        signal?.addEventListener('abort', onAbort, { once: true })
      })
    },
    async execute(action,args={},signal){
      if(action==='stop'&&!child)return {ok:true,action,outcome:'completed',actionSent:false,desktop_environment:'task'}
      recoverHost()
      // A virtual desktop must never become permanently unusable because one host
      // process died: a crashed host is replaced automatically above, and these
      // two answers say exactly what is wrong and how the caller can recover.
      if(closed)return {...failure('task_desktop_closed','This task desktop was closed in this session; a fresh one must be created before use.',false,action),
        retry:'reobserve',how_to_recover:'call task_desktop restart (or switch the Win-Pilot desktop environment away and back), then observe again'}
      if(lost&&cleanupUnconfirmed){
        // The host died without confirming cleanup, so its Windows child session
        // may still be alive and blocks both a new session and a takeover. Report
        // that session by id with the one step that actually unblocks it.
        const orphan=inspectSessions()?.child_session_id??null
        return {...failure('task_desktop_cleanup_unconfirmed',
          `The task desktop host ended without confirming session cleanup${orphan?`; child session ${orphan} is still active`:''}.`,false,action),
          orphan_child_session_id:orphan,retry:'never',
          how_to_recover:orphan
            ?`End the orphaned session (logoff ${orphan} from an elevated shell, or close the task window), then call task_desktop restart and observe again.`
            :'Call task_desktop restart, then observe again.'}
      }
      if(lost)return {...failure(hostAlive()?'task_desktop_connection_lost':'task_desktop_host_lost',
        hostAlive()?'The task desktop worker stopped answering.':'The task desktop host process ended and could not be replaced automatically.',false,action),
        retry:'reobserve',how_to_recover:'call task_desktop restart, then observe again'}
      if(needsObservation&&isControlMutation({...args,action}))return {...failure('task_desktop_reobserve_required','The child session ended. Observe the replacement desktop before sending input.',false,action),retry:'reobserve'}
      // The implicit open must pass the same remote-control guard as an explicit
      // login; otherwise execute() would be a second, unguarded way in.
      if(!child){
        const availability=inspectHost()
        if(!availability.available)return {...failure(availability.error_code||'task_desktop_unavailable',availability.message),action}
        const conflict=remoteConflict()
        if(conflict&&!conflict.allow)return failure('task_desktop_remote_in_use',conflict.message)
        opening??=openOrLogin(signal).finally(()=>{opening=null});const opened=await opening
        if(opened.ok===false){
          // Same dead end as restart: a child session left by a dead host blocks a
          // new one and cannot be adopted. Name it and give the next step.
          if(opened.error_code==='task_desktop_occupied'){
            const orphan=inspectSessions()?.child_session_id??null
            return {...opened,action,error_code:'task_desktop_orphan_session',orphan_child_session_id:orphan,retry:'never',
              how_to_recover:`End the orphaned session (logoff ${orphan??'<id>'} from an elevated shell, or close the task window), then call task_desktop restart and observe again.`}
          }
          return {...opened,action}
        }
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
