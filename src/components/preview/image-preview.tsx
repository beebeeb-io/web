import { useEffect, useState } from 'react'
import { Icon } from '../icons'

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

      {/* EXIF stripped badge */}
      <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full border border-amber/30 bg-black/50 px-2.5 py-1 font-mono text-[10px] text-amber backdrop-blur-sm">
        <Icon name="shield" size={10} />
        GPS &amp; device serial stripped before encryption
      </div>
    </>
  )
}
