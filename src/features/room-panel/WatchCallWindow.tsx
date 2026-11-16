import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { REACTIONS, reactionById } from '@/features/fun/catalog'
import type { ReactionEvent } from '@/features/fun/useWatchFun'
import { BRIDGE_ID, INSTALLED_ATTR } from '@/features/watch/useExtensionInstalled'
import { getSocket } from '@/lib/socket'

const styles = `
  *{box-sizing:border-box}
  body{margin:0;background:#141418;color:#fff;font:13px system-ui,sans-serif}
  .call{position:relative;height:100dvh;display:grid;grid-template-rows:minmax(0,1fr) auto;overflow:hidden}
  .view{position:relative;display:grid;place-items:center;overflow:hidden;background:#222228}
  video{width:100%;height:100%;object-fit:cover;position:absolute;inset:0}
  .initial{display:grid;place-items:center;width:48px;height:48px;border-radius:50%;background:#34343a;font-size:24px}
  .name{position:absolute;bottom:6px;left:8px;padding:3px 6px;border-radius:5px;background:#111b;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tray{display:flex;gap:2px;justify-content:space-evenly;padding:3px}
  button{border:0;border-radius:6px;background:transparent;color:inherit;cursor:pointer;padding:4px;font-size:17px}
  button:hover,button:focus-visible{background:#ffffff22}
  .burst{position:absolute;top:8px;right:8px;border-radius:8px;background:#111d;padding:6px 9px;max-width:90%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;animation:enter .22s ease-out}
  @keyframes enter{from{opacity:0;transform:translateY(8px)}}
  @media(prefers-reduced-motion:reduce){.burst{animation:none}}
`

export function WatchCallWindow({
  target, roomId, stream, live, isSelf, name,
}: {
  target: Window
  roomId: string
  stream: MediaStream | null
  live: boolean
  isSelf: boolean
  name: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [reaction, setReaction] = useState<ReactionEvent | null>(null)

  useEffect(() => {
    if (video.current) video.current.srcObject = stream
  }, [stream, live])

  useEffect(() => {
    let expiry: ReturnType<typeof setTimeout> | undefined
    const socket = getSocket()
    const receive = (event: ReactionEvent & { roomId: string }) => {
      if (event.roomId !== roomId || !reactionById(event.reaction)) return
      setReaction(event)
      clearTimeout(expiry)
      expiry = setTimeout(() => setReaction(null), 3200)
    }
    socket.on('fun:react', receive)
    return () => {
      socket.off('fun:react', receive)
      clearTimeout(expiry)
    }
  }, [roomId])

  useEffect(() => {
    const bridge = document.getElementById(BRIDGE_ID)
    let expiry: ReturnType<typeof setTimeout> | undefined
    const check = () => {
      if (!document.hidden || expiry !== undefined) return
      if (!bridge?.hasAttribute(INSTALLED_ATTR)) {
        target.close()
        return
      }
      expiry = setTimeout(() => {
        expiry = undefined
        if (document.hidden) target.close()
      }, 1300)
      document.dispatchEvent(new Event('huddle:watch-focus'))
    }
    const answer = (event: Event) => {
      clearTimeout(expiry)
      expiry = undefined
      if (document.hidden && !(event as CustomEvent<boolean>).detail) target.close()
    }
    bridge?.addEventListener('huddle:watch-focus-result', answer)
    document.addEventListener('visibilitychange', check)
    const timer = setInterval(check, 750)
    return () => {
      clearInterval(timer)
      clearTimeout(expiry)
      bridge?.removeEventListener('huddle:watch-focus-result', answer)
      document.removeEventListener('visibilitychange', check)
    }
  }, [target])

  return createPortal(
    <>
      <style>{styles}</style>
      <div className="call">
        <div className="view">
          {live ? <video ref={video} autoPlay playsInline muted aria-label={name} style={isSelf ? { transform: 'scaleX(-1)' } : undefined} /> :
            <span className="initial" aria-label={`${name} has no video`}>{name.slice(0, 1).toUpperCase()}</span>}
          <span className="name">{name}</span>
          {reaction && (
            <span className="burst" key={reaction.id} role="status">
              {reactionById(reaction.reaction)?.glyph} {reaction.from.name}
            </span>
          )}
        </div>
        <div className="tray" role="group" aria-label="Watch party reactions">
          {REACTIONS.map(({ id, glyph, label }) => (
            <button key={id} type="button" aria-label={label} title={label}
              onClick={() => getSocket().volatile.emit('fun:react', { roomId, reaction: id })}>{glyph}</button>
          ))}
        </div>
      </div>
    </>,
    target.document.body,
  )
}
