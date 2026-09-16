#!/usr/bin/env node
import { runCli } from '../lib/cli.js'
import { runMcpStdio } from '../lib/mcp-server.js'

const controller = new AbortController()
process.once('SIGINT', () => controller.abort())
process.once('SIGTERM', () => controller.abort())

process.exitCode = process.argv[2] === 'mcp'
  ? await runMcpStdio()
  : await runCli(process.argv.slice(2), {
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
      signal: controller.signal,
    })
