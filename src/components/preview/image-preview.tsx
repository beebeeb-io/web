import { useEffect, useState } from 'react'

interface ImagePreviewProps {
  blob: Blob
}

export function ImagePreview({ blob }: ImagePreviewProps) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const objectUrl = URL.createObjectURL(blob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  if (!url) return null

  return (
    <>
      <img
        src={url}
        alt=""
        className="max-h-full max-w-full rounded-md object-contain"
        style={{ boxShadow: '0 20px 60px -10px rgba(0,0,0,0.3)' }}
      />
      {/* EXIF/GPS strip badge removed — no stripping is performed in the
          upload pipeline (see src/lib/encrypted-upload.ts). Restore once a
          real metadata-strip step exists. */}
    </>
  )
}
