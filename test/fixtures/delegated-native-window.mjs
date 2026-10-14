import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Keep the broker alive until its child exits so process ancestry can be verified.
const child = spawn('powershell.exe', [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
  fileURLToPath(new URL('./native-window.ps1', import.meta.url)),
], { windowsHide: true, stdio: 'ignore' })
child.on('error', () => { process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
