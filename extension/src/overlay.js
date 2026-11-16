/**
 * The one thing missing from what already worked: doing it on the page.
 *
 * Everything up to this point required a second tab — open the Huddle app,
 * find Watch, add "Netflix, Prime, others" as a source, type the title. That
 * is a correct description of what has to happen (the room's `item` has to
 * exist before there is anything to hold this tab to), but it is also every
 * bit of friction Teleparty doesn't have. Their whole pitch is that nothing
 * about watching together requires leaving the page you are already on.
 *
 * So this is that: a small panel, drawn over the streaming site's own UI,
 * that can start the room watching *this* — the exact title on screen, not a
 * title typed into a form somewhere else — without ever tabbing away.
 *
 * One file for both sites. Nothing in here is Netflix- or Prime-specific any
 * more: what is on screen comes from whichever bridge is loaded, so this
 * stops needing to know which site it is standing on.
 *
 * A shadow root, not a plain `<div>`. Both sites' styles are aggressive
 * (global resets, ids on everything) and reach into any element sharing the
 * page — a shadow root's closed style scope is what stops their CSS from
 * reaching in, and this panel's own styles from reaching out.
 */

/*
 * Wrapped in its own scope, deliberately.
 *
 * Content scripts from one extension in one frame do not each get a module
 * of their own — they share a single global lexical scope, like several
 * classic <script> tags in one page. Two files declaring `const CHANNEL` at
 * top level is therefore not two constants, it is a redeclaration, and it
 * throws `SyntaxError: Identifier 'CHANNEL' has already been declared`
 * before a single line of the second file runs.
 *
 * That is exactly how this broke: the panel was never absent from the page
 * because of anything to do with Netflix, it was absent because this file
 * refused to parse. Nothing here reaches for anything at that scope, so
 * closing it off costs nothing and makes the collision impossible rather
 * than merely currently-avoided. Anything genuinely shared between the two
 * goes through `window.__huddle*`, which is explicit and searchable.
 */
