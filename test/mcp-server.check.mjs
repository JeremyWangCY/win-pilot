import assert from 'node:assert/strict'
import { createMcpServer } from '../lib/mcp-server.js'

const calls = []
const server = createMcpServer({
  runtime: {
    run: async request => {
      calls.push(request)
      return { ok: true, action: request.action, value: 42 }
    },
    close() {},
  },
})

const initialized = await server.handle({
  jsonrpc: '2.0', id: 1, method: 'initialize', params: {},
})
assert.equal(initialized.result.serverInfo.name, 'win-pilot')

const listed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
assert.equal(listed.result.tools.length, 1)
assert.equal(listed.result.tools[0].name, 'computer')
assert.equal(listed.result.tools[0].inputSchema.type, 'object')
assert.ok(listed.result.tools[0].inputSchema.properties.action)

const called = await server.handle({
  jsonrpc: '2.0', id: 3, method: 'tools/call',
  params: { name: 'computer', arguments: { action: 'wait', seconds: 0 } },
})
assert.deepEqual(calls, [{ action: 'wait', seconds: 0 }])
assert.equal(called.result.isError, false)
assert.deepEqual(JSON.parse(called.result.content[0].text), { ok: true, action: 'wait', value: 42 })

const unknown = await server.handle({
  jsonrpc: '2.0', id: 4, method: 'tools/call',
  params: { name: 'missing', arguments: {} },
})
assert.equal(unknown.error.code, -32602)

console.log('mcp server check PASSED')
