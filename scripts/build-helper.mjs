import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const names = ['bootstrap', 'observation', 'background-input', 'capture', 'dispatch']
const nativeDir = path.join(root, 'native/helper')
const target = path.join(root, 'lib/win-pilot-helper.ps1')
const packaged = !fs.existsSync(path.join(nativeDir, 'bootstrap.ps1'))
if (packaged) {
  if (process.argv.includes('--check')) {
    console.log('build-helper: native/helper sources not packaged; skip bundle staleness check')
    process.exit(0)
  }
  console.error('build-helper: native/helper sources not packaged; cannot rebuild helper')
  process.exit(1)
}
// Windows PowerShell 5.1 treats UTF-8 .ps1 files without a BOM as the active ANSI code page.
// The helper contains intentional Unicode source text, so emit UTF-8 with BOM to make parsing deterministic on every Windows host.
const output = '\uFEFF' + names.map(name => fs.readFileSync(path.join(nativeDir, `${name}.ps1`), 'utf8').replace(/^\uFEFF/, '')).join('')
// Line endings are compared normalized. `core.autocrlf=true` (the default on
// Windows checkouts) rewrites the committed bundle to CRLF while a fresh
// generation emits LF, and a source file that arrived with mixed endings can
// round-trip differently again — none of which is a real staleness signal. Only
// a content difference fails the check.
const normalizeEol = (text) => text.replace(/\r\n/g, '\n')
if (process.argv.includes('--check')) {
  if (normalizeEol(fs.readFileSync(target, 'utf8')) !== normalizeEol(output)) {
    throw new Error('Helper bundle stale: run npm run build:helper')
  }
} else fs.writeFileSync(target, output)
