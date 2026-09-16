import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const ignored = new Set(['.git', 'node_modules'])
const textExtensions = new Set(['.js', '.mjs', '.ps1', '.md', '.json', '.yml', '.yaml', '.html', '.cs', '.csproj'])
const legacyPrefix = 'p' + 'c'
const stale = new RegExp(`${legacyPrefix}[-_ ]?pilot|dsh-${legacyPrefix}-pilot|dsh-c` + 'ua|' + `${legacyPrefix}pilot`, 'i')
const failures = []

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue
    const full = path.join(directory, entry.name)
    const relative = path.relative(root, full).replaceAll('\\', '/')
    if (stale.test(entry.name)) failures.push(`${relative}: stale filename`)
    if (entry.isDirectory()) visit(full)
    else if (textExtensions.has(path.extname(entry.name))) {
      const lines = fs.readFileSync(full, 'utf8').split(/\r?\n/)
      lines.forEach((line, index) => {
        if (stale.test(line)) failures.push(`${relative}:${index + 1}: ${line.trim()}`)
      })
    }
  }
}

visit(root)
assert.deepEqual(failures, [], `old branding remains:\n${failures.join('\n')}`)
console.log('branding check PASSED')
