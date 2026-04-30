import { useMemo } from 'react'

interface PdfPreviewProps {
  blob: Blob
}

export function PdfPreview({ blob }: PdfPreviewProps) {
  const url = useMemo(() => {
    const pdfBlob = new Blob([blob], { type: 'application/pdf' })
    return URL.createObjectURL(pdfBlob)
  }, [blob])

  return (
    <iframe
      src={url}
      className="w-full h-full rounded bg-paper"
      style={{ border: 'none', minHeight: '80vh' }}
      title="PDF preview"
    />
  )
}
