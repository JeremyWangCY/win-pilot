import assert from 'node:assert/strict'
import fs from 'node:fs'

const root = new URL('..', import.meta.url)
const read = name => fs.readFileSync(new URL(name, root), 'utf8')
const pkgText = read('package.json')
const pkg = JSON.parse(pkgText)

const verify = [
  'npm run test:desktop',
  'dotnet run --project native/task-desktop-tests/task-desktop-tests.csproj -c Release',
  'dotnet run --project native/task-desktop-ui-tests/task-desktop-ui-tests.csproj -c Release -- artifacts/floating-window/layout',
  'npm test',
].join(' && ')
assert.equal(pkg.scripts.verify, verify, 'verify must be the single full gate shared by CI and publish')
assert.ok(
  pkgText.includes('node test/latency.check.mjs"'),
  'latency check must stay the last npm test file',
)

const ci = read('.github/workflows/ci.yml')
const publish = read('.github/workflows/publish.yml')
for (const [name, text] of [['ci.yml', ci], ['publish.yml', publish]]) {
  assert.match(text, /^ {4}runs-on: windows-latest$/m, `${name} must stay on windows-latest`)
  assert.match(text, /npm run verify/, `${name} must call the shared verify script`)
  const buildAt = text.indexOf('npm run build:desktop')
  const verifyAt = text.indexOf('npm run verify')
  assert.ok(buildAt >= 0 && verifyAt > buildAt, `${name} must build native components before verify`)
  for (const inlined of ['test:desktop', 'task-desktop-ui-tests', 'task-desktop-tests', 'npm test']) {
    assert.equal(text.includes(inlined), false, `${name} must not inline ${inlined}; the list lives only in package.json`)
  }
}

assert.match(ci, /pull_request:[\s\S]*branches:[\s\S]*- main/, 'CI must still run on pull requests to main')
assert.match(publish, /tags:[\s\S]*- 'v\*'/ , 'publish must still trigger on v* tags')
assert.match(publish, /id-token:\s*write/, 'publish must keep OIDC id-token: write')
assert.match(publish, /does not match package version/, 'publish must still reject a tag that disagrees with package.json')
assert.equal(publish.includes('registry-url'), false, 'setup-node must not inject a registry token over OIDC')
const publishCommand = publish.split('\n').find(line => line.includes('npm publish'))
assert.equal(publishCommand.trim(), 'run: npm publish --access public --provenance')
assert.equal(publish.includes('loglevel'), false, 'publish diagnostics verbose logging must stay removed')
assert.equal(publish.includes('verbose'), false, 'publish diagnostics verbose logging must stay removed')

console.log('workflow gate check PASSED')
