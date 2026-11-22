// Agent-neutral user config file (~/.win-pilot/config.json / WIN_PILOT_CONFIG)
// and `win-pilot config` CLI contract.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  WIN_PILOT_SETTINGS_DEFAULTS as DEFAULTS,
  WIN_PILOT_EDITABLE_SETTING_KEYS as KEYS,
  applyConfigSnapshot,
  enableUserConfigForTest,
  getConfigSummary,
  getSettings,
  getUserConfigPath,
  parseSettingValue,
  readUserConfig,
  resetSettingsForTest,
  resetUserConfig,
  resolveSettingKey,
  setSettingsForTest,
  setUserConfigValue,
  unsetUserConfigValue,
} from '../lib/settings.js'
import { runCli } from '../lib/cli.js'
import { createWinPilotRuntime } from '../lib/runtime.js'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-pilot-config-test-'))
const configPath = path.join(tempDir, 'nested', 'config.json')
const prevConfigEnv = process.env.WIN_PILOT_CONFIG
const prevNoUserConfig = process.env.WIN_PILOT_NO_USER_CONFIG

function captureCli(extraIo = {}) {
  let stdout = ''
  let stderr = ''
  return {
    io: {
      stdout: { write: value => { stdout += value } },
      stderr: { write: value => { stderr += value } },
      configPath,
      ...extraIo,
    },
    stdout: () => stdout,
    stderr: () => stderr,
  }
}

