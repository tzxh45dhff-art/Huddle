import { useEffect, useRef, useState } from 'react'
import {
  ArrowDown, ArrowRight, ArrowUpRight, ChevronLeft, ChevronRight, Film, History,
  Loader2, Play, Search, SlidersHorizontal, Users, X,
} from 'lucide-react'

import { StreamingSetup } from './StreamingSetup'
import {
  catalogPage, openStreamingTitle, PROVIDERS, streamingDetails, streamingResume, streamKey,
  type CatalogPage, type Checkpoint, type StreamDetails, type StreamOffer, type StreamProvider, type StreamTitle,
  type ViewingRequest,
} from './streaming'
import { formatTime, type WatchItem } from './types'
import { useExtensionInstalled } from './useExtensionInstalled'
import './streaming.css'

type Filter = 'all' | StreamProvider
type Kind = 'all' | StreamTitle['kind']

const providerOf = (key: string) => key.startsWith('hotstar:') ? 'hotstar' : 'prime'
const yearLine = (item: StreamTitle) => [item.year, item.kind === 'series' ? 'Series' : item.runtime ? `${item.runtime} min` : 'Film', item.genres[0]].filter(Boolean).join('  ·  ')

function ProviderMark({ provider }: { provider: StreamProvider }) {
  return <span className={`stream-mark stream-mark-${provider}`}>{PROVIDERS[provider].name}</span>
}

function Art({ src, eager = false }: { src: string | null; eager?: boolean }) {
  return src ? <img key={src} src={src} alt="" loading={eager ? 'eager' : 'lazy'} decoding="async"
    onError={(event) => { event.currentTarget.hidden = true }} /> : null
}

function TitleCard({ item, onChoose }: { item: StreamTitle; onChoose: (item: StreamTitle) => void }) {
  return (
    <button type="button" className="stream-title-card" onClick={() => onChoose(item)} aria-label={`Show details for ${item.title}`}>
      <span className="stream-poster">
        <Film className="stream-poster-icon" aria-hidden />
        <Art src={item.poster} />
        <span className="stream-poster-badges">{item.offers.map(offer => <ProviderMark key={offer.provider} provider={offer.provider} />)}</span>
        <span className="stream-poster-peek">
          <span className="stream-peek-play"><Play size={17} fill="currentColor" aria-hidden /></span>
          {item.overview && <span>{item.overview}</span>}
        </span>
      </span>
      <strong title={item.title}>{item.title}</strong>
      <small>{yearLine(item)}</small>
    </button>
  )
}

function Shelf({ label, items, onChoose }: {
  label: string; items: StreamTitle[]; onChoose: (item: StreamTitle) => void
}) {
  const rail = useRef<HTMLDivElement>(null)
  if (!items.length) return null
  const move = (direction: number) => rail.current?.scrollBy({
    left: direction * (rail.current.clientWidth * 0.8),
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  })
  return (
    <section className="stream-shelf" aria-label={label}>
      <div className="stream-heading">
        <h2>{label}</h2>
        <div className="stream-arrows">
          <button type="button" aria-label={`Previous ${label.toLowerCase()} titles`} onClick={() => move(-1)}><ChevronLeft aria-hidden /></button>
          <button type="button" aria-label={`More ${label.toLowerCase()} titles`} onClick={() => move(1)}><ChevronRight aria-hidden /></button>
        </div>
      </div>
      <div className="stream-rail" ref={rail} data-lenis-prevent>
        {items.map(item => <TitleCard key={item.id} item={item} onChoose={onChoose} />)}
      </div>
    </section>
  )
}

function ResumeRow({ room, items, busy, installed, onResume }: {
  room: boolean; items: Checkpoint[]; busy: boolean; installed: boolean; onResume: (item: Checkpoint) => void
}) {
  if (!items.length) return null
  return (
    <section className="stream-shelf" aria-label={room ? 'Resume with the room' : 'Continue watching'}>
      <div className="stream-heading">
        <h2>{room ? <Users aria-hidden /> : <History aria-hidden />}{room ? 'Resume with the room' : 'Continue watching'}</h2>
      </div>
      <div className="stream-resume-rail" data-lenis-prevent>
        {items.map(item => {
          const content = <>
            <span className="stream-resume-art"><Play size={20} fill="currentColor" aria-hidden /><Art src={item.thumbnail} /></span>
            <span className="stream-resume-info">
              <strong title={item.title}>{item.title}</strong>
              <span>{PROVIDERS[providerOf(item.mediaKey)].name} · {formatTime(item.position)}</span>
              <span className="stream-progress"><span style={{ width: item.duration ? `${Math.min(100, item.position / item.duration * 100)}%` : '0%' }} /></span>
            </span>
          </>
          return installed
            ? <button type="button" disabled={busy} className="stream-resume-card" key={item.mediaKey} onClick={() => onResume(item)}>{content}</button>
            : <a className="stream-resume-card" key={item.mediaKey} href={item.ref} target="_blank" rel="noopener noreferrer">{content}</a>
        })}
      </div>
    </section>
  )
}

