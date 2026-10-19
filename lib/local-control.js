import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { randomUUID, randomBytes, timingSafeEqual } from 'node:crypto'

const MAX_FRAME = 65536
export const controlDirectory = () => path.join(os.tmpdir(), 'win-pilot', 'controls')

export function createLocalControl(handle, { directory = controlDirectory() } = {}) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const id = randomUUID(), token = randomBytes(24).toString('hex')
  const endpoint = process.platform === 'win32' ? `\\\\.\\pipe\\win-pilot-${id}` : path.join(directory, `${id}.sock`)
  const sockets = new Set()
  const server = net.createServer(socket => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
    socket.setTimeout(10000, () => socket.destroy())
    let input = '', sent = false
    socket.setEncoding('utf8')
    socket.on('data', async chunk => {
      if (sent) return
      input += chunk
      if (Buffer.byteLength(input) > MAX_FRAME) { socket.destroy(); return }
      const end = input.indexOf('\n')
      if (end < 0) return
      sent = true
      try {
        const request = JSON.parse(input.slice(0, end))
        const supplied = Buffer.from(String(request.token || ''))
        const expected = Buffer.from(token)
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error('Local control authentication failed')
        socket.setTimeout(0)
        const value = await handle(request)
        socket.end(JSON.stringify(value) + '\n')
      } catch (error) { socket.end(JSON.stringify({ ok: false, error_code: 'local_control_failed', message: error.message }) + '\n') }
    })
  })
  const ready = new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(endpoint, () => { server.unref(); resolve() })
  })
  return {
    id, endpoint, token, ready,
    async close() {
      await ready.catch(() => {})
      for (const socket of sockets) socket.destroy()
      if (server.listening) await new Promise(resolve => server.close(resolve))
      if (process.platform !== 'win32') fs.rmSync(endpoint, { force: true })
    },
  }
}

export function requestLocalControl(connection, request, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(connection.endpoint)
    let input = '', settled = false
    const finish = (error, value) => {
      if (settled) return
      settled = true; socket.destroy()
      if (error) reject(error); else resolve(value)
    }
    socket.setTimeout(timeoutMs, () => finish(new Error('Local control request timed out')))
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.write(JSON.stringify({ ...request, token: connection.token }) + '\n'))
    socket.on('error', error => finish(error))
    socket.on('end', () => { if (!settled) finish(new Error('Local control connection closed without a response')) })
    socket.on('data', chunk => {
      input += chunk
      if (Buffer.byteLength(input) > MAX_FRAME) return finish(new Error('Local control response exceeded the limit'))
      const end = input.indexOf('\n')
      if (end >= 0) {
        try { finish(null, JSON.parse(input.slice(0, end))) } catch (error) { finish(error) }
      }
    })
  })
}
