import { useEffect, useState } from 'react'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'

interface PdfPreviewProps {
  blob: Blob
}

function isMobile(): boolean {
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent)
}

export function PdfPreview({ blob }: PdfPreviewProps) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const pdfBlob = new Blob([blob], { type: 'application/pdf' })
    const objectUrl = URL.createObjectURL(pdfBlob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  if (!url) return null

  function handleOpen() {
    if (url) window.open(url, '_blank')
  }

  // Mobile browsers can't render PDFs inline — show prominent open/download
  if (isMobile()) {
    return (
      <div className="flex flex-col items-center gap-4 py-8">
        <Icon name="file-text" size={48} className="text-ink-3" />
        <p className="text-sm text-ink-2">PDF preview requires a full viewer</p>
        <BBButton variant="amber" size="md" onClick={handleOpen}>
          <Icon name="eye" size={14} className="mr-2" />
          Open PDF
        </BBButton>
      </div>
    )
  }

  // Desktop: embed with native PDF viewer
  return (
    <div className="flex h-full w-full flex-col">
      <embed
        src={`${url}#toolbar=1&navpanes=0`}
        type="application/pdf"
        className="w-full flex-1 rounded"
        style={{ minHeight: '70vh' }}
      />
    </div>
  )
}
