/**
 * Invoice rows (task W-P2-2).
 *
 * A VAT invoice's status decides how its row is drawn — paid is green, an
 * upcoming/open invoice is amber, anything else falls back to the neutral
 * chip. That decision is one exhaustive union, so a status the server adds
 * later cannot silently render as "Paid" with a green chip.
 */

import { BBButton, BBChip, Icon } from '@beebeeb/shared'
import type { BillingInvoice } from '../../lib/api'
import { formatMoneyCents } from '../../lib/billing/money'
import { formatDocumentDate } from '../../lib/format'

export type InvoiceRow =
  | { readonly status: 'paid'; readonly invoice: BillingInvoice }
  | { readonly status: 'unpaid'; readonly invoice: BillingInvoice }
  | { readonly status: 'other'; readonly invoice: BillingInvoice }

/** Map a server invoice onto the row the table draws. */
export function invoiceRow(invoice: BillingInvoice): InvoiceRow {
  switch (invoice.status) {
    case 'paid':
      return { status: 'paid', invoice }
    case 'upcoming':
    case 'open':
      return { status: 'unpaid', invoice }
    default:
      return { status: 'other', invoice }
  }
}

/** The chip text stays the server's own status word, capitalised. */
export function invoiceRowLabel(row: InvoiceRow): string {
  const status = row.invoice.status
  return status.charAt(0).toUpperCase() + status.slice(1)
}

/** Exhaustive: paid green, unpaid amber, everything else neutral. */
export function invoiceRowChipVariant(row: InvoiceRow): 'green' | 'amber' | 'default' {
  switch (row.status) {
    case 'paid':
      return 'green'
    case 'unpaid':
      return 'amber'
    case 'other':
      return 'default'
    default: {
      const unreachable: never = row
      return unreachable
    }
  }
}

interface InvoiceTableProps {
  readonly rows: readonly InvoiceRow[]
  readonly downloadingId: string | null
  readonly onDownload: (invoice: BillingInvoice) => void
}

/**
 * The rows of the invoice table. The bordered container and the column header
 * stay in `InvoiceList`, which also owns the empty state.
 */
export function InvoiceTable({ rows, downloadingId, onDownload }: InvoiceTableProps) {
  return (
    <>
      {rows.map((row) => (
        <InvoiceTableRow
          key={row.invoice.id}
          row={row}
          downloading={downloadingId === row.invoice.id}
          onDownload={onDownload}
        />
      ))}
    </>
  )
}

function InvoiceTableRow({ row, downloading, onDownload }: { row: InvoiceRow; downloading: boolean; onDownload: (invoice: BillingInvoice) => void }) {
  const inv = row.invoice
  const downloadButton = (
    <BBButton
      size="sm"
      variant="ghost"
      onClick={() => onDownload(inv)}
      disabled={downloading}
      aria-label={`Download invoice ${inv.invoice_number}`}
    >
      {downloading ? (
        <svg className="animate-spin h-3 w-3 text-ink-3" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      ) : (
        <Icon name="download" size={12} />
      )}
    </BBButton>
  )
  return (
    <div className="border-b border-line last:border-b-0 hover:bg-paper-2/50 transition-colors">
      {/* Desktop / tablet: the original fixed-column table row (sm+). */}
      <div
        className="hidden sm:grid gap-4 px-5 py-3 items-center"
        style={{ gridTemplateColumns: '1.4fr 1fr 120px 100px 40px' }}
      >
        <span className="font-mono text-xs font-medium break-all">{inv.invoice_number}</span>
        <span className="text-[12.5px] text-ink-2">{formatDocumentDate(inv.invoice_date)}</span>
        <div className="min-w-0">
          <div className="font-mono text-xs font-semibold">
            {formatMoneyCents(inv.amount_gross_cents, 'EUR')}
          </div>
          <div className="text-[10.5px] text-ink-4 mt-0.5">
            {vatTreatmentLabel(inv.vat_treatment)}
          </div>
        </div>
        <span>
          <BBChip variant={invoiceRowChipVariant(row)}>
            {invoiceRowLabel(row)}
          </BBChip>
        </span>
        <div className="flex justify-end">{downloadButton}</div>
      </div>

      {/* Mobile: stacked card — no horizontal scroll. Number + amount in
          mono, status chip + per-row download stay reachable. */}
      <div className="sm:hidden px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-xs font-medium break-all text-ink">
              {inv.invoice_number}
            </div>
            <div className="text-[12px] text-ink-3 mt-0.5">
              {formatDocumentDate(inv.invoice_date)}
            </div>
          </div>
          <div className="shrink-0 -mr-1.5 -mt-1">{downloadButton}</div>
        </div>
        <div className="flex items-end justify-between gap-3 mt-2.5">
          <div className="min-w-0">
            <div className="font-mono text-sm font-semibold text-ink">
              {formatMoneyCents(inv.amount_gross_cents, 'EUR')}
            </div>
            <div className="text-[10.5px] text-ink-4 mt-0.5">
              {vatTreatmentLabel(inv.vat_treatment)}
            </div>
          </div>
          <BBChip variant={invoiceRowChipVariant(row)}>
            {invoiceRowLabel(row)}
          </BBChip>
        </div>
      </div>
    </div>
  )
}

/** Human label for a VAT treatment, shown under the invoice amount. */
export function vatTreatmentLabel(treatment: string): string {
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
