import { createHash } from 'node:crypto'

import { env } from '../config/env.js'
import { prisma } from '../models/prisma.js'

type Provider = 'prime' | 'hotstar'

export type StreamOffer = {
  provider: Provider
  access: 'subscription' | 'free'
  url: string
}

export type StreamTitle = {
  id: string
  title: string
  kind: 'movie' | 'series'
  year: number | null
  overview: string
  runtime: number | null
  genres: string[]
  poster: string | null
  backdrop: string | null
  offers: StreamOffer[]
}

export type StreamEpisode = {
  season: string
  episode: string
  title: string
  offers: StreamOffer[]
}

type CatalogPage = { titles: StreamTitle[]; next: string | null }
type CatalogDetails = { title: StreamTitle | null; episodes: StreamEpisode[] }
type Source = 'live' | 'cached' | 'offline' | 'limited' | 'unconfigured'

const apiBase = 'https://api.movieofthenight.com/v4'
const ttl = 24 * 60 * 60 * 1000
const pending = new Map<string, Promise<{ value: unknown; source: Source }>>()
const noPage: CatalogPage = { titles: [], next: null }

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []
const short = (value: unknown, limit = 200) => typeof value === 'string' ? value.trim().slice(0, limit) : ''
const numeric = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null

export function streamingIdentity(raw: string) {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
    const host = url.hostname
    const hotstar = host === 'hotstar.com' || host === 'www.hotstar.com'
    const prime = /^(?:www\.)?(?:primevideo\.com|amazon\.(?:in|com))$/.test(host)
    const gti = host === 'app.primevideo.com' && url.pathname === '/detail'
      ? url.searchParams.get('gti') : null
    if (gti && /^amzn1\.dv\.gti\.[a-f0-9-]{36}$/i.test(gti)) {
      const link = new URL('https://app.primevideo.com/detail')
      link.searchParams.set('gti', gti.toLowerCase())
      if (url.searchParams.get('action') === 'play') link.searchParams.set('action', 'play')
      return { provider: 'prime' as const, key: gti.toUpperCase(), url: link }
    }
    const id = hotstar
      ? /^\/in\/(?:movies|shows)\/.+?\/(\d+)(?:\/watch)?\/?$/.exec(url.pathname)?.[1]
      : prime ? /\/(?:detail|dp)\/([a-z0-9]+)(?:\/|$)/i.exec(url.pathname)?.[1] : undefined
    if (!id) return null
    return { provider: (hotstar ? 'hotstar' : 'prime') as Provider, key: hotstar ? id : id.toUpperCase(), url: new URL(url.origin + url.pathname) }
  } catch {
    return null
  }
}

function art(value: unknown) {
  try {
    const url = new URL(short(value, 1500))
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch { return null }
}

function offers(data: unknown, preferPlayback = true): StreamOffer[] {
  const seen = new Set<Provider>()
  const options = list(object(data).in).map(object)
  options.sort((a, b) => Number(b.type === 'subscription') - Number(a.type === 'subscription'))
  return options.flatMap((option) => {
    const provider = object(option.service).id
    const access = option.type
    if ((provider !== 'prime' && provider !== 'hotstar') || (access !== 'subscription' && access !== 'free') ||
        seen.has(provider) || option.addon) return []
    const video = preferPlayback ? streamingIdentity(short(option.videoLink, 1000)) : null
    const verified = video?.provider === provider ? video : streamingIdentity(short(option.link, 1000))
    if (verified?.provider !== provider) return []
    if (typeof option.expiresOn === 'number' && option.expiresOn * 1000 <= Date.now()) return []
    seen.add(provider)
    return [{ provider, access, url: verified.url.href }]
  })
}

function title(value: unknown): StreamTitle | null {
  const row = object(value)
  const id = short(row.id, 64)
  const title = short(row.title)
  if (!/^[a-z0-9_-]+$/i.test(id) || !title || (row.showType !== 'movie' && row.showType !== 'series')) return null
  const imageSet = object(row.imageSet)
  const poster = object(imageSet.verticalPoster)
  const backdrop = object(imageSet.horizontalBackdrop)
  const links = offers(row.streamingOptions, row.showType === 'movie')
  if (!links.length) return null
  return {
    id, title, kind: row.showType,
    year: numeric(row.releaseYear) ?? numeric(row.firstAirYear),
    runtime: numeric(row.runtime),
    overview: short(row.overview, 900),
    genres: list(row.genres).map(value => short(object(value).name, 40)).filter(Boolean).slice(0, 6),
    poster: art(poster.w360 ?? poster.w480 ?? poster.w600),
    backdrop: art(backdrop.w1080 ?? backdrop.w720 ?? object(imageSet.horizontalPoster).w1080),
    offers: links,
  }
}

function parsePage(raw: unknown, search: boolean): CatalogPage {
  const response = object(raw)
  return {
    titles: list(search ? raw : response.shows).map(title).filter(row => row !== null),
    next: !search && response.hasMore === true && typeof response.nextCursor === 'string'
      ? response.nextCursor.slice(0, 600) : null,
  }
}

function parseDetails(raw: unknown): CatalogDetails {
  const row = object(raw)
  const episodes = list(row.seasons).flatMap((value, seasonIndex) => {
    const season = object(value)
    const seasonNumber = /^season\s+(\d+)$/i.exec(short(season.title))?.[1] ?? String(seasonIndex + 1)
    return list(season.episodes).flatMap((value, episodeIndex) => {
      const episode = object(value)
      const links = offers(episode.streamingOptions)
      if (!links.length) return []
      return [{ season: seasonNumber, episode: String(episodeIndex + 1), title: short(episode.title), offers: links }]
    })
  })
  return { title: title(raw), episodes }
}

async function reserve() {
  const month = new Date().toISOString().slice(0, 7)
  return await prisma.$executeRaw`
    INSERT INTO StreamingCatalogBudget (month, used) VALUES (${month}, 1)
    ON CONFLICT (month) DO UPDATE SET used = used + 1 WHERE used < 1000
  ` > 0
}

function decode<T>(row: { payload: string } | null, fallback: T): T {
  try { return row ? JSON.parse(row.payload) as T : fallback } catch { return fallback }
}

async function fetchCached<T>(key: string, path: string, parse: (raw: unknown) => T, fallback: T) {
  const row = await prisma.streamingCatalogPage.findUnique({ where: { key } })
  const cached = decode(row, fallback)
  if (row && row.expiresAt.getTime() > Date.now()) return { value: cached, source: 'cached' as const }
  if (!env.streamingAvailabilityKey) return { value: cached, source: row ? 'cached' as const : 'unconfigured' as const }
  const running = pending.get(key)
  if (running) return await running as { value: T; source: Source }
  const fetchPage = async (): Promise<{ value: T; source: Source }> => {
    if (!await reserve()) return { value: cached, source: 'limited' }
    try {
      const response = await fetch(apiBase + path, {
        headers: { 'X-API-Key': env.streamingAvailabilityKey },
        signal: AbortSignal.timeout(6500),
        redirect: 'error',
      })
      if (response.status === 429) return { value: cached, source: 'limited' }
      if (!response.ok) return { value: cached, source: 'offline' }
      const value = parse(await response.json())
      const data = { payload: JSON.stringify(value), expiresAt: new Date(Date.now() + ttl) }
      await prisma.streamingCatalogPage.upsert({ where: { key }, update: data, create: { key, ...data } })
      return { value, source: 'live' }
    } catch {
      return { value: cached, source: 'offline' }
    }
  }
  const request = fetchPage()
  pending.set(key, request)
  try { return await request } finally { pending.delete(key) }
}

const digest = (value: string) => createHash('sha256').update(value).digest('base64url')
const normalize = (value: string) => value.normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g, ' ')

