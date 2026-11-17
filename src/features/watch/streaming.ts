import { api } from '@/lib/api'

export type StreamProvider = 'prime' | 'hotstar' | 'net77'
export type StreamOffer = { provider: StreamProvider; access: 'subscription' | 'free'; url: string }
export type StreamTitle = {
  id: string
  title: string
  kind: 'movie' | 'series'
  year: number | null
  runtime: number | null
  overview: string
  genres: string[]
  poster: string | null
  backdrop: string | null
  offers: StreamOffer[]
}
export type StreamEpisode = { season: string; episode: string; title: string; offers: StreamOffer[] }
export type CatalogSource = 'live' | 'cached' | 'offline' | 'limited' | 'unconfigured'
export type CatalogPage = { titles: StreamTitle[]; next: string | null; source: CatalogSource }
export type StreamDetails = { title: StreamTitle | null; episodes: StreamEpisode[]; source: CatalogSource }
export type Checkpoint = {
  mediaKey: string
  title: string
  ref: string
  thumbnail: string | null
  position: number
  duration: number | null
  updatedAt: string
}
export const PROVIDERS = {
  hotstar: { name: 'JioHotstar', url: 'https://www.hotstar.com/in' },
  prime: { name: 'Prime Video', url: 'https://www.primevideo.com/' },
  net77: { name: 'NetMirror', url: 'https://net77.cc/home' },
} as const

export type NetMirrorTitle = {
  id: string
  title: string
  year: number | null
  kind: 'movie' | 'series' | null
}
type NetMirrorCatalog = { status: 'ok' | 'closed' | 'unavailable'; items?: NetMirrorTitle[] }

export function netMirrorCatalog(roomId: string, query: string, type: 'all' | 'movie' | 'series', signal: AbortSignal) {
  return new Promise<NetMirrorCatalog>((resolve) => {
    const id = crypto.randomUUID()
    function complete(result: NetMirrorCatalog) {
      window.clearTimeout(timeout)
      document.removeEventListener('huddle:net77-catalog-result', reply)
      signal.removeEventListener('abort', cancel)
      resolve(result)
    }
    const cancel = () => complete({ status: 'unavailable' })
    function reply(event: Event) {
      const result = (event as CustomEvent<NetMirrorCatalog & { id: string }>).detail
      if (result?.id === id) complete(result)
    }
    const timeout = window.setTimeout(cancel, 18_000)
    signal.addEventListener('abort', cancel, { once: true })
    document.addEventListener('huddle:net77-catalog-result', reply)
    document.dispatchEvent(new CustomEvent('huddle:net77-catalog', { detail: { id, roomId, query, type } }))
  })
}

export function netMirrorTitleUrl(key: string, title: string) {
  const url = new URL(PROVIDERS.net77.url)
  url.hash = new URLSearchParams({ 'huddle-net77-pick': key, title: title.replace(/\s*· S\d+ E\d+$/, '') }).toString()
  return url.href
}

function endpoint(roomId: string) {
  return `/rooms/${encodeURIComponent(roomId)}/watch/streaming`
}

export function catalogPage(roomId: string, input: { q?: string; cursor?: string } = {}) {
  const params = new URLSearchParams()
  if (input.q) params.set('q', input.q)
  if (input.cursor) params.set('cursor', input.cursor)
  return api.get<CatalogPage>(`${endpoint(roomId)}?${params}`)
}

export function streamingDetails(roomId: string, id: string) {
  return api.get<StreamDetails>(`${endpoint(roomId)}/${encodeURIComponent(id)}`)
}

export function streamingResume(roomId: string) {
  return api.get<{ personal: Checkpoint[]; room: Checkpoint[] }>(`${endpoint(roomId)}/resume`)
}

export function streamKey(ref: string | undefined) {
  if (!ref) return null
  try {
    const url = new URL(ref)
    if (url.protocol !== 'https:') return null
    if (/^(?:www\.)?net77\.cc$/.test(url.hostname) && url.pathname === '/home') {
      const id = /^#huddle-net77=([a-z0-9_-]{1,80}(?:\.\d{1,5}\.\d{1,5})?)$/i.exec(url.hash)?.[1]
      return id ? `net77:${id.toLowerCase()}` : null
    }
    if (/^(?:www\.)?hotstar\.com$/.test(url.hostname)) {
      const id = /\/(\d+)(?:\/watch)?\/?$/.exec(url.pathname)?.[1]
      return id ? `hotstar:${id}` : null
    }
    if (/^(?:www\.)?(?:primevideo\.com|amazon\.(?:in|com))$/.test(url.hostname)) {
      const id = /\/(?:detail|dp)\/([a-z0-9]+)(?:\/|$)/i.exec(url.pathname)?.[1]
      return id ? `prime:${id.toUpperCase()}` : null
    }
  } catch { /* An external queue entry can be plain text. */ }
  return null
}

export type ViewingRequest = {
  roomId: string
  url: string
  title: string
  mode: 'room' | 'solo' | 'join'
  position?: number
  thumbnail?: string | null
}

export function openStreamingTitle(request: ViewingRequest) {
  return new Promise<void>((resolve, reject) => {
    const id = crypto.randomUUID()
    const complete = (error?: string) => {
      window.clearTimeout(timeout)
      document.removeEventListener('huddle:movie-hub-result', reply)
      if (error) reject(new Error(error))
      else resolve()
    }
    const reply = (event: Event) => {
      const result = (event as CustomEvent<{ id: string; ok: boolean; error?: string }>).detail
      if (result?.id === id) complete(result.ok ? undefined : result.error || 'The extension could not open this title.')
    }
    const timeout = window.setTimeout(() => complete('The extension did not respond. Refresh Huddle and try again.'), 9000)
    document.addEventListener('huddle:movie-hub-result', reply)
    document.dispatchEvent(new CustomEvent('huddle:movie-hub-launch', { detail: { ...request, id } }))
  })
}
