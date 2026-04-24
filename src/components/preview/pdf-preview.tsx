import { useState } from 'react'
import { Icon } from '../icons'

interface PdfPreviewProps {
  blob: Blob
}

export function PdfPreview({ blob: _blob }: PdfPreviewProps) {
  void _blob // reserved for future pdf.js integration
  const [page, setPage] = useState(1)
  const totalPages = 1 // placeholder until pdf.js integration

  return (
    <>
      {/* Document card */}
      <div
        className="w-[520px] rounded bg-paper text-ink"
        style={{
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
          padding: '42px 52px 32px',
          fontSize: '11.5px',
          lineHeight: 1.65,
        }}
      >
        <div className="mb-1.5 text-lg font-bold tracking-tight">
          PDF preview
        </div>
        <div className="mb-5 font-mono text-[10px] text-ink-3">
          Client-side rendering coming soon
        </div>

        <p className="mb-3 text-ink-2">
          This PDF has been decrypted locally. Full in-browser rendering with
          pdf.js will be available in a future update.
        </p>
        <p className="text-ink-3">
          Use the download button in the toolbar to save and view this file in
          your system PDF viewer.
        </p>

        <div className="mt-8 flex border-t border-line pt-3 text-[9.5px] text-ink-4">
          <span>page {page} of {totalPages}</span>
        </div>
      </div>

      {/* Page navigation bar */}
      <div
        className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center rounded-full border border-ink/10 backdrop-blur-sm"
        style={{ background: 'oklch(0.2 0.005 70 / 0.9)', padding: 4 }}
      >
        <button
          type="button"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          className="rotate-180 px-2.5 py-1.5 text-paper disabled:opacity-30"
        >
          <Icon name="chevron-right" size={13} />
        </button>
        <span className="px-2 font-mono text-[11px] text-paper">
          {page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page >= totalPages}
          className="px-2.5 py-1.5 text-paper disabled:opacity-30"
        >
          <Icon name="chevron-right" size={13} />
        </button>
      </div>
    </>
  )
}
