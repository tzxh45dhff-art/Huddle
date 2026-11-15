import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync } from 'node:fs'
const source = readFileSync(new URL('../src/bridge-hotstar.js', import.meta.url), 'utf8')
function boot() {
  let tick, command, report
  const video = { duration: 3600, currentTime: 15, paused: true, playbackRate: 1, readyState: 4,
    getClientRects: () => [1], play() { this.paused = false; return Promise.resolve() }, pause() { this.paused = true } }
  const location = { pathname: '/in/movies/test/123456/watch' }
  const document = { querySelectorAll: () => [video], querySelector: () => null }
  const window = { postMessage: value => { report = value }, addEventListener: (_, fn) => { command = fn } }
  vm.runInNewContext(source, { window, document, location, performance: { now: () => 1 }, setInterval: fn => { tick = fn } })
  return { video, location, document, tick: () => { tick(); return report }, send: data => command({ source: window, data: { channel: 'huddle', kind: 'command', ...data } }) }
}
test('on-demand playback reports and accepts bounded commands', () => {
  const b = boot()
  assert.equal(b.tick().titleKey, '123456')
  b.send({ command: 'seek', seconds: 9000 }); assert.equal(b.video.currentTime, 3600)
  b.send({ command: 'play' }); assert.equal(b.video.paused, false)
  b.send({ command: 'pause' }); assert.equal(b.video.paused, true)
  b.send({ command: 'seek', seconds: NaN }); assert.equal(b.video.currentTime, 3600)
})
test('browse pages, live streams and detected adverts do not sync', () => {
  const b = boot()
  b.location.pathname = '/in/home'; assert.equal(b.tick().ready, false)
  b.location.pathname = '/in/movies/test/123456/watch'
  b.video.duration = Infinity; assert.equal(b.tick().ready, false)
  b.video.duration = 3600
  b.document.querySelector = () => ({ getClientRects: () => [1] })
  assert.equal(b.tick().ready, false)
  b.send({ command: 'seek', seconds: 500 }); assert.equal(b.video.currentTime, 15)
})
test('room matching uses service and episode identity', () => {
  const window = {}
  const location = { href: 'https://www.hotstar.com/in/shows/series/111/episode/222/watch?ulp_id=111' }
  vm.runInNewContext(readFileSync(new URL('../src/title-match.js', import.meta.url), 'utf8'), { window, location, URL })
  const matches = ref => window.__huddleMatchesRoom({ item: { source: 'external', ref } })
  assert.equal(matches('https://www.hotstar.com/in/shows/series/111/episode/222/watch'), true)
  assert.equal(matches('https://www.hotstar.com/in/shows/series/111/episode/333/watch'), false)
  assert.equal(matches('https://www.netflix.com/watch/222'), false)
  assert.equal(matches('https://hotstar.com.evil.invalid/in/movie/222/watch'), false)
})
