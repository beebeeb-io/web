import { useState, useCallback } from 'react'
import { BBButton, BBChip, Icon } from '@beebeeb/shared'
import { downloadCreditNotePdf, type BillingCreditNote } from '../../lib/api'
import { formatDocumentDate } from '../../lib/format'

interface CreditNoteListProps {
  creditNotes: BillingCreditNote[]
  /** Surface a download failure to the user (toast in the page that hosts this). */
  onError?: (message: string) => void
}

/** A credit note is money going back to the customer: shown with a leading minus,
 *  e.g. -1951 → "-EUR 19.51". The server already sends the amount negative. */
export function formatCreditCents(cents: number): string {
  if (!Number.isFinite(cents)) return '-EUR 0.00'
  const abs = Math.abs(cents) / 100
  return `${cents === 0 ? '' : '-'}EUR ${abs.toFixed(2)}`
}

/** Status chip label: `issued` is the normal state; `reversed` means the credit
 *  was itself cancelled, so it no longer reduces what the customer owes. */
function statusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/**
 * Credit notes (task 1899): the legal documents for refunds, listed under the
 * invoices. Renders NOTHING when there are none: most customers never get one.
 * The PDF goes through the authenticated blob download (bearer header, never a
 * token in the URL), the same as the invoice PDF.
 */
export function CreditNoteList({ creditNotes, onError }: CreditNoteListProps) {
  const [downloading, setDownloading] = useState<string | null>(null)

  const handleDownload = useCallback(
    async (cn: BillingCreditNote) => {
      setDownloading(cn.id)
      try {
        const blob = await downloadCreditNotePdf(cn.id)
        const objectUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = objectUrl
        a.download = `${cn.credit_note_number || 'credit-note'}.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(objectUrl), 4000)
      } catch (err) {
        onError?.(err instanceof Error ? err.message : 'Could not download credit note.')
      } finally {
        setDownloading(null)
      }
    },
    [onError],
  )

  if (creditNotes.length === 0) return null

  return (
    <div data-testid="credit-notes-section">
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
          Credit notes
        </span>
      </div>

      <div className="border border-line rounded-xl overflow-hidden" data-testid="credit-notes-list">
        <div
          className="hidden sm:grid gap-4 px-5 py-2.5 border-b border-line bg-paper-2 text-[11px] font-semibold uppercase tracking-wider text-ink-4"
          style={{ gridTemplateColumns: '1.4fr 1fr 1.2fr 120px 100px 40px' }}
        >
          <span>Number</span>
          <span>Date</span>
          <span>Corrects</span>
          <span>Amount</span>
          <span>Status</span>
          <span />
        </div>

        {creditNotes.map((cn) => {
          const reversed = cn.status === 'reversed'
          const downloadButton = (
            <BBButton
              size="sm"
              variant="ghost"
              onClick={() => void handleDownload(cn)}
              disabled={downloading === cn.id}
              aria-label={`Download credit note ${cn.credit_note_number}`}
            >
              {downloading === cn.id ? (
                <svg className="animate-spin h-3 w-3 text-ink-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <Icon name="download" size={12} />
              )}
            </BBButton>
          )
          const amount = (
            <span className={`font-mono text-xs font-semibold ${reversed ? 'line-through text-ink-4' : ''}`}>
              {formatCreditCents(cn.amount_gross_cents)}
            </span>
          )
          return (
            <div
              key={cn.id}
              className="border-b border-line last:border-b-0 hover:bg-paper-2/50 transition-colors"
            >
              <div
                className="hidden sm:grid gap-4 px-5 py-3 items-center"
                style={{ gridTemplateColumns: '1.4fr 1fr 1.2fr 120px 100px 40px' }}
              >
                <span className="font-mono text-xs font-medium break-all">{cn.credit_note_number}</span>
                <span className="text-[12.5px] text-ink-2">{formatDocumentDate(cn.credit_note_date)}</span>
                <span className="font-mono text-xs text-ink-3 break-all">{cn.original_invoice_number}</span>
                {amount}
                <span>
                  <BBChip variant="default">{statusLabel(cn.status)}</BBChip>
                </span>
                <div className="flex justify-end">{downloadButton}</div>
              </div>

              <div className="sm:hidden px-4 py-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-mono text-xs font-medium break-all text-ink">{cn.credit_note_number}</div>
                    <div className="text-[12px] text-ink-3 mt-0.5">
                      {formatDocumentDate(cn.credit_note_date)} · corrects{' '}
                      <span className="font-mono">{cn.original_invoice_number}</span>
                    </div>
                  </div>
                  <div className="shrink-0 -mr-1.5 -mt-1">{downloadButton}</div>
                </div>
                <div className="flex items-end justify-between gap-3 mt-2.5">
                  {amount}
                  <BBChip variant="default">{statusLabel(cn.status)}</BBChip>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
