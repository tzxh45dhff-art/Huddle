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
  const commands = []
  const frame = {
    src: 'https://net77.cc/player',
    getClientRects: () => [1],
    contentDocument: { body: video.ownerDocument.body, querySelectorAll: () => [video] },
    contentWindow: { postMessage: (message, origin) => commands.push({ message, origin }) },
  }
  const listeners = []
  const window = {
    __huddleStartSync() {},
    postMessage: value => state.push(value),
    addEventListener: (_, fn) => listeners.push(fn),
  }
  window.top = window
  receive = event => listeners.forEach(fn => fn(event))
  const sandbox = {
    window, URL, location: { href: 'https://net77.cc/home' },
    document: { querySelectorAll: selector => selector === 'video' ? [] : [frame] },
    chrome: { runtime: { onMessage: { addListener() {} } } },
    performance: { now: () => 1 },
    setInterval: fn => { tick = fn },
  }
  for (const script of ['title-match.js', 'net77-media.js', 'net77.js']) {
    vm.runInNewContext(readFileSync(new URL(`../src/${script}`, import.meta.url), 'utf8'), sandbox)
  }

  return {
    video, frame, attrs, state, commands, receive, tick: () => tick(), setAd: value => { isAd = value },
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

test('a trusted cross-origin playback frame can replace the old room title', () => {
  const local = fixture()
  local.frame.src = 'https://net52.cc/player'
  local.frame.contentDocument = null
  const media = { key: 'example-42.1.2', title: 'Fixture · S1 E2', position: 600, duration: 1500 }
  const data = { channel: 'huddle-net77-frame', kind: 'state', media }
  local.receive({ data, source: local.frame.contentWindow, origin: 'https://bad.invalid' })
  local.tick()
  assert.equal(local.state.at(-1).ready, false)
  local.receive({ data, source: {}, origin: 'https://net52.cc' })
  local.tick()
  assert.equal(local.state.at(-1).ready, false)
  local.receive({ data, source: local.frame.contentWindow, origin: 'https://net52.cc' })
  assert.equal(local.state.at(-1).ready, true)
  assert.equal(local.state.at(-1).position, 600)
  local.send({ command: 'seek', seconds: 720 })
  assert.equal(local.commands.at(-1).origin, 'https://net52.cc')
  assert.equal(local.commands.at(-1).message.seconds, 720)
  local.frame.src = 'https://net52.cc/another-player'
  local.tick()
  assert.equal(local.state.at(-1).ready, false)
})

test('the player frame binds to its NetMirror parent even with no referrer', () => {
  const host = fixture()
  const sent = []
  const parent = { postMessage: (message, origin) => sent.push({ message, origin }) }
  let receive
  const child = {
    top: parent, parent,
    addEventListener: (_, fn) => { receive = fn },
  }
  const document = { ...host.frame.contentDocument, addEventListener() {}, referrer: '' }
  vm.runInNewContext(readFileSync(new URL('../src/net77-media.js', import.meta.url), 'utf8'), {
    window: child, document, URL, setInterval() {},
  })
  const hello = { channel: 'huddle-net77-frame', kind: 'hello' }
  receive({ source: parent, origin: 'https://bad.invalid', data: hello })
  assert.equal(sent.length, 0)
  receive({ source: parent, origin: 'https://net77.cc', data: hello })
  assert.equal(sent.at(-1).origin, 'https://net77.cc')
  assert.equal(sent.at(-1).message.media.key, 'example-42.1.2')
  const seek = { ...hello, kind: 'command', command: 'seek', titleKey: 'example-42.1.3', seconds: 800 }
  receive({ source: parent, origin: 'https://net77.cc', data: seek })
  assert.equal(host.video.currentTime, 600)
  receive({ source: parent, origin: 'https://net77.cc', data: { ...seek, titleKey: 'example-42.1.2' } })
  assert.equal(host.video.currentTime, 800)
})
