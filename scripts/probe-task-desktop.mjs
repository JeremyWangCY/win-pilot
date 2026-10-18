import {spawn} from 'node:child_process'
import fs from 'node:fs'
import {randomUUID} from 'node:crypto'
import {fileURLToPath} from 'node:url'
if(fs.existsSync(new URL('../lib/task-desktop/safety-hold.json',import.meta.url))) {
  throw new Error('Live task-desktop tests are stopped because they may close the main ChatGPT app. Repair startup isolation before removing this hold.')
}
const child=spawn(fileURLToPath(new URL('../lib/task-desktop/win-pilot-task-desktop.exe',import.meta.url)),['--stdio','--instance-id',randomUUID()],{stdio:['pipe','pipe','pipe'],windowsHide:true})
const stream=fs.createWriteStream(new URL('../reports/task-desktop-host-probe.log',import.meta.url))
child.stdout.on('data',chunk=>{stream.write(chunk);process.stdout.write(chunk)})
child.stderr.on('data',chunk=>{stream.write(chunk);process.stderr.write(chunk)})
child.on('exit',(code,signal)=>{console.log({code,signal});stream.end()})
setTimeout(()=>child.stdin.write(JSON.stringify({id:'status',command:'status'})+'\n'),1500)
setTimeout(()=>child.stdin.write(JSON.stringify({id:'open',command:'open'})+'\n'),2500)
setTimeout(()=>child.stdin.write(JSON.stringify({id:'status-later',command:'status'})+'\n'),12000)
setTimeout(()=>child.stdin.write(JSON.stringify({id:'preview',command:'preview_snapshot'})+'\n'),20000)
setTimeout(()=>{child.stdin.write(JSON.stringify({id:'close',command:'close'})+'\n')},65000).unref()
