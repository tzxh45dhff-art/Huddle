import { io } from './socket-lib.js'
import './title-match.js'

/**
 * The connection, and the clock.
 *
 * Everything that talks to the server happens here rather than in the Netflix
 * tab, for one reason worth stating plainly: a socket opened from a content
 * script carries the *page's* origin. Allowing it would mean putting
 * netflix.com on the API's CORS allowlist, and from that moment any script
 * running on netflix.com — theirs, or anything they load — is talking to the
 * same door. From the worker the origin is this extension's own id: one value,
 * allowlisted deliberately, that a web page cannot forge.
 *
 * The offset is measured here for the same reason it is measured in the app:
 * every correction downstream is a subtraction against server time, and
 * browser clocks are routinely seconds out. The method is the app's, down to
 * preferring the fastest exchange over the median — a round trip that came
 * back quickly had the least room to be asymmetric, and asymmetry is the whole
 * error term in `rtt / 2`.
 */

const PING_SAMPLES = 7
const RESYNC_MS = 30_000

let socket = null
/* Cleared on every reconnect. Without this, each connect stacked another
   resync timer on the last one and the pings multiplied quietly. */
let resyncTimer = null
let offset = 0
let snapshot = null
let config = { server: '', token: '', roomId: '', roomCode: '' }
let status = 'idle'
let streamReady = false

const state = () => ({ status, offset, snapshot, config: { ...config, token: config.token ? '…' : '' } })

async function load() {
  const stored = await chrome.storage.local.get(['server', 'token', 'roomId', 'roomCode'])
  config = {
    server: stored.server ?? '',
    token: stored.token ?? '',
    roomId: stored.roomId ?? '',
    roomCode: stored.roomCode ?? '',
  }
}

/**
 * Every tab that can be held to the room.
 *
 * Netflix used to be matched at `/watch/*`, which was both too narrow and the
 * wrong shape: it is a single-page app, so the tab that is playing a title was
 * often loaded at a different path and never matched. Prime is worse for the
 * same reason — it plays over its detail page and has no `/watch/` at all. So
 * the query is by site, and each tab's own bridge decides whether a real title
 * is on screen. A tab that is not watching anything simply ignores the push.
 */
const WATCHABLE = [
  'https://net77.cc/*',
  'https://www.net77.cc/*',
  'https://*.net52.cc/mobile/*',
  'https://*.hotstar.com/*',
  '*://*.netflix.com/*',
  '*://*.primevideo.com/*',
  '*://*.amazon.com/gp/video/*',
  '*://*.amazon.co.uk/gp/video/*',
  '*://*.amazon.in/gp/video/*',
  '*://*.amazon.de/gp/video/*',
  '*://*.amazon.co.jp/gp/video/*',
]

/** Push the room to every watchable tab. They own correcting; we own this. */
async function broadcast(message = { kind: 'room', snapshot, offset, status }) {
  const tabs = await chrome.tabs.query({ url: WATCHABLE })
  if (message.kind === 'room' && (message.snapshot !== snapshot || message.status !== status)) return
  for (const tab of tabs) {
    if (tab.id === undefined) continue
    chrome.tabs
      .sendMessage(tab.id, message)
      .catch(() => undefined)
  }
}

function measureClock() {
  if (!socket) return
  const samples = []
  /* Detached either way — on the last sample, or by the deadline. A run that
     loses a pong would otherwise leave its listener on the socket forever,
     and every resync adds another. */
  const deadline = setTimeout(() => socket?.off('watch:pong', onPong), 5000)

  const send = () => socket?.emit('watch:ping', { sent: Date.now() })

  const onPong = ({ sent, serverTime }) => {
    const now = Date.now()
    const rtt = now - sent
    samples.push({ offset: serverTime + rtt / 2 - now, rtt })
    /* Fastest, not median. See the note at the top. */
    offset = samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset
    if (samples.length < PING_SAMPLES) {
      setTimeout(send, 90)
    } else {
      clearTimeout(deadline)
      socket?.off('watch:pong', onPong)
    }
  }

  socket.on('watch:pong', onPong)
  send()
}