export async function streamingCatalog(query: string, cursor: string) {
  if (query) {
    const q = normalize(query)
    // Every already-fetched browse page is searchable without a catalog call.
    const pages = await prisma.streamingCatalogPage.findMany({
      where: { key: { startsWith: 'browse:' }, expiresAt: { gt: new Date() } },
      orderBy: { savedAt: 'desc' }, take: 200,
    })
    const local = new Map<string, StreamTitle>()
    for (const page of pages) {
      for (const item of decode(page, noPage).titles) {
        if (normalize(item.title).includes(q) && !local.has(item.id)) local.set(item.id, item)
      }
    }
    if ([...local.values()].some(item => normalize(item.title) === q)) {
      return { titles: [...local.values()].slice(0, 60), next: null, source: 'cached' as const }
    }

    const params = new URLSearchParams({ country: 'in', title: q, series_granularity: 'show' })
    const response = await fetchCached('search:' + digest(q), '/shows/search/title?' + params, (raw) => parsePage(raw, true), noPage)
    const combined = new Map([...local.values(), ...response.value.titles].map(item => [item.id, item]))
    return { titles: [...combined.values()].slice(0, 60), next: null, source: response.source }
  }

  const providers = ['hotstar', 'prime'] as const
  let cursors: Record<string, unknown> = { hotstar: '', prime: '' }
  if (cursor) {
    try { cursors = object(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))) } catch { cursors = {} }
  }
  // Load the services separately so a first page always has room for both.
  const pages = await Promise.all(providers.map(async (provider) => {
    if (typeof cursors[provider] !== 'string' || cursors[provider].length > 600) return null
    const params = new URLSearchParams({
      country: 'in', catalogs: `${provider}.subscription,${provider}.free`,
      series_granularity: 'show', order_by: 'popularity_1month',
    })
    const cursor = cursors[provider]
    if (cursor) params.set('cursor', cursor)
    const response = await fetchCached('browse:' + provider + ':' + digest(cursor),
      '/shows/search/filters?' + params, (raw) => parsePage(raw, false), noPage)
    return { ...response, provider, cursor }
  }))
  const titles = new Map<string, StreamTitle>()
  for (let index = 0; index < Math.max(...pages.map(page => page?.value.titles.length ?? 0)); index++) {
    for (const page of pages) {
      const entry = page?.value.titles[index]
      if (entry && !titles.has(entry.id)) titles.set(entry.id, entry)
    }
  }
  const sources = pages.map(page => page?.source)
  const source = sources.includes('live') ? 'live' : sources.includes('cached') ? 'cached'
    : sources.includes('limited') ? 'limited' : sources.includes('offline') ? 'offline' : 'unconfigured'
  const next = Object.fromEntries(pages.flatMap(page => {
    if (!page) return []
    if (page.value.next !== null) return [[page.provider, page.value.next]]
    return (source === 'live' || source === 'cached') && page.source !== 'live' && page.source !== 'cached'
      ? [[page.provider, page.cursor]] : []
  }))
  return { titles: [...titles.values()], next: Object.keys(next).length ? Buffer.from(JSON.stringify(next)).toString('base64url') : null, source }
}

export async function streamingDetails(id: string) {
  const response = await fetchCached('details:' + id, '/shows/' + encodeURIComponent(id) + '?series_granularity=episode&country=in', parseDetails, { title: null, episodes: [] })
  return { ...response.value, source: response.source }
}
