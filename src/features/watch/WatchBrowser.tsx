import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Film, FolderOpen, Link2, ListVideo, Loader2, Play, Search, Upload } from 'lucide-react'

import { Button } from '@/components/ui/button'
import * as watchApi from '@/features/watch/api'
import { PosterCard, PosterGrid } from '@/features/watch/PosterCard'
import { QueuePanel } from '@/features/watch/QueuePanel'
import { StreamingHub } from '@/features/watch/StreamingHub'
import { formatTime, type LibraryEntry, type QueueItem, type ResolvedSource, type SearchResult, type WatchItem } from '@/features/watch/types'
import { apiUrl } from '@/lib/config'

export type WatchSection = 'library' | 'search' | 'streaming' | 'queue'

const SOURCE_LABELS = { file: 'Server video', youtube: 'YouTube', external: 'Synced countdown' }

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function fromLibrary(entry: LibraryEntry): ResolvedSource {
  return {
    source: 'file', ref: entry.hls ?? entry.ref, title: entry.title,
    thumbnail: entry.thumbnail, duration: entry.duration,
  }
}

function Empty({ icon: Icon, title, children }: { icon: typeof Film; title: string; children?: React.ReactNode }) {
  return (
    <div className="watch-empty">
      <Icon aria-hidden />
      <div><p>{title}</p>{children && <div>{children}</div>}</div>
    </div>
  )
}

