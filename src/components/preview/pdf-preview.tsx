import { useEffect, useState } from 'react'

interface PdfPreviewProps {
  blob: Blob
}

export function PdfPreview({ blob }: PdfPreviewProps) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    // Re-wrap with explicit PDF MIME so the browser's built-in viewer activates
    // even when the decrypted blob was typed as application/octet-stream.
    const pdfBlob = new Blob([blob], { type: 'application/pdf' })
    const objectUrl = URL.createObjectURL(pdfBlob)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [blob])

  if (!url) return null

  return (
    <div className="flex h-full w-full flex-col">
      <iframe
        src={url}
        className="w-full flex-1 rounded bg-paper"
        style={{ border: 'none', minHeight: '60vh' }}
        title="PDF preview"
      />
    </div>
  )
}
