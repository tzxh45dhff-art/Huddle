import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

function fixture() {
  let tick
  let receive
  const events = new Map()
  const state = []
  const attrs = {
    'data-series_id': 'Example-42', 'data-title': 'Fixture',
    'data-senum': '01', 'data-epnum': '02', 'data-eptitle': 'The second one',
  }
  let isAd = false
  const video = {
    paused: true, currentTime: 600, duration: 1800, readyState: 4, playbackRate: 1,
    ownerDocument: { body: { getAttribute: name => attrs[name] ?? null } },
    getClientRects: () => [1], closest: () => isAd,
    play() { this.paused = false; return Promise.resolve() },
    pause() { this.paused = true },
    addEventListener: (name, fn) => events.set(name, fn),
    removeEventListener: (name) => events.delete(name),
  }
  const frame = { getClientRects: () => [1], contentDocument: { querySelectorAll: () => [video] } }
  const window = {
    __huddleStartSync() {},
    postMessage: value => state.push(value),
    addEventListener: (_, fn) => { receive = fn },
  }
  const sandbox = {
    window, URL, location: { href: 'https://net77.cc/home' },
    document: { querySelectorAll: selector => selector === 'video' ? [] : [frame] },
    chrome: { runtime: { onMessage: { addListener() {} } } },
    performance: { now: () => 1 },
    setInterval: fn => { tick = fn },
  }
  for (const script of ['title-match.js', 'net77.js']) {
    vm.runInNewContext(readFileSync(new URL(`../src/${script}`, import.meta.url), 'utf8'), sandbox)
  }

  return {
    video, frame, attrs, state, tick: () => tick(), setAd: value => { isAd = value },
    title: () => window.__huddleNet77Title(),
    match: ref => window.__huddleMatchesRoom({ item: { source: 'external', ref } }),
    send: data => receive({ source: window, data: { channel: 'huddle', kind: 'command', titleKey: 'example-42.1.2', ...data } }),
    emit: type => events.get(type)?.({ target: video, type }),
  }
}

test('identified Net77 frame seeks and preserves the series and episode identity', () => {
  const local = fixture()
  const shared = local.title()
  assert.equal(shared.title, 'Fixture · S1 E2')
  assert.equal(local.match(shared.url), true)
  assert.equal(local.match(shared.url.replace('.1.2', '.1.3')), false)
  assert.equal(local.match(shared.url.replace('net77.cc/', 'net77.cc.example/')), false)
  local.send({ command: 'seek', seconds: 900 })
  local.emit('seeked')
  assert.equal(local.state.at(-1).position, 900)
  assert.equal(local.state.at(-1).seekEvent, 'seeked')
  local.attrs['data-epnum'] = '03'
  local.send({ command: 'seek', seconds: 200 })
  assert.equal(local.video.currentTime, 900, 'a command cannot touch a replacement episode')
  local.tick()
  local.send({ command: 'seek', seconds: 200 })
  assert.equal(local.video.currentTime, 900, 'a queued command still targets the previous episode')
  assert.equal(local.match(shared.url), false)
})

test('ads, inaccessible frames and ambiguous episode metadata do not sync', () => {
  const local = fixture()
  local.setAd(true)
  local.tick()
  assert.equal(local.state.at(-1).ready, false)
  local.setAd(false)
  local.attrs['data-senum'] = ''
  local.tick()
  assert.equal(local.state.at(-1).ready, false)
  local.attrs['data-senum'] = '1'
  local.frame.contentDocument = null
  local.tick()
  assert.equal(local.state.at(-1).ready, false)
})
