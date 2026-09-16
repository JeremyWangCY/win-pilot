import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SUPPORTED = new Set(['mcp', 'cli', 'codex', 'claude', 'qoder', 'pi', 'dsh'])

export function getAgentInstallPlan(agent, { executable = 'win-pilot', home = os.homedir(), clientCommand } = {}) {
  const normalized = String(agent || '').trim().toLowerCase()
  if (!SUPPORTED.has(normalized)) throw new Error(`unsupported agent: ${agent}`)
  const skill = {
    source: 'skills/win-pilot',
    destination: normalized === 'pi'
      ? path.join(home, '.pi', 'agent', 'skills', 'win-pilot')
      : path.join(home, '.agents', 'skills', 'win-pilot'),
  }
  const registrations = {
    mcp: {
      kind: 'mcp',
      command: Array.isArray(clientCommand)
        ? [...clientCommand, 'win-pilot', '--', executable, 'mcp']
        : null,
      server: { command: executable, args: ['mcp'], transport: 'stdio' },
    },
    cli: { kind: 'skill-cli', command: null },
    codex: { kind: 'mcp', command: ['codex', 'mcp', 'add', 'win-pilot', '--', executable, 'mcp'] },
    claude: { kind: 'mcp', command: ['claude', 'mcp', 'add', '--scope', 'user', 'win-pilot', '--', executable, 'mcp'] },
    qoder: { kind: 'mcp', command: ['qoder', 'mcp', 'add', '-s', 'user', 'win-pilot', '--', executable, 'mcp'] },
    pi: { kind: 'skill-cli', command: null },
    dsh: { kind: 'dsh-plugin', command: ['dsh', 'plugin', '--profile', 'web', 'add', 'win-pilot'] },
  }
  return {
    agent: normalized,
    skill,
    registration: registrations[normalized],
    verify: [`${executable} --version`, `${executable} doctor --probe`, `${executable} status --json`],
  }
}

export function installForAgent(agent, options = {}) {
  const plan = getAgentInstallPlan(agent, options)
  if (options.dryRun) return { ok: true, changed: false, plan }
  const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const source = path.join(packageRoot, plan.skill.source)
  if (!fs.existsSync(source)) throw new Error(`bundled skill missing: ${source}`)
  fs.mkdirSync(path.dirname(plan.skill.destination), { recursive: true })
  fs.cpSync(source, plan.skill.destination, { recursive: true, force: true })
  let registration = { ok: true, skipped: true }
  if (plan.registration.command) {
    const [command, ...args] = plan.registration.command
    const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true })
    registration = {
      ok: result.status === 0,
      status: result.status,
      stdout: result.stdout?.trim() || '',
      stderr: result.stderr?.trim() || '',
    }
    if (!registration.ok) throw new Error(`agent registration failed: ${registration.stderr || command}`)
  }
  return { ok: true, changed: true, plan, registration }
}
