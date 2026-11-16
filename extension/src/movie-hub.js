const STORE = 'movieHubTabs'
const LAUNCH_LIFETIME = 10 * 60_000
const SEEK_RETRY = 3500
const CHECKPOINT_MS = 25_000

function providerIdentity(raw) {
  try {
    const url = new URL(raw)
    if (url.port || url.username || url.password ||
        !/^(?:www\.)?(?:primevideo\.com|hotstar\.com|amazon\.(?:in|com))$/.test(url.hostname)) return null
    const identity = globalThis.__huddleStreamingIdentity(url.href)
    return /^(?:prime|hotstar):/.test(identity ?? '') ? identity : null
  } catch {
    return null
  }
}

async function playbackUrl(raw) {
  const url = new URL(raw)
  if (url.origin !== 'https://app.primevideo.com') return url
  const gti = url.searchParams.get('gti')
  if (url.pathname !== '/detail' || !/^amzn1\.dv\.gti\.[a-f0-9-]{36}$/i.test(gti ?? '')) return null
  // Prime's public app link redirects to the web ID of this exact asset.
  const link = new URL('/detail', url.origin)
  link.searchParams.set('gti', gti)
  link.searchParams.set('action', 'play')
  const result = await fetch(link, {
    credentials: 'omit', signal: AbortSignal.timeout(6500),
  })
  if (result.body) void result.body.cancel().catch(() => undefined)
  return result.ok && result.url ? new URL(result.url) : null
}

