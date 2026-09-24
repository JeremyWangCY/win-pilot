import assert from 'node:assert/strict'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const overlayPath = path.join(rootDir, 'lib', 'virtual-cursor-overlay.ps1')
const psExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

const output = execFileSync(psExe, [
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', overlayPath,
  '-TransitionSample', '100,100,500,300,320',
], { encoding: 'utf8', timeout: 30000 }).trim()

const points = JSON.parse(output)
assert.ok(points.length >= 10, 'a visible transition should contain multiple intermediate positions')
assert.deepEqual(points[0], { x: 100, y: 100 }, 'transition starts at the current pointer position')
assert.deepEqual(points.at(-1), { x: 500, y: 300 }, 'transition lands exactly on the requested target')
assert.ok(points.some(({ x, y }) => x > 100 && x < 500 && y > 100 && y < 300), 'transition contains an intermediate position')
for (let index = 1; index < points.length; index += 1) {
  assert.ok(points[index].x >= points[index - 1].x, 'x movement must not reverse')
  assert.ok(points[index].y >= points[index - 1].y, 'y movement must not reverse')
}
console.log('cursor-transition check PASSED')