export function WatchBrowser({
  roomId, section, visible, canSearch, queue, current, playing,
  ready, onSection, onQueued, onQueueChange, onPlayQueued, onResume,
}: {
  roomId: string
  section: WatchSection
  visible: boolean
  canSearch: boolean
  queue: QueueItem[]
  current: WatchItem | null
  playing: boolean
  ready: boolean
  onSection: (section: WatchSection) => void
  onQueued: (queued: watchApi.Queued, playNow: boolean) => void
  onQueueChange: (items: QueueItem[]) => void
  onPlayQueued: (item: QueueItem) => void
  onResume: () => void
}) {
  const [library, setLibrary] = useState<LibraryEntry[] | null>(null)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [query, setQuery] = useState('')
  const [libraryFilter, setLibraryFilter] = useState('')
  const [streamInput, setStreamInput] = useState('')
  const [results, setResults] = useState<SearchResult[] | null>(null)
  const [pending, setPending] = useState<ResolvedSource | null>(null)
  const [pendingDelete, setPendingDelete] = useState<LibraryEntry | null>(null)
  const [action, setAction] = useState<string | null>(null)
  const inFlight = useRef(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)
  const filePicker = useRef<HTMLInputElement>(null)
  const scroll = useRef<HTMLDivElement>(null)
  const deleteDialog = useRef<HTMLDialogElement>(null)
  const deleteTrigger = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!visible || section !== 'library') return
    let active = true
    setLibraryError(null)
    watchApi.fetchLibrary(roomId)
      .then((items) => { if (active) setLibrary(items) })
      .catch((error: unknown) => {
        if (active) setLibraryError(error instanceof Error ? error.message : 'Could not load the server library.')
      })
    return () => { active = false }
  }, [roomId, section, visible, refresh])

  useEffect(() => {
    scroll.current?.scrollTo(0, 0)
    setMessage(null)
    setPending(null)
  }, [section])

  useEffect(() => {
    if (pendingDelete) deleteDialog.current?.showModal()
    else if (deleteDialog.current?.open) {
      deleteDialog.current.close()
      deleteTrigger.current?.focus()
    }
  }, [pendingDelete])

  async function perform(label: string, task: () => Promise<void>, fallback: string) {
    if (inFlight.current) return
    inFlight.current = true
    setAction(label)
    setMessage(null)
    try {
      await task()
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : fallback, error: true })
    } finally {
      inFlight.current = false
      setAction(null)
    }
  }

  async function add(item: ResolvedSource, playNow: boolean) {
    const queued = await watchApi.addToQueue(roomId, item)
    onQueued(queued, playNow)
    if (!playNow) setMessage({ text: `Added to Up next: ${item.title}`, error: false })
  }

  function choose(item: ResolvedSource, playNow: boolean) {
    if (playNow && current?.ref === item.ref && current.source === item.source) {
      onResume()
      return
    }
    void perform(item.ref, () => add(item, playNow), 'Could not add this video.')
  }

  function submit(value: string, mode: 'search' | 'streaming') {
    value = value.trim()
    if (!value) return
    const resolve = mode === 'streaming' || /^https?:\/\//i.test(value) || /^[\w-]{11}$/.test(value)
    void perform(mode, async () => {
      setPending(null)
      if (resolve) {
        const item = await watchApi.resolveInput(roomId, value)
        if (item.note) setPending(item)
        else await add(item, true)
      } else {
        if (!canSearch) throw new Error('Paste a YouTube or direct video link to continue.')
        setResults(null)
        setResults(await watchApi.searchVideos(roomId, value))
      }
    }, 'Could not open this video.')
  }

  function upload(file: File | undefined) {
    if (!file) return
    void perform('upload', async () => {
      setProgress(0)
      try {
        await add(await watchApi.uploadVideo(roomId, file, setProgress), true)
        setRefresh((value) => value + 1)
      } finally {
        setProgress(null)
      }
    }, 'Could not upload this video.')
  }

  const next = queue[queue.findIndex((entry) => entry.id === current?.id) + 1]
  const featuredFile = library?.find((entry) => entry.playable && entry.thumbnail)
    ?? library?.find((entry) => entry.playable)
  const featured = current ?? next ?? (featuredFile ? fromLibrary(featuredFile) : null)
  const filtered = library?.filter((entry) => entry.title.toLowerCase().includes(libraryFilter.trim().toLowerCase()))
  const disabled = action !== null || !ready

  function renderCard(item: ResolvedSource, details: { subtitle?: string; playable?: boolean; reason?: string } = {}, entry?: LibraryEntry) {
    return (
      <PosterCard
        key={entry?.file ?? item.ref}
        item={{ ...item, ...details }}
        current={current?.source === item.source && current.ref === item.ref}
        playing={playing}
        busy={disabled}
        onPlay={() => choose(item, true)}
        onQueue={() => choose(item, false)}
        onDelete={entry && (() => {
          deleteTrigger.current = document.activeElement as HTMLElement | null
          setPendingDelete(entry)
        })}
      />
    )
  }

  return (
    <div ref={scroll} hidden={!visible} className="watch-catalog" data-lenis-prevent>
      <input ref={filePicker} type="file" accept="video/mp4,video/webm,video/ogg,video/quicktime" hidden
        onChange={(event) => { upload(event.currentTarget.files?.[0]); event.currentTarget.value = '' }} />

      {section === 'library' && (
        <section className="watch-feature" aria-label={current ? 'Now playing' : 'Watch'}>
          {featured?.thumbnail && <img className="watch-feature-art" src={apiUrl(featured.thumbnail)} alt="" />}
          <div className="watch-feature-copy">
            <div className="watch-feature-label">
              <span className={current && playing ? 'is-live' : ''} />
              {current ? (playing ? 'Now playing' : 'Paused in the room') : next ? 'Up next' : featured ? 'From the server' : 'Watch together'}
            </div>
            <h1 title={featured?.title}>{featured?.title ?? 'Pick something to watch'}</h1>
            <p>{featured ? [SOURCE_LABELS[featured.source], featured.duration ? formatTime(featured.duration) : null].filter(Boolean).join(' · ') : 'Choose a server video, search YouTube, or open a streaming link.'}</p>
            <div className="watch-feature-actions">
              {featured ? (
                <button type="button" className="watch-primary" disabled={!current && disabled} onClick={() => {
                  if (current) onResume()
                  else if (next) onPlayQueued(next)
                  else choose(featured, true)
                }}>
                  <Play aria-hidden /> {current ? 'Return to player' : 'Play for everyone'}
                </button>
              ) : (
                <button type="button" className="watch-primary" onClick={() => onSection('search')}>
                  <Search aria-hidden /> {canSearch ? 'Search videos' : 'Open a video link'}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {section === 'streaming' && <StreamingHub key={roomId} roomId={roomId} current={current} ready={ready} visible={visible} />}

      <section className={section === 'streaming' ? 'stream-paste watch-shelf' : 'watch-shelf'} aria-labelledby="watch-shelf-heading">
        <header className="watch-shelf-heading">
          <div>
            <h2 id="watch-shelf-heading">{section === 'library' ? 'On the server' : section === 'search' ? 'Search & links' : section === 'streaming' ? 'Have a streaming link?' : 'Up next'}</h2>
            {section === 'library' && library && <p>{library.length} {library.length === 1 ? 'video' : 'videos'}</p>}
          </div>
          {section === 'library' && (
            <div className="watch-shelf-actions">
              {!!library?.length && (
                <label className="watch-field watch-filter">
                  <Search aria-hidden />
                  <input type="search" aria-label="Filter server videos" placeholder="Find a video" value={libraryFilter}
                    onChange={(event) => setLibraryFilter(event.target.value)} />
                </label>
              )}
              <button type="button" className="watch-secondary" onClick={() => filePicker.current?.click()} disabled={disabled}>
                {progress === null ? <Upload aria-hidden /> : <Loader2 aria-hidden className="animate-spin" />}
                {progress === null ? 'Upload video' : `Uploading ${Math.round(progress * 100)}%`}
              </button>
            </div>
          )}
        </header>

        {message && <p className="watch-notice" role={message.error ? 'alert' : 'status'}>{message.text}</p>}

        {section === 'library' && (
          <>
            {libraryError && <div className="watch-notice" role="alert">{libraryError} <button type="button" onClick={() => setRefresh((value) => value + 1)}>Try again</button></div>}
            {!library && !libraryError && (
              <div className="watch-skeleton" role="status" aria-label="Loading server videos">
                {[0, 1, 2, 3].map((key) => <div key={key} />)}
              </div>
            )}
            {library?.length === 0 && !libraryError && <Empty icon={FolderOpen} title="The server library is empty">Upload a video to make it available to the room.</Empty>}
            {!!library?.length && filtered?.length === 0 && <Empty icon={Search} title="No matching videos">Try a different title.</Empty>}
            {!!filtered?.length && (
              <PosterGrid>
                {filtered.map((entry) => renderCard(fromLibrary(entry), {
                  subtitle: entry.hls ? `${formatBytes(entry.bytes)} · Streaming` : formatBytes(entry.bytes),
                  playable: entry.playable,
                  reason: !entry.playable ? 'This file format can’t play in a browser' : !entry.fastStart && !entry.hls ? 'May take longer to start' : undefined,
                }, entry))}
              </PosterGrid>
            )}
          </>
        )}

        {(section === 'search' || section === 'streaming') && (
          <>
            <form className="watch-form" onSubmit={(event) => { event.preventDefault(); submit(section === 'search' ? query : streamInput, section) }}>
              <label className="watch-field">
                {section === 'search' ? <Search aria-hidden /> : <Link2 aria-hidden />}
                <input
                  key={section} value={section === 'search' ? query : streamInput}
                  onChange={(event) => (section === 'search' ? setQuery : setStreamInput)(event.target.value)}
                  aria-label={section === 'streaming' ? 'Streaming link or title' : canSearch ? 'Search YouTube or paste a video link' : 'Video link'}
                  placeholder={section === 'streaming' ? 'Paste a streaming link or enter a title' : canSearch ? 'Search YouTube or paste a video link' : 'Paste a YouTube or direct video link'}
                  spellCheck={false} autoComplete="off"
                />
              </label>
              <button type="submit" className="watch-primary" disabled={disabled || !(section === 'search' ? query : streamInput).trim()}>
                {action === section ? <Loader2 aria-hidden className="animate-spin" /> : null}
                {section === 'search' && canSearch ? 'Search' : 'Open'}
              </button>
            </form>
            {pending && (
              <div className="watch-notice">
                <p>{pending.note}</p>
                <div className="watch-feature-actions">
                  <button type="button" className="watch-primary" disabled={disabled} onClick={() => {
                    void perform(pending.ref, async () => { await add(pending, true); setPending(null) }, 'Could not start the countdown.')
                  }}>Start countdown</button>
                  <button type="button" className="watch-secondary" onClick={() => setPending(null)}>Cancel</button>
                </div>
              </div>
            )}
          </>
        )}

        {section === 'search' && (
          <>
            {action === 'search' && <p className="watch-notice" role="status">Looking up your video…</p>}
            {action !== 'search' && results?.length === 0 && <Empty icon={Search} title="No videos found">Try a different search.</Empty>}
            {!!results?.length && <PosterGrid>{results.map((result) => renderCard({
              source: 'youtube', ref: result.id, title: result.title, thumbnail: result.thumbnail, duration: null,
            }, { subtitle: result.channel }))}</PosterGrid>}
            {results === null && !action && !pending && <Empty icon={Link2} title={canSearch ? 'Find a video on YouTube' : 'Open a video by link'}>
              {canSearch ? 'Search by title or paste a YouTube or direct video link.' : 'Paste a YouTube link or a direct link to a video file.'}
            </Empty>}
          </>
        )}

        {section === 'queue' && (
          <QueuePanel
            roomId={roomId} items={queue} nowPlayingId={current?.id ?? null} disabled={!ready}
            onQueueChange={onQueueChange} onPlayNow={(item) => item.id === current?.id ? onResume() : onPlayQueued(item)}
            onBrowse={() => onSection('library')}
          />
        )}
        {section === 'library' && !!next && current && (
          <button type="button" className="watch-queue-link" onClick={() => onSection('queue')}>
            <ListVideo aria-hidden /> <span>Up next <strong>{next.title}</strong></span><ArrowUpRight aria-hidden />
          </button>
        )}
      </section>

      <dialog ref={deleteDialog} className="watch-dialog" aria-labelledby="watch-delete-title" onCancel={(event) => {
        event.preventDefault()
        if (action !== 'delete') setPendingDelete(null)
      }}>
        {pendingDelete && <>
          <h3 id="watch-delete-title">Delete this server video?</h3>
          <p>{pendingDelete.title} will be removed from the server{pendingDelete.hls ? ' along with its streamed copy' : ''}. This can’t be undone.</p>
          {message?.error && <p role="alert">{message.text}</p>}
          <div className="watch-feature-actions">
            <Button type="button" flat autoFocus disabled={action === 'delete'} onClick={() => setPendingDelete(null)}>Keep it</Button>
            <button type="button" className="watch-secondary" disabled={disabled} onClick={() => {
              void perform('delete', async () => {
                await watchApi.deleteFromLibrary(roomId, pendingDelete.file)
                setLibrary((items) => items?.filter((entry) => entry.file !== pendingDelete.file) ?? null)
                setPendingDelete(null)
              }, 'Could not delete this video.')
            }}>{action === 'delete' ? 'Deleting…' : 'Delete video'}</button>
          </div>
        </>}
      </dialog>
    </div>
  )
}