export function createMovieHub({ getConfig, getSnapshot, canStart, announce, sendRoom }) {
  const tabs = new Map()
  const progress = new Map()
  let loaded
  let launchQueue = Promise.resolve()
  let saves = Promise.resolve()

  function load() {
    loaded ??= chrome.storage.session?.get(STORE).then((stored) => {
      for (const [id, intent] of Object.entries(stored[STORE] ?? {})) tabs.set(Number(id), intent)
    }).catch(() => undefined) ?? Promise.resolve()
    return loaded
  }

  function save() {
    const copy = Object.fromEntries([...tabs].map(([id, { starting: _, ...intent }]) => [id, intent]))
    saves = saves.then(() => chrome.storage.session?.set({ [STORE]: copy })).catch(() => undefined)
    return saves
  }

  function suppress(id) {
    const intent = tabs.get(id)
    return intent && (intent.mode === 'solo' || intent.expires > Date.now())
  }

  async function forget(id) {
    await load()
    progress.delete(id)
    if (tabs.delete(id)) await save()
  }

  chrome.tabs.onRemoved?.addListener((id) => void forget(id))

  function launch(input) {
    const next = launchQueue.then(() => open(input))
    launchQueue = next.catch(() => undefined)
    return next
  }

  async function open(input) {
    await load()
    const config = getConfig()
    if (!config.roomId || config.roomId !== input.roomId ||
        !['room', 'solo', 'join'].includes(input.mode)) return { ok: false, error: 'Open a supported title from this Huddle room.' }

    const url = await playbackUrl(input.url).catch(() => null)
    const identity = url && providerIdentity(url.href)
    if (!identity) return { ok: false, error: 'The provider could not resolve this title. Open it on the provider and use the Huddle panel.' }
    if (getConfig().roomId !== config.roomId || getConfig().server !== config.server) {
      return { ok: false, error: 'The Huddle room changed while the title was opening.' }
    }
    const ref = url.origin + url.pathname
    const sameTitle = providerIdentity(getSnapshot()?.item?.ref) === identity
    const mode = input.mode === 'room' && sameTitle ? 'join' : input.mode
    if (mode === 'join' && !sameTitle) {
      return { ok: false, error: 'The room changed titles. Return to Huddle to join the new one.' }
    }

    let tabId
    try {
      const tab = await chrome.tabs.create({ url: 'about:blank' })
      tabId = tab.id
      if (tabId === undefined) throw new Error('No tab opened')
      if (mode !== 'join') {
        // Only the latest room launch can switch a given room.
        for (const [id, other] of tabs) {
          if (mode === 'room' && other.mode === 'room' && other.roomId === input.roomId) tabs.delete(id)
        }
        tabs.set(tabId, {
          identity, mode, roomId: config.roomId, server: config.server,
          expires: Date.now() + LAUNCH_LIFETIME, seeks: 0, seekAt: 0,
          title: String(input.title ?? '').trim().slice(0, 200) || 'Streaming title',
          thumbnail: typeof input.thumbnail === 'string' && /^https:\/\//.test(input.thumbnail) ? input.thumbnail.slice(0, 600) : null,
          position: Number.isFinite(input.position) ? Math.min(86400, Math.max(0, input.position)) : null,
        })
        await save()
      }
      await chrome.tabs.update(tabId, { url: ref })
      return { ok: true }
    } catch {
      if (tabId !== undefined) {
        await forget(tabId)
        await chrome.tabs.remove(tabId).catch(() => undefined)
      }
      return { ok: false, error: 'Could not open the streaming tab.' }
    }
  }

  async function observe(message, sender) {
    const tabId = sender.tab?.id
    const identity = providerIdentity(sender.url)
    if (tabId === undefined || !identity || !Number.isFinite(message.position) || !Number.isFinite(message.duration) ||
        message.duration <= 0 || message.duration > 86400 || message.position < 0 || message.position > message.duration + 1 ||
        !message.ready || message.buffering || message.seeking) return
    const url = new URL(sender.url)
    const ref = url.origin + url.pathname

    await load()
    const config = getConfig()
    let intent = tabs.get(tabId)
    if (intent && (config.roomId !== intent.roomId || config.server !== intent.server ||
        (intent.expires < Date.now() && !(intent.mode === 'solo' && intent.position === null)))) {
      await forget(tabId)
      sendRoom(tabId)
      intent = undefined
    }
    if (intent && identity !== intent.identity) return

    if (intent && !intent.starting && intent.position !== null) {
      const position = Math.min(message.duration, intent.position)
      if (Math.abs(message.position - position) <= 2.5) {
        intent.position = null
        await save()
      } else {
        if (intent.seeks < 3 && Date.now() - intent.seekAt >= SEEK_RETRY) {
          intent.seekAt = Date.now()
          intent.seeks += 1
          await chrome.tabs.sendMessage(tabId, { kind: 'movie-hub-seek', identity, position }).catch(() => undefined)
        } else if (intent.seeks === 3 && Date.now() - intent.seekAt >= SEEK_RETRY) {
          intent.seeks += 1
          await chrome.tabs.sendMessage(tabId, {
            kind: 'movie-hub-error', error: 'The provider could not seek to your saved time. Move the playhead there to resume.',
          }).catch(() => undefined)
        }
        return
      }
    }

    if (intent?.mode === 'room') {
      if (message.paused || intent.starting || intent.failed || !canStart()) return
      intent.starting = true
      try {
        await announce(intent.title, ref, message.position, {
          duration: Math.round(message.duration), thumbnail: intent.thumbnail,
        }, () => tabs.get(tabId) === intent)
        await forget(tabId)
        sendRoom(tabId)
      } catch {
        if (tabs.get(tabId) === intent) {
          intent.failed = true
          await save()
          await chrome.tabs.sendMessage(tabId, {
            kind: 'movie-hub-error', error: 'The room could not switch automatically. Use the Huddle panel to start this title.',
          }).catch(() => undefined)
        }
      } finally {
        intent.starting = false
      }
      return
    }

    const item = getSnapshot()?.item
    const shared = intent?.mode !== 'solo' && item?.source === 'external' && providerIdentity(item.ref) === identity
    if ((!shared && intent?.mode !== 'solo') || !config.token || message.position < 5) return
    const before = progress.get(tabId)
    const ended = message.position >= message.duration - 8
    if (before?.identity === identity && (before.ended || (!ended &&
        (message.paused && before.paused || Date.now() - before.at < CHECKPOINT_MS && !message.paused)))) return
    const saved = { identity, paused: message.paused, ended, at: Date.now() }
    progress.set(tabId, saved)
    const response = await fetch(`${config.server}/api/rooms/${config.roomId}/watch/streaming/resume`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.token}`, 'ngrok-skip-browser-warning': 'true' },
      body: JSON.stringify({
        url: ref, title: (intent?.title ?? item?.title ?? 'Streaming title').slice(0, 200),
        thumbnail: intent?.thumbnail, position: message.position,
        duration: message.duration, shared, ended,
      }),
    }).catch(() => null)
    if (!response?.ok && progress.get(tabId) === saved) progress.delete(tabId)
  }

  return { load, launch, observe, suppress, forget }
}