function connect() {
  disconnect()
  if (!config.server || !config.token || !config.roomId) {
    status = 'not configured'
    return
  }

  snapshot = null
  status = 'connecting'
  void broadcast()
  socket = io(config.server, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { token: config.token },
    extraHeaders: { 'ngrok-skip-browser-warning': 'true' },
  })

  socket.on('connect', () => {
    status = 'connected'
    /* The stage has to be open before the server will accept a control from
       this socket — `watch:control` is gated on it having been joined. */
    socket.emit('watch:open', { roomId: config.roomId })
    socket.emit('watch:sync-request', { roomId: config.roomId })
    measureClock()
  })

  socket.on('watch:stream-ready', (incoming) => {
    streamReady = incoming?.roomId === config.roomId
  })

  socket.on('fun:react', (event) => {
    if (event?.roomId === config.roomId) void broadcast({ kind: 'reaction', event })
  })

  socket.on('watch:state', (incoming) => {
    if (incoming?.roomId !== config.roomId) return
    snapshot = incoming
    void broadcast()
  })

  socket.on('disconnect', () => {
    status = 'disconnected'
    streamReady = false
    snapshot = null
    void broadcast()
  })
  socket.on('connect_error', (error) => {
    status = `refused: ${error?.message ?? 'unknown'}`
  })

  resyncTimer = setInterval(measureClock, RESYNC_MS)
}

function disconnect() {
  streamReady = false
  if (resyncTimer !== null) {
    clearInterval(resyncTimer)
    resyncTimer = null
  }
  if (!socket) return
  try {
    socket.emit('watch:close', { roomId: config.roomId })
    socket.disconnect()
  } catch {
    /* Already gone. Nothing to unwind. */
  }
  socket = null
}

/**
 * Tell the room what is playing, from the tab that is actually watching it.
 *
 * The room already has a place for exactly this — the same "external" queue
 * entry the app's own Watch tab writes when somebody picks "Netflix, Prime,
 * others" and types a title by hand. This writes the identical shape, so
 * everything downstream (the web app's synced-countdown view, anyone else's
 * extension tab, the queue list) treats it exactly the same either way — the
 * page just supplies a truer title than a person guessing from a bare URL.
 */
