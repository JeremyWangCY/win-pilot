import fs from 'node:fs'
import {fileURLToPath} from 'node:url'
import {createTaskDesktopProvider} from '../lib/task-desktop.js'

// Render only the native window's own controls. The immutable --preview mode
// refuses Windows-session creation even if the connection hold is absent.
const desktop=createTaskDesktopProvider()
try {
  const shown=await desktop.command('preview')
  if(!shown.ok||shown.preview_only!==true||shown.connected||shown.worker_ready)throw new Error(shown.message||'Expected a disconnected preview window')
  const refusals=[]
  for(const command of ['open','prepare']) {
    const refused=await desktop.command(command)
    if(refused.ok!==false||refused.error_code!=='task_desktop_preview_only')throw new Error(`Native preview did not refuse ${command}`)
    refusals.push({command,...refused})
  }
  const unchanged=await desktop.command('status')
  if(unchanged.connected||unchanged.worker_ready||unchanged.windows_session_id!==null)throw new Error('Preview unexpectedly connected')
  const capture=await desktop.command('preview_snapshot')
  if(!capture.ok||!capture.path)throw new Error(capture.message||'Preview capture failed')
  const destination=new URL('../reports/task-desktop-preview.png',import.meta.url)
  fs.copyFileSync(capture.path,destination)
  fs.writeFileSync(new URL('../reports/task-desktop-preview.json',import.meta.url),JSON.stringify({shown,refusals,unchanged,capture,path:fileURLToPath(destination),captured_at:new Date().toISOString()},null,2))
  console.log(JSON.stringify({ok:true,pid:shown.host_pid,preview_only:true,path:fileURLToPath(destination)}))
  if(process.argv.includes('--keep-open'))await desktop.waitForClose()
} finally {
  await desktop.close()
}
