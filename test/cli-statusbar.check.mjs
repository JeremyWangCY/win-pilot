import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { once } from 'node:events'

const root = fileURLToPath(new URL('../', import.meta.url))
for (const request of [{ action: 'list_windows' }, { action: 'wait', duration_s: 8 }]) {
  const done = path.join(os.tmpdir(), `win-pilot-cli-pill-${process.pid}-${Date.now()}`)
  const observer = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(root, 'test/fixtures/statusbar-observer.ps1'), '-ActionDonePath', done],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('status observer startup timed out')), 10000)
      observer.stdout.on('data', data => { output += data; if (output.includes('READY')) { clearTimeout(timer); resolve() } })
      observer.once('error', reject)
    })
    const cli = spawn(process.execPath, ['bin/win-pilot.js', 'request', '--payload',
      JSON.stringify(request), '--json'], { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let response = ''
    cli.stdout.on('data', data => { response += data })
    assert.equal((await once(cli, 'exit'))[0], 0, response)
    assert.equal(JSON.parse(response).ok, true)
    fs.writeFileSync(done, 'done')
    await once(observer, 'exit')
    const report = JSON.parse(output.trim().split(/\r?\n/).at(-1))
    assert.equal(report.seen, true, 'a real one-shot CLI observation must display the running pill')
    assert.equal(report.hidden_during_action, false, 'the running pill must remain visible throughout long actions')
    assert.equal(report.hidden_after, true, 'the running pill must expire after the CLI exits')
    console.log('CLI observation status pill check PASSED: ' + JSON.stringify(report))
  } finally {
    if (observer.exitCode === null) observer.kill()
    fs.rmSync(done, { force: true })
  }
}
