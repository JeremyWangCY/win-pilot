import { readFileSync } from 'node:fs'
import { createWinPilotRuntime } from './runtime.js'
import { installForAgent } from './agent-install.js'

const PACKAGE_VERSION = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version

const HELP = `Win-Pilot CLI

Usage:
  win-pilot --version
  win-pilot mcp
  win-pilot install --agent <mcp|cli|codex|claude|qoder|pi|dsh> [--dry-run] [--json]
  win-pilot status [--json]
  win-pilot doctor [--probe] [--json]
  win-pilot request [--payload <json> | --stdin] [--json]
  win-pilot act <action> [--payload <json> | --stdin] [--json]
  win-pilot <action> [--payload <json> | --stdin] [--json]

request passes a complete computer request through unchanged. The CLI intentionally does not whitelist actions.
`

async function readAll(stream) {
  let text = ''
  for await (const chunk of stream) text += chunk
  return text
}

function parsePayload(text) {
  if (!text?.trim()) return {}
  const value = JSON.parse(text)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('payload must be a JSON object')
  }
  return value
}

export function parseCliArgs(argv) {
  const args = [...argv]
  const options = { json: false, probe: false, stdin: false, version: false, dryRun: false, agent: null, payloadText: null }
  const positionals = []
  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    if (token === '--json') options.json = true
    else if (token === '--probe') options.probe = true
    else if (token === '--stdin') options.stdin = true
    else if (token === '--dry-run') options.dryRun = true
    else if (token === '--agent') {
      if (i + 1 >= args.length) throw new Error('--agent requires a value')
      options.agent = args[++i]
    }
    else if (token === '--help' || token === '-h') options.help = true
    else if (token === '--version' || token === '-v') options.version = true
    else if (token === '--payload') {
      if (i + 1 >= args.length) throw new Error('--payload requires JSON')
      options.payloadText = args[++i]
    } else positionals.push(token)
  }

  if (options.version) return { command: 'version', options }
  if (options.help || positionals.length === 0) return { command: 'help', options }
  const first = positionals.shift()
  if (first === 'status' || first === 'doctor' || first === 'install') return { command: first, options, extra: positionals }
  if (first === 'request' || first === 'raw') return { command: 'request', options, extra: positionals }
  if (first === 'act') {
    const action = positionals.shift()
    if (!action) throw new Error('act requires an action name')
    return { command: 'act', action, options, extra: positionals }
  }
  return { command: 'act', action: first, options, extra: positionals }
}

function humanStatus(value) {
  return [
    `Win-Pilot ${value.version}`,
    `Platform: ${value.platform}/${value.arch}`,
    `Node: ${value.node}`,
    `Desktop: ${value.providers.desktop}`,
    `Browser: ${value.providers.browser}`,
    `Daemon: ${value.daemon.running ? `running (pid ${value.daemon.pid})` : 'idle'}`,
  ].join('\n')
}

function humanDoctor(value) {
  const lines = value.checks.map(check => {
    const mark = check.ok ? 'OK' : (check.required ? 'FAIL' : 'OPTIONAL')
    return `${mark.padEnd(8)} ${check.name}: ${check.detail}`
  })
  lines.push(value.ok ? 'Win-Pilot is ready.' : 'Win-Pilot has required checks that failed.')
  return lines.join('\n')
}

function writeValue(io, value, json, humanFormatter) {
  const text = json
    ? JSON.stringify(value)
    : humanFormatter ? humanFormatter(value) : JSON.stringify(value, null, 2)
  io.stdout.write(text + '\n')
}

export async function runCli(argv, io = {}) {
  const stdout = io.stdout || process.stdout
  const stderr = io.stderr || process.stderr
  const stdin = io.stdin || process.stdin
  // The runtime is created on first use so pure informational commands
  // (--version, --help) never spawn the helper daemon or touch the desktop.
  let runtime = null
  const getRuntime = () => (runtime ||= (io.runtimeFactory || createWinPilotRuntime)({ signal: io.signal }))
  try {
    const parsed = parseCliArgs(argv)
    if (parsed.command === 'version') {
      stdout.write(PACKAGE_VERSION + '\n')
      return 0
    }
    if (parsed.command === 'help') {
      stdout.write(HELP)
      return 0
    }
    if (parsed.extra?.length) throw new Error(`unexpected arguments: ${parsed.extra.join(' ')}`)

    if (parsed.command === 'install') {
      if (!parsed.options.agent) throw new Error('install requires --agent')
      const value = installForAgent(parsed.options.agent, { dryRun: parsed.options.dryRun })
      writeValue({ stdout }, value, parsed.options.json)
      return 0
    }
    if (parsed.command === 'status') {
      writeValue({ stdout }, getRuntime().status(), parsed.options.json, humanStatus)
      return 0
    }
    if (parsed.command === 'doctor') {
      const value = await getRuntime().doctor({ probe: parsed.options.probe })
      writeValue({ stdout }, value, parsed.options.json, humanDoctor)
      return value.ok ? 0 : 1
    }

    if (parsed.options.stdin && parsed.options.payloadText !== null) {
      throw new Error('use either --stdin or --payload, not both')
    }
    let payloadText = parsed.options.payloadText
    if (parsed.options.stdin) payloadText = await readAll(stdin)
    if (parsed.command === 'request' && payloadText === null) {
      throw new Error('request requires --payload or --stdin')
    }
    const payload = parsePayload(payloadText)
    const value = parsed.command === 'request'
      ? await getRuntime().run(payload)
      : await getRuntime().act(parsed.action, payload)
    writeValue({ stdout }, value, parsed.options.json)
    return value?.ok === false ? 1 : 0
  } catch (error) {
    stderr.write(`win-pilot: ${error.message}\n`)
    return 2
  } finally {
    runtime?.close?.()
  }
}
