import assert from 'node:assert/strict'
import { createVersionController } from '../lib/host-integration.js'

let next = { version:'2.0.0', build:'new', reloadable:true }
const events = []
let finishOperation
const activeOperation = new Promise(resolve => { finishOperation = resolve })
const controller = createVersionController({ runningVersion:'1.0.0', runningBuildId:'old', installed:() => next,
  prepare:async () => { events.push('waiting'); await activeOperation; events.push('drained') },
  reload:async () => { events.push('loaded') },
})
assert.deepEqual([controller.status().running_version, controller.status().installed_version], ['1.0.0','2.0.0'])
assert.equal(controller.status().needs_reload, true)
assert.equal((await controller.reload()).reload_state, 'waiting')
await new Promise(resolve => setTimeout(resolve, 10))
assert.deepEqual(events, ['waiting'], 'reload must wait for the operation rather than cancel or replace it')
finishOperation()
await new Promise(resolve => setTimeout(resolve, 10))
assert.deepEqual(events, ['waiting','drained','loaded'])
next = { version:'3.0.0', build:'in-place', reloadable:false }
assert.equal(controller.status().restart_required, true)
assert.equal((await controller.reload()).ok, false, 'an in-place installation cannot promise fresh ESM dependencies')
next = { version:'1.0.0', build:'old', reloadable:true }
assert.equal((await controller.reload()).ok, true)
assert.equal(controller.status().needs_reload, false)
let cancelled = false
const broken = createVersionController({ runningVersion:'1', runningBuildId:'a',
  installed:() => ({version:'2',build:'b',reloadable:true}),
  reload:async () => { throw new Error('fixture load failed') }, cancel:() => { cancelled = true },
})
await broken.reload()
await new Promise(resolve => setTimeout(resolve, 10))
assert.equal(broken.status().reload_state, 'failed')
assert.equal(cancelled, true)
console.log('runtime version check PASSED (loaded/disk versions, drain-before-reload, honest restart/failure state)')
