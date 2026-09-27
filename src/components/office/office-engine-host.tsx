/**
 * OfficeEngineHost (task 1567) — mounts the real LibreOffice-WASM engine in a
 * same-origin `<iframe>` and exposes a typed `OfficeBridge` handle once it's
 * ready.
 *
 * Why an iframe, not a direct script tag on the app's own page: the engine
 * needs `crossOriginIsolated === true` (SharedArrayBuffer for its pthread
 * build — see PLAN.md's COOP/COEP note) which is a document-level opt-in via
 * response headers. Scoping it to an iframe whose document is served from
 * `/office/<version>/...` (own headers, see nginx.conf + the dev-server
 * plugin in vite.config.ts) means the REST of the app never runs under
 * COOP/COEP, which would otherwise break any future cross-origin embed
 * elsewhere. The iframe is same-origin (the whole point of "our own engine,
 * our own origin" — docs/EGRESS.md), so `iframe.contentWindow.bbOffice` is
 * directly readable/callable from this component — no postMessage plumbing
 * needed, and every call in this file is a synchronous property read plus a
 * normal async function call on that object.
 *
 * `bb-office-api.js` (repos/office/bridge/) documents its own contract as
 * "load me as a sibling <script> on the same page as qt_soffice.html" — this
 * repo owns that combined page as `bb-office-host.html` (assembled by
 * scripts/office-dev-assets.sh from the engine's own qt_soffice.html plus a
 * trailing `<script src="bb-office-api.js">`), served from the SAME
 * content-hashed version directory as the engine binaries.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { OfficeBridge } from '../../lib/office/bb-office-bridge'
import { fetchOfficeManifest } from '../../lib/office/loader'

export type OfficeEngineStatus = 'loading-manifest' | 'booting' | 'ready' | 'error'

export interface OfficeEngineHostProps {
  /** Base path the manifest + version directories are served under. */
  baseUrl?: string
  /** App theme at mount time — seeded into the engine profile BEFORE any
   *  document opens (see bridge's `setTheme` doc comment: switching theme
   *  live does not repaint an already-open document in this engine build,
   *  so this is a boot-time seed, not a reactive prop). */
  initialTheme: 'light' | 'dark'
  /** Fires once `iframe.contentWindow.bbOffice` exists and the boot-time
   *  theme seed has been applied. */
  onReady?: (bridge: OfficeBridge) => void
  onError?: (message: string) => void
  /** Test-only: overrides the polling timeout (ms) so a red-path test doesn't
   *  wait the full production timeout. */
  bootTimeoutMs?: number
}

const DEFAULT_BOOT_TIMEOUT_MS = 90_000

/**
 * Polls `iframe.contentWindow.bbOffice` rather than relying on the iframe's
 * `onLoad` — `onLoad` fires once the HTML document parses, well before Qt's
 * own `QtLoader` has fetched/instantiated the ~55 MB engine and
 * `bb-office-api.js` has established its `Module.uno_main` port (that
 * script's own `waitForModule` does the identical poll one level down, for
 * the identical reason — see its header comment).
 */
function pollForBridge(
  win: Window,
  timeoutMs: number,
  signal: { cancelled: boolean },
): Promise<OfficeBridge> {
  const start = Date.now()
  return new Promise((resolve, reject) => {
    ;(function poll() {
      if (signal.cancelled) return
      const bridge = (win as Window & { bbOffice?: OfficeBridge }).bbOffice
      if (bridge) {
        resolve(bridge)
        return
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error('Office engine did not become ready in time'))
        return
      }
      setTimeout(poll, 150)
    })()
  })
}

