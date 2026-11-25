import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = new URL('..', import.meta.url)
const read = name => fs.readFileSync(new URL(name, root), 'utf8')
const files = {
  'README.md': read('README.md'),
  'README.zh.md': read('README.zh.md'),
  'docs/task-desktop.md': read('docs/task-desktop.md'),
}

const forbidden = [
  'never shown to a remote viewer',
  '不会出现在远程画面',
  'After 10 seconds without manual input',
  '空闲10秒后交还',
  'After 10 seconds without input',
  '空闲10秒且没有按住',
  'automatic manual takeover',
  '展开后自动接管',
]
for (const [name, text] of Object.entries(files)) {
  for (const phrase of forbidden) {
    assert.equal(text.includes(phrase), false, `${name} still claims: ${phrase}`)
  }
}

for (const phrase of ['Hand back', 'Take over', 'heuristic']) {
  assert.ok(files['README.md'].includes(phrase), `README.md must describe ${phrase}`)
  assert.ok(files['docs/task-desktop.md'].includes(phrase), `docs/task-desktop.md must describe ${phrase}`)
}
for (const phrase of ['交还托管', '接管', '启发式']) {
  assert.ok(files['README.zh.md'].includes(phrase), `README.zh.md must describe ${phrase}`)
  assert.ok(files['docs/task-desktop.md'].includes(phrase), `docs/task-desktop.md must describe ${phrase}`)
}

console.log('readme task-desktop contract check PASSED')
