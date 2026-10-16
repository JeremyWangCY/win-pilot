import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createTaskDesktopProvider,getTaskDesktopAvailability} from '../lib/task-desktop.js'

const directory=fs.mkdtempSync(path.join(os.tmpdir(),'win-pilot-availability-'))
const files=['win-pilot-task-desktop.exe','win-pilot-task-desktop.dll','win-pilot-task-desktop.deps.json','win-pilot-task-desktop.runtimeconfig.json','safety-hold.json']
const hostPath=path.join(directory,files[0])
let spawns=0
try {
  let status=getTaskDesktopAvailability({hostPath})
  assert.equal(status.available,false)
  assert.equal(status.host_present,false)
  assert.equal(status.preview_available,false)
  assert.equal(status.missing_files.length,4)
  for(const file of files.slice(0,4))fs.writeFileSync(path.join(directory,file),'fixture only, never execute')
  status=getTaskDesktopAvailability({hostPath})
  assert.equal(status.required_files_present,true)
  assert.equal(status.safety_hold,false)
  assert.equal(status.available,process.platform==='win32')

  // Even invalid JSON must hold: parsing failures may not reopen unsafe startup.
  fs.writeFileSync(path.join(directory,'safety-hold.json'),'not valid JSON')
  assert.equal(getTaskDesktopAvailability({hostPath}).preview_available,process.platform==='win32','preview may show the window without enabling connections')
  const provider=createTaskDesktopProvider({hostPath,spawn(){spawns++;throw new Error('must not start any host')}})
  for(const command of ['open','login','prepare','status']) {
    const result=await provider.command(command)
    assert.equal(result.error_code,'task_desktop_safety_hold')
    assert.equal(result.actionSent,false)
  }
  assert.equal((await provider.command('resume')).error_code,'task_desktop_not_ready')
  assert.equal((await provider.execute('screenshot')).error_code,'task_desktop_safety_hold')
  assert.equal((await provider.execute('type_text',{text:'must not dispatch'})).error_code,'task_desktop_safety_hold')
  assert.equal((await provider.execute('stop')).ok,true)
  await provider.close()
  assert.equal(spawns,0,'safety hold must prevent the native process boundary entirely')
} finally {
  for(const file of files){const target=path.join(directory,file);if(fs.existsSync(target))fs.unlinkSync(target)}
  fs.rmdirSync(directory)
}
console.log('task desktop availability and no-spawn safety hold check PASSED')
