import readline from 'node:readline'
import { createPcPilotRuntime } from './runtime.js'
import { defineComputerTool } from './index.js'

const PROTOCOL_VERSION = '2025-06-18'

function error(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

export function createMcpServer({ runtime = createPcPilotRuntime(), tool } = {}) {
  const definition = tool || defineComputerTool(value => value)
  const inputSchema = definition.parameters?.type === 'object'
    ? definition.parameters
    : { type: 'object', properties: definition.parameters || {} }

  return Object.freeze({
    async handle(message) {
      const id = message?.id
      if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
        return error(id, -32600, 'Invalid JSON-RPC request')
      }
      if (message.method === 'initialize') {
        return {
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'win-pilot', version: '0.1.0' },
          },
        }
      }
      if (message.method === 'notifications/initialized') return null
      if (message.method === 'ping') return { jsonrpc: '2.0', id, result: {} }
      if (message.method === 'tools/list') {
        return {
          jsonrpc: '2.0', id,
          result: {
            tools: [{ name: 'computer', description: definition.description, inputSchema }],
          },
        }
      }
      if (message.method === 'tools/call') {
        if (message.params?.name !== 'computer') return error(id, -32602, 'Unknown tool')
        try {
          const value = await runtime.run(message.params?.arguments || {})
          return {
            jsonrpc: '2.0', id,
            result: {
              content: [{ type: 'text', text: JSON.stringify(value) }],
              isError: value?.ok === false,
              structuredContent: value,
            },
          }
        } catch (cause) {
          return error(id, -32603, cause?.message || String(cause))
        }
      }
      return error(id, -32601, `Method not found: ${message.method}`)
    },
    close() { runtime.close?.() },
  })
}

export async function runMcpStdio({ stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, server } = {}) {
  const active = server || createMcpServer()
  const lines = readline.createInterface({ input: stdin, crlfDelay: Infinity, terminal: false })
  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      let response
      try {
        response = await active.handle(JSON.parse(line))
      } catch (cause) {
        response = error(null, -32700, cause?.message || 'Parse error')
      }
      if (response) stdout.write(JSON.stringify(response) + '\n')
    }
    return 0
  } catch (cause) {
    stderr.write(`win-pilot mcp: ${cause?.message || String(cause)}\n`)
    return 1
  } finally {
    active.close()
  }
}