export function useOfficeEngine(opts: OfficeEngineHostProps) {
  const { baseUrl = '/office', initialTheme, onReady, onError, bootTimeoutMs = DEFAULT_BOOT_TIMEOUT_MS } = opts
  const [status, setStatus] = useState<OfficeEngineStatus>('loading-manifest')
  const [error, setError] = useState<string | null>(null)
  const [iframeSrc, setIframeSrc] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<OfficeBridge | null>(null)
  const cancelledRef = useRef({ cancelled: false })

  useEffect(() => {
    cancelledRef.current = { cancelled: false }
    let cancelled = false
    setStatus('loading-manifest')
    setError(null)
    fetchOfficeManifest({ baseUrl })
      .then((manifest) => {
        if (cancelled) return
        setIframeSrc(`${baseUrl}/${manifest.version}/bb-office-host.html`)
        setStatus('booting')
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        setStatus('error')
        onError?.(message)
      })
    return () => {
      cancelled = true
      cancelledRef.current.cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl])

  const handleIframeLoad = useCallback(() => {
    const win = iframeRef.current?.contentWindow
    if (!win) return
    const localSignal = { cancelled: false }
    cancelledRef.current = localSignal
    pollForBridge(win, bootTimeoutMs, localSignal)
      .then(async (bridge) => {
        if (localSignal.cancelled) return
        bridgeRef.current = bridge
        // Boot-time theme seed (lead decision 2 on the engine's live-repaint
        // gap): applied before any document is open, so there is nothing
        // wrong to un-repaint — the FIRST document this session opens gets
        // the seeded theme's icon/appearance config from the start.
        try {
          await bridge.setTheme(initialTheme)
        } catch {
          // Non-fatal — the engine's own dialogs simply keep their default
          // appearance; the document canvas itself is unaffected either way.
        }
        if (localSignal.cancelled) return
        setStatus('ready')
        onReady?.(bridge)
      })
      .catch((err) => {
        if (localSignal.cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        setStatus('error')
        onError?.(message)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootTimeoutMs, initialTheme])

  return { status, error, iframeSrc, iframeRef, handleIframeLoad, bridge: bridgeRef.current }
}

export interface OfficeEngineHostViewProps extends OfficeEngineHostProps {
  className?: string
}

/**
 * Native Qt title-bar crop (lead decision 1 on the engine's open gap,
 * task 1567 phase-4 note: "the native Qt window title bar cannot be
 * hidden" — a frameless-window engine patch was tried, built, and reverted
 * after it broke document-switching; the lead's own fallback is "crop it in
 * our web shell... our chrome replaces LibreOffice's"). MEASURED, not
 * guessed: a real screenshot of the rebuilt engine's title bar
 * ("private:stream — LibreOfficeDev Writer", solid `rgb(48,140,198)`) was
 * scanned pixel-by-pixel — the coloured bar plus its 4px white window-edge
 * sliver above it spans the first ~22px of the iframe's own content, so
 * 26px is cropped for a safety margin without eating into the document
 * canvas below it. Mechanism: the iframe renders TALLER than its visible
 * container (`height: calc(100% + Npx)`) and is shifted up by the same
 * amount inside an `overflow: hidden` parent — the extra height at the
 * BOTTOM reveals that much more real document canvas instead of wasting it,
 * and `getBoundingClientRect()` on the (now-shifted) iframe element already
 * reflects its true on-screen position, so office-editor.tsx's own
 * pointerup → host-coordinate translation for the floating selection
 * toolbar needs no separate adjustment for this offset.
 */
const TITLE_BAR_CROP_PX = 26

/**
 * The presentational half: renders the iframe once a manifest-derived src is
 * known. `useOfficeEngine` (above) is exported separately so OfficeEditor can
 * own the hook's return value directly instead of prop-drilling through a
 * ref-forwarding wrapper.
 */
export function OfficeEngineFrame({
  iframeSrc,
  iframeRef,
  onLoad,
  className,
}: {
  iframeSrc: string | null
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  onLoad: () => void
  className?: string
}) {
  if (!iframeSrc) return null
  return (
    <div className={className ?? 'relative h-full w-full overflow-hidden'} data-testid="office-engine-frame-crop">
      <iframe
        ref={iframeRef}
        src={iframeSrc}
        onLoad={onLoad}
        title="Office document canvas"
        data-testid="office-engine-frame"
        // Same-origin by construction (the whole point — see this file's
        // header) — allow-same-origin is required for this component to reach
        // `contentWindow.bbOffice`. allow-scripts lets the engine's own JS
        // (Qt/Emscripten bootstrap, bb-office-api.js) run at all. Nothing else
        // is granted: no allow-popups (SystemShellExecute's product path is
        // dispatched to the HOST page via a CustomEvent, per docs/EGRESS.md —
        // this iframe never needs to navigate/pop up itself), no allow-forms,
        // no allow-top-navigation.
        sandbox="allow-scripts allow-same-origin"
        // clipboard-read/write (task 1567, Calc lane): `.uno:Copy`'s system
        // clipboard write executes in THIS frame's own realm, and without an
        // explicit Permissions-Policy grant here a same-origin sandboxed
        // iframe's clipboard calls are denied (found by actually running the
        // Calc e2e against the real engine: Sum/Average/Count never appeared
        // until this was added). No egress/security concern — the clipboard
        // is a local OS resource, not a network path (docs/EGRESS.md).
        allow="cross-origin-isolated; clipboard-read; clipboard-write"
        className="absolute left-0 right-0 border-0 bg-white"
        // CRITIQUE.md findings #1/#2 (task 1567, 2026-09-27) — SECOND root
        // cause, found by actually instrumenting the real running app (not
        // assumed from the earlier bridge-side fix alone): `<iframe>` is a
        // REPLACED element, and `position:absolute; left:0; right:0` with no
        // explicit `width` does NOT stretch a replaced element to fill its
        // containing block the way it does for a plain `<div>` — browsers
        // fall back to the iframe's own intrinsic default width, 300px
        // (confirmed empirically: a real e2e diagnostic measured this
        // iframe's own `getBoundingClientRect()` at exactly 300×N inside a
        // 1064px-wide canvas area). This is the SAME symptom bb-office-api.js's
        // canvas-backing-store fix targets, but at one level up: that fix
        // makes the CANVAS match ITS OWN document's box; this fix makes that
        // whole document's box (the iframe) actually fill this container in
        // the first place. `height` was already explicit for the crop hack
        // above — `width` needed the same treatment, not left to `left`/
        // `right` alone.
        style={{ top: -TITLE_BAR_CROP_PX, height: `calc(100% + ${TITLE_BAR_CROP_PX}px)`, width: '100%' }}
      />
    </div>
  )
}
