import { useState, useCallback } from 'react'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { downloadInvoicePdf, type BillingInvoice } from '../../lib/api'

interface InvoiceListProps {
  invoices: BillingInvoice[]
  /** Surface a download failure to the user (toast in the page that hosts this). */
  onError?: (message: string) => void
}

function formatDate(iso: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Format integer cents as a EUR amount, e.g. 3995 → "EUR 39.95". */
function formatCents(cents: number): string {
  if (!Number.isFinite(cents)) return 'EUR 0.00'
  return `EUR ${(cents / 100).toFixed(2)}`
}

/** Human label for a VAT treatment, shown under the invoice amount. */
function vatTreatmentLabel(treatment: string): string {
  switch (treatment) {
    case 'reverse_charge':
      return 'Reverse charge (0%)'
    case 'domestic':
      return 'Domestic VAT'
    case 'oss_destination':
      return 'Destination VAT'
    case 'out_of_scope':
      return 'Outside EU VAT'
    case 'micro_threshold_home':
      return 'Home VAT'
    default:
      return treatment
  }
}

/**
 * The VAT-compliant invoice list (task 0919). Each row downloads its PDF via the
 * authenticated `/api/v1/billing/invoices/{id}/pdf` endpoint — a blob save, NOT a
 * `window.open`, because the endpoint requires the session bearer.
 */
export function InvoiceList({ invoices, onError }: InvoiceListProps) {
  const [downloading, setDownloading] = useState<string | null>(null)

  const handleDownload = useCallback(
    async (invoice: BillingInvoice) => {
      setDownloading(invoice.id)
      try {
        const blob = await downloadInvoicePdf(invoice.id)
        const objectUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = objectUrl
        a.download = `${invoice.invoice_number || 'invoice'}.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(objectUrl), 4000)
      } catch (err) {
        onError?.(err instanceof Error ? err.message : 'Could not download invoice.')
      } finally {
        setDownloading(null)
      }
    },
    [onError],
  )

  const handleDownloadAll = useCallback(async () => {
    for (const inv of invoices) {
      await handleDownload(inv)
    }
  }, [invoices, handleDownload])

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
          Invoices
        </span>
        {invoices.length > 0 && (
          <BBButton size="sm" variant="ghost" className="ml-auto" onClick={() => void handleDownloadAll()}>
            <Icon name="download" size={11} className="mr-1" />
            Download all
          </BBButton>
        )}
      </div>

      {invoices.length === 0 ? (
        <div className="border border-line rounded-xl bg-paper-2 py-8 text-center" data-testid="invoices-empty">
          <div className="w-10 h-10 rounded-xl bg-paper border border-line flex items-center justify-center mx-auto mb-3">
            <Icon name="file-text" size={16} className="text-ink-3" />
          </div>
          <div className="text-sm text-ink-3 mb-0.5">No invoices yet</div>
          <div className="text-xs text-ink-4">
            Invoices will appear here after your first payment.
          </div>
        </div>
      ) : (
        <div className="border border-line rounded-xl overflow-x-auto" data-testid="invoices-list">
          <div
            className="grid gap-4 px-5 py-2.5 border-b border-line bg-paper-2 text-[11px] font-semibold uppercase tracking-wider text-ink-4 min-w-[560px]"
            style={{ gridTemplateColumns: '1.4fr 1fr 120px 100px 40px' }}
          >
            <span>Number</span>
            <span>Date</span>
            <span>Amount</span>
            <span>Status</span>
            <span />
          </div>

          {invoices.map((inv) => {
            const isPaid = inv.status === 'paid'
            const isUpcoming = inv.status === 'upcoming' || inv.status === 'open'
            return (
              <div
                key={inv.id}
                className="grid gap-4 px-5 py-3 border-b border-line items-center last:border-b-0 hover:bg-paper-2/50 transition-colors min-w-[560px]"
                style={{ gridTemplateColumns: '1.4fr 1fr 120px 100px 40px' }}
              >
                <span className="font-mono text-xs font-medium break-all">{inv.invoice_number}</span>
                <span className="text-[12.5px] text-ink-2">{formatDate(inv.invoice_date)}</span>
                <div className="min-w-0">
                  <div className="font-mono text-xs font-semibold">
                    {formatCents(inv.amount_gross_cents)}
                  </div>
                  <div className="text-[10.5px] text-ink-4 mt-0.5">
                    {vatTreatmentLabel(inv.vat_treatment)}
                  </div>
                </div>
                <span>
                  <BBChip variant={isPaid ? 'green' : isUpcoming ? 'amber' : 'default'}>
                    {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                  </BBChip>
                </span>
                <div className="flex justify-end">
                  <BBButton
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleDownload(inv)}
                    disabled={downloading === inv.id}
                    aria-label={`Download invoice ${inv.invoice_number}`}
                  >
                    {downloading === inv.id ? (
                      <svg className="animate-spin h-3 w-3 text-ink-3" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <Icon name="download" size={12} />
                    )}
                  </BBButton>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
