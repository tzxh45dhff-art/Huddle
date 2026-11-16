/** NetMirror's visible HTML video, in the document that owns it. */
;(() => {
  const bridge = 'huddle-net77-frame'
  const originPattern = /^https:\/\/(?:www\.)?(?:net77|net52)\.cc$/
  const keyPattern = /^[a-z0-9_-]{1,80}$/i
  const numberPattern = /^\d{1,5}$/
  const readAttr = (body, name) => {
    const value = body?.getAttribute(name)?.trim()
    return value && !/^(?:null|undefined|none)$/i.test(value) ? value : ''
  }

  function read(doc) {
    const videos = Array.from(doc.querySelectorAll('video')).filter(video =>
      video.getClientRects().length && Number.isFinite(video.duration) && video.duration >= 120 &&
      !video.closest('.jw-flag-ads, .ad-showing, [data-ad-playing="true"]'),
    )
    if (videos.length !== 1) return null

    const body = doc.body
    const series = readAttr(body, 'data-series_id') || readAttr(body, 'data-id')
    const title = readAttr(body, 'data-title')
    const season = readAttr(body, 'data-senum')
    const episode = readAttr(body, 'data-epnum')
    const episodeName = readAttr(body, 'data-eptitle')
    if (!keyPattern.test(series) || !title) return null
    if ((season || episode || episodeName) && (!numberPattern.test(season) || !numberPattern.test(episode))) return null

    return {
      video: videos[0],
      key: (episode ? `${series}.${Number(season)}.${Number(episode)}` : series).toLowerCase(),
      title: (episode ? `${title} · S${Number(season)} E${Number(episode)}` : title).slice(0, 200),
    }
  }

  function state(video, event) {
    return {
      position: video?.currentTime ?? 0,
      duration: video?.duration ?? 0,
      paused: video?.paused ?? true,
      rate: video?.playbackRate ?? 1,
      seeking: !!video?.seeking,
      seekEvent: event?.type,
      buffering: !!video && !video.paused && video.readyState < 3,
    }
  }

  function control(video, { command, seconds, rate }) {
    try {
      if (command === 'play') void video.play().catch(() => undefined)
      else if (command === 'pause') video.pause()
      else if (command === 'seek' && Number.isFinite(seconds)) video.currentTime = Math.min(video.duration, Math.max(0, seconds))
      else if (command === 'rate' && Number.isFinite(rate)) video.playbackRate = Math.min(1.25, Math.max(0.75, rate))
    } catch {
      // A provider can replace the video while a command is in flight.
    }
  }

  window.__huddleNet77Media = { bridge, originPattern, read, state, control }
  if (window === window.top || window.parent !== window.top) return

  let parentOrigin
  try {
    parentOrigin = new URL(document.referrer).origin
  } catch {
    parentOrigin = null
  }
  if (!originPattern.test(parentOrigin)) parentOrigin = null

  let hadTitle = false
  function report(event) {
    if (!parentOrigin) return
    const active = read(document)
    if (event && active?.video !== event.target) return
    if (!active && !hadTitle) return
    hadTitle = !!active
    window.parent.postMessage({
      channel: bridge, kind: 'state',
      media: active ? { key: active.key, title: active.title, ...state(active.video, event) } : null,
    }, parentOrigin)
  }
  for (const event of ['seeking', 'seeked', 'play', 'pause']) document.addEventListener(event, report, true)
  window.addEventListener('message', event => {
    if (event.source !== window.parent || !originPattern.test(event.origin) || event.data?.channel !== bridge) return
    if (event.data.kind === 'hello') {
      parentOrigin = event.origin
      report()
      return
    }
    if (event.data.kind !== 'command' || event.origin !== parentOrigin) return
    const active = read(document)
    if (active && event.data.titleKey === active.key) control(active.video, event.data)
  })
  report()
  setInterval(report, 250)
})()
