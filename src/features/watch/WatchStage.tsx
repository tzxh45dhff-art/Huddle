import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { ArrowLeft, Clapperboard, FolderOpen, ListVideo, Loader2, MessagesSquare, MonitorPlay, Play, Search, VolumeX, WifiOff, X } from 'lucide-react'

import * as watchApi from '@/features/watch/api'
import { ExternalBeacon } from '@/features/watch/players/ExternalBeacon'
import { FilePlayer } from '@/features/watch/players/FilePlayer'
import { YouTubePlayer } from '@/features/watch/players/YouTubePlayer'
import { WatchBrowser, type WatchSection } from '@/features/watch/WatchBrowser'
import type { AudioTrackInfo, PlayerHandle, QueueItem, SubtitleTrack } from '@/features/watch/types'
import { useDriftCorrection } from '@/features/sync/useDriftCorrection'
import { usePlaybackKeeper } from '@/features/sync/usePlaybackKeeper'
import { useWatchSession } from '@/features/watch/useWatchSession'
import { WatchFun } from '@/features/fun/WatchFun'
import { clock } from '@/features/fun/time'
import { useWatchFun } from '@/features/fun/useWatchFun'
import { WatchControls } from '@/features/watch/WatchControls'
import { WatchToasts } from '@/features/watch/WatchToasts'
import { apiUrl } from '@/lib/config'
import { cn } from '@/lib/utils'
import { petCue, setPetWatching, useHoldPetScene, type PetCueKind } from '@/features/pet/petCues'

import './watch.css'

const SECTIONS = [
  { id: 'library', label: 'Library', icon: FolderOpen },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'streaming', label: 'Streaming', icon: MonitorPlay },
  { id: 'queue', label: 'Up next', icon: ListVideo },
] satisfies { id: WatchSection; label: string; icon: typeof Search }[]

const EASE = [0.16, 1, 0.3, 1] as const

/** Last language someone on this device picked, so the next film opens in it. */
const AUDIO_LANGUAGE_KEY = 'syncroom.audioLanguage'

/**
 * The watch stage.
 *
 * Takes the whole screen rather than sitting in a card: this is the flagship
 * activity, and a synced player in a modal reads as a preview of one.
 *
 * Portalled to the body for the same reason the hub's drawer is — the hub's
 * fade leaves a `will-change` that would trap this under the fixed header.
 */
/** What the pet makes of each reaction over a film. */
const PET_REACTS: Record<string, PetCueKind> = {
  laugh: 'laugh', dead: 'laugh', cry: 'aww', shock: 'gasp', love: 'love', fire: 'cheer', clap: 'cheer', popcorn: 'snack',
}

