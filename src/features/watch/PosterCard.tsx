import { Film, ListPlus, Play, Trash2 } from 'lucide-react'

import { formatTime, type WatchItem } from '@/features/watch/types'
import { apiUrl } from '@/lib/config'

type Playable = Pick<WatchItem, 'title' | 'thumbnail' | 'duration'> & {
  subtitle?: string
  playable?: boolean
  reason?: string
}

export function PosterCard({ item, current, playing, busy, onPlay, onQueue, onDelete }: {
  item: Playable
  current: boolean
  playing: boolean
  busy: boolean
  onPlay: () => void
  onQueue: () => void
  onDelete?: () => void
}) {
  const playable = item.playable !== false
  return (
    <article className="watch-card" data-current={current}>
      <button type="button" className="watch-card-art" disabled={!playable || (busy && !current)} onClick={onPlay}
        aria-label={!playable ? `${item.title}: ${item.reason}` : current ? `Return to player for ${item.title}` : `Play ${item.title} for everyone`}>
        {item.thumbnail
          ? <img src={apiUrl(item.thumbnail)} alt="" loading="lazy" />
          : <Film aria-hidden className="watch-card-fallback" />}
        {playable && <span className="watch-card-play"><Play aria-hidden /></span>}
        {current && <span className="watch-card-playing">{playing ? 'Now playing' : 'Paused'}</span>}
        {!!item.duration && <span className="watch-card-duration">{formatTime(item.duration)}</span>}
      </button>
      <div className="watch-card-caption">
        <div>
          <h3 title={item.title}>{item.title}</h3>
          <p title={item.reason ?? item.subtitle}>{item.reason ?? item.subtitle}</p>
        </div>
        {playable && <button type="button" className="watch-icon" onClick={onQueue} disabled={busy} title="Add to Up next" aria-label={`Add ${item.title} to Up next`}><ListPlus aria-hidden /></button>}
        {onDelete && <button type="button" className="watch-icon watch-delete" onClick={onDelete} disabled={busy}
          title="Delete from server" aria-label={`Delete ${item.title} from the server`}><Trash2 aria-hidden /></button>}
      </div>
    </article>
  )
}

export function PosterGrid({ children }: { children: React.ReactNode }) {
  return <div className="watch-grid">{children}</div>
}
