import readline from 'node:readline'
import { createWinPilotRuntime } from './runtime.js'

/** JSON Lines transport. One process owns one runtime until EOF or session_close. */
export async function runCliSession({ stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, runtime = createWinPilotRuntime(), signal } = {}) {
  const lines = readline.createInterface({ input: stdin, crlfDelay: Infinity, terminal: false })
  const pending = new Set()
  let closing = false, exitCode = 0
  const abort = () => { closing = true; lines.close(); void runtime.close().catch(() => {}) }
  if (signal?.aborted) { await runtime.close(); lines.close(); return 0 }
  signal?.addEventListener('abort', abort, { once:true })
  const write = value => stdout.write(JSON.stringify(value) + '\n')
  const dispatch = async line => {
    let request
    try {
      request = JSON.parse(line)
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('Expected a JSON request object')
      const { id, ...args } = request
      const result = await runtime.run(args, { signal })
      write({ ...result, id: id ?? null })
    } catch (error) { write({ id: request?.id ?? null, ok: false, error_code: 'invalid_session_request', message: error.message }) }
  }
  try {
    for await (const line of lines) {
      if (!line.trim()) continue
      let request
      try { request = JSON.parse(line) } catch { await dispatch(line); continue }
      if (request?.action === 'session_close') {
        closing = true
        await runtime.close()
        await Promise.allSettled(pending)
        write({ id: request.id ?? null, ok: true, action: 'session_close', cleanup_confirmed: true })
        break
      }
      if (closing) break
      if (pending.size >= 32 && !['stop', 'resume', 'control_status'].includes(request?.action)) {
        write({ id: request?.id ?? null, ok: false, error_code: 'session_busy', message: 'Too many pending requests' }); continue
      }
      const work = dispatch(line); pending.add(work)
      work.finally(() => pending.delete(work)).catch(() => {})
    }
    // EOF is a disconnect, not permission to leave an active input behind.
    await runtime.close()
    await Promise.allSettled(pending)
  } catch (error) { stderr.write(`win-pilot session: ${error.message}\n`); exitCode = 1 }
  finally { signal?.removeEventListener('abort', abort); lines.close(); await runtime.close() }
  return exitCode
}