export function StreamingHub({ roomId, current, ready, visible }: {
  roomId: string; current: WatchItem | null; ready: boolean; visible: boolean
}) {
  const [page, setPage] = useState<CatalogPage | null>(null)
  const [browseError, setBrowseError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [input, setInput] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [kind, setKind] = useState<Kind>('all')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogPage | null>(null)
  const [searchError, setSearchError] = useState(false)
  const [more, setMore] = useState(false)
  const [moreNotice, setMoreNotice] = useState('')
  const [selected, setSelected] = useState<StreamTitle | null>(null)
  const [details, setDetails] = useState<StreamDetails | null>(null)
  const [detailsError, setDetailsError] = useState(false)
  const [season, setSeason] = useState('')
  const [resume, setResume] = useState<{ personal: Checkpoint[]; room: Checkpoint[] }>({ personal: [], room: [] })
  const [opening, setOpening] = useState(false)
  const [launchError, setLaunchError] = useState('')
  const extension = useExtensionInstalled()
  const [major, minor] = (extension ?? '').split('.').map(Number)
  const installed = major > 0 || minor >= 8
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!visible) return
    let active = true
    setBrowseError(false)
    catalogPage(roomId).then((next) => { if (active) setPage(next) }).catch(() => { if (active) setBrowseError(true) })
    return () => { active = false }
  }, [roomId, visible, refresh])

  useEffect(() => {
    if (!visible || !query) return
    let active = true
    setResults(null)
    setSearchError(false)
    catalogPage(roomId, { q: query })
      .then((value) => { if (active) setResults(value) })
      .catch(() => { if (active) setSearchError(true) })
    return () => { active = false }
  }, [roomId, visible, query, refresh])

  useEffect(() => {
    if (!visible) return
    let active = true
    const load = () => {
      if (!document.hidden) void streamingResume(roomId)
        .then((value) => { if (active) setResume(value) }).catch(() => undefined)
    }
    load()
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', load)
    return () => {
      active = false
      window.removeEventListener('focus', load)
      document.removeEventListener('visibilitychange', load)
    }
  }, [roomId, visible, current?.id])

  useEffect(() => {
    if (!selected || !visible) return
    const panel = dialog.current
    if (!panel?.open) panel?.showModal()
    return () => { panel?.close(); trigger.current?.focus() }
  }, [selected, visible])

  useEffect(() => {
    if (!selected || selected.kind !== 'series') return
    let active = true
    streamingDetails(roomId, selected.id).then((value) => {
      if (!active) return
      setDetails(value)
      setSeason(value.episodes[0]?.season ?? '')
    }).catch(() => { if (active) setDetailsError(true) })
    return () => { active = false }
  }, [roomId, selected])

  function choose(item: StreamTitle) {
    trigger.current = document.activeElement as HTMLElement | null
    setDetails(null)
    setDetailsError(false)
    setLaunchError('')
    setSeason('')
    setSelected(item)
  }

  async function launch(input: Omit<ViewingRequest, 'roomId'>) {
    if (opening) return
    setOpening(true)
    setLaunchError('')
    try {
      await openStreamingTitle({ ...input, roomId })
      setSelected(null)
    } catch (error) {
      setLaunchError(error instanceof Error ? error.message : 'Could not open the provider.')
    } finally {
      setOpening(false)
    }
  }

  async function loadMore() {
    if (!page?.next || more) return
    setMore(true)
    setMoreNotice('')
    try {
      const next = await catalogPage(roomId, { cursor: page.next })
      if (next.source === 'limited' || next.source === 'offline') {
        setMoreNotice(next.source === 'limited' ? 'The catalog has reached its free limit. Saved titles are still available.' : 'Couldn’t load more titles right now.')
      }
      setPage(current => ({
        ...next, titles: [...new Map([...(current?.titles ?? []), ...next.titles].map(item => [item.id, item])).values()],
        next: next.source === 'limited' || next.source === 'offline' ? current?.next ?? null : next.next,
      }))
    } catch {
      setMoreNotice('Couldn’t load more titles right now.')
    } finally {
      setMore(false)
    }
  }

  const matchesFilters = (item: StreamTitle) => (kind === 'all' || item.kind === kind) &&
    (filter === 'all' || item.offers.some(offer => offer.provider === filter))
  const browse = (page?.titles ?? []).filter(matchesFilters)
  const visibleResults = (results?.titles ?? []).filter(matchesFilters)
  const hero = browse.find(item => item.backdrop) ?? browse[0]
  const roomKey = current?.source === 'external' ? streamKey(current.ref) : null
  const roomProvider = roomKey ? providerOf(roomKey) : null
  const chosenOffers = selected?.offers.filter(offer => filter === 'all' || offer.provider === filter) ?? []
  const seasons = [...new Set((details?.episodes ?? []).filter(episode => episode.offers.some(offer => filter === 'all' || offer.provider === filter)).map(episode => episode.season))]
  const selectedSeason = seasons.includes(season) ? season : seasons[0]
  const episodes = details?.episodes.filter(episode => episode.season === selectedSeason) ?? []
  const source = query ? results?.source : page?.source
  const sourceMessage = source === 'limited' ? 'The free catalog limit has been reached. Previously loaded titles are still available.'
    : source === 'offline' ? 'The catalog feed is temporarily unavailable.'
    : source === 'unconfigured' ? 'The live catalog isn’t connected on this server.' : ''

  function offerButton(offer: StreamOffer, label: string, canSync = true) {
    const opensProvider = !installed || !canSync
    const content = <><span><b>{PROVIDERS[offer.provider].name}</b><small>{offer.access === 'free' ? 'Free to watch' : 'With subscription'}</small></span>
      {opensProvider ? <ArrowUpRight aria-hidden /> : <Play aria-hidden fill="currentColor" />}</>
    return opensProvider
      ? <a key={offer.provider} className="stream-offer" href={offer.url} target="_blank" rel="noopener noreferrer">{content}</a>
      : <button key={offer.provider} className="stream-offer" type="button" disabled={!ready || opening} onClick={() => void launch({
          url: offer.url, title: label, mode: roomKey && streamKey(offer.url) === roomKey ? 'join' : 'room', thumbnail: selected?.poster,
        })}>{content}</button>
  }

  return (
    <div className="stream-hub">
      {!query && (
        <section className="stream-hero" aria-label="Featured streaming title">
          <div className="stream-hero-art"><Art src={hero?.backdrop ?? '/watch/streaming-marquee.jpg'} eager /></div>
          <div className="stream-hero-content">
            <div className="stream-overline"><span />{hero ? 'Featured in India' : 'Streaming in India'}</div>
            <h2>{hero?.title ?? <>Find your next<br />watch.</>}</h2>
            {hero ? <><span className="stream-hero-meta">{yearLine(hero)}</span><p>{hero.overview}</p></>
              : <p>Choose a movie or series on Prime Video or JioHotstar and watch it with your room.</p>}
            <div className="stream-hero-actions">
              {hero
                ? <button type="button" className="stream-action" onClick={() => choose(hero)}><Play aria-hidden fill="currentColor" /> View title</button>
                : <a className="stream-action" href="#stream-search"><Search aria-hidden /> Find a title</a>}
              <div className="stream-badges">{(hero?.offers.map(offer => offer.provider) ?? ['prime', 'hotstar'] as const).map(provider => <ProviderMark key={provider} provider={provider} />)}</div>
            </div>
          </div>
        </section>
      )}

      <div className="stream-content">
        <div className="stream-toolbar" id="stream-search">
          <form className="stream-search-form" role="search" onSubmit={(event) => { event.preventDefault(); setQuery(input.trim()) }}>
            <Search aria-hidden />
            <input type="search" aria-label="Search streaming movies and shows" placeholder="Search movies and series" maxLength={100} value={input} onChange={(event) => {
              setInput(event.target.value)
              if (!event.target.value) setQuery('')
            }} />
            <button type="submit" disabled={!input.trim()}>Search</button>
          </form>
          <div className="stream-filters">
            <div className="stream-filter-pills" role="group" aria-label="Streaming service">
              {(['all', 'hotstar', 'prime'] as const).map(provider => (
                <button key={provider} type="button" aria-pressed={provider === filter} onClick={() => setFilter(provider)}>{provider === 'all' ? 'All services' : PROVIDERS[provider].name}</button>
              ))}
            </div>
            <label className="stream-type"><SlidersHorizontal aria-hidden /><select aria-label="Title type" value={kind} onChange={e => setKind(e.target.value as Kind)}>
              <option value="all">Movies & series</option><option value="movie">Movies</option><option value="series">Series</option>
            </select></label>
          </div>
        </div>

        {roomProvider && current && <div className="stream-current">
          <span className="stream-current-icon"><Users aria-hidden /></span>
          <span><small>On in this room</small><strong>{current.title}</strong></span>
          {installed ? <button type="button" className="stream-link-button" disabled={!ready || opening}
            onClick={() => void launch({ url: current.ref, title: current.title, mode: 'join' })}>Join now <ArrowRight aria-hidden /></button>
          : <a className="stream-link-button" href={current.ref} target="_blank" rel="noopener noreferrer">Open on {PROVIDERS[roomProvider].name}<ArrowUpRight aria-hidden /></a>}
        </div>}

        {!selected && launchError && <p className="stream-notice" role="alert">{launchError}</p>}
        {sourceMessage && <p className="stream-notice" role="status">{sourceMessage}</p>}

        {query ? (
          <section className="stream-shelf" aria-label="Search results">
            <div className="stream-heading"><h2>Results for “{query}”</h2><button type="button" className="stream-link-button" onClick={() => { setInput(''); setQuery('') }}><X aria-hidden /> Clear</button></div>
            {!results && !searchError ? <p className="stream-notice" role="status"><Loader2 className="stream-spin" aria-hidden /> Checking availability…</p>
              : searchError ? <p className="stream-notice" role="alert">Couldn’t search the catalog. <button onClick={() => setRefresh(n => n + 1)}>Try again</button></p>
              : visibleResults.length ? <div className="stream-grid">{visibleResults.map(item => <TitleCard key={item.id} item={item} onChoose={choose} />)}</div>
              : <div className="stream-empty"><Search aria-hidden /><div><strong>No matching titles{filter !== 'all' || kind !== 'all' ? ' with these filters' : ''}</strong>
                <p>Try another title, or open the provider and use the Huddle panel when it plays.</p>
                <div className="stream-empty-links">{Object.entries(PROVIDERS).map(([id, provider]) => <a key={id} href={provider.url} target="_blank" rel="noopener noreferrer">{provider.name} <ArrowUpRight aria-hidden /></a>)}</div>
              </div></div>}
          </section>
        ) : (
          <>
            <ResumeRow room={false} items={resume.personal} busy={!ready || opening} installed={installed} onResume={item => void launch({
              url: item.ref, title: item.title, mode: 'solo', position: item.position, thumbnail: item.thumbnail,
            })} />
            <ResumeRow room items={resume.room} busy={!ready || opening} installed={installed} onResume={item => void launch({
              url: item.ref, title: item.title, mode: item.mediaKey === roomKey ? 'join' : 'room', position: item.position, thumbnail: item.thumbnail,
            })} />
            {!page && !browseError && <div className="stream-skeleton" role="status" aria-label="Loading streaming titles">{[1, 2, 3, 4, 5].map(n => <span key={n} />)}</div>}
            {browseError && <p className="stream-notice" role="alert">Couldn’t reach the streaming catalog. <button type="button" onClick={() => setRefresh(n => n + 1)}>Try again</button></p>}
            {browse.length > 0 && <Shelf label={filter === 'all' ? 'Popular right now' : `Popular on ${PROVIDERS[filter].name}`} items={browse.slice(0, 12)} onChoose={choose} />}
            {filter === 'all' && (['hotstar', 'prime'] as const).map(provider => <Shelf key={provider} label={`On ${PROVIDERS[provider].name}`}
              items={browse.filter(item => item.offers.some(offer => offer.provider === provider)).slice(0, 12)} onChoose={choose} />)}
            {browse.length > 12 && <section className="stream-shelf" aria-label="All streaming titles"><div className="stream-heading"><h2>More to explore</h2></div>
              <div className="stream-grid">{browse.slice(12).map(item => <TitleCard key={item.id} item={item} onChoose={choose} />)}</div>
            </section>}
            {page && browse.length === 0 && <div className="stream-empty"><Film aria-hidden /><div><strong>{page.titles.length ? 'No titles with these filters' : 'Browse directly on a provider'}</strong>
              <p>{page.titles.length ? 'Try another service or load more titles.' : 'Open a movie or episode and use the Huddle panel to start it for the room.'}</p>
              {!page.titles.length && <div className="stream-empty-links">{Object.entries(PROVIDERS).map(([id, provider]) => <a key={id} href={provider.url} target="_blank" rel="noopener noreferrer">{provider.name} <ArrowUpRight aria-hidden /></a>)}</div>}
            </div></div>}
            {moreNotice && <p className="stream-notice" role="status">{moreNotice}</p>}
            {page?.next && <button type="button" className="stream-more" disabled={more} onClick={() => void loadMore()}>
              {more ? <Loader2 className="stream-spin" aria-hidden /> : <ArrowDown aria-hidden />}{more ? 'Loading titles…' : 'Load more titles'}
            </button>}
          </>
        )}

        <div className="stream-footer">
          <details><summary>Extension & playback setup</summary><StreamingSetup compact /></details>
          {(page?.titles.length || results?.titles.length) ? <div className="stream-credits">
            <a href="https://www.movieofthenight.com/about/api" target="_blank" rel="noopener noreferrer">Streaming availability by Movie of the Night <ArrowUpRight aria-hidden /></a>
            <a href="https://www.themoviedb.org/" target="_blank" rel="noopener noreferrer">Additional artwork by TMDB <ArrowUpRight aria-hidden /></a>
          </div> : null}
        </div>
      </div>

      <dialog ref={dialog} className="stream-dialog" aria-labelledby="stream-dialog-title" data-lenis-prevent onCancel={event => {
        event.preventDefault()
        setSelected(null)
      }}>
        {selected && <>
          <div className="stream-dialog-banner"><Art src={selected.backdrop ?? selected.poster} />
            <button type="button" autoFocus className="stream-dialog-close" aria-label="Close title details" onClick={() => setSelected(null)}><X aria-hidden /></button>
          </div>
          <div className="stream-dialog-body">
            <div className="stream-overline"><span />{selected.kind === 'series' ? 'Series' : 'Movie'}</div>
            <h2 id="stream-dialog-title">{selected.title}</h2>
            <div className="stream-hero-meta">{yearLine(selected)}</div>
            {selected.overview && <p>{selected.overview}</p>}
            {installed
              ? <p className="stream-handoff-hint">Press play if prompted. The room switches when playback starts.</p>
              : <details className="stream-dialog-setup"><summary>Set up the extension to watch together</summary><StreamingSetup compact /></details>}
            {launchError && <p className="stream-notice" role="alert">{launchError}</p>}
            {opening && <p className="stream-notice" role="status"><Loader2 className="stream-spin" aria-hidden /> Opening the provider…</p>}
            {selected.kind === 'movie' ? <>
              <h3>{installed ? 'Watch together on' : 'Open on'}</h3>
              <div className="stream-offers">{chosenOffers.map(offer => offerButton(offer, selected.title))}</div>
            </> : (
              <>
                <div className="stream-episode-heading"><h3>Episodes</h3>{seasons.length > 0 && <select aria-label="Season" value={selectedSeason} onChange={e => setSeason(e.target.value)}>
                  {seasons.map(value => <option key={value} value={value}>Season {value}</option>)}
                </select>}</div>
                {!details && !detailsError && <p className="stream-notice" role="status"><Loader2 className="stream-spin" aria-hidden /> Loading episodes…</p>}
                {(detailsError || (details && !seasons.length)) && <>
                  <p className="stream-notice">Open the series to select an episode. Once it plays, start the room from the Huddle panel.</p>
                  <div className="stream-offers">{chosenOffers.map(offer => offerButton(offer, selected.title, false))}</div>
                </>}
                <div className="stream-episodes">{episodes.map(episode => {
                  const offers = episode.offers.filter(offer => filter === 'all' || offer.provider === filter)
                  if (!offers.length) return null
                  const title = `${selected.title} · S${episode.season} E${episode.episode}`
                  return <article key={`${episode.season}:${episode.episode}`}>
                    <div><small>Episode {episode.episode}</small><strong>{episode.title || title}</strong></div>
                    <div className="stream-offers">{offers.map(offer => offerButton(offer, title))}</div>
                  </article>
                })}</div>
              </>
            )}
          </div>
        </>}
      </dialog>
    </div>
  )
}
