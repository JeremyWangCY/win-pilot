import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { copyTree } from '../lib/fs-copy.js'

// Regression guard for a Windows-only process abort: `fs.cpSync` terminates the
// host with 0xC0000409 when the source path contains non-ASCII characters, so the
// failure cannot be caught and the plugin dies on its first computer action. A
// localized profile (C:\Users\<中文名>\.dsh) is a normal install location, so the
// recursive copy must never come back.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

function collect(directory, base = directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) collect(full, base, found)
    else found.push({ relative: path.relative(base, full), bytes: fs.readFileSync(full, 'utf8') })
  }
  return found.sort((a, b) => a.relative.localeCompare(b.relative))
}

// 1. A tree whose source path contains non-ASCII characters copies completely.
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'win-pilot-中文-路径-' + randomUUID().slice(0, 8) + '-'))
try {
  const source = path.join(workspace, '中文源目录', '嵌套')
  fs.mkdirSync(path.join(source, '深层'), { recursive: true })
  fs.writeFileSync(path.join(source, 'a.txt'), 'alpha')
  fs.writeFileSync(path.join(source, '深层', '说明.md'), '内容')
  const target = path.join(workspace, '目标')
  copyTree(path.join(workspace, '中文源目录'), target)

  const copied = collect(target)
  const expected = [path.join('嵌套', 'a.txt'), path.join('嵌套', '深层', '说明.md')].sort((a, b) => a.localeCompare(b))
  assert.deepEqual(copied.map(item => item.relative), expected)
  assert.deepEqual(copied.map(item => item.bytes).sort(), ['alpha', '内容'].sort())
  // Copying is non-destructive: the source tree is still intact.
  assert.equal(fs.readFileSync(path.join(source, 'a.txt'), 'utf8'), 'alpha')
} finally {
  fs.rmSync(workspace, { recursive: true, force: true })
}

// 2. Nothing in the shipped code may call the aborting API again.
const offenders = []
for (const directory of ['lib', 'scripts']) {
  const walk = where => {
    for (const entry of fs.readdirSync(where, { withFileTypes: true })) {
      const full = path.join(where, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!entry.name.endsWith('.js') && !entry.name.endsWith('.mjs')) continue
      const text = fs.readFileSync(full, 'utf8')
      for (const line of text.split('\n')) {
        // Comments name the hazard on purpose; only a real call is a regression.
        if (/^\s*(\/\/|\*)/.test(line)) continue
        if (/\bfs\.cpSync\s*\(/.test(line)) offenders.push(path.relative(root, full) + ': ' + line.trim())
      }
    }
  }
  walk(path.join(root, directory))
}
assert.deepEqual(offenders, [], 'fs.cpSync aborts the host on non-ASCII Windows paths; use copyTree instead:\n' + offenders.join('\n'))

console.log('unicode path copy check PASSED (real Chinese path, no fs.cpSync in shipped code)')