async function announce(title, url, position) {
  if (!socket?.connected) throw new Error('Connection lost — wait for Huddle to reconnect.')
  if (!streamReady) throw new Error('Huddle’s server needs the streaming update. If it was just restarted, reconnect and try again.')
  if (!Number.isFinite(position) || position < 0) throw new Error('Wait for the video to finish loading, then try again.')
  const connection = socket
  const { server, token, roomId } = config

  const response = await fetch(`${server}/api/rooms/${roomId}/watch/queue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ source: 'external', ref: url, title }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? `Could not add that (${response.status})`)

  const itemId = body?.item?.id
  if (!itemId) throw new Error('The server did not say what it added.')

  if (connection !== socket || !connection.connected || !streamReady) {
    throw new Error('The room connection changed. The title was queued but playback did not start.')
  }
  const reply = await connection.timeout(5000)
    .emitWithAck('watch:stream-start', { roomId, itemId, position })
    .catch(() => null)
  if (!reply?.ok) throw new Error(reply?.error ?? 'The room did not confirm the start. Check the connection and try again.')
}

/** Turn a room code into the id every socket event is keyed on. */
async function resolveRoom(server, token, code) {
  const response = await fetch(`${server}/api/rooms/join`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'ngrok-skip-browser-warning': 'true',
    },
    body: JSON.stringify({ code }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new Error(body?.error ?? `Could not join that room (${response.status})`)
  const id = body?.room?.id ?? body?.id
  if (!id) throw new Error('The server did not say which room that is.')
  return id
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  ;(async () => {
    if (message?.kind === 'announce') {
      try {
        await announce(String(message.title ?? '').trim() || 'Untitled', String(message.url ?? ''), message.position)
        respond({ ok: true })
      } catch (error) {
        respond({ ok: false, error: error?.message ?? String(error) })
      }
      return
    }

    if (message?.kind === 'watch-focus') {
      if (message.roomId !== config.roomId || !_sender.tab || !socket?.connected) {
        respond({ watching: false })
        return
      }
      const item = snapshot?.item
      const expected = item?.source === 'external' ? globalThis.__huddleStreamingIdentity(item.ref) : null
      const [active] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => [])
      let actual = globalThis.__huddleStreamingIdentity(active?.url)
      if (expected?.startsWith('net77:') && active?.id !== undefined &&
          /^https:\/\/(?:www\.)?(?:net77|net52)\.cc\//.test(active.url ?? '')) {
        const reply = await chrome.tabs.sendMessage(active.id, { kind: 'net77-active' }, { frameId: 0 }).catch(() => null)
        actual = globalThis.__huddleStreamingIdentity(reply?.url)
      }
      respond({ watching: active?.id === _sender.tab.id || Boolean(expected && expected === actual) })
      return
    }

    if (message?.kind === 'react') {
      if (socket?.connected && snapshot?.item?.id === message.itemId) {
        socket.emit('fun:react', { roomId: config.roomId, reaction: message.reaction })
      }
      respond({ ok: true })
      return
    }

    if (message?.kind === 'control') {
      if (!socket?.connected) {
        respond({ ok: false, error: 'Connection lost — controls were not sent.' })
        return
      }
      if (!snapshot?.item || message.roomId !== config.roomId || message.itemId !== snapshot.item.id) {
        respond({ ok: false, error: 'The room switched titles before this control arrived.' })
        return
      }
      const { action, position } = message.control ?? {}
      socket.emit('watch:control', { roomId: config.roomId, action, position })
      respond({ ok: true })
      return
    }

    if (message?.kind === 'hello') {
      /* A tab announcing itself gets the room immediately rather than waiting
         for the next change, which on a paused film is never. */
      const tabId = _sender?.tab?.id
      if (tabId !== undefined) {
        /*
         * Answered even with no snapshot yet, and carrying the status.
         *
         * It used to stay silent unless there was a snapshot, which left the
         * tab unable to tell "the extension is not set up" from "it is
         * connected and the room is empty". The overlay rendered both as "not
         * connected" and disabled the button that would have started
         * something — on a page where the socket was working the whole time.
         */
        chrome.tabs
          .sendMessage(tabId, { kind: 'room', snapshot, offset, status })
          .catch(() => undefined)
      }
      respond({ ok: true })
      return
    }

    if (message?.kind === 'configure') {
      /*
       * Handed over by the Huddle tab, rather than typed into the popup.
       *
       * Reconnects only when something actually differs. The page that sends
       * this re-renders for reasons that have nothing to do with the room —
       * somebody walking in, a queue changing — and tearing a working socket
       * down to rebuild the identical one would drop the stage membership
       * that `watch:control` is gated on, mid-film.
       */
      const server = String(message.server ?? '').replace(/\/$/, '')
      const roomId = String(message.roomId ?? '')
      const token = String(message.token ?? '')
      if (!server || !roomId || !token) {
        respond({ ok: false, error: 'incomplete configuration' })
        return
      }

      const same = server === config.server && roomId === config.roomId && token === config.token
      config = { server, token, roomId, roomCode: String(message.roomName ?? config.roomCode) }
      await chrome.storage.local.set(config)
      if (!same || !socket?.connected) connect()
      respond({ ok: true })
      return
    }

    if (message?.kind === 'state') {
      respond(state())
      return
    }

    if (message?.kind === 'save') {
      try {
        const server = String(message.server ?? '').trim().replace(/\/$/, '')
        const token = String(message.token ?? '').trim()
        const code = String(message.code ?? '').trim()
        const roomId = await resolveRoom(server, token, code)
        config = { server, token, roomId, roomCode: code }
        await chrome.storage.local.set(config)
        connect()
        respond({ ok: true, roomId })
      } catch (error) {
        respond({ ok: false, error: error?.message ?? String(error) })
      }
      return
    }

    respond({ ok: false, error: 'unknown message' })
  })()
  /* Keeps the channel open for the async work above. */
  return true
})

void load().then(() => {
  if (config.server && config.token && config.roomId) connect()
})
