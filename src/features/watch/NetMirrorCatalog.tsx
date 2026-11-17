import { useEffect, useState } from 'react'
import { ArrowUpRight, Film, Loader2 } from 'lucide-react'

import { netMirrorCatalog, PROVIDERS, type NetMirrorTitle } from './streaming'

export function NetMirrorCatalog({ roomId, query, kind, installed, active, busy, onChoose }: {
  roomId: string
  query: string
  kind: 'all' | 'movie' | 'series'
  installed: boolean
  active: boolean
  busy: boolean
  onChoose: (item: NetMirrorTitle, poster: string) => void
}) {
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<Awaited<ReturnType<typeof netMirrorCatalog>> | null>(null)
  const retry = () => setAttempt(previous => previous + 1)

  useEffect(() => {
    if (!installed) return
    const controller = new AbortController()
    setResult(null)
    netMirrorCatalog(roomId, query, kind, controller.signal).then(value => {
      if (!controller.signal.aborted) setResult(value)
    })
    return () => controller.abort()
  }, [roomId, query, kind, installed, attempt])

  const needsTab = result?.status === 'closed' || result?.status === 'unavailable'
  useEffect(() => {
    if (!needsTab) return
    const onReturn = () => {
      if (!document.hidden) setAttempt(previous => previous + 1)
    }
    document.addEventListener('visibilitychange', onReturn)
    return () => document.removeEventListener('visibilitychange', onReturn)
  }, [needsTab])

  const titles = result?.items?.filter(item => /^[a-z0-9_-]{1,80}$/i.test(item.id) && item.title) ?? []
  if (!active && (query || !installed) && !titles.length) return null

  return (
    <section className="stream-shelf" aria-label={query ? 'NetMirror search results' : 'On NetMirror'}>
      <div className="stream-heading">
        <h2>{query ? 'Results on NetMirror' : 'On NetMirror'}</h2>
        <a className="stream-link-button" href={PROVIDERS.net77.url} target="_blank" rel="noopener noreferrer">
          Open NetMirror <ArrowUpRight aria-hidden />
        </a>
      </div>
      {!installed ? <p className="stream-notice">Update the Huddle extension to see NetMirror titles here.</p>
        : !result ? <p className="stream-notice" role="status"><Loader2 className="stream-spin" aria-hidden /> Checking NetMirror…</p>
        : needsTab ? <p className="stream-notice" role="status">
          {result.status === 'closed' ? 'Open NetMirror in this browser, then come back to see its catalog.' : 'Finish opening NetMirror in its tab, then check again.'}
          {' '}<button type="button" onClick={retry}>Check again</button>
        </p>
        : !titles.length ? <p className="stream-notice" role="status">No NetMirror titles found{query ? ` for “${query}”` : ''}.</p>
        : <div className="stream-grid">{titles.map(item => {
          const poster = `https://imgcdn.kim/poster/v/${item.id}.jpg`
          return (
            <button className="stream-title-card" type="button" key={item.id} disabled={busy}
              aria-label={`Open ${item.title} on NetMirror`} onClick={() => onChoose(item, poster)}>
              <span className="stream-poster">
                <Film className="stream-poster-icon" aria-hidden />
                <img src={poster} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true }} />
                <span className="stream-poster-badges"><span className="stream-mark stream-mark-net77">NetMirror</span></span>
              </span>
              <strong title={item.title}>{item.title}</strong>
              {(item.year || item.kind) && <small>{[item.year, item.kind === 'series' ? 'Series' : item.kind === 'movie' ? 'Film' : null].filter(Boolean).join(' · ')}</small>}
            </button>
          )
        })}</div>}
    </section>
  )
}
