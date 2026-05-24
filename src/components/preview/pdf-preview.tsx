import { useEffect, useMemo } from 'react'

interface PdfPreviewProps {
  blob: Blob
}

export function PdfPreview({ blob }: PdfPreviewProps) {
  const url = useMemo(() => {
    const pdfBlob = new Blob([blob], { type: 'application/pdf' })
    return URL.createObjectURL(pdfBlob)
  }, [blob])

  useEffect(() => {
    return () => URL.revokeObjectURL(url)
  }, [url])

  return (
    <iframe
      src={url}
      sandbox="allow-popups allow-scripts"
      className="w-full h-full border-0 rounded"
      title="PDF preview"
    />
  )
}
