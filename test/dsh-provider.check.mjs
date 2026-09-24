import assert from 'node:assert/strict'
import { reserveComputerUseProvider } from '../lib/index.js'

function createContext(initialRegistry) {
  let registry = initialRegistry
  const disposers = []
  const events = []
  return {
    events,
    disposers,
    get(name) {
      assert.equal(name, 'computerUse')
      return registry
    },
    effect(run, label) {
      events.push(['effect', label])
      const dispose = run()
      disposers.push(dispose)
      return async () => { if (typeof dispose === 'function') await dispose() }
    },
    plugin(Plugin) {
      events.push(['plugin', Plugin.name || 'anonymous'])
      registry = initialRegistry
      return Promise.resolve()
    },
    setRegistry(value) { registry = value },
  }
}

let released = false
let claimed = ''
const existing = {
  register(name) {
    claimed = name
    return async () => { released = true }
  },
}
const ctx = createContext(existing)
assert.equal(await reserveComputerUseProvider(ctx), true)
assert.equal(claimed, 'win-pilot')
assert.deepEqual(ctx.events, [['effect', 'win-pilot.computer-use-provider']])
await ctx.disposers[0]()
assert.equal(released, true)

const mounted = createContext(undefined)
mounted.plugin = (Plugin) => {
  mounted.events.push(['plugin', Plugin.name || 'anonymous'])
  mounted.setRegistry(existing)
  return Promise.resolve()
}
assert.equal(await reserveComputerUseProvider(mounted, {
  loadRegistry: async () => class ComputerUseRegistry {},
}), true)
assert.equal(mounted.events[0][0], 'plugin')
assert.equal(mounted.events[1][0], 'effect')

const legacy = createContext(undefined)
assert.equal(await reserveComputerUseProvider(legacy, { loadRegistry: async () => null }), false)

const conflict = createContext({ register() { throw new Error('provider occupied') } })
assert.throws(() => reserveComputerUseProvider(conflict), /provider occupied/)

console.log('dsh provider check PASSED')
