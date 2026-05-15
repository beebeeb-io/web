import { useEffect, useMemo, useState } from 'react'
import { Document, Page, pdfjs } from 'react-pdf'
import 'react-pdf/dist/esm/Page/AnnotationLayer.css'
import 'react-pdf/dist/esm/Page/TextLayer.css'

pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

interface PdfPreviewProps {
  blob: Blob
}

export function PdfPreview({ blob }: PdfPreviewProps) {
  const [numPages, setNumPages] = useState<number>(0)
  const [containerWidth, setContainerWidth] = useState<number>(800)
  const containerRef = useMemo(() => {
    let el: HTMLDivElement | null = null
    return {
      ref: (node: HTMLDivElement | null) => {
        el = node
        if (node) setContainerWidth(node.clientWidth)
      },
      get el() { return el },
    }
  }, [])

  useEffect(() => {
    function onResize() {
      if (containerRef.el) setContainerWidth(containerRef.el.clientWidth)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [containerRef])

  const fileUrl = useMemo(() => {
    const pdfBlob = new Blob([blob], { type: 'application/pdf' })
    return URL.createObjectURL(pdfBlob)
  }, [blob])

  useEffect(() => {
    return () => URL.revokeObjectURL(fileUrl)
  }, [fileUrl])

  return (
    <div ref={containerRef.ref} className="w-full h-full overflow-y-auto flex flex-col items-center gap-2 py-2">
      <Document
        file={fileUrl}
        onLoadSuccess={({ numPages: n }) => setNumPages(n)}
        loading={
          <div className="flex items-center gap-2 py-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-amber" />
            <span className="text-sm text-ink-3">Loading PDF...</span>
          </div>
        }
        error={
          <div className="text-sm text-red py-8">Failed to load PDF</div>
        }
      >
        {Array.from({ length: numPages }, (_, i) => (
          <Page
            key={i + 1}
            pageNumber={i + 1}
            width={Math.min(containerWidth - 16, 900)}
            className="mb-2 shadow-md rounded"
            renderTextLayer={true}
            renderAnnotationLayer={true}
          />
        ))}
      </Document>
    </div>
  )
}