export function WatchStage({
  roomId,
  selfId,
  onClose,
  insetRight = 0,
  panelOpen = false,
  onTogglePanel,
  unread = 0,
  origin,
}: {
  roomId: string
  selfId: string | undefined
  onClose: () => void
  /** Rem the room panel occupies, so the player is never hidden behind it. */
  insetRight?: number
  panelOpen?: boolean
  /** The stage covers the hub's rails, so chat needs a door in from here. */
  onTogglePanel?: () => void
  unread?: number
  /** The control this opened from, so the reveal starts there. */
  origin?: DOMRect | null
}) {
  const { snapshot, queue, setQueue, connected, clockReady, targetPosition, send } = useWatchSession(
    roomId,
    true,
  )

  const [handle, setHandle] = useState<PlayerHandle | null>(null)

  /* Read through refs by the player-intent callback below, so it can stay a
     stable function while still seeing the current room and player. */
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const handleRef = useRef(handle)
  handleRef.current = handle
  const [section, setSection] = useState<WatchSection>('library')
  const [browsing, setBrowsing] = useState(false)
  const navigation = useRef<HTMLElement>(null)
  const playerTitle = useRef<HTMLHeadingElement>(null)
  const focusPlayer = useRef(false)
  const [canSearch, setCanSearch] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  /** Id of a just-added item waiting to be put on. See `onQueued` below. */
  const [pendingPlayId, setPendingPlayId] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  /*
   * Audio language.
   *
   * Deliberately local, never sent through `send()`. Playback position, rate,
   * and what's on are decisions the room makes together — which language you
   * personally hear it in is not, the same way volume isn't. Two people in one
   * room can watch the same film in different languages at once.
   */
  const [audioTracks, setAudioTracks] = useState<AudioTrackInfo[]>([])
  const [audioTrack, setAudioTrackState] = useState(0)
  /** Index into the item's subtitle list, or -1 for off. Also personal. */
  const [subtitleTrack, setSubtitleTrackState] = useState(-1)
  /** The caption tracks the YouTube video on screen has, from YouTube itself. */
  const [youTubeCaptions, setYouTubeCaptions] = useState<SubtitleTrack[]>([])
  /** True while the player is stalled, so a freeze reads as loading. */
  const [buffering, setBuffering] = useState(false)

  const item = snapshot?.item ?? null
  const showPlayer = !!item && !browsing

  function openSection(next: WatchSection) {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    focusPlayer.current = false
    setSection(next)
    setBrowsing(true)
  }

  function returnToLibrary() {
    openSection('library')
    navigation.current?.querySelector<HTMLButtonElement>('[data-section="library"]')?.focus()
  }

  function browseFromContent(next: WatchSection) {
    openSection(next)
    navigation.current?.querySelector<HTMLButtonElement>(`[data-section="${next}"]`)?.focus()
  }

  const showPlayingItem = useCallback(() => {
    focusPlayer.current = true
    setBrowsing(false)
  }, [])

  useEffect(() => {
    if (showPlayer && focusPlayer.current) {
      playerTitle.current?.focus({ preventScroll: true })
      focusPlayer.current = false
    }
  }, [showPlayer, item?.id])

  /* Reactions floating over the film, and moments pinned in it. */
  const fun = useWatchFun(roomId, item?.id ?? null)

  /*
   * The pet watches along: it reacts with the room, and dozes off if the film
   * sits paused for a while.
   */
  const lastReaction = useRef<string | null>(null)
  useEffect(() => {
    const latest = fun.reactions.at(-1)
    if (!latest || latest.id === lastReaction.current) return
    const fresh = lastReaction.current !== null || Date.now() - latest.at < 4000
    lastReaction.current = latest.id
    const kind = PET_REACTS[latest.reaction]
    if (fresh && kind) petCue(kind, latest.from.name)
  }, [fun.reactions])
  const [dozing, setDozing] = useState(false)
  const paused = !!item && !snapshot?.playing
  useEffect(() => {
    setDozing(false)
    if (!paused) return
    const timer = window.setTimeout(() => setDozing(true), 60_000)
    return () => window.clearTimeout(timer)
  }, [paused])
  useHoldPetScene(dozing ? 'dozing' : 'watching', !!item)
  useEffect(() => {
    setPetWatching(item?.title ?? null)
    return () => setPetWatching(null)
  }, [item?.title])
  const seekRoom = useCallback(
    (seconds: number) => send('watch:control', { action: 'seek', position: seconds }),
    [send],
  )
  const embeddable = item?.source === 'youtube' || item?.source === 'file'

  /*
   * The last YouTube video this room played.
   *
   * Kept so the player below can outlive the item that introduced it — a
   * fresh instance per video meant `destroy()` immediately followed by
   * `new Player()`, which is what crashed the SDK on every switch, including
   * a switch to a non-YouTube source. Cleared only on a room change, the one
   * moment the whole session is genuinely being torn down.
   */
  const [stickyYouTubeRef, setStickyYouTubeRef] = useState<string | null>(null)
  useEffect(() => {
    if (item?.source === 'youtube') setStickyYouTubeRef(item.ref)
  }, [item?.source, item?.ref])
  useEffect(() => {
    setStickyYouTubeRef(null)
  }, [roomId])

  /*
   * Auto-hide chrome.
   *
   * The header and controls fade out after 5 s of no mouse/touch activity,
   * then reappear on any movement. Scrubbing, hovering the controls, or
   * pausing keeps them visible.
   */
  const [chromeVisible, setChromeVisible] = useState(true)
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const resetHideTimer = useCallback(() => {
    setChromeVisible(true)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    hideTimer.current = setTimeout(() => setChromeVisible(false), 5000)
  }, [])

  /* Start the timer when a video is playing; clear when paused or empty. */
  useEffect(() => {
    if (!showPlayer || !isFullscreen || !snapshot?.playing) {
      setChromeVisible(true)
      if (hideTimer.current) clearTimeout(hideTimer.current)
      return
    }
    resetHideTimer()
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current) }
  }, [showPlayer, isFullscreen, snapshot?.playing, resetHideTimer])

  /* Track fullscreen state changes (user might press Escape). */
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(document.fullscreenElement === stageRef.current)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  /*
   * iOS Safari never fires `fullscreenchange` for the video-native path
   * below — it has its own events for its own fullscreen mode.
   */
  useEffect(() => {
    const video = handle?.getVideoElement?.()
    if (!video) return
    const onBegin = () => setIsFullscreen(true)
    const onEnd = () => setIsFullscreen(false)
    video.addEventListener('webkitbeginfullscreen', onBegin)
    video.addEventListener('webkitendfullscreen', onEnd)
    return () => {
      video.removeEventListener('webkitbeginfullscreen', onBegin)
      video.removeEventListener('webkitendfullscreen', onEnd)
    }
  }, [handle])

  const toggleFullscreen = useCallback(() => {
    if (!stageRef.current) return

    const video = handle?.getVideoElement?.() as
      | (HTMLVideoElement & {
          webkitEnterFullscreen?: () => void
          webkitExitFullscreen?: () => void
          webkitDisplayingFullscreen?: boolean
          webkitSupportsFullscreen?: boolean
        })
      | null
      | undefined

    if (video?.webkitDisplayingFullscreen) {
      video.webkitExitFullscreen?.()
      return
    }

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => undefined)
      return
    }

    /*
     * iOS Safari blacks out a `<video>` when a non-video ancestor goes
     * fullscreen through the standard API — the video composites beneath
     * the fullscreened layer rather than into it. Its own video-fullscreen
     * API is the one path Safari actually renders correctly, at the cost of
     * swapping in the OS player chrome for our custom controls while it's
     * open — a real tradeoff, but better than a black rectangle.
     */
    if (video?.webkitSupportsFullscreen && video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen()
      return
    }

    stageRef.current.requestFullscreen?.().catch(() => undefined)
  }, [handle])

  /*
   * Where this screen says the film is, for a play or a pause — but only when
   * it agrees with the room. A screen that has fallen behind (a stall, a slow
   * line) pausing the room at *its* position used to drag everyone else back
   * to it, and every one of them paid a rebuffer for it. Out of step, the
   * server's own reckoning is the better answer.
   */
  const reportedPosition = useCallback(() => {
    const current = handleRef.current
    if (!embeddable || !current) return undefined
    const here = current.getPosition()
    return Math.abs(here - targetPosition()) <= 1.5 ? here : undefined
  }, [embeddable, targetPosition])

  /** Play or pause for the whole room, from the controls or a click on the picture. */
  const playPause = useCallback(() => {
    if (!snapshot) return
    send('watch:control', {
      action: snapshot.playing ? 'pause' : 'play',
      position: reportedPosition(),
    })
  }, [snapshot, send, reportedPosition])

  /*
   * A click on the picture plays or pauses; a double-click goes fullscreen.
   * The single click waits a beat so a double-click doesn't also pause and
   * resume the room on its way to fullscreen.
   */
  const clickTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const onPictureClick = useCallback(() => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    clickTimer.current = setTimeout(playPause, 220)
  }, [playPause])
  const onPictureDoubleClick = useCallback(() => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
    toggleFullscreen()
  }, [toggleFullscreen])

  useEffect(() => () => {
    if (clickTimer.current) clearTimeout(clickTimer.current)
  }, [item?.id, showPlayer])

  useEffect(() => {
    watchApi
      .fetchCapabilities(roomId)
      .then((caps) => setCanSearch(caps.search))
      .catch(() => setCanSearch(false))
  }, [roomId])

  useEffect(() => {
    watchApi.fetchQueue(roomId).then(setQueue).catch(() => undefined)
  }, [roomId, setQueue])

  /* A new item clears the last item's failure, so one unembeddable video does
     not leave an error sitting over the next one. */
  useEffect(() => {
    setError(null)
  }, [item?.id])

  /*
   * Follow the room, and keep following it — see `usePlaybackKeeper`. No
   * "tap to join": a browser that will not start sound before a touch gets
   * the film muted and in step, and the sound at the first touch anywhere.
   * YouTube pays a rebuffer for every seek, so it is only moved when it is
   * out by more than a second; a file can be placed much closer for free.
   */
  const keeper = usePlaybackKeeper({
    handle,
    playing: snapshot?.playing ?? false,
    position: snapshot && !snapshot.playing ? snapshot.position : null,
    rate: snapshot?.rate,
    seq: snapshot?.seq ?? -1,
    clockReady,
    targetPosition,
    enabled: embeddable,
    tolerance: item?.source === 'youtube' ? 1 : 0.5,
  })

  useDriftCorrection({
    handle,
    playing: snapshot?.playing ?? false,
    rate: snapshot?.rate ?? 1,
    seq: snapshot?.seq ?? -1,
    targetPosition,
    enabled: embeddable && clockReady,
  })

  /* Local read-out for the scrubber. Deliberately not the drift loop's clock —
     this only paints, and it runs faster so the bar moves smoothly. */
  useEffect(() => {
    const tick = () => {
      if (handle && embeddable) {
        setPosition(handle.getPosition())
        setDuration(handle.getDuration() || item?.duration || 0)
        /* Only while the room believes it's playing. A paused video is not
           buffering, and saying so would put a spinner over every pause. */
        setBuffering(handle.isBuffering() && (snapshot?.playing ?? false))
      } else if (snapshot) {
        setPosition(targetPosition())
        setDuration(item?.duration ?? 0)
        setBuffering(false)
      }
    }
    tick()
    const timer = setInterval(tick, 250)
    return () => clearInterval(timer)
  }, [handle, embeddable, snapshot, targetPosition, item?.duration])

  /*
   * Read the source's audio-track list into state.
   *
   * Called on every handle change and again whenever the player says its list
   * might have moved — HLS discovers alternate audio asynchronously, so the
   * list at the moment playback starts is not reliably the final one.
   */
  const syncAudioTracks = useCallback(() => {
    if (!handle) {
      setAudioTracks([])
      setAudioTrackState(0)
      return
    }
    setAudioTracks(handle.getAudioTracks())
    setAudioTrackState(handle.getAudioTrack())
  }, [handle])

  useEffect(() => {
    syncAudioTracks()
  }, [syncAudioTracks])

  /* A saved language applies itself once, the moment a video's tracks first
     become known — not on every re-sync, or manually switching languages
     mid-film would get silently reverted the next time hls.js re-announces
     its track list. */
  const appliedPreference = useRef<string | null>(null)
  useEffect(() => {
    if (!handle || audioTracks.length < 2) return
    if (appliedPreference.current === item?.id) return
    appliedPreference.current = item?.id ?? null

    let preferred: string | null = null
    try {
      preferred = localStorage.getItem(AUDIO_LANGUAGE_KEY)
    } catch {
      /* Private browsing can refuse storage access entirely. */
    }
    if (!preferred) return

    const match = audioTracks.find((track) => track.language === preferred)
    if (match && match.id !== handle.getAudioTrack()) {
      handle.setAudioTrack(match.id)
      setAudioTrackState(match.id)
    }
  }, [handle, audioTracks, item?.id])

  const onAudioTrackChange = useCallback(
    (id: number) => {
      if (!handle) return
      handle.setAudioTrack(id)
      setAudioTrackState(id)
      const track = audioTracks.find((entry) => entry.id === id)
      if (track) {
        try {
          localStorage.setItem(AUDIO_LANGUAGE_KEY, track.language)
        } catch {
          /* Not being able to remember the choice is not worth surfacing. */
        }
      }
    },
    [handle, audioTracks],
  )

  /* Subtitles start off on every new item, matching the `<track>` elements,
     which are rendered without `default` for the same reason. */
  useEffect(() => {
    setSubtitleTrackState(-1)
  }, [item?.id])

  const onSubtitleTrackChange = useCallback(
    (index: number) => {
      if (!handle) return
      handle.setSubtitleTrack(index)
      setSubtitleTrackState(index)
    },
    [handle],
  )

  const playNow = useCallback((next: QueueItem) => {
    send('watch:load', { itemId: next.id })
    showPlayingItem()
  }, [send, showPlayingItem])

  /*
   * The player was played or paused by something outside this app.
   *
   * Fullscreen on a phone hands the video to the OS player, whose pause button
   * — like the lock screen's, and a headphone click — reaches the element
   * directly. Treated as a control the room issued, so pausing there pauses it
   * for everybody, exactly as the app's own button does.
   *
   * Ignored when it merely agrees with the room, which is the common case: the
   * element fires `pause` when *we* pause it, and echoing that back would send
   * a second command for every one the room already made.
   */
  const onPlayerIntent = useCallback(
    (playing: boolean) => {
      const room = snapshotRef.current
      if (!room || room.playing === playing) return
      /* The keeper just started, stopped or unmuted this player itself — a
         browser can pause a video it is unmuting, and that is nobody asking
         the room to stop. */
      if (performance.now() - keeper.touchedAt.current < 1500) return
      /* An ended film pauses itself. That is `watch:ended`'s business, and
         reporting it here as a pause would fight the advance to the next
         thing in the queue. */
      if (handleRef.current?.getDuration() && !playing) {
        const handle = handleRef.current
        const duration = handle.getDuration()
        if (duration > 0 && handle.getPosition() >= duration - 0.5) return
      }

      send('watch:control', {
        action: playing ? 'play' : 'pause',
        position: reportedPosition(),
      })
    },
    [send, keeper.touchedAt, reportedPosition],
  )

  /*
   * Choosing something should play it.
   *
   * Identified by id, never by position. The add is REST and the room's queue
   * arrives over the socket, so at the moment of choosing the list in hand can
   * still be the one from before — and "the last row" was then whatever was
   * already there, which is how picking a video used to start the *previous*
   * one. Holding the id and waiting for that exact row is the whole fix.
   */
  const onQueued = useCallback(
    ({ item: added, items }: watchApi.Queued, playImmediately: boolean) => {
      /* The REST reply is already the new queue, so seed it rather than wait
         on the socket — otherwise a dropped `watch:queue` means the pending
         load never resolves and the pick silently does nothing. */
      setQueue(items)
      if (playImmediately) setPendingPlayId(added.id)
    },
    [setQueue],
  )

  useEffect(() => {
    if (!pendingPlayId) return
    const target = queue.find((entry) => entry.id === pendingPlayId)
    if (!target) return
    playNow(target)
    setPendingPlayId(null)
  }, [pendingPlayId, queue, playNow])

  const skip = useCallback(() => {
    if (!snapshot) return
    send('watch:ended', { seq: snapshot.seq })
  }, [send, snapshot])

  const onEnded = useCallback(() => {
    if (!snapshot) return
    /* The seq stamps which item ended, so five clients firing at once still
       only advance the queue by one. */
    send('watch:ended', { seq: snapshot.seq })
  }, [send, snapshot])

  const revealX = origin ? `${Math.round(origin.left + origin.width / 2)}px` : '50%'
  const revealY = origin ? `${Math.round(origin.top + origin.height / 2)}px` : '50%'
  const visibleChrome = !isFullscreen || !snapshot?.playing || chromeVisible
  const currentIndex = queue.findIndex((entry) => entry.id === item?.id)
  const next = queue[currentIndex + 1]
  const status = !connected ? 'Reconnecting…' : !snapshot ? 'Syncing…' :
    snapshot.viewers.length ? `${snapshot.viewers.length} watching` : null

  return createPortal(
    <motion.div
      className="watch-stage"
      style={{
        paddingRight: `${insetRight}rem`,
        ['--reveal-x' as string]: revealX,
        ['--reveal-y' as string]: revealY,
      }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.25, ease: EASE }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || !showPlayer || isFullscreen ||
          (event.target instanceof Element && event.target.closest('input, [role="dialog"]'))) return
        returnToLibrary()
      }}
    >
      <header className="watch-header">
        <div className="watch-brand"><span><Clapperboard aria-hidden /></span>Watch</div>
        <nav ref={navigation} className="watch-nav" aria-label="Watch navigation">
          {SECTIONS.map(({ id, label, icon: Icon }) => (
            <button key={id} data-section={id} type="button"
              aria-current={!showPlayer && section === id ? 'page' : undefined}
              onClick={() => openSection(id)}>
              <Icon aria-hidden /> <span>{label}</span>
              {id === 'queue' && queue.length > 0 && <small>{queue.length}</small>}
            </button>
          ))}
        </nav>
        <div className="watch-header-actions">
          {status && <p className="watch-room-status" role="status">
            {!connected ? <WifiOff aria-hidden /> : !snapshot ? <Loader2 aria-hidden className="animate-spin" /> : <span className="watch-status-dot" />}
            <span className="watch-status-text">{status}</span>
          </p>}
          {!showPlayer && item && (
            <button type="button" className="watch-secondary watch-resume" aria-label="Open player" onClick={showPlayingItem}>
              <Play aria-hidden /> <span>Player</span>
            </button>
          )}
          {onTogglePanel && (
            <button type="button" className="watch-icon watch-chat" onClick={onTogglePanel} aria-label="Chat and call" aria-pressed={panelOpen} title="Chat and call">
              <MessagesSquare aria-hidden />
              {unread > 0 && !panelOpen && <small>{unread > 9 ? '9+' : unread}</small>}
            </button>
          )}
          <button type="button" className="watch-icon" onClick={onClose} aria-label="Leave Watch" title="Leave Watch">
            <X aria-hidden />
          </button>
        </div>
      </header>

      <div className="watch-body">
        <WatchBrowser
          key={roomId}
          roomId={roomId}
          section={section}
          visible={!showPlayer}
          canSearch={canSearch}
          queue={queue}
          current={item}
          playing={!!snapshot?.playing}
          ready={connected && !!snapshot}
          onSection={browseFromContent}
          onQueued={onQueued}
          onQueueChange={setQueue}
          onPlayQueued={playNow}
          onResume={showPlayingItem}
        />

        {/* The player keeps its DOM and socket subscription while the catalog is open. */}
        <section className={cn('watch-theater', !showPlayer && 'watch-theater-away')} inert={!showPlayer} data-lenis-prevent>
          <div className="watch-theater-inner">
            <div className="watch-theater-top">
              <button type="button" className="watch-secondary" onClick={returnToLibrary}><ArrowLeft aria-hidden /> Back to library</button>
            </div>
            <div
              ref={stageRef}
              className={cn('watch-player', !visibleChrome && 'watch-player-quiet')}
              onMouseMove={isFullscreen ? resetHideTimer : undefined}
              onTouchStart={isFullscreen ? resetHideTimer : undefined}
            >
              <div className={cn('watch-picture', item?.source === 'external' && 'watch-picture-external')}>
                {stickyYouTubeRef && (
                  <YouTubePlayer
                    key="youtube"
                    videoId={stickyYouTubeRef}
                    active={item?.source === 'youtube'}
                    startAt={targetPosition()}
                    onHandle={setHandle}
                    onEnded={onEnded}
                    onError={setError}
                    onCaptions={setYouTubeCaptions}
                  />
                )}
                {embeddable && (
                  <div aria-hidden className="absolute inset-0 z-1" onClick={onPictureClick} onDoubleClick={onPictureDoubleClick} />
                )}

                {item?.source === 'file' && (
                  <FilePlayer
                    key={item.id}
                    src={apiUrl(item.ref)}
                    startAt={targetPosition()}
                    subtitles={item.subtitles}
                    onHandle={setHandle}
                    onEnded={onEnded}
                    onError={setError}
                    onAudioTracksChanged={syncAudioTracks}
                    onIntentChanged={onPlayerIntent}
                  />
                )}
                {item?.source === 'external' && (
                  <ExternalBeacon item={item} position={snapshot?.position ?? 0} playing={snapshot?.playing ?? false} />
                )}

                {embeddable && !error && (buffering || snapshot?.playing && !handle) && (
                  <div className="watch-player-message watch-player-center" role="status">
                    <span><Loader2 aria-hidden className="animate-spin" /> {handle ? 'Buffering…' : 'Loading video…'}</span>
                  </div>
                )}
                {keeper.soundHeld && snapshot?.playing && !error && (
                  <div className="watch-player-message watch-player-bottom" role="status">
                    <span><VolumeX aria-hidden /> Tap for sound</span>
                  </div>
                )}
                {error && (
                  <div className="watch-player-message watch-player-center" role="alert"><span>{error}</span></div>
                )}
                {isFullscreen && (
                  <button type="button" className="watch-secondary watch-fullscreen-back" onClick={returnToLibrary}><ArrowLeft aria-hidden /> Back to library</button>
                )}
              </div>

              {showPlayer && (
                <>
                  <WatchToasts snapshot={snapshot} selfId={selfId} />
                  <WatchFun
                    item={item ? { id: item.id, title: item.title } : null}
                    position={position}
                    chromeVisible={visibleChrome}
                    selfId={selfId}
                    reactions={fun.reactions}
                    moments={fun.moments}
                    arrival={fun.arrival}
                    onDismissArrival={fun.dismissArrival}
                    onReact={fun.react}
                    onPin={fun.pin}
                    onRemove={fun.remove}
                    onSeek={seekRoom}
                  />
                </>
              )}

              {snapshot && item && (
                <div className="watch-player-controls">
                  <WatchControls
                    key={item.id}
                    snapshot={snapshot}
                    position={position}
                    duration={duration}
                    hasNext={!!next}
                    isFullscreen={isFullscreen}
                    audioTracks={audioTracks}
                    audioTrack={audioTrack}
                    onAudioTrackChange={onAudioTrackChange}
                    subtitles={item.source === 'youtube' ? youTubeCaptions : (item.subtitles ?? [])}
                    subtitleTrack={subtitleTrack}
                    onSubtitleTrackChange={onSubtitleTrackChange}
                    onPlayPause={playPause}
                    onSeek={seekRoom}
                    onRate={(rate) => send('watch:control', { action: 'rate', rate })}
                    onSkip={skip}
                    onToggleFullscreen={toggleFullscreen}
                    disabled={!connected}
                    markers={fun.moments.map((m) => ({
                      id: m.id,
                      position: m.position,
                      emoji: m.emoji,
                      label: `${m.emoji} ${clock(m.position)}${m.note ? ` — ${m.note}` : ''} (${m.createdBy.name})`,
                    }))}
                  />
                </div>
              )}
            </div>
            {item && (
              <div className="watch-theater-details">
                <div>
                  <p>
                    {item.source === 'youtube' ? 'YouTube' : item.source === 'file' ? 'Server video' : 'Synced countdown'}
                    {' · '}{snapshot?.playing ? 'Watching together' : 'Paused in the room'}
                  </p>
                  <h1 ref={playerTitle} tabIndex={-1}>{item.title}</h1>
                </div>
                {next && <button type="button" className="watch-queue-link" onClick={() => browseFromContent('queue')}>
                  <ListVideo aria-hidden /> <span>Up next <strong>{next.title}</strong></span>
                </button>}
              </div>
            )}
          </div>
        </section>
      </div>
    </motion.div>,
    document.body,
  )
}
