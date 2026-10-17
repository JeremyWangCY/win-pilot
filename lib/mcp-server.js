import readline from 'node:readline'
import fs from 'node:fs'
import { createWinPilotRuntime } from './runtime.js'
import { defineComputerTool } from './index.js'

const PROTOCOL_VERSION = '2025-06-18'
const VERSION = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url),'utf8')).version

function error(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }
}

export function createMcpServer({ runtime = createWinPilotRuntime(), tool } = {}) {
  const pending = new Map()
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
            serverInfo: { name: 'win-pilot', version: VERSION },
          },
        }
      }
      if (message.method === 'notifications/initialized') return null
      if (message.method === 'notifications/cancelled') {
        pending.get(message.params?.requestId)?.abort(new Error('client_cancelled'))
        return null
      }
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
        if (pending.has(id)) return error(id, -32600, 'Duplicate active request id')
        const controller = new AbortController(); pending.set(id,controller)
        try {
          const value = await runtime.run(message.params?.arguments || {}, {signal:controller.signal})
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
        } finally {pending.delete(id)}
      }
      return error(id, -32601, `Method not found: ${message.method}`)
    },
    async close() {
      for (const controller of pending.values()) controller.abort(new Error('transport_closed'))
      await runtime.close?.()
    },
  })
}

export async function runMcpStdio({ stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, server } = {}) {
  const active = server || createMcpServer()
  const lines = readline.createInterface({ input: stdin, crlfDelay: Infinity, terminal: false })
  const inFlight = new Set()
  const dispatch = async line => {
    let response
    try { response = await active.handle(JSON.parse(line)) }
    catch (cause) { response = error(null, -32700, cause?.message || 'Parse error') }
    if (response) stdout.write(JSON.stringify(response) + '\n')
  }
  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      if (inFlight.size >= 32) {
        // Cancellation and stop must remain readable even behind pending work.
        let message
        try {message=JSON.parse(line)}catch {stdout.write(JSON.stringify(error(null,-32700,'Parse error'))+'\n');continue}
        if (message.method !== 'notifications/cancelled' && message.params?.arguments?.action !== 'stop') {
          stdout.write(JSON.stringify(error(message.id,-32000,'Too many pending requests'))+'\n');continue
        }
      }
      const work = dispatch(line);inFlight.add(work)
      work.finally(()=>inFlight.delete(work)).catch(()=>{})
    }
    await active.close()
    await Promise.allSettled(inFlight)
    return 0
  } catch (cause) {
    stderr.write(`win-pilot mcp: ${cause?.message || String(cause)}\n`)
    return 1
  } finally {
    await active.close()
  }
}
