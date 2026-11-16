import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('disconnected controls are not buffered and stale snapshots are cleared', async () => {
  const sent = [], pushed = [], listeners = {}
  let message
  let fetches = 0
  let activeTab = { id: 1, url: "https://www.hotstar.com/in/movies/fixture/123456/watch" }
  const socket = {
    timeout() { return this },
    async emitWithAck(...args) { sent.push(args); return { ok: true } },
    connected: true, on: (name, fn) => { listeners[name] = fn }, off() {}, emit: (...args) => sent.push(args), disconnect() {} }
  const chrome = {
    storage: { local: { get: async () => ({}), set: async () => {} } },
    tabs: { query: async ({ active }) => active ? [activeTab] : [{ id: 1 }], sendMessage: async (_, value) => { pushed.push(value) } },
    runtime: { onMessage: { addListener: fn => { message = fn } } },
  }
  const context = vm.createContext({ chrome, io: () => socket, setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {}, Date, URL, console, fetch: async () => { fetches += 1; return { ok: true, json: async () => ({ item: { id: 'fixture-item' } }) } } })
  const source = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8').replace(/^import .*$/gm, '')
  vm.runInContext(readFileSync(new URL('../src/title-match.js', import.meta.url), 'utf8'), context)
  vm.runInContext(source, context)
  await new Promise(resolve => setImmediate(resolve))
  const send = (data, sender = {}) => new Promise(resolve => message(data, sender, resolve))
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
  const announcement = { kind: 'announce', title: 'Fixture', url: 'https://example.test', position: 1234.5 }
  assert.equal((await send(announcement)).ok, false, 'an older API cannot start the title at zero')
  assert.equal(fetches, 0, 'an older API does not add a title that cannot be started')
  listeners['watch:stream-ready']({ roomId: 'room' })
  assert.equal((await send(announcement)).ok, true)
  assert.equal(sent.at(-1)[0], 'watch:stream-start')
  assert.equal(sent.at(-1)[1].position, 1234.5)

  listeners['watch:state']({
    roomId: 'room',
    item: { id: 'fixture-item', source: 'external', ref: activeTab.url },
  })
  const focus = () => send({ kind: 'watch-focus', roomId: 'room' }, { tab: { id: 2 } })
  assert.equal((await focus()).watching, true, 'the shared title keeps the call visible')
  activeTab = { id: 3, url: 'https://www.hotstar.com/in/movies/different/789/watch' }
  assert.equal((await focus()).watching, false, 'another title closes the floating call')
  activeTab = { id: 3, url: 'https://example.test/' }
  assert.equal((await focus()).watching, false, 'an unrelated tab closes the floating call')
})
