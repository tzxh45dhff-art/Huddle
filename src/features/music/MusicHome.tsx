import { ArrowRight, ChevronLeft, ChevronRight, Disc3, Headphones, Play, Search } from 'lucide-react'
import { useRef, useState, type ComponentProps } from 'react'
import { TrackCard } from './TrackCard'
import { trackKey, type LibraryTrack } from './types'

type SongProps = (track: LibraryTrack) => ComponentProps<typeof TrackCard>

function Shelf({ title, tracks, rowProps, onMore }: {
  title: string; tracks: LibraryTrack[]; rowProps: SongProps; onMore?: () => void
}) {
  const rail = useRef<HTMLDivElement>(null)
  if (!tracks.length) return null
  const scroll = (direction: number) => rail.current?.scrollBy({
    left: direction * rail.current.clientWidth * 0.8,
    behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
  })
  return <section className="music-home-shelf" aria-label={title}>
    <div className="music-home-heading">
      <h3>{title}</h3>
      <div>
        {onMore && <button className="music-home-see-all" onClick={onMore}>View all <ArrowRight size={14} aria-hidden /></button>}
        <button className="music-home-arrow" aria-label={'Previous ' + title} onClick={() => scroll(-1)}><ChevronLeft size={16} /></button>
        <button className="music-home-arrow" aria-label={'More ' + title} onClick={() => scroll(1)}><ChevronRight size={16} /></button>
      </div>
    </div>
    <div ref={rail} className="music-home-rail" data-lenis-prevent>
      {tracks.map(track => <TrackCard key={trackKey(track)} {...rowProps(track)} />)}
    </div>
  </section>
}

export function MusicHome({ current, playing, recent, suggested, loading, failed, liked, rowProps,
  onRetry, onSearch, onHistory, onLiked, onPlaylists, onOpenPlayer }: {
  current: LibraryTrack | null
  playing: boolean
  recent: LibraryTrack[] | null
  suggested: LibraryTrack[]
  loading: boolean
  failed: boolean
  liked: LibraryTrack[]
  rowProps: SongProps
  onRetry: () => void
  onSearch: () => void
  onHistory: () => void
  onLiked: () => void
  onPlaylists: () => void
  onOpenPlayer: () => void
}) {
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null)
  const featured = current ?? recent?.[0] ?? liked[0] ?? suggested[0]
  const artwork = featured?.artwork !== failedArtwork ? featured?.artwork : null
  return <div className="music-home">
    <div className="music-home-top">
      <h2>Your listening room</h2>
      <button aria-label="Find a song" onClick={onSearch}><Search size={17} aria-hidden /><span>Find a song</span></button>
    </div>
    <section className="music-home-feature" aria-label={current ? 'Now playing' : 'Featured song'}>
      <div className="music-home-feature-copy">
        {featured && <p className="music-home-eyebrow"><Headphones size={14} aria-hidden />{current ? (playing ? 'On in your room' : 'Paused in your room') : 'Featured pick'}</p>}
        <h3 title={featured?.title}>{featured?.title ?? 'What should we play?'}</h3>
        {featured?.artist && <p className="music-home-artist">{featured.artist}</p>}
        <div className="music-home-feature-actions">
          {featured
            ? <button className="music-home-primary" onClick={current ? onOpenPlayer : rowProps(featured).onPlay}>
              {current ? <Disc3 size={18} aria-hidden /> : <Play size={17} fill="currentColor" aria-hidden />}
              {current ? 'Open player' : 'Play for the room'}
            </button>
            : <button className="music-home-primary" onClick={onSearch}><Search size={17} aria-hidden /> Find your first song</button>}
        </div>
      </div>
      <div className="music-home-sleeve" aria-hidden>
        <div className="music-home-vinyl"><span>{artwork ? <img src={artwork} alt="" /> : <Disc3 />}</span></div>
        <div className="music-home-cover">{artwork
          ? <img src={artwork} alt="" onError={() => setFailedArtwork(artwork)} />
          : <><Disc3 /><span>huddle<br /><b>listening room</b></span></>}</div>
      </div>
    </section>
    {failed && <p role="alert" className="music-home-notice">Couldn’t load the room’s recent picks. <button onClick={onRetry}>Try again</button></p>}
    {loading && !recent && <div className="music-home-loading" role="status" aria-label="Loading songs">{[0, 1, 2, 3, 4].map(n => <span key={n} />)}</div>}
    <Shelf title="Recently picked in this room" tracks={recent?.slice(0, 8) ?? []} rowProps={rowProps} onMore={onHistory} />
    <Shelf title="From room playlists" tracks={suggested} rowProps={rowProps} onMore={onPlaylists} />
    <Shelf title="Your favourites" tracks={liked.slice(0, 8)} rowProps={rowProps} onMore={onLiked} />
    {!loading && !failed && !recent?.length && !liked.length && !suggested.length && <div className="music-home-empty">
      <Disc3 aria-hidden /><p>Your room’s song picks and favourites will appear here.</p>
    </div>}
  </div>
}
