import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { createMcpServer, runMcpStdio } from '../lib/mcp-server.js'
import { createWinPilotRuntime } from '../lib/runtime.js'
import { createBrowserProvider } from '../lib/browser-provider.js'
import { applyConfigSnapshot } from '../lib/settings.js'
import { randomUUID } from 'node:crypto'
import { controlCoordinator, createControlCoordinator } from '../lib/control-session.js'
Object.assign(controlCoordinator,createControlCoordinator({lockName:`\\\\.\\pipe\\win-pilot-mcp-test-${randomUUID()}`}))
applyConfigSnapshot({overlay:false,statusPill:false})

let started
const ready=new Promise(resolve=>{started=resolve})
const provider=createBrowserProvider({execute:(action,args,signal)=>new Promise((resolve,reject)=>{
  started();signal.addEventListener('abort',()=>reject(Object.assign(new Error('cancelled after sending'),{outcome:'unknown'})),{once:true})
})})
const runtime=createWinPilotRuntime({browserProvider:provider})
const server=createMcpServer({runtime})
try {
  const request=server.handle({jsonrpc:'2.0',id:71,method:'tools/call',params:{name:'computer',arguments:{action:'browser_navigate'}}})
  await ready
  await server.handle({jsonrpc:'2.0',method:'notifications/cancelled',params:{requestId:71}})
  const response=await request
  assert.equal(response.result.structuredContent.outcome,'unknown')
  assert.equal(response.result.structuredContent.actionSent,true)
} finally {await server.close()}

// Stop must be parsed while an earlier tools/call is still pending on stdin.
const stdin=new PassThrough(), stdout=new PassThrough(), stderr=new PassThrough()
let release, firstSeen, stopSeen=false
const firstReady=new Promise(resolve=>{firstSeen=resolve})
const blocking=new Promise(resolve=>{release=resolve})
const responses=[]
stdout.on('data',data=>{for(const line of String(data).trim().split('\n'))if(line)responses.push(JSON.parse(line))})
const running=runMcpStdio({stdin,stdout,stderr,server:{
  async handle(message){
    if(message.params?.arguments?.action==='stop'){
      stopSeen=true;release();return{jsonrpc:'2.0',id:2,result:{stopped:true}}
    }
    firstSeen();await blocking;return{jsonrpc:'2.0',id:1,result:{cancelled:true}}
  },close(){release()},
}})
stdin.write(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{arguments:{action:'browser_navigate'}}})+'\n')
await firstReady
stdin.write(JSON.stringify({jsonrpc:'2.0',id:2,method:'tools/call',params:{arguments:{action:'stop'}}})+'\n')
let timeout
try {
  await Promise.race([blocking,new Promise((resolve,reject)=>{timeout=setTimeout(()=>reject(new Error('stdin dispatcher blocked stop behind the active action')),1000)})])
  assert.equal(stopSeen,true)
  stdin.end();assert.equal(await running,0)
  assert.deepEqual(responses.map(r=>r.id).sort(),[1,2])
} finally {clearTimeout(timeout);release();stdin.end();await running}
console.log('PASS: MCP request cancellation and stop delivery during an active stdin request')
