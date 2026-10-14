// Chromium text read: the helper must not die reading a real selection.
//
// Covers a fatal defect. On Chromium/Electron windows the TextPatternRange from
// TextPattern.GetSelection() has a broken native handle; calling GetText on it
// access-violates inside MS.Internal.Automation.UiaCoreApi.RawTextRange_GetText
// (0xC0000005) and kills the helper process. A native access violation is not a
// managed exception, so the try/catch that wrapped the call could never catch it.
//
// The heavy lifting is in the PowerShell fixture, which owns a real Chromium
// window, lets the page make a non-empty selection, and asserts the read
// survives AND still returns the selected text. An empty selection does not
// crash, so a fixture without the selection step would pass vacuously — that
// mistake was made and caught while writing this test.
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { stopDaemon } from '../lib/index.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const helperSource = readFileSync(path.join(root, 'lib', 'win-pilot-helper.ps1'), 'utf8')

// --- static contract ------------------------------------------------------

// The exact call that crashes must not exist. Strip comment lines first, since
// the fix documents the defect in a comment that names the old call.
// NOTE: the helper also contains an unrelated bare-enum reference in prose, so
// comments must go before any pattern test.
const codeOnly = helperSource
  .split(/\r?\n/)
  .filter((line) => !line.trimStart().startsWith('#'))
  .filter((line) => !line.trimStart().startsWith('//'))
  .join('\n')
assert.ok(!/selection\[0\]\.GetText\(/.test(codeOnly),
  'GetText must never be called on the selection range object: that is the 0xC0000005 crash')
assert.ok(codeOnly.includes('MoveEndpointByRange'),
  'the selection must be read through a DocumentRange clone whose endpoints were moved')

// The endpoint enum lives in the Text namespace; a wrong path throws at runtime
// and is swallowed by the surrounding catch, silently returning no text. This is
// exactly how the first version of the fix was broken while "not crashing".
//
// NOTE: the bare `System.Windows.Automation.TextPatternRangeEndpoint` is a
// SUBSTRING of the correct `...Automation.Text.TextPatternRangeEndpoint`, so a
// naive substring test cannot tell them apart. Match the wrong form only when it
// is not immediately preceded by `Text.`.
assert.ok(!/(?<!Text\.)\[System\.Windows\.Automation\.TextPatternRangeEndpoint\]/.test(codeOnly),
  'the endpoint enum must be System.Windows.Automation.Text.TextPatternRangeEndpoint ' +
  '(without the .Text segment the call throws and the selection silently reads as empty)')
assert.ok(codeOnly.includes('[System.Windows.Automation.Text.TextPatternRangeEndpoint]::Start'),
  'the DocumentRange clone must move its Start endpoint onto the selection')

// --- live behaviour -------------------------------------------------------

// Interactive desktop tests must be explicitly enabled. Never open browser
// windows as a side effect of an ordinary npm test run.
if (process.env.WIN_PILOT_INTERACTIVE_TESTS !== '1') {
  console.log('text read static checks PASSED; live Chromium test SKIPPED (set WIN_PILOT_INTERACTIVE_TESTS=1)')
  stopDaemon()
  process.exit(0)
}

// Run the fixture. A crash inside it is reported as a non-zero exit and its
// FAIL lines are surfaces in the assertion message.
const fixture = path.join(root, 'test', 'fixtures', 'text-read-chromium.ps1')
let output = ''
let exitCode = 0
try {
  output = execFileSync('pwsh', ['-NoLogo', '-NoProfile', '-File', fixture], {
    encoding: 'utf8', windowsHide: true, timeout: 180000,
  })
} catch (error) {
  exitCode = error.status ?? 1
  output = `${error.stdout ?? ''}${error.stderr ?? ''}`
}

if (/^SKIP:/m.test(output.trim())) {
  // No Chromium binary or the fixture window never appeared: report loudly rather
  // than passing silently, so a skipped run is visible in the log.
  console.log(`text read check SKIPPED: ${output.trim().split('\n')[0]}`)
  stopDaemon()
  process.exit(0)
}

assert.equal(exitCode, 0,
  `the Chromium text-read fixture must pass:\n${output.trim()}`)
assert.match(output, /TEXT_READ_FIXTURE_OK/,
  `the fixture must report success:\n${output.trim()}`)

// The fixture refuses to pass without an observable selection, which is what
// proves the crash path was actually exercised.
assert.match(output, /selectedLen=(?:[1-9]\d*)/,
  `the fixture must read a non-empty selection:\n${output.trim()}`)

stopDaemon()
console.log('text read check PASSED')
