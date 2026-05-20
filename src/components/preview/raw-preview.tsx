import { useEffect, useState } from 'react'
import { UnsupportedPreview } from './unsupported-preview'

interface RawPreviewProps {
  blob: Blob
  filename: string
  zoom?: number
  rotation?: number
  onZoomChange?: (z: number) => void
  onClose?: () => void
  onPrev?: () => void
  onNext?: () => void
  hasPrev?: boolean
  hasNext?: boolean
}

export function RawPreview({ blob, filename, zoom = 1, rotation = 0, onZoomChange }: RawPreviewProps) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)

    async function extractPreview() {
      try {
        const exifr = await import('exifr')
        const buffer = new Uint8Array(await blob.arrayBuffer())
        const thumb = await exifr.thumbnail(buffer)
        if (cancelled) return
        if (thumb && thumb.byteLength > 0) {
          const bytes = new Uint8Array(thumb.buffer as ArrayBuffer, thumb.byteOffset, thumb.byteLength)
          const thumbBlob = new Blob([bytes], { type: 'image/jpeg' })
          setPreviewUrl(URL.createObjectURL(thumbBlob))
        } else {
          setFailed(true)
        }
      } catch {
        if (!cancelled) setFailed(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    extractPreview()
    return () => {
      cancelled = true
    }
  }, [blob])

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  if (loading) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-amber" />
        <span className="text-sm text-ink-3">Extracting preview...</span>
      </div>
    )
  }

  if (failed || !previewUrl) {
    return <UnsupportedPreview blob={blob} filename={filename} />
  }

  const containerStyle: React.CSSProperties = {
    transform: `scale(${zoom}) rotate(${rotation}deg)`,
    transformOrigin: 'center center',
    transition: 'transform 0.15s ease-out',
  }

  return (
    <div className="relative flex items-center justify-center w-full h-full overflow-hidden">
      <img
        src={previewUrl}
        alt={filename}
        className="max-w-full max-h-full object-contain select-none"
        style={containerStyle}
        draggable={false}
        onWheel={(e) => {
          if (!onZoomChange) return
          e.preventDefault()
          const delta = e.deltaY > 0 ? -0.1 : 0.1
          onZoomChange(Math.max(0.5, Math.min(4, zoom + delta)))
        }}
      />
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-full bg-ink/60 text-[11px] text-white font-mono">
        Embedded preview — download for full quality
      </div>
    </div>
  )
}
