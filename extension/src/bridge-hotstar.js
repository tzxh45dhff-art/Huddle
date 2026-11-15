/** Experimental desktop adapter. Live streams are excluded until their timelines are verified. */
;(() => {
  function playback() {
    const match = /\/(\d+)\/watch\/?$/.exec(location.pathname)
    if (!match) return null
    const videos = [...document.querySelectorAll('video')].filter(video =>
      video.getClientRects().length && Number.isFinite(video.duration) && video.duration >= 120,
    )
    if (videos.length !== 1) return null
    const ad = document.querySelector('.ad-showing, [data-ad-playing="true"], [data-testid="ad-countdown"]')
    if (ad?.getClientRects().length) return null
    return { video: videos[0], key: match[1] }
  }
  setInterval(() => {
    const active = playback()
    const video = active?.video
    window.postMessage({
      channel: 'huddle', kind: 'state', at: performance.now(),
      titleKey: active?.key ?? null, ready: !!active,
      position: video?.currentTime ?? 0, duration: video?.duration ?? 0,
      paused: video?.paused ?? true, rate: video?.playbackRate ?? 1,
      buffering: !!video && !video.paused && video.readyState < 3,
    }, '*')
  }, 250)
  window.addEventListener('message', event => {
    if (event.source !== window) return
    const data = event.data
    if (data?.channel !== 'huddle' || data.kind !== 'command') return
    const active = playback()
    if (!active) return
    const video = active.video
    try {
      if (data.command === 'play') void video.play().catch(() => undefined)
      else if (data.command === 'pause') video.pause()
      else if (data.command === 'seek' && Number.isFinite(data.seconds)) {
        video.currentTime = Math.min(video.duration, Math.max(0, data.seconds))
      } else if (data.command === 'rate' && Number.isFinite(data.rate)) {
        video.playbackRate = Math.min(1.25, Math.max(0.75, data.rate))
      }
    } catch {
      // Playback can replace its media element while a command is arriving.
    }
  })
})()
