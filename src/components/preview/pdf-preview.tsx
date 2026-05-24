import { useEffect, useMemo } from 'react'

interface PdfPreviewProps {
  blob: Blob
}

export function PdfPreview({ blob }: PdfPreviewProps) {
  // Two URLs: the bare blob: URL (revoke target on unmount) and the same
  // URL with `#view=FitH` appended (fed to the iframe). `FitH` tells
  // Chrome's PDFium viewer to scale the page to fit the iframe's width
  // — without it the PDF renders at native size and a narrow viewport
  // (phones, side panels) shows only the top-left corner.
  const blobUrl = useMemo(() => {
    const pdfBlob = new Blob([blob], { type: 'application/pdf' })
    return URL.createObjectURL(pdfBlob)
  }, [blob])

  useEffect(() => {
    return () => URL.revokeObjectURL(blobUrl)
  }, [blobUrl])

  return (
    <iframe
      src={`${blobUrl}#view=FitH`}
      sandbox="allow-popups allow-scripts"
      className="w-full h-full border-0 rounded"
      title="PDF preview"
    />
  )
}
