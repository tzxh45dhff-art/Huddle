import { Download, Puzzle } from 'lucide-react'

import { useExtensionInstalled } from '@/features/watch/useExtensionInstalled'
import { EXTENSION_STORE_URL } from '@/lib/config'
import { cn } from '@/lib/utils'

export function StreamingSetup() {
  const installed = useExtensionInstalled()
  const outdated = installed !== null && installed !== __EXTENSION_VERSION__

  return (
    <div className="rounded-card border border-white/12 bg-white/[0.03] px-5 py-5">
      <h3 className="mb-3 font-display text-lg font-semibold text-chalk">Watch with your streaming account</h3>
      <p className="flex items-center gap-2 text-[0.8rem] font-semibold text-chalk">
        <span
          aria-hidden
          className={cn(
            'size-2 rounded-full',
            installed ? (outdated ? 'bg-amber-400' : 'bg-emerald-400') : 'bg-white/30',
          )}
        />
        {installed
          ? outdated
            ? `Extension v${installed} installed — v${__EXTENSION_VERSION__} is available`
            : 'Extension installed'
          : 'Extension not detected in this browser'}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <a className="watch-secondary" href="https://www.primevideo.com" target="_blank" rel="noopener noreferrer">Open Prime Video</a>
        <a className="watch-secondary" href="https://www.hotstar.com/in" target="_blank" rel="noopener noreferrer">Open JioHotstar · Beta</a>
      </div>
      <p className="mt-3 text-sm text-mist">Sign in to the service, play a film or episode, then choose “Start the room on this” in the Huddle panel. Friends can open the shared title from this room. Each viewer needs access to the title.</p>
      <p className="mt-2 text-xs text-dusk">JioHotstar is experimental on desktop. Live sports and ad-supported playback still need verification.</p>
      {installed && !outdated ? (
        <p className="mt-3 text-[0.78rem] leading-relaxed text-dusk">
          Keep this room open. The extension connects automatically and syncs play, pause, and seek.
        </p>
      ) : (
        <>
          <p className="mt-3 text-[0.85rem] leading-relaxed text-mist">
            {outdated ? (
              EXTENSION_STORE_URL ? (
                <>
                  Your copy is older than this room&rsquo;s. Chrome updates store extensions on
                  its own, so this usually resolves itself within a few hours.
                </>
              ) : (
                <>
                  Your copy is older than this room&rsquo;s. A sideloaded extension has no update
                  channel, so nothing tells you but this — download it again and press{' '}
                  <strong className="font-semibold text-chalk">Reload</strong> on{' '}
                  <code className="font-mono text-[0.78rem] text-chalk">chrome://extensions</code>.
                </>
              )
            ) : (
              <>
                Install the Chrome extension to sync play, pause, and seek in your streaming tab.
              </>
            )}
          </p>

          <ExtensionDownload outdated={outdated} />

          <p className="mt-3 text-[0.72rem] leading-relaxed text-dusk">
            Everyone needs the extension for playback sync. Use the link field above to set up a shared countdown.
          </p>
        </>
      )}
    </div>
  )
}

/**
 * Getting the extension onto this machine.
 *
 * Two shapes, and which one appears is not a design choice — it is what Chrome
 * allows. Published to the Web Store, this is one button and Chrome keeps the
 * thing updated by itself. Unpublished, an extension can only be sideloaded: a
 * folder on disk, developer mode, and a person who has to be told when there
 * is a new version, because nothing else will tell them.
 *
 * There is no third option worth offering. Self-hosted `.crx` auto-update was
 * removed for Windows and macOS in 2014 and survives only through enterprise
 * policy, which means editing the registry on every machine — further from
 * "professional" than the zip, not closer.
 *
 * Served from this origin rather than the API, either way: the API is a laptop
 * behind a tunnel that is not always up, and this page is on a CDN that is.
 */
function ExtensionDownload({ outdated }: { outdated: boolean }) {
  if (EXTENSION_STORE_URL) {
    return (
      <div className="mt-4 rounded-card border border-white/10 bg-white/[0.04] px-4 py-4">
        <a
          href={EXTENSION_STORE_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-2 rounded-full bg-chalk px-4 py-2 text-[0.8rem] font-semibold text-ink transition hover:opacity-90"
        >
          <Puzzle aria-hidden className="size-4" />
          {outdated ? 'Open the store listing' : 'Add to Chrome'}
        </a>
        <p className="mt-3 text-[0.78rem] leading-relaxed text-mist">
          {outdated
            ? 'Chrome updates it on its own, usually within a few hours. This opens the listing if you would rather not wait.'
            : 'One click, then come back to this tab — it configures itself from here, with nothing to type. Updates arrive on their own.'}
        </p>
      </div>
    )
  }

  const steps = outdated
    ? ['Unzip it over the folder you loaded before.', 'chrome://extensions → Reload.']
    : [
        'Unzip it somewhere you will keep — Chrome reads that folder every time it starts, so Downloads is a bad home for it.',
        'Open chrome://extensions and turn on Developer mode, top right.',
        'Load unpacked → pick the unzipped folder.',
        'Come back to this tab. It configures itself from here, with nothing to type.',
      ]

  return (
    <div className="mt-4 rounded-card border border-white/10 bg-white/[0.04] px-4 py-4">
      <a
        href="/huddle-extension.zip"
        download
        className="inline-flex items-center gap-2 rounded-full bg-chalk px-4 py-2 text-[0.8rem] font-semibold text-ink transition hover:opacity-90"
      >
        <Download aria-hidden className="size-4" />
        {outdated ? 'Download the update' : 'Download the extension'}
        <span className="font-normal opacity-60">v{__EXTENSION_VERSION__}</span>
      </a>

      <ol className="mt-3 space-y-1.5 text-[0.78rem] leading-relaxed text-mist">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-2">
            <span className="text-dusk tabular-nums">{index + 1}.</span>
            <span>{step}</span>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-[0.7rem] leading-relaxed text-dusk">
        Chrome asks about developer mode on every restart — that prompt is the cost of an
        extension installed outside the Web Store, and <em>Keep</em> dismisses it.
      </p>
    </div>
  )
}