try {
  // 1. Key alias resolution and value parsing.
  assert.equal(resolveSettingKey('browserControl'), 'browserControl')
  assert.equal(resolveSettingKey('browser-control'), 'browserControl')
  assert.equal(resolveSettingKey('browser_control'), 'browserControl')
  assert.equal(resolveSettingKey('DESKTOP-ENVIRONMENT'), 'desktopEnvironment')
  assert.equal(resolveSettingKey('unknownKey'), null)

  assert.equal(parseSettingValue('browser-control', 'true'), true)
  assert.equal(parseSettingValue('browserControl', 'on'), true)
  assert.equal(parseSettingValue('browserControl', '0'), false)
  assert.equal(parseSettingValue('browserControl', 'off'), false)
  assert.equal(parseSettingValue('desktop-environment', 'TASK'), 'task')
  assert.equal(parseSettingValue('remote_control_policy', 'refuse'), 'refuse')
  assert.throws(() => parseSettingValue('browserControl', 'maybe'))
  assert.throws(() => parseSettingValue('desktopEnvironment', 'mars'))
  assert.throws(() => parseSettingValue('maxBatchActions', '10'))

  // 2. Default path and WIN_PILOT_CONFIG override.
  assert.equal(
    getUserConfigPath({ env: {}, home: path.join(tempDir, 'fake-home') }),
    path.join(tempDir, 'fake-home', '.win-pilot', 'config.json'),
  )
  assert.equal(getUserConfigPath({ env: { WIN_PILOT_CONFIG: configPath } }), path.resolve(configPath))

  // 3. Hot-reload via WIN_PILOT_CONFIG without restarting runtime.
  process.env.WIN_PILOT_CONFIG = configPath
  delete process.env.WIN_PILOT_NO_USER_CONFIG
  enableUserConfigForTest()

  assert.equal(getSettings().browserControl, false, 'browserControl must default to false')
  assert.equal(getSettings().desktopEnvironment, 'current')

  const runtime = createWinPilotRuntime()
  try {
    assert.equal(runtime.status().browser_control, 'disabled')
    assert.equal(runtime.status().desktop_environment, 'current')

    // Enable browserControl & switch desktopEnvironment through user config.
    setUserConfigValue('browser-control', 'true')
    setUserConfigValue('desktopEnvironment', 'task')
    setUserConfigValue('ignoreUserInput', 'on')

    assert.equal(getSettings().browserControl, true, 'user config must take effect immediately')
    assert.equal(getSettings().desktopEnvironment, 'task')
    assert.equal(getSettings().ignoreUserInput, true)
    assert.equal(runtime.status().browser_control, 'enabled', 'existing runtime must hot-reload browserControl')
    assert.equal(runtime.status().desktop_environment, 'task', 'existing runtime must hot-reload desktopEnvironment')

    // DSH host snapshot takes precedence over user config, and clearing it falls back to user config.
    applyConfigSnapshot({ browserControl: false, desktopEnvironment: 'current' })
    assert.equal(getSettings().browserControl, false)
    assert.equal(getSettings().desktopEnvironment, 'current')
    applyConfigSnapshot(null)
    assert.equal(getSettings().browserControl, true)
    assert.equal(getSettings().desktopEnvironment, 'task')

    // DSH host snapshot with mirrorToUserConfig syncs live volatile edits to config.json.
    let liveBrowserControl = false
    applyConfigSnapshot({ browserControl: { get: () => liveBrowserControl }, desktopEnvironment: 'current' }, { mirrorToUserConfig: true })
    assert.equal(readUserConfig().values.browserControl, undefined, 'default values are omitted from mirrored config.json')
    liveBrowserControl = true
    assert.equal(getSettings().browserControl, true)
    assert.equal(readUserConfig().values.browserControl, true, 'volatile DSH edit mirrors to config.json for other agents')
    applyConfigSnapshot(null)
    assert.equal(getSettings().browserControl, true, 'mirrored value persists after host snapshot clears')

    // UTF-8 BOM written by Windows Notepad / PowerShell 5.1 parses cleanly.
    fs.writeFileSync(configPath, '\uFEFF' + JSON.stringify({ browserControl: true, desktopEnvironment: 'task' }), 'utf8')
    assert.equal(readUserConfig().error, null)
    assert.equal(getSettings().browserControl, true)
    assert.equal(getSettings().desktopEnvironment, 'task')

    // Unset restores individual defaults.
    unsetUserConfigValue('browser-control')
    assert.equal(getSettings().browserControl, false)
    assert.equal(getSettings().desktopEnvironment, 'task')

    // Unknown/legacy keys written manually into config.json are safely ignored.
    fs.writeFileSync(configPath, JSON.stringify({
      browserControl: true,
      maxBatchActions: 999,
      allowSystemKeys: false,
      desktopEnvironment: 'invalid-env',
    }, null, 2))
    assert.equal(getSettings().browserControl, true)
    assert.equal(getSettings().maxBatchActions, DEFAULTS.maxBatchActions)
    assert.equal(getSettings().desktopEnvironment, DEFAULTS.desktopEnvironment)

    // Corrupt JSON does not crash getSettings(), but blocks destructive set until reset.
    fs.writeFileSync(configPath, '{not valid json')
    assert.equal(readUserConfig().error !== null, true)
    assert.deepEqual(getSettings(), DEFAULTS)
    assert.throws(() => setUserConfigValue('browserControl', 'true'), /corrupt config file/i)

    resetUserConfig()
    assert.equal(readUserConfig().error, null)
    assert.deepEqual(getSettings(), DEFAULTS)
  } finally {
    await runtime.close()
  }

  // 4. CLI `win-pilot config` subcommands.
  {
    const out = captureCli()
    assert.equal(await runCli(['config', 'path', '--json'], out.io), 0)
    assert.equal(JSON.parse(out.stdout()).path, path.resolve(configPath))
  }
  {
    const out = captureCli()
    assert.equal(await runCli(['config', 'set', 'browser-control', 'true', '--json'], out.io), 0)
    const parsed = JSON.parse(out.stdout())
    assert.equal(parsed.ok, true)
    assert.equal(parsed.key, 'browserControl')
    assert.equal(parsed.value, true)
    assert.equal(parsed.overridden, true)
  }
  {
    const out = captureCli()
    assert.equal(await runCli(['config', 'get', 'browserControl'], out.io), 0)
    assert.equal(out.stdout().trim(), 'true')
  }
  {
    const out = captureCli()
    assert.equal(await runCli(['config', '--json'], out.io), 0)
    const summary = JSON.parse(out.stdout())
    assert.equal(summary.ok, true)
    assert.deepEqual(summary.fields.map(f => f.key), KEYS)
    assert.equal(summary.settings.browserControl, true)
    assert.equal(summary.fields.find(f => f.key === 'browserControl').source, 'config')
  }
  {
    const out = captureCli()
    assert.equal(await runCli(['config'], out.io), 0)
    assert.match(out.stdout(), /browserControl\s+=\s+true\s+\(config, default: false\)/)
  }
  {
    const out = captureCli()
    assert.equal(await runCli(['config', 'unset', 'browserControl', '--json'], out.io), 0)
    assert.equal(JSON.parse(out.stdout()).value, false)
  }
  {
    const out = captureCli()
    assert.equal(await runCli(['config', 'set', 'desktop-environment', 'task'], out.io), 0)
    assert.match(out.stdout(), /desktopEnvironment = task/)
    const resetOut = captureCli()
    assert.equal(await runCli(['config', 'reset', '--json'], resetOut.io), 0)
    assert.deepEqual(JSON.parse(resetOut.stdout()).values, {})
    assert.equal(getConfigSummary({ configPath }).settings.desktopEnvironment, 'current')
  }
  {
    const bad = captureCli()
    assert.equal(await runCli(['config', 'set', 'unknown', '1'], bad.io), 2)
    assert.match(bad.stderr(), /unknown setting/)
  }

  // 5. Test seam isolation.
  setSettingsForTest({ browserControl: true })
  assert.equal(getSettings().browserControl, true)
  resetSettingsForTest()
  assert.equal(getSettings().browserControl, false)

  console.log('user config check PASSED')
} finally {
  resetSettingsForTest()
  if (prevConfigEnv === undefined) delete process.env.WIN_PILOT_CONFIG
  else process.env.WIN_PILOT_CONFIG = prevConfigEnv
  if (prevNoUserConfig === undefined) delete process.env.WIN_PILOT_NO_USER_CONFIG
  else process.env.WIN_PILOT_NO_USER_CONFIG = prevNoUserConfig
  fs.rmSync(tempDir, { recursive: true, force: true })
}
