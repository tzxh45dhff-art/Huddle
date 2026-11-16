;(() => {
  function identity(raw) {
    try {
      const url = new URL(raw)
      if (url.protocol !== 'https:') return null
      const host = url.hostname
      let id
      if (host === 'hotstar.com' || host.endsWith('.hotstar.com')) {
        id = /\/(\d+)(?:\/watch)?\/?$/.exec(url.pathname)?.[1]
        return id ? 'hotstar:' + id : null
      }
      if (host === 'netflix.com' || host.endsWith('.netflix.com')) {
        id = /\/watch\/(\d+)/.exec(url.pathname)?.[1]
        return id ? 'netflix:' + id : null
      }
      if (host === 'primevideo.com' || host.endsWith('.primevideo.com') || /^(?:www\.)?amazon\.(?:com|co\.uk|in|de|co\.jp)$/.test(host)) {
        id = /\/(?:detail|gp\/video\/detail)\/([A-Z0-9]+)/i.exec(url.pathname)?.[1]
        return id ? 'prime:' + id.toUpperCase() : null
      }
    } catch {}
    return null
  }
  globalThis.__huddleStreamingIdentity = identity
  if (typeof window === 'undefined') return
  window.__huddleRoomUrl = room => identity(room?.item?.ref) ? room.item.ref : null
  window.__huddleMatchesRoom = room => {
    const local = identity(location.href)
    return !!local && room?.item?.source === 'external' && local === identity(room.item.ref)
  }
})()
