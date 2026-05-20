/**
 * HEIC/HEIF preview — converts HEIC images to JPEG in-browser using heic2any,
 * then renders the result with ImagePreview.
 *
 * HEIC decoding can take several seconds for large photos, so this component
 * shows a loading spinner during conversion.
 */

import { useEffect, useState } from 'react'
import { Icon } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { ImagePreview } from './image-preview'

interface HeicPreviewProps {
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

export function HeicPreview({
  blob,
  zoom,
  rotation,
  onZoomChange,
  onClose,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: HeicPreviewProps) {
  const [convertedBlob, setConvertedBlob] = useState<Blob | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function convert() {
      try {
        // Lazy-load heic2any — only fetched when a HEIC file is opened
        const heic2any = (await import('heic2any')).default
        const result = await heic2any({
          blob,
          toType: 'image/jpeg',
          quality: 0.92,
        })
        if (cancelled) return

        // heic2any may return a single Blob or an array (for HEIC sequences).
        // For preview we only show the first image.
        const converted = Array.isArray(result) ? result[0] : result
        setConvertedBlob(converted)
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : 'Failed to decode HEIC image',
          )
        }
      }
    }

    convert()
    return () => {
      cancelled = true
    }
  }, [blob])

  // Loading state
  if (!convertedBlob && !error) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-amber" />
        <span className="text-sm text-ink-3">Converting HEIC image...</span>
      </div>
    )
  }

  // Error state — offer download instead
  if (error) {
    function handleDownload() {
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'image.heic'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    }

    return (
      <div className="flex flex-col items-center gap-4 text-center">
        <Icon name="image" size={36} className="text-ink-3" />
        <p className="text-sm text-ink-2">Could not decode HEIC image.</p>
        <p className="text-xs text-ink-3 font-mono">{error}</p>
        <BBButton variant="amber" size="md" onClick={handleDownload}>
          <Icon name="download" size={14} className="mr-2" />
          Download
        </BBButton>
      </div>
    )
  }

  // Render the converted JPEG using the standard image preview
  return (
    <ImagePreview
      blob={convertedBlob!}
      zoom={zoom}
      rotation={rotation}
      onZoomChange={onZoomChange}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      hasPrev={hasPrev}
      hasNext={hasNext}
    />
  )
}
