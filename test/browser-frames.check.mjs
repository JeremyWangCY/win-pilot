import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { once } from 'node:events'
import { browserAction, releaseBrowserSession } from '../lib/browser-session.js'
import { createWinPilotRuntime } from '../lib/runtime.js'
import { controlCoordinator, createControlCoordinator } from '../lib/control-session.js'
import { randomUUID } from 'node:crypto'
Object.assign(controlCoordinator,createControlCoordinator({lockName:`\\\\.\\pipe\\win-pilot-frames-test-${randomUUID()}`}))

const edge = process.env.EDGE_PATH || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
assert.ok(existsSync(edge), 'Set EDGE_PATH to an isolated Chromium executable')
let mutationCount = 0
let mutationAbortController
const servers = []
const server = http.createServer(async (req, res) => {
  if (req.url === '/slow') { mutationCount++; setTimeout(() => mutationAbortController?.abort(), 50); setTimeout(() => res.end('done'), 2000); return }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  if (req.url.startsWith('/frame')) {
    res.end(`<input aria-label="Frame editor"><button id="hit">Frame hit</button><script>
      hit.onclick=e=>hit.textContent=e.isTrusted?'Trusted frame hit':'DOM frame hit';
      const host=document.createElement('div');document.body.append(host);host.attachShadow({mode:'open'}).innerHTML='<input aria-label="Frame shadow">';
    </script>`)
    return
  }
  res.end(`<input aria-label="Main editor"><button id="choose">Choose hidden file</button>
    <input id="file" type="file" hidden><output id="selected"></output>
    <iframe title="Same origin" src="/frame" style="margin:50px;width:450px;height:200px"></iframe>
    <iframe title="Cross origin" src="http://localhost:${servers[1].address().port}/frame"></iframe>
    <iframe title="Sandbox" sandbox="allow-scripts" src="/frame"></iframe><script>
      choose.onclick=()=>file.click();file.onchange=()=>selected.textContent=file.files[0]?.name||'';
    </script>`)
})
const foreign = http.createServer((req, res) => { res.end('<button>Foreign button</button>') })
servers.push(server, foreign)
for (const s of servers) { s.listen(0); await once(s, 'listening') }
const profile = await mkdtemp(path.join(tmpdir(), 'win-pilot-frames-'))
const upload = path.join(profile, 'chooser-fixture.txt')
await writeFile(upload, 'chooser fixture')
let child, endpoint
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function eventually(fn) { let last; for (let i=0;i<100;i++) { try { return await fn() } catch(e) { last=e; await delay(100) } } throw last }
try {
  child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--site-per-process', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide:true, stdio:'ignore' })
  let launchError; child.on('error', error=>{launchError=error})
  const portFile = await eventually(async()=>{if(launchError)throw launchError; return readFile(path.join(profile,'DevToolsActivePort'),'utf8')})
  const [port,socketPath]=portFile.trim().split(/\r?\n/)
  endpoint=`ws://127.0.0.1:${port}${socketPath}`
  const opened=await browserAction('browser_open',{browser_endpoint:endpoint,url:`http://127.0.0.1:${server.address().port}/`})
  const args={browser_endpoint:endpoint,tab_id:opened.tab_id,command_timeout_ms:10000}
  const action=(name,extra={},signal)=>browserAction(name,{...args,...extra},signal)
  const get=(state,name)=>{const item=state.elements.find(item=>item.name===name);assert.ok(item,`missing ${name}`);return item}
  const main=await eventually(async()=>{const s=await action('browser_state');get(s,'Choose hidden file');return s})
  const listing=await eventually(async()=>{const s=await action('browser_frames');assert.ok(s.frames.length>=4);return s})
  const frame=listing.frames.find(frame=>frame.url.endsWith('/frame')&&frame.supported)
  assert.ok(frame)
  const unsupported=listing.frames.filter(frame=>!frame.supported)
  assert.ok(listing.capabilities.cross_origin_frames===false && listing.capabilities.oopif===false,'Cross-origin and OOPIF support must not be advertised')
  assert.ok(unsupported.length>=2,'cross-origin and opaque sandbox frame owners must be explicit unsupported')
  for (const item of unsupported) await assert.rejects(action('browser_state',{frame_id:item.frame_id}), /Cross-origin or OOPIF|frame_id not found/)
  const childState=await action('browser_state',{frame_id:frame.frame_id})
  get(childState,'Frame shadow')
  assert.ok(!main.elements.some(item=>item.name==='Frame editor'),'main observation must not pretend to include child controls')
  assert.notEqual(get(main,'Main editor').ref,get(childState,'Frame editor').ref,'refs stay unique across frames')
  await action('browser_replace',{element:get(childState,'Frame editor').ref,text:'child text'})
  const edited=await action('browser_state',{frame_id:frame.frame_id,include_editable_text:true})
  assert.equal(get(edited,'Frame editor').value_preview,'child text')
  assert.equal(get(await action('browser_state',{include_editable_text:true}),'Main editor').value_preview,'')
  await action('browser_click',{element:get(edited,'Frame hit').ref,trusted_input:true})
  const hit=await action('browser_read',{frame_id:frame.frame_id})
  assert.match(hit.text,/Trusted frame hit/,'frame trusted click must use top viewport coordinates')
  await action('browser_replace',{element:get(edited,'Frame shadow').ref,text:'shadow text'})
  const old=get(edited,'Frame editor').element
  await action('browser_navigate',{frame_id:frame.frame_id,url:`http://127.0.0.1:${server.address().port}/frame-next`})
  await eventually(async()=>{const s=await action('browser_state',{frame_id:frame.frame_id});assert.equal(s.frame_url,`http://127.0.0.1:${server.address().port}/frame-next`);return s})
  await assert.rejects(action('browser_type',{element:old,text:'must not type'}),/Stale/)
  await assert.rejects(action('browser_reload',{frame_id:frame.frame_id}),/requires main frame/)

  const armed=await action('browser_filechooser');assert.equal(armed.armed,true)
  await action('browser_click',{element:get(await action('browser_state'),'Choose hidden file').ref,trusted_input:true})
  const choices=await eventually(async()=>{const s=await action('browser_filechooser');assert.equal(s.filechoosers.length,1);return s})
  const superseded=choices.filechoosers[0].filechooser_id
  await action('browser_click',{element:get(await action('browser_state'),'Choose hidden file').ref,trusted_input:true})
  await assert.rejects(action('browser_upload',{filechooser_id:superseded,files:[upload]}),/Stale/)
  const newest=await action('browser_filechooser');assert.equal(newest.filechoosers.length,1,'observing a superseding chooser must remain possible after stale upload rejection')
  const chooser=newest.filechoosers[0].filechooser_id
  const selected=await action('browser_upload',{filechooser_id:chooser,files:[upload]})
  assert.equal(selected.ok,true)
  assert.match((await action('browser_read')).text,/chooser-fixture.txt/)
  await assert.rejects(action('browser_upload',{filechooser_id:chooser,files:[upload]}),/Stale/)
  await action('browser_click',{element:get(await action('browser_state'),'Choose hidden file').ref,trusted_input:true})
  const staleChoices=await eventually(async()=>{const s=await action('browser_filechooser');assert.equal(s.filechoosers.length,1);return s})
  await action('browser_navigate',{url:`http://127.0.0.1:${server.address().port}/again`})
  await action('browser_wait')
  await assert.rejects(action('browser_upload',{filechooser_id:staleChoices.filechoosers[0].filechooser_id,files:[upload]}),/Stale/)

  const aborted=AbortSignal.abort()
  await assert.rejects(action('browser_open',{url:`http://127.0.0.1:${server.address().port}/`},aborted))
  const waitAbort=new AbortController();setTimeout(()=>waitAbort.abort(),150)
  const before=Date.now()
  await assert.rejects(action('browser_wait',{browser_wait_for:'text',text:'never present',browser_wait_timeout_ms:30000},waitAbort.signal))
  assert.ok(Date.now()-before<2000,'wait abort must not wait for polling timeout')
  const beforeAbortRef=get(await action('browser_state'),'Main editor').element
  const beforeAbortScreenshot=await action('browser_state',{with_screenshot:true})
  const requestAbort=new AbortController();mutationAbortController=requestAbort
  await assert.rejects(action('browser_request',{url:`http://127.0.0.1:${server.address().port}/slow`,method:'POST',allow_mutation:true},requestAbort.signal),error=>error.outcome==='unknown')
  assert.equal(mutationCount,1,'sent mutating request must not be replayed')
  await assert.rejects(action('browser_type',{element:beforeAbortRef,text:'old ref must fail'}),/Stale/)
  if(beforeAbortScreenshot.screenshot) await assert.rejects(action('browser_click_point',{screenshot_id:beforeAbortScreenshot.screenshot.screenshot_id,x:10,y:10}),/Stale/)

  // Real headless CDP fault injection: cancellation immediately after a down
  // send must still submit its matching up with a separate cleanup signal.
  for (const [method,down,up,name,extra] of [
    ['Input.dispatchKeyEvent','keyDown','keyUp','browser_key',{key:'Enter'}],
    ['Input.dispatchMouseEvent','mousePressed','mouseReleased','browser_click',{trusted_input:true}],
  ]) {
    const editor=get(await action('browser_state'),'Main editor')
    const originalSend=WebSocket.prototype.send
    const cancelled=new AbortController(), sent=[]
    WebSocket.prototype.send=function(data){
      const message=JSON.parse(data)
      if(message.method===method) sent.push(message.params.type)
      const value=originalSend.call(this,data)
      if(message.method===method&&message.params.type===down) queueMicrotask(()=>cancelled.abort())
      return value
    }
    try {await assert.rejects(action(name,{element:editor.ref,...extra},cancelled.signal),error=>error.outcome==='unknown')}
    finally {WebSocket.prototype.send=originalSend}
    assert.equal(sent.filter(type=>type===down).length,1,'do not replay down')
    assert.equal(sent.filter(type=>type===up).length,1,'release already dispatched input after cancellation')
  }

  await releaseBrowserSession(undefined)
  const owned={control_session_id:'owner'}
  const isolatedState=await action('browser_state',{...owned,with_screenshot:true})
  const isolatedEditor=get(isolatedState,'Main editor')
  await assert.rejects(action('browser_type',{control_session_id:'other',element:isolatedEditor.element,text:'wrong owner'}),/wrong-session/)
  await assert.rejects(action('browser_type',{control_session_id:'other',element:isolatedEditor.ref,text:'wrong owner'}),/Stale/)
  if(isolatedState.screenshot) await assert.rejects(action('browser_click_point',{control_session_id:'other',screenshot_id:isolatedState.screenshot.screenshot_id,x:10,y:10}),/Stale/)
  await action('browser_state',{control_session_id:'other'})
  await action('browser_replace',{...owned,element:isolatedEditor.ref,text:'right owner'})
  await action('browser_filechooser',owned)
  await assert.rejects(action('browser_filechooser',{control_session_id:'other'}),/another control session/)
  await action('browser_click',{...owned,element:get(await action('browser_state',owned),'Choose hidden file').ref,trusted_input:true})
  const ownedChoices=await eventually(async()=>{const s=await action('browser_filechooser',owned);assert.equal(s.filechoosers.length,1);return s})
  await assert.rejects(action('browser_upload',{control_session_id:'other',filechooser_id:ownedChoices.filechoosers[0].filechooser_id,files:[upload]}),/wrong-session/)
  await action('browser_upload',{...owned,filechooser_id:ownedChoices.filechoosers[0].filechooser_id,files:[upload]})
  const claim=await action('browser_claim_tab',owned)
  await assert.rejects(action('browser_reload'),/claim_id/)
  await assert.rejects(action('browser_reload',{claim_id:claim.claim_id,control_session_id:'other'}),/wrong-session/)
  await action('browser_navigate',{...owned,claim_id:claim.claim_id,url:`http://127.0.0.1:${server.address().port}/finished`})
  await action('browser_wait')
  const finalized=await action('browser_finalize',{...owned,claim_id:claim.claim_id})
  assert.equal(finalized.handed_back,true);assert.equal(finalized.activated,false)
  await assert.rejects(action('browser_reload',{...owned,claim_id:claim.claim_id}),/finalized/)
  const fresh=await action('browser_claim_tab',owned);assert.notEqual(fresh.claim_id,claim.claim_id)
  await action('browser_close',{...owned,claim_id:fresh.claim_id})
  await assert.rejects(action('browser_state'),/tab_id not found/)
  const cleanupTab=await browserAction('browser_open',{browser_endpoint:endpoint,url:`http://127.0.0.1:${server.address().port}/cleanup-check`})
  const cleanupOwner={tab_id:cleanupTab.tab_id,control_session_id:'cleanup-owner'}
  const cleanupClaim=await action('browser_claim_tab',cleanupOwner)
  await action('browser_filechooser',{...cleanupOwner,claim_id:cleanupClaim.claim_id})
  const originalChooserSend=WebSocket.prototype.send
  const cleanupAbort=new AbortController()
  let failedAttachment
  const cleanupMessages=[]
  WebSocket.prototype.send=function(data) {
    const message=JSON.parse(data)
    if(message.method==='Page.setInterceptFileChooserDialog'&&message.params.enabled===false&&!failedAttachment) {
      failedAttachment=message.sessionId
      const value=originalChooserSend.call(this,data)
      queueMicrotask(()=>cleanupAbort.abort())
      return value
    }
    return originalChooserSend.call(this,data)
  }
  try {await assert.rejects(action('browser_finalize',{...cleanupOwner,claim_id:cleanupClaim.claim_id},cleanupAbort.signal),error=>error.outcome==='unknown')}
  finally {WebSocket.prototype.send=originalChooserSend}
  assert.ok(failedAttachment,'fault must interrupt an armed attachment')
  WebSocket.prototype.send=function(data) {cleanupMessages.push(JSON.parse(data));return originalChooserSend.call(this,data)}
  try {await releaseBrowserSession(cleanupOwner.control_session_id)}
  finally {WebSocket.prototype.send=originalChooserSend}
  assert.ok(cleanupMessages.some(message=>message.method==='Page.setInterceptFileChooserDialog'&&message.params.enabled===false&&message.sessionId===failedAttachment),'retry must disable original attachment')
  assert.ok(cleanupMessages.some(message=>message.method==='Target.detachFromTarget'&&message.params.sessionId===failedAttachment),'retry must detach original attachment')
  const cleanupReclaim=await action('browser_claim_tab',cleanupOwner)
  await action('browser_close',{...cleanupOwner,claim_id:cleanupReclaim.claim_id})
  const runtimeA=createWinPilotRuntime(), runtimeB=createWinPilotRuntime()
  try {
    const opened=await runtimeA.act('browser_open',{browser_endpoint:endpoint,url:`http://127.0.0.1:${server.address().port}/close-check`})
    const target={browser_endpoint:endpoint,tab_id:opened.tab_id}
    assert.equal((await runtimeA.act('browser_claim_tab',target)).ok,true)
    await runtimeA.close()
    const reclaim=await runtimeB.act('browser_claim_tab',target)
    assert.equal(reclaim.ok,true,JSON.stringify(reclaim))
    await runtimeB.act('browser_close',{...target,claim_id:reclaim.claim_id})
  } finally {await runtimeA.close();await runtimeB.close()}
  console.log('browser frames, chooser, lifecycle and cancellation check PASSED')
} finally {
  if (endpoint) { try { await browserAction('browser_shutdown',{browser_endpoint:endpoint}) } catch {} }
  child?.kill()
  for (const s of servers) { s.closeAllConnections?.(); s.close() }
  await delay(300)
  await rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>{})
}
