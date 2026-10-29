/**
 * useImpressFitZoom (task 1567 fix pass round 2, 2026-09-27) — computes a
 * real "fit the whole slide in the canvas, with margin" zoom percent from
 * the ACTUAL container size and the document's real page size, and pins it
 * via `bridge.setZoom()`. Runs once the canvas area has its final layout
 * (see the `active` contract below) and again on every container resize —
 * closing both halves of the lead's item 1 ("fit... on open AND when the
 * container resizes").
 *
 * Why this lives here instead of an engine-side auto-fit: the round-1 fix
 * dispatched `DocumentZoomType.ENTIRE_PAGE` on open and trusted the engine
 * to recompute a sane `ZoomValue` itself. Re-verified against a real
 * screenshot (design/office-editor-shots/pass2-verify-impress-dark.png) and
 * found to be a CONFIRMED NO-OP in production — the canvas region was
 * pixel-identical to a screenshot taken before that dispatch even existed,
 * and the slide was still rendered at the engine's literal BY_VALUE/100%
 * default, overflowing the visible canvas with the native vertical
 * scrollbar showing. Rather than keep guessing at engine internals (already
 * a confirmed no-op for the sibling `.uno:ScrollBar` hide, see
 * bb-office-worker.js's own item-2 note), the fit is computed here, where
 * the real container size is directly measurable — see
 * `bb-office-worker.js`'s new `getSlideSize` op for the other half.
 *
 * `active` should be `officeApp === 'impress' && docReady` — NOT `docReady`
 * alone gated earlier. `ImpressFilmstrip` (office-editor.tsx) only mounts
 * once `docReady` is true, and it claims its own column width from the SAME
 * flex row the canvas container sits in — computing fit before it mounts
 * would fit against a too-wide container and overflow horizontally the
 * moment the filmstrip appears. Gating on the same `docReady` the filmstrip
 * itself gates on means this hook's first `applyFit()` always runs against
 * the container's FINAL layout.
 *
 * The engine's own native scrollbar is hidden unconditionally by
 * `office-engine-host.tsx`'s own crop overlay regardless of this hook's
 * timing (a confirmed engine gap — `.uno:ScrollBar` does not toggle it), so
 * there is no visible scrollbar flash even on the one render tick before
 * this hook's first `setZoom()` call resolves.
 */

import { useEffect, useRef } from 'react'
import type { OfficeBridge } from '../lib/office/bb-office-bridge'

// 1 CSS px = 2540/96 hundredths-of-a-mm at 96 DPI — the SAME 1:1
// backing-store assumption bb-office-api.js's own
// `sizeCanvasBackingStoreBeforeBoot` documents (devicePixelRatio
// deliberately not applied in this engine build; see that file's header).
const MM100_PER_CSS_PX = 2540 / 96

// Leaves a visible margin around the slide, like Keynote/Google Slides'
// own "fit" zoom (neither fills the frame edge-to-edge) — the lead's own
// review of pass2-verify-impress-*.png named "with margin" explicitly.
const FIT_MARGIN_FACTOR = 0.92

const MIN_ZOOM_PERCENT = 10
const MAX_ZOOM_PERCENT = 400

// A raw ResizeObserver fires on every layout pixel during a live drag (e.g.
// the browser window being resized) — coalesce so at most one setZoom()
// round-trip is in flight against the worker port at a time.
const RESIZE_DEBOUNCE_MS = 120

export function useImpressFitZoom(
  active: boolean,
  containerRef: React.RefObject<HTMLElement | null>,
  getBridge: () => OfficeBridge | null,
  onZoomChange?: (percent: number) => void,
) {
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)

  useEffect(() => {
    if (!active) return
    const container = containerRef.current
    if (!container) return

    let cancelled = false
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    function applyFit() {
      if (cancelled) return
      // Coalesce: a resize firing while a fit is already in flight is
      // remembered and re-run once, instead of overlapping two setZoom()
      // calls against the same document.
      if (inFlightRef.current) {
        pendingRef.current = true
        return
      }
      inFlightRef.current = true
      ;(async () => {
        try {
          const bridge = getBridge()
          if (!bridge) return
          const size = await bridge.getSlideSize()
          if (!size || cancelled) return
          // Non-null: this whole effect returned early above if
          // `containerRef.current` was null at setup time, and `container`
          // is a `const` capturing that same element for this effect's
          // entire lifetime (TS's flow narrowing doesn't cross into this
          // nested async closure on its own).
          const rect = container!.getBoundingClientRect()
          const availWidthPx = rect.width
          const availHeightPx = rect.height
          if (availWidthPx <= 0 || availHeightPx <= 0) return
          const slideWidthPxAt100 = size.width / MM100_PER_CSS_PX
          const slideHeightPxAt100 = size.height / MM100_PER_CSS_PX
          if (slideWidthPxAt100 <= 0 || slideHeightPxAt100 <= 0) return
          const scale = Math.min(availWidthPx / slideWidthPxAt100, availHeightPx / slideHeightPxAt100) * FIT_MARGIN_FACTOR
          const percent = Math.round(Math.min(MAX_ZOOM_PERCENT, Math.max(MIN_ZOOM_PERCENT, scale * 100)))
          const result = await bridge.setZoom(percent)
          if (!cancelled) onZoomChange?.(result.zoom)
        } catch (e) {
          // best-effort — a failed fit leaves whatever zoom was already
          // active in place; never blocks the document from being usable.
          // Logged (not swallowed silently) so a real regression here is
          // visible in the console rather than just "the fit never
          // happened, no trace why".
          console.error('useImpressFitZoom: applyFit failed', e)
        } finally {
          inFlightRef.current = false
          if (pendingRef.current && !cancelled) {
            pendingRef.current = false
            applyFit()
          }
        }
      })()
    }

    applyFit()

    const observer = new ResizeObserver(() => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(applyFit, RESIZE_DEBOUNCE_MS)
    })
    observer.observe(container)

    return () => {
      cancelled = true
      if (debounceTimer) clearTimeout(debounceTimer)
      observer.disconnect()
    }
  }, [active, containerRef, getBridge, onZoomChange])
}
