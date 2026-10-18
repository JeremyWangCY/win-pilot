import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath,pathToFileURL} from 'node:url'
import {randomUUID} from 'node:crypto'
import {spawn} from 'node:child_process'

if(!process.argv.includes('--authorized-host-test'))throw new Error('This entry requires explicit authorization for live host child-session testing.')
const root=fileURLToPath(new URL('..',import.meta.url))
const packageArg=process.argv.find(value=>value.startsWith('--package-root='))
const packageRoot=packageArg?path.resolve(packageArg.slice('--package-root='.length)):root
const {createTaskDesktopProvider}=await import(pathToFileURL(path.join(packageRoot,'lib','task-desktop.js')).href)
const instance=randomUUID(),output=path.join(root,'artifacts','task-desktop-host',instance)
fs.mkdirSync(output,{recursive:true})
const hold=path.join(packageRoot,'lib','task-desktop','safety-hold.json'),backup=path.join(output,'safety-hold.original.json'),hadHold=fs.existsSync(hold)
const fixture=path.join(root,'artifacts','task-desktop-host','fixture','win-pilot-task-fixture.exe')
if(!fs.existsSync(fixture))throw new Error('Built fixture is missing; no desktop was started.')
const eventsDirectory=path.join(os.tmpdir(),'win-pilot','host-fixture-'+instance),events=path.join(eventsDirectory,'fixture-events.jsonl')
if(fs.existsSync(eventsDirectory))throw new Error('Fixture directory must be fresh.')
fs.mkdirSync(eventsDirectory,{recursive:true})
const abort=new AbortController(),report={instance_id:instance,started_at:new Date().toISOString(),status:'incomplete',checks:[],output,events,host_test_authorized:true,package_root:packageRoot,hold_present_before_test:hadHold}
const testBudget=process.argv.includes('--keep-open-on-worker-error')?30*60*1000:process.argv.includes('--windows-login')?15*60*1000:240000
const trace=path.join(output,'native.jsonl')
const desktop=createTaskDesktopProvider({loginTimeoutMs:0,spawn(file,args,options){const child=spawn(file,args,options);report.host_pid=child.pid;child.stdout.on('data',chunk=>fs.appendFileSync(trace,chunk));child.stderr.on('data',chunk=>fs.appendFileSync(path.join(output,'stderr.txt'),chunk));return child}})
let expiresAt=Date.now()+testBudget
const deadline=setInterval(()=>{
  const state=desktop.getState()
  if(['login_settings','awaiting_windows_login'].includes(state?.state)&&!state.worker_ready){expiresAt=Date.now()+testBudget;return}
  if(Date.now()>=expiresAt)abort.abort(new Error('Host fixture test reached its time budget'))
},1000)
// Test-driver control only: no computer-action requests or credential fields.
let controlInput=''
process.stdin.setEncoding('utf8')
process.stdin.on('data',chunk=>{controlInput+=chunk;let end;while((end=controlInput.indexOf('\n'))>=0){const line=controlInput.slice(0,end);controlInput=controlInput.slice(end+1);void(async()=>{try{const request=JSON.parse(line);if(!['status','retry','pause','takeover','resume','preview_snapshot','close'].includes(request.command))throw new Error('Unsupported test control');console.log(JSON.stringify({control_id:request.id??null,result:await desktop.command(request.command)}))}catch(error){console.log(JSON.stringify({control_error:error.message}))}})()}})
const save=()=>{fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));fs.writeFileSync(path.join(root,'reports','task-desktop-host-latest.json'),JSON.stringify(report,null,2))}
const check=(name,detail)=>{report.checks.push({name,status:'pass',detail});save();console.log(JSON.stringify({check:name,detail}))}
const startupCapture=setTimeout(async()=>{try{report.startup_state=await desktop.command('status');const shot=await desktop.command('preview_snapshot');if(shot.ok&&shot.path){fs.copyFileSync(shot.path,path.join(output,'startup-window.png'));report.startup_screenshot=path.join(output,'startup-window.png')}save()}catch{}},20000)
const watched=process.argv.filter(value=>value.startsWith('--watch-pid=')).map(value=>Number(value.split('=')[1]))
for(const pid of watched){if(!Number.isSafeInteger(pid)||pid<=0)throw new Error('Invalid watched PID');process.kill(pid,0)}
const monitor=setInterval(()=>{for(const pid of watched)try{process.kill(pid,0)}catch{abort.abort(new Error('Watched ChatGPT process exited'));}},1000)
function fixtureEvents(){try{return fs.readFileSync(events,'utf8').split('\n').slice(0,-1).filter(Boolean).map(line=>JSON.parse(line))}catch{return []}}
async function waitEvent(name,text){const deadline=Date.now()+7000;do{const match=fixtureEvents().find(event=>event.session===report.child_session&&event.name===name&&(text===undefined||event.detail?.text===text));if(match)return match;if(abort.signal.aborted)throw abort.signal.reason;await new Promise(resolve=>setTimeout(resolve,100))}while(Date.now()<deadline);throw new Error('Fixture did not confirm '+name)}
function requireOk(value,label){if(value?.ok!==true)throw new Error(label+': '+JSON.stringify(value));return value}
const act=async(action,args={})=>{
  const deadline=Date.now()+15000
  do {
    const result=requireOk(await desktop.execute(action,{dispatch:'foreground',overlay:false,status_pill:false,control_session_id:instance,...args},abort.signal),action)
    // A screenshot can succeed while input changes during its capture. Honor
    // the helper's explicit reobserve flag before using its element snapshot.
    // Only observations repeat; an uncertain mutation is never replayed.
    if(action!=='get_window_state'||result.needs_observation!==true)return result
    report.input_reobservations=(report.input_reobservations||0)+1;save()
    await new Promise(resolve=>setTimeout(resolve,100))
  } while(Date.now()<deadline&&!abort.signal.aborted)
  throw new Error('No stable input observation within the test budget')
}
function element(state,name){const found=state.elements?.filter(value=>value.name===name&&value.enabled!==false)||[];if(!state.snapshot_id||found.length!==1)throw new Error('Expected unique fixture element '+name);return found[0]}
try {
  report.hold_temporarily_released=hadHold;if(hadHold)report.hold_backup=backup;save()
  if(hadHold)fs.renameSync(hold,backup)
  let ready=await desktop.command(process.argv.includes('--windows-login')?'login':'open',{},abort.signal)
  if(ready.ok!==true&&process.argv.includes('--keep-open-on-worker-error')){
    let state=await desktop.command('status')
    if(state.connected&&state.startup_isolation_ready&&!state.worker_ready){
      report.status='worker_error_waiting';report.owned_window=state;save();console.log(JSON.stringify({waiting_for_worker_debug:true,host_pid:state.host_pid,child:state.windows_session_id}))
      while(state.connected&&!state.worker_ready&&!abort.signal.aborted){await new Promise(resolve=>setTimeout(resolve,500));state=await desktop.command('status',{},abort.signal)}
      if(state.worker_ready){ready=state;report.status='incomplete'}
    }
  }
  ready=requireOk(ready,'open')
  if(ready.state==='needs_preparation')ready=requireOk(await desktop.command('prepare',{},abort.signal),'prepare')
  if(!ready.worker_ready||!ready.connected||!Number.isInteger(ready.windows_session_id)||ready.windows_session_id<=0||ready.windows_session_id===ready.parent_windows_session_id)throw new Error('No distinct ready child session')
  report.child_session=ready.windows_session_id;report.parent_session=ready.parent_windows_session_id
  check('child_worker_startup',ready)
  // The helper can be ready before Windows finishes this user's startup apps.
  // Let those apps settle; keep input guards enabled throughout the test.
  await new Promise(resolve=>setTimeout(resolve,15000))
  if(process.argv.includes('--probe-input-desktop')) {
    report.desktop_samples=[];const started=Date.now();let previous=''
    do {
      const value=await act('list_displays',{diagnostic_desktop:true})
      const sample={elapsed_ms:Date.now()-started,input_desktop_ready:value.input_desktop_ready,desktop_status:value.desktop_status}
      report.desktop_samples.push(sample);save()
      const serialized=JSON.stringify(sample.desktop_status)
      if(serialized!==previous){console.log(JSON.stringify({event:'input_desktop_sample',...sample}));previous=serialized}
      await new Promise(resolve=>setTimeout(resolve,500))
    }while(Date.now()-started<20000&&!abort.signal.aborted)
    if(report.desktop_samples[0]?.input_desktop_ready!==true)throw new Error('Worker announced ready before the helper input desktop was ready')
    check('input_desktop_ready_at_worker_ready',{})
  } else {
  const startupView=await desktop.command('preview_snapshot',{},abort.signal)
  if(startupView.ok&&startupView.path){fs.copyFileSync(startupView.path,path.join(output,'ready-window.png'));report.ready_screenshot=path.join(output,'ready-window.png');save()}
  if(process.argv.includes('--probe-missing-app')){
    const started=Date.now()
    const missing=await desktop.execute('launch_app',{dispatch:'background',focus_policy:'never',overlay:false,status_pill:false,control_session_id:instance,name:'win-pilot-missing-'+instance+'.exe'},abort.signal)
    if(missing.ok!==false||missing.error_code==='task_desktop_timeout'||Date.now()-started>=10000)throw new Error('Missing application did not fail promptly: '+JSON.stringify(missing))
    requireOk(await desktop.execute('list_displays',{control_session_id:instance},abort.signal),'observation after missing app')
    check('missing_app_fails_without_blocking_worker',{elapsed_ms:Date.now()-started,message:missing.message})
  }
  const launched=await desktop.execute('launch_app',{dispatch:'background',focus_policy:'never',overlay:false,status_pill:false,control_session_id:instance,name:`"${fixture}" --host-test ${instance} --session ${report.child_session} --parent-session ${report.parent_session} --events "${events}"`},abort.signal)
  // An explicitly completed launch must be observed, never launched again merely
  // because Windows declined foreground activation during shell startup.
  const observeLaunch=launched.launch_succeeded===true&&launched.error_code==='foreground_activation_unconfirmed'||launched.error_code==='user_input_interrupted'&&Number.isInteger(launched.pid)&&launched.pid>0
  if(launched.ok!==true&&!observeLaunch)requireOk(launched,'launch_app')
  if(launched.ok!==true)report.launch_observation_required={error_code:launched.error_code,pid:launched.pid}
  if(!Number.isInteger(launched.pid)||launched.pid<=0)throw new Error('No fixture PID returned')
  const app=String(launched.pid);report.fixture_pid=launched.pid
  await waitEvent('shown');check('fixture_shown',{pid:launched.pid})
  let observation=await act('get_window_state',{app,screenshot:true,include_text:true})
  if(observation.screenshot?.path){fs.copyFileSync(observation.screenshot.path,path.join(output,'fixture-before.png'));check('fixture_screenshot',{path:path.join(output,'fixture-before.png')})}
  let target=element(observation,'Fixture input')
  await act('click',{app,element:target.index,snapshot_id:observation.snapshot_id})
  const text='host-test-'+instance
  await act('type_text',{app,text});await waitEvent('text_changed',text);check('text_input',{text})
  observation=await act('get_window_state',{app,screenshot:false,include_text:true});target=element(observation,'Fixture increment')
  await act('click',{app,element:target.index,snapshot_id:observation.snapshot_id});await waitEvent('clicked');check('button_click',{})
  requireOk(await desktop.command('pause',{},abort.signal),'pause')
  const refused=await desktop.execute('type_text',{app,text:'-MUST-NOT-APPEAR'},abort.signal)
  if(refused.ok!==false||refused.error_code!=='task_desktop_paused'||refused.actionSent!==false)throw new Error('Paused input was not refused')
  await act('get_window_state',{app,screenshot:false,include_text:true});check('pause_refuses_input_allows_observation',{})
  const takeover=requireOk(await desktop.command('takeover',{},abort.signal),'takeover')
  if(!takeover.takeover||!takeover.paused)throw new Error('Manual takeover did not pause the agent')
  const takeoverRefused=await desktop.execute('type_text',{app,text:'-TAKEOVER-MUST-NOT-APPEAR'},abort.signal)
  if(takeoverRefused.ok!==false||takeoverRefused.error_code!=='task_desktop_paused')throw new Error('Agent input was allowed during takeover')
  check('takeover_refuses_agent_input',{})
  requireOk(await desktop.command('resume',{},abort.signal),'resume')
  observation=await act('get_window_state',{app,screenshot:false,include_text:true});target=element(observation,'Fixture input')
  await act('click',{app,element:target.index,snapshot_id:observation.snapshot_id});await act('press_key',{app,key:'End'});await act('type_text',{app,text:'-resumed'});await waitEvent('text_changed',text+'-resumed');check('resume_input',{})
  observation=await act('get_window_state',{app,screenshot:true,include_text:true})
  if(observation.screenshot?.path)fs.copyFileSync(observation.screenshot.path,path.join(output,'fixture-after.png'))
  for(const pid of watched)process.kill(pid,0)
  check('watched_chatgpt_processes_alive',{pids:watched})
  const reused=requireOk(await desktop.command('login',{},abort.signal),'reuse ready desktop')
  if(!reused.worker_ready||reused.windows_session_id!==report.child_session||reused.host_pid!==report.host_pid)throw new Error('Desktop reuse changed the existing session')
  check('reuse_without_another_windows_logon',{host_pid:reused.host_pid,child:reused.windows_session_id})
  }
  report.status='pass'
  if(process.argv.includes('--keep-open-after-pass')){
    report.status='pass_waiting_for_window_close';save();console.log(JSON.stringify({tests_passed:true,window_kept_open:true,host_pid:report.host_pid,child:report.child_session}))
    clearInterval(deadline)
    await desktop.waitForClose(abort.signal)
    report.status='pass'
  }
} catch(error){
  report.status='fail';report.error=String(error?.stack||error);console.log(JSON.stringify({error:report.error}));process.exitCode=1
}
finally {
  clearTimeout(startupCapture)
  try{await desktop.close();report.cleanup_confirmed=true}catch(error){report.cleanup_confirmed=false;report.cleanup_error=error.message;report.status='fail';process.exitCode=1}
  try{for(const pid of watched)process.kill(pid,0);report.watched_processes_alive_after_cleanup=true}catch(error){report.watched_processes_alive_after_cleanup=false;report.status='fail';process.exitCode=1;report.watch_error=error.message}
  clearInterval(monitor)
  clearInterval(deadline)
  process.stdin.pause()
  if(fs.existsSync(backup)&&!fs.existsSync(hold))fs.renameSync(backup,hold)
  report.hold_restored=fs.existsSync(hold);report.finished_at=new Date().toISOString();save()
  console.log(JSON.stringify({status:report.status,cleanup_confirmed:report.cleanup_confirmed,hold_restored:report.hold_restored,report:path.join(output,'report.json')}))
}
