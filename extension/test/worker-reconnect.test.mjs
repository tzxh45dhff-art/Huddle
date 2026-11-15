import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('disconnected controls are not buffered and stale snapshots are cleared', async () => {
  const sent = [], pushed = [], listeners = {}
  let message
  const socket = { connected: true, on: (name, fn) => { listeners[name] = fn }, off() {}, emit: (...args) => sent.push(args), disconnect() {} }
  const chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { query: async () => [{ id: 1 }], sendMessage: async (_, value) => { pushed.push(value) } },
    runtime: { onMessage: { addListener: fn => { message = fn } } },
  }
  const context = vm.createContext({ chrome, io: () => socket, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, Date, console, fetch: async () => { throw new Error('Unexpected request') } })
  const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8').replace("import { io } from './socket-lib.js'", '')
  vm.runInContext(source, context)
  await new Promise(resolve => setImmediate(resolve))
  const send = data => new Promise(resolve => message(data, {}, resolve))
  await send({ kind: 'configure', server: 'https://example.test', token: 'synthetic-fixture', roomId: 'room' })
  listeners['watch:state']({ roomId: 'room', position: 1200 })
  socket.connected = false
  listeners.disconnect()
  assert.equal((await send({ kind: 'state' })).snapshot, null)
  const before = sent.length
  assert.equal((await send({ kind: 'control', control: { action: 'seek', position: 0 } })).ok, false)
  assert.equal((await send({ kind: 'announce', title: 'Fixture', url: 'https://example.test' })).ok, false)
  assert.equal(sent.length, before)
  await new Promise(resolve => setImmediate(resolve))
  assert.ok(pushed.some(value => value.status === 'disconnected' && value.snapshot === null))
  socket.connected = true
  assert.equal((await send({ kind: 'control', control: { action: 'pause', position: 1200 } })).ok, true)
  assert.equal(sent.at(-1)[0], 'watch:control')
})
