import { useCallback, useEffect, useRef, useState } from 'react'
import { useTouchGestures } from '../../hooks/use-touch-gestures'

interface ImagePreviewProps {
  blob: Blob
  zoom: number
  rotation: number
  onZoomChange: (zoom: number) => void
  onClose?: () => void
  onPrev?: () => void
  onNext?: () => void
  hasPrev?: boolean
  hasNext?: boolean
}

const MIN_ZOOM = 0.5
const MAX_ZOOM = 4.0
const ZOOM_STEP = 0.15

export function ImagePreview({
  blob,
  zoom,
  rotation,
  onZoomChange,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: ImagePreviewProps) {
  const [url, setUrl] = useState<string | null>(null)
  const [showIndicator, setShowIndicator] = useState(false)
  const indicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Double-tap toggles between 100% and 200% zoom
  function handleDoubleTap() {
    const next = zoom >= 1.9 ? 1 : 2
    onZoomChange(next)
    triggerIndicator()
  }

  useTouchGestures(containerRef, {
    onSwipeLeft: onNext && hasNext ? onNext : undefined,
    onSwipeRight: onPrev && hasPrev ? onPrev : undefined,
    onSwipeDown: onClose,
    onDoubleTap: handleDoubleTap,
  })

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  // Show zoom indicator with fade-out
  const triggerIndicator = useCallback(() => {
    setShowIndicator(true)
    if (indicatorTimerRef.current) clearTimeout(indicatorTimerRef.current)
    indicatorTimerRef.current = setTimeout(() => setShowIndicator(false), 1000)
  }, [])

  useEffect(() => {
    return () => {
      if (indicatorTimerRef.current) clearTimeout(indicatorTimerRef.current)
    }
  }, [])

  function handleWheel(e: React.WheelEvent) {
    e.preventDefault()
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta))
    if (next !== zoom) {
      onZoomChange(next)
      triggerIndicator()
    }
  }

  if (!url) return null

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden"
      onWheel={handleWheel}
    >
      {/* Prev arrow */}
      {onPrev && hasPrev && (
        <button
          type="button"
          onClick={onPrev}
          aria-label="Previous file"
          className="absolute left-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-paper/80 text-ink-2 shadow-1 backdrop-blur-sm transition-colors hover:bg-paper hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}

      {/* Image */}
      <img
        src={url}
        alt=""
        className="rounded-md object-contain select-none"
        style={{
          transform: `scale(${zoom}) rotate(${rotation}deg)`,
          transition: 'transform 0.15s ease',
          maxHeight: '100%',
          maxWidth: '100%',
          boxShadow: '0 20px 60px -10px rgba(0,0,0,0.3)',
        }}
        draggable={false}
      />

      {/* Next arrow */}
      {onNext && hasNext && (
        <button
          type="button"
          onClick={onNext}
          aria-label="Next file"
          className="absolute right-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-paper/80 text-ink-2 shadow-1 backdrop-blur-sm transition-colors hover:bg-paper hover:text-ink"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
      )}

      {/* Zoom indicator */}
      {showIndicator && (
        <div className="pointer-events-none absolute bottom-3 right-3 rounded-md bg-paper/90 px-2 py-1 font-mono text-[11px] text-ink-2 shadow-1 backdrop-blur-sm transition-opacity">
          {Math.round(zoom * 100)}%
        </div>
      )}

      {/* EXIF/GPS strip badge removed — no stripping is performed in the
          upload pipeline (see src/lib/encrypted-upload.ts). Restore once a
          real metadata-strip step exists. */}
    </div>
  )
}