;(() => {
  const CHANNEL = 'huddle'
  const reactions = [
    ['laugh', '😂', 'Laughing'], ['cry', '😭', 'Crying'], ['shock', '😱', 'Shocked'],
    ['love', '😍', 'Loving it'], ['fire', '🔥', 'Fire'], ['clap', '👏', 'Applause'],
    ['dead', '💀', 'Dead'], ['popcorn', '🍿', 'Popcorn'],
  ]

  let latest = { player: null, room: null, offset: 0, status: null, heard: false }

  function cleanTitle() {
    /* Both sites put the title in the tab title, suffixed or prefixed with
       their own name. Reading it here rather than asking the bridge for one
       keeps this overlay independent of whatever internal metadata method
       either site happens to find working this month. */
    return (
      document.title
        /* Each site suffixes its own name; neither belongs in a room's queue. */
        .replace(/\s*[-|]\s*(Netflix|Prime Video|JioHotstar|Disney\+ Hotstar)\s*$/i, '')
        .replace(/^\s*Prime Video\s*[-|:]\s*/i, '')
        .trim() || 'This title'
    )
  }

  function buildPanel() {
    const host = document.createElement('div')
    host.id = 'huddle-overlay-host'
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;right:18px;bottom:18px;'
    const root = host.attachShadow({ mode: 'closed' })

    root.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
        .pill {
          display: flex; align-items: center; gap: 8px;
          background: rgba(20,20,22,.92); backdrop-filter: blur(8px);
          border: 1px solid rgba(255,255,255,.1); border-radius: 999px;
          padding: 8px 14px; cursor: pointer; color: #eee; user-select: none;
          box-shadow: 0 8px 24px rgba(0,0,0,.4);
        }
        .dot { width: 7px; height: 7px; border-radius: 50%; background: #666; flex: none; }
        .dot.on { background: #4ade80; }
        .dot.wait { background: #fbbf24; }
        .panel {
          display: none; margin-bottom: 10px; width: 260px;
          background: rgba(18,18,20,.96); backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,.1); border-radius: 14px;
          padding: 14px; color: #eee; box-shadow: 0 12px 32px rgba(0,0,0,.5);
        }
        .panel.open { display: block; }
        .row { margin-bottom: 10px; }
        .label { color: #9a9aa0; font-size: 10.5px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
        .value { color: #eee; word-break: break-word; }
        button {
          width: 100%; border: 0; border-radius: 8px; padding: 8px 10px;
          background: #e5484d; color: #fff; font-weight: 600; cursor: pointer;
        }
        button:disabled { opacity: .5; cursor: default; }
        button.ghost { background: rgba(255,255,255,.08); color: #eee; margin-top: 6px; }
        .err { color: #ff9c9c; font-size: 11px; margin-top: 6px; }
        .stats {
          display: none; margin-top: 10px; padding-top: 9px;
          border-top: 1px solid rgba(255,255,255,.08);
          font: 10.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
          color: #9a9aa0;
        }
        .stats.open { display: block; }
        .reactions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; margin-top: 8px; }
        .reactions button { background: #ffffff12; font-size: 17px; padding: 4px; }
        .reactions button:hover, .reactions button:focus-visible { background: #ffffff28; }
        .burst {
          position: fixed; left: 20px; bottom: 12vh; pointer-events: none; max-width: 80vw;
          box-shadow: 0 8px 24px #0008; background: #141418ed; color: white;
          padding: 8px 12px; border-radius: 12px; font-size: 18px;
          animation: rise 3.2s ease both;
        }
        @keyframes rise {
          from { opacity: 0; transform: translateY(12px); }
          12%, 75% { opacity: 1; }
          to { opacity: 0; transform: translateY(-30px); }
        }
        @media (prefers-reduced-motion: reduce) { .burst { animation: none; } }
        .stats b { color: #eee; font-weight: 600; }
        .stats .warn { color: #fbbf24; }
        .toggle {
          margin-top: 8px; color: #6a6a70; font-size: 10px; cursor: pointer;
          user-select: none; text-decoration: underline; text-underline-offset: 2px;
        }
      </style>
      <div class="panel" id="panel">
        <div class="row"><div class="label">Status</div><div class="value" id="status">—</div></div>
        <a id="joinTitle" style="display:none;color:#fff;margin-bottom:12px;" rel="noopener noreferrer">Open the room’s video</a>
        <div class="row" id="idleRow">
          <div class="label">Watch this together</div>
          <div id="onTitle">
            <div class="value" id="detectedTitle" style="margin-bottom:8px;"></div>
            <button id="announce">Start the room on this</button>
          </div>
          <div class="value" id="offTitleHint" style="display:none;">
            Open a title and start playing it to sync the room to it.
          </div>
        </div>
        <div class="row" id="followingRow" style="display:none;">
          <div class="label">Following</div>
          <div class="value" id="followingTitle"></div>
          <button class="ghost" id="resync">Resync now</button>
          <div id="reactions" class="reactions" role="group" aria-label="Watch party reactions">
            ${reactions.map(([id, glyph, label]) => `<button type="button" data-reaction="${id}" aria-label="${label}" title="${label}">${glyph}</button>`).join('')}
          </div>
        </div>
        <div id="err" class="err" style="display:none;"></div>
        <div class="toggle" id="statsToggle">Show sync detail</div>
        <div class="stats" id="stats"></div>
      </div>
      <div id="bursts" aria-live="polite"></div>
      <div class="pill" id="pill"><span class="dot" id="dot"></span><span id="pillText">Huddle</span></div>
    `

    document.documentElement.appendChild(host)
    return {
      host,
      bursts: root.getElementById('bursts'),
      reactions: root.getElementById('reactions'),
      pill: root.getElementById('pill'),
      panel: root.getElementById('panel'),
      dot: root.getElementById('dot'),
      pillText: root.getElementById('pillText'),
      status: root.getElementById('status'),
      idleRow: root.getElementById('idleRow'),
      joinTitle: root.getElementById('joinTitle'),
      followingRow: root.getElementById('followingRow'),
      onTitle: root.getElementById('onTitle'),
      offTitleHint: root.getElementById('offTitleHint'),
      detectedTitle: root.getElementById('detectedTitle'),
      followingTitle: root.getElementById('followingTitle'),
      announce: root.getElementById('announce'),
      resync: root.getElementById('resync'),
      err: root.getElementById('err'),
      statsToggle: root.getElementById('statsToggle'),
      stats: root.getElementById('stats'),
    }
  }

  function mount() {
    const el = buildPanel()
    const follows = () => latest.room?.item && latest.player?.ready &&
      window.__huddleMatchesRoom?.(latest.room)
    const followFullscreen = () => {
      const full = document.fullscreenElement ?? document.webkitFullscreenElement
      const target = full && !['VIDEO', 'IFRAME'].includes(full.tagName) ? full : document.documentElement
      if (el.host.parentNode !== target) target.appendChild(el.host)
    }
    document.addEventListener('fullscreenchange', followFullscreen)
    document.addEventListener('webkitfullscreenchange', followFullscreen)
    followFullscreen()

    el.reactions.addEventListener('click', (event) => {
      const reaction = event.target.closest('button[data-reaction]')?.dataset.reaction
      if (!reaction || !follows()) return
      chrome.runtime.sendMessage({ kind: 'react', reaction, itemId: latest.room.item.id }).catch(() => undefined)
    })

    let open = true
    el.panel.classList.toggle('open', true)
    let busy = false

    el.pill.addEventListener('click', () => {
      open = !open
      el.panel.classList.toggle('open', open)
    })

    el.announce.addEventListener('click', async () => {
      busy = true
      render()
      el.err.style.display = 'none'
      const player = latest.player
      if (!player?.ready || player.buffering || !Number.isFinite(player.position)) {
        busy = false
        el.err.textContent = 'Wait for the video to finish loading, then try again.'
        el.err.style.display = 'block'
        render()
        return
      }
      const net77Title = window.__huddleNet77Title?.()
      if (window.__huddleNet77Title && !net77Title) {
        busy = false
        el.err.textContent = 'Net77 has not identified this title yet.'
        el.err.style.display = 'block'
        render()
        return
      }
      const title = net77Title?.title ?? (el.detectedTitle.textContent || cleanTitle())
      const result = await chrome.runtime
        .sendMessage({ kind: 'announce', title, url: net77Title?.url ?? location.href, position: player.position })
        .catch((error) => ({ ok: false, error: error?.message ?? String(error) }))
      busy = false
      if (!result?.ok) {
        el.err.textContent = result?.error ?? 'Could not start the room on this.'
        el.err.style.display = 'block'
      }
      render()
    })

    let showStats = false
    el.statsToggle.addEventListener('click', () => {
      showStats = !showStats
      el.stats.classList.toggle('open', showStats)
      el.statsToggle.textContent = showStats ? 'Hide sync detail' : 'Show sync detail'
      render()
    })

    el.resync.addEventListener('click', () => {
      /* Not a network call — the correction loop in sync.js already knows
         where the room is, and shares this JS context (same extension, same
         frame, same isolated world). This just asks it to look now instead of
         on its own next tick, which is the whole point of pressing a button. */
      window.__huddleResync?.()
    })

    function render() {
      const { player, room, offset } = latest

      /*
       * Three states, not two.
       *
       * `room` being null used to mean "not connected", which was wrong in the
       * case that actually happens: the worker connected and holding an empty
       * room. The panel said the extension was not set up, and disabled the
       * button that would have put something on — on a tab whose socket was
       * working the entire time. So connectedness comes from the worker's own
       * status now, and the room is only what is playing.
       */
      const { status, heard } = latest
      const connected = status === 'connected' || (heard && room !== null)
      /*
       * Whether a real title is on screen, asked of the bridge rather than of
       * the URL.
       *
       * This used to test `location.pathname.startsWith('/watch/')`, which is
       * true of Netflix and true of nothing else — Prime plays over its detail
       * page, so a path test would have said "not watching" through an entire
       * film. The bridge already answers this properly for its own site,
       * including withholding it during an advert, so the answer comes from
       * there and this file stops needing to know which site it is on.
       */
      const onWatchPage = Boolean(player?.ready)

      el.dot.className = 'dot' + (connected ? ' on' : '')
      el.pillText.textContent = connected ? 'Huddle · connected' : 'Huddle'
      el.status.textContent = connected
        ? `Connected · offset ${Math.round(offset)}ms`
        : !heard
          ? 'Checking…'
          : status && status !== 'idle' && status !== 'not configured'
            ? `${status} — the room's server is not answering.`
            : 'Not set up yet. Open your Huddle room in a tab.'

      const hasRoomItem = Boolean(room?.item) && (window.__huddleMatchesRoom ? window.__huddleMatchesRoom(room) : true)
      const roomUrl = window.__huddleRoomUrl?.(room)
      el.joinTitle.style.display = roomUrl && !hasRoomItem ? 'block' : 'none'
      el.joinTitle.href = roomUrl || '#'
      el.joinTitle.textContent = roomUrl?.includes('#huddle-net77=')
        ? `Open Net77 and select ${room.item.title}`
        : 'Open the room’s video'
      el.idleRow.style.display = hasRoomItem ? 'none' : 'block'
      el.followingRow.style.display = hasRoomItem ? 'block' : 'none'

      if (!hasRoomItem) {
        /* Nothing to announce from Browse, My List, or a search — there is no
           single title on screen there, and offering the button anyway would
           mean it announces whatever `document.title` happens to say. */
        el.onTitle.style.display = onWatchPage ? 'block' : 'none'
        el.offTitleHint.style.display = onWatchPage ? 'none' : 'block'
        if (onWatchPage) {
          if (document.activeElement !== el.detectedTitle) el.detectedTitle.textContent = window.__huddleNet77Title?.()?.title ?? cleanTitle()
          el.announce.disabled = busy || !connected || !!player.buffering
          el.announce.textContent = busy ? 'Starting…' : 'Start the room on this'
        }
      } else {
        /* Left visible off a title page on purpose — it is useful to see what
           the room is on even from Browse, as the reason to go open it. */
        el.followingTitle.textContent = room.item.title
        el.reactions.style.display = follows() ? 'grid' : 'none'
        el.resync.disabled = !onWatchPage || !player || player.buffering
      }

      if (showStats) renderStats()
    }

    /**
     * The numbers behind the panel.
     *
     * Deliberately raw. This exists to be read out or screenshotted when
     * something feels wrong, and the whole value of it is that it does not
     * interpret: a gap of 2.4s with a fresh room update is a player not
     * obeying, and a gap of 0.1s with a nine-second-old update is a socket not
     * delivering. Those look identical from the sofa and need opposite fixes.
     */
    function renderStats() {
      const s = window.__huddleStats?.()
      if (!s) {
        el.stats.textContent = 'no sync engine on this page'
        return
      }

      const secs = (v) => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}s`)
      const ms = (v) => (v === null || v === undefined ? '—' : `${Math.round(v)}ms`)
      /* Anything past a couple of seconds means updates have stopped arriving,
         which is the one reading worth colouring. */
      const stale = s.roomAgeMs !== null && s.roomAgeMs > 2500

      el.stats.innerHTML = [
        `gap <b>${secs(s.gap)}</b>   rate <b>${s.rate.toFixed(2)}</b>${s.rateHonoured ? '' : ' <span class="warn">(refused)</span>'}`,
        `room <b class="${stale ? 'warn' : ''}">${ms(s.roomAgeMs)}</b> ago   player <b>${ms(s.playerAgeMs)}</b> ago`,
        `clock offset <b>${ms(s.offsetMs)}</b>   settling <b>${ms(s.settlingMs)}</b>`,
        `seeks <b>${s.seeks}</b>   speed changes <b>${s.nudgeWrites}</b>`,
        `room ${s.playing ? 'playing' : 'paused'} · player ${s.paused ? 'paused' : 'playing'}${s.buffering ? ' · buffering' : ''}${s.ready ? '' : ' · no title'}`,
      ].join('<br />')
    }

    render()
    setInterval(render, 1000)

    window.addEventListener('message', (event) => {
      if (event.source !== window) return
      const data = event.data
      if (!data || data.channel !== CHANNEL) return
      if (data.kind === 'state') latest = { ...latest, player: data }
    })

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.kind === 'reaction' && follows() && message.event?.roomId === latest.room.roomId) {
        const glyph = reactions.find(([id]) => id === message.event.reaction)?.[1]
        if (!glyph) return
        const toast = document.createElement('div')
        toast.className = 'burst'
        toast.textContent = `${glyph} ${message.event.from?.name ?? ''}`
        el.bursts.replaceChildren(toast)
        setTimeout(() => toast.remove(), 3200)
        return
      }
      if (message?.kind === 'room') {
        latest = {
          ...latest,
          room: message.snapshot ?? null,
          offset: message.offset ?? 0,
          status: message.status ?? null,
          /* Heard from at all — which is a different fact from having a room,
             and the one that says whether the extension is alive. */
          heard: true,
        }
      }
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount, { once: true })
  } else {
    mount()
  }
})()
