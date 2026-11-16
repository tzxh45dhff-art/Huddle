import assert from 'node:assert/strict'
import { test } from 'node:test'
import '../src/title-match.js'
import { createMovieHub } from '../src/movie-hub.js'

const movie = 'https://www.hotstar.com/in/movies/test/123456/watch'
const previous = 'https://www.hotstar.com/in/movies/previous/654321/watch'
const primeApp = 'https://app.primevideo.com/detail?gti=amzn1.dv.gti.12345678-1234-1234-1234-123456789abc'
const primeWeb = 'https://www.primevideo.com/detail/EPISODE123'

function fixture(t, current = previous) {
  let lastTab = 0
  const announcements = [], seeks = [], requests = [], opening = []
  let stored = {}
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: String(url), options })
    return { ok: true, url: primeWeb + '?ref_=redirect' }
  })
  globalThis.chrome = {
    storage: { session: {
      get: async () => stored,
      set: async (value) => { stored = structuredClone(value) },
    } },
    tabs: {
      create: async () => ({ id: ++lastTab }),
      update: async (id, options) => { opening.push([id, options.url]) },
      sendMessage: async (_id, message) => { seeks.push(message) },
    },
  }
  const hub = createMovieHub({
    getConfig: () => ({ roomId: 'room', server: 'https://example.test', token: 'fixture' }),
    getSnapshot: () => ({ item: { source: 'external', ref: current, title: 'Current title' } }),
    announce: async (...values) => { announcements.push(values) },
    canStart: () => true,
    sendRoom() {},
  })
  const observe = (url, position, patch, id = lastTab) => hub.observe({
    ready: true, duration: 3600, position, paused: false, ...patch,
  }, { url, tab: { id } })
  const launch = (url, mode = 'room', position) => hub.launch({ url, mode, position, title: 'Test title', roomId: 'room' })
  return { hub, launch, observe, announcements, seeks, requests, opening }
}

test('room launch waits for the selected player and publishes its real time', async (t) => {
  const hub = fixture(t)
  assert.equal((await hub.launch(movie)).ok, true)
  await hub.observe(previous, 800)
  await hub.observe(movie, 0, { buffering: true })
  await hub.observe(movie, 0, { paused: true })
  assert.equal(hub.announcements.length, 0)
  await hub.observe(movie, 842.25)
  assert.deepEqual(hub.announcements.map(entry => entry.slice(0, 3)), [['Test title', movie, 842.25]])
  assert.equal(Boolean(hub.hub.suppress(1)), false)
})

test('private resume seeks to its checkpoint and never starts or changes the room', async (t) => {
  const hub = fixture(t, movie)
  assert.equal((await hub.launch(movie, 'solo', 900)).ok, true)
  await hub.observe(movie, 12)
  assert.deepEqual(hub.seeks, [{ kind: 'movie-hub-seek', identity: 'hotstar:123456', position: 900 }])
  assert.equal(hub.requests.length, 0)
  await hub.observe(movie, 900.3)
  assert.equal(hub.announcements.length, 0)
  assert.equal(hub.hub.suppress(1), true)
  const payload = JSON.parse(hub.requests[0].options.body)
  assert.equal(payload.shared, false)
  assert.equal(payload.position, 900.3)
})

test('Prime deep links use the redirected episode identity and joining never restarts it', async (t) => {
  const hub = fixture(t, primeWeb)
  assert.equal((await hub.launch(previous, 'join')).ok, false)
  assert.equal((await hub.launch(primeApp)).ok, true)
  assert.equal(new URL(hub.requests[0].url).searchParams.get('action'), 'play')
  assert.deepEqual(hub.opening, [[1, primeWeb]])
  await hub.observe(primeWeb, 100)
  assert.equal(hub.announcements.length, 0)
})
