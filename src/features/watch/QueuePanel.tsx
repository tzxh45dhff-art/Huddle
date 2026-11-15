import { useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Clapperboard, Play, Trash2 } from 'lucide-react'

import * as watchApi from '@/features/watch/api'
import { formatTime, type QueueItem } from '@/features/watch/types'
import { apiUrl } from '@/lib/config'

const SOURCE_LABEL = { youtube: 'YouTube', file: 'Server video', external: 'Synced countdown' }

export function QueuePanel({
  roomId, items, nowPlayingId, disabled, onQueueChange, onPlayNow, onBrowse,
}: {
  roomId: string
  items: QueueItem[]
  nowPlayingId: string | null
  disabled: boolean
  onQueueChange: (items: QueueItem[]) => void
  onPlayNow: (item: QueueItem) => void
  onBrowse: () => void
}) {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(request: () => Promise<QueueItem[]>) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      onQueueChange(await request())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update the queue.')
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  function move(index: number, delta: number) {
    const next = items.map((item) => item.id)
    const target = index + delta
    if (target < 0 || target >= next.length) return
    const [id] = next.splice(index, 1)
    next.splice(target, 0, id!)
    void change(() => watchApi.reorderQueue(roomId, next))
  }

  return (
    <>
      {error && <p className="watch-notice" role="alert">{error}</p>}
      {items.length === 0 ? (
        <div className="watch-empty">
          <Clapperboard aria-hidden />
          <div>
            <p>Nothing queued yet</p>
            <div>Add a video from the library or search to line it up for the room.</div>
            <button type="button" className="watch-secondary mt-4" onClick={onBrowse}>Browse library</button>
          </div>
        </div>
      ) : (
        <ol className="watch-queue" aria-label="Room queue" aria-busy={busy}>
          {items.map((item, index) => {
            const current = item.id === nowPlayingId
            return (
              <li key={item.id} data-current={current}>
                <button type="button" className="watch-queue-item" disabled={disabled} onClick={() => onPlayNow(item)}
                  aria-label={current ? `Return to player for ${item.title}` : `Play ${item.title} for everyone`}>
                  <span className="watch-queue-art">
                    {item.thumbnail && <img src={apiUrl(item.thumbnail)} alt="" loading="lazy" />}
                    <Play aria-hidden />
                  </span>
                  <span className="watch-queue-info">
                    <strong>{item.title}</strong>
                    <small>{current ? 'In the player' : SOURCE_LABEL[item.source]} · {item.addedBy.name}{item.duration ? ` · ${formatTime(item.duration)}` : ''}</small>
                  </span>
                </button>
                <div className="watch-queue-actions">
                  <button type="button" className="watch-icon" onClick={() => move(index, -1)} disabled={busy || disabled || index === 0} aria-label={`Move ${item.title} up`}><ChevronUp aria-hidden /></button>
                  <button type="button" className="watch-icon" onClick={() => move(index, 1)} disabled={busy || disabled || index === items.length - 1} aria-label={`Move ${item.title} down`}><ChevronDown aria-hidden /></button>
                  <button type="button" className="watch-icon" onClick={() => void change(() => watchApi.removeFromQueue(roomId, item.id))} disabled={busy || disabled} aria-label={`Remove ${item.title}`}><Trash2 aria-hidden /></button>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </>
  )
}
