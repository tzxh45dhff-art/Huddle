/** Sync only the identifiable, visible player on net77.cc. */
;(() => {
  const keyPattern = /^[a-z0-9_-]{1,80}$/i
  const numberPattern = /^[0-9]{1,5}$/
  const frameSelector = '#player iframe, iframe.player-iframe, .player-iframe iframe'

  function player() {
    // The desktop site can use a same-origin player frame or a local video.
    const candidates = []
    for (const frame of document.querySelectorAll(frameSelector)) {
      if (!frame.getClientRects().length || !frame.contentDocument) continue
      candidates.push(...frame.contentDocument.querySelectorAll('video'))
    }
    candidates.push(...document.querySelectorAll('video'))

    const videos = candidates.filter(video =>
      video.getClientRects().length && Number.isFinite(video.duration) && video.duration >= 120,
    )
    if (videos.length !== 1) return null

    const video = videos[0]
    if (video.closest('.jw-flag-ads, .ad-showing, [data-ad-playing="true"]')) return null
    const body = video.ownerDocument.body
    const series = body?.getAttribute('data-series_id')?.trim()
    const title = body?.getAttribute('data-title')?.trim()
    const season = body?.getAttribute('data-senum')?.trim() || ''
    const episode = body?.getAttribute('data-epnum')?.trim() || ''
    const episodeName = body?.getAttribute('data-eptitle')?.trim() || ''
    if (!series || !keyPattern.test(series) || !title) return null
    if ((season || episode || episodeName) && (!numberPattern.test(season) || !numberPattern.test(episode))) return null

    const key = (episode ? `${series}.${Number(season)}.${Number(episode)}` : series).toLowerCase()
    return {
      video, key, url: `https://net77.cc/home#huddle-net77=${key}`,
      title: (episode ? `${title} · S${Number(season)} E${Number(episode)}` : title).slice(0, 200),
    }
  }

  let active = null
  window.__huddleNet77Title = () => active
  chrome.runtime.onMessage.addListener((message, _, reply) => {
    if (message?.kind === 'net77-active') reply({ url: player()?.url })
  })

  function report(event) {
    if (event && event.target !== active?.video) return
    const current = player()
    if (event && current?.video !== event.target) return
    if (current?.video !== active?.video) {
      active?.video.removeEventListener('seeking', report)
      active?.video.removeEventListener('seeked', report)
      current?.video.addEventListener('seeking', report)
      current?.video.addEventListener('seeked', report)
    }
    active = current
    const video = active?.video
    window.postMessage({
      channel: 'huddle', kind: 'state', at: performance.now(),
      titleKey: active?.key ?? null, ready: !!active,
      position: video?.currentTime ?? 0, duration: video?.duration ?? 0,
      paused: video?.paused ?? true, rate: video?.playbackRate ?? 1,
      seeking: !!video?.seeking, seekEvent: event?.type,
      buffering: !!video && !video.paused && video.readyState < 3,
    }, '*')
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.data?.channel !== 'huddle' || event.data.kind !== 'command') return
    const current = player()
    if (!active || !current || current.key !== event.data.titleKey || current.video !== active.video) return
    const { command, seconds, rate } = event.data
    const { video } = current
    try {
      if (command === 'play') void video.play().catch(() => undefined)
      else if (command === 'pause') video.pause()
      else if (command === 'seek' && Number.isFinite(seconds)) video.currentTime = Math.min(video.duration, Math.max(0, seconds))
      else if (command === 'rate' && Number.isFinite(rate)) video.playbackRate = Math.min(1.25, Math.max(0.75, rate))
    } catch {
      // A provider can replace the video while a command is in flight.
    }
  })

  window.__huddleStartSync({ name: 'Net77' })
  report()
  setInterval(report, 250)
})()
