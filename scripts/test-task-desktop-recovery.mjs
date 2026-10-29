import fs from 'node:fs'
import {spawn,execFileSync} from 'node:child_process'
import {createTaskDesktopProvider} from '../lib/task-desktop.js'
if(!process.argv.includes('--authorized-host-test'))throw new Error('Explicit live child-session test authorization is required.')
const log=new URL('../artifacts/task-desktop-recovery-'+Date.now()+'.jsonl',import.meta.url)
fs.mkdirSync(new URL('../artifacts/',import.meta.url),{recursive:true})
const emit=value=>{fs.appendFileSync(log,JSON.stringify({time:new Date().toISOString(),...value})+'\n');console.log(JSON.stringify(value))}
const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),210000)
let starts=0
const p=createTaskDesktopProvider({loginTimeoutMs:120000,spawn(file,args,opts){const c=spawn(file,args,opts);starts++;emit({event:'host_start',pid:c.pid,starts});let b='';c.stdout.on('data',chunk=>{b+=chunk;let end;while((end=b.indexOf('\n'))>=0){const line=b.slice(0,end);b=b.slice(end+1);try{const v=JSON.parse(line);if(v.event)emit({event:'native',value:v})}catch{}}});return c}})
try{
  const ready=await p.command('login',{},abort.signal)
  if(!ready.ok||!ready.worker_ready)throw new Error('open failed: '+JSON.stringify(ready))
  const sid=ready.windows_session_id,parent=ready.parent_windows_session_id
  if(!Number.isInteger(sid)||sid<=0||sid===parent)throw new Error('Invalid owned session')
  emit({event:'ready',session:sid,parent})
  // Only end the child authenticated by this provider, never the parent.
  execFileSync('logoff.exe',[String(sid)],{windowsHide:true,timeout:15000})
  emit({event:'owned_child_logged_off',session:sid})
  await p.waitForClose(abort.signal)
  if(abort.signal.aborted)throw new Error('host did not shut down on invalidation')
  const blocked=await p.execute('click',{x:1,y:1},abort.signal)
  emit({event:'input_after_loss',result:blocked})
  if(blocked.error_code!=='task_desktop_reobserve_required')throw new Error('Expected observation guard')
  const recovered=await p.execute('list_displays',{},abort.signal)
  emit({event:'recovered',ok:recovered.ok,code:recovered.error_code,starts,state:p.getState()})
  if(!recovered.ok||starts!==2)throw new Error('replacement observation did not recover')
  emit({event:'pass'})
}catch(e){emit({event:'fail',message:e.message});process.exitCode=1}
finally{clearTimeout(timer);try{await p.close();emit({event:'cleanup_confirmed'})}catch(e){emit({event:'cleanup_failed',message:e.message});process.exitCode=1}}

