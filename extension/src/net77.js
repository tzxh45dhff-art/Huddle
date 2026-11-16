/** Keep one room connection in the tab, even when the player is in another origin. */
;(() => {
  const media = window.__huddleNet77Media
  const frameSelector = '#player iframe, iframe#player, iframe.player-iframe, .player-iframe iframe, iframe[src]'
  const frameStates = new WeakMap()
  const probes = new WeakMap()
  const keyPattern = /^[a-z0-9_-]{1,80}(?:\.\d{1,5}\.\d{1,5})?$/
  const frameOrigin = frame => {
    try { return new URL(frame.src, location.href).origin } catch { return '' }
  }
  const visibleFrames = () => Array.from(document.querySelectorAll(frameSelector)).filter(frame =>
    frame.getClientRects().length && media.originPattern.test(frameOrigin(frame)),
  )

  function player() {
    const candidates = []
    const local = media.read(document)
    if (local) candidates.push(local)
    for (const frame of visibleFrames()) {
      if (frame.contentDocument) {
        const active = media.read(frame.contentDocument)
        if (active) candidates.push(active)
      } else {
        const report = frameStates.get(frame)
        if (report?.src === frame.src && performance.now() - report.seen < 4000) {
          candidates.push({ ...report.media, frame, origin: report.origin })
        }
      }
    }
    if (candidates.length !== 1) return null
    const current = candidates[0]
    return { ...current, url: `https://net77.cc/home#huddle-net77=${current.key}` }
  }

  let active = null
  const events = ['seeking', 'seeked', 'play', 'pause']
  window.__huddleNet77Title = () => active
  window.__huddleNet77PlayerOpen = () => Array.from(document.querySelectorAll('#player, .player-iframe'))
    .some(node => node.getClientRects().length && !node.classList.contains('hide'))
  chrome.runtime.onMessage.addListener((message, _, reply) => {
    if (message?.kind === 'net77-active') reply({ url: player()?.url })
  })

  function report(event, frameEvent) {
    if (event && event.target !== active?.video) return
    const current = player()
    if (event && current?.video !== event.target) return
    if (current?.video !== active?.video) {
      for (const type of events) {
        active?.video?.removeEventListener(type, report)
        current?.video?.addEventListener(type, report)
      }
    }
    active = current
    const reading = active?.frame ? frameStates.get(active.frame).media : media.state(active?.video, event)
    window.postMessage({
      ...reading,
      channel: 'huddle', kind: 'state', at: performance.now(),
      titleKey: active?.key ?? null, ready: !!active,
      seekEvent: active?.frame ? frameEvent : reading.seekEvent,
    }, '*')
  }

  function receiveFrame(event) {
    if (!media.originPattern.test(event.origin)) return
    const frame = visibleFrames().find(candidate => candidate.contentWindow === event.source)
    if (!frame || frame.contentDocument) return
    const value = event.data.media
    if (!value || typeof value.key !== 'string' || !keyPattern.test(value.key) ||
        typeof value.title !== 'string' || !value.title.trim() ||
        !Number.isFinite(value.position) || !Number.isFinite(value.duration) || value.duration < 120) {
      frameStates.delete(frame)
      report()
      return
    }
    frameStates.set(frame, {
      src: frame.src, seen: performance.now(), origin: event.origin,
      media: {
        key: value.key, title: value.title.slice(0, 200), position: value.position, duration: value.duration,
        paused: value.paused === true, rate: Number.isFinite(value.rate) ? value.rate : 1,
        seeking: value.seeking === true, buffering: value.buffering === true,
      },
    })
    report(undefined, value.seekEvent === 'seeked' ? 'seeked' : undefined)
  }

  window.addEventListener('message', event => {
    const data = event.data
    if (data?.channel === media.bridge && data.kind === 'state') return receiveFrame(event)
    if (event.source !== window || data?.channel !== 'huddle' || data.kind !== 'command') return
    const current = player()
    if (!active || !current || current.key !== data.titleKey ||
        current.video !== active.video || current.frame !== active.frame) return
    if (current.video) media.control(current.video, data)
    else current.frame.contentWindow.postMessage({ ...data, channel: media.bridge }, current.origin)
  })

  window.__huddleStartSync({ name: 'Net77' })
  report()
  setInterval(() => {
    // An iframe can suppress its referrer or redirect between the two hosts.
    // Establish the channel with only a trusted, visible frame in this tab.
    for (const frame of visibleFrames()) {
      if (frame.contentDocument || !frame.contentWindow) continue
      const now = performance.now()
      if (now - (frameStates.get(frame)?.seen ?? -Infinity) < 4000 ||
          now - (probes.get(frame) ?? -Infinity) < 2000) continue
      probes.set(frame, now)
      for (const origin of ['https://net77.cc', 'https://www.net77.cc', 'https://net52.cc', 'https://www.net52.cc']) {
        frame.contentWindow.postMessage({ channel: media.bridge, kind: 'hello' }, origin)
      }
    }
    report()
  }, 250)
})()
