import { BBChip } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import type { BillingTransaction } from '../../lib/api'

interface TransactionListProps {
  transactions: BillingTransaction[]
  /**
   * 'plain' (default) = the original standalone section (label + list), kept for
   * the change-plan view. 'card' = the mockup #7 "Payment History" card: a single
   * hairline-bordered card with an uppercase label header and the table inside.
   */
  variant?: 'plain' | 'card'
}

function formatDate(iso: string): string {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/**
 * Format signed integer cents as a EUR amount, e.g. 3995 → "EUR 39.95",
 * -1099 → "− EUR 10.99" (refunds are stored negative). The minus uses a real
 * minus sign so it reads as money, not a hyphen.
 */
function formatCents(cents: number, currency: string): string {
  if (!Number.isFinite(cents)) cents = 0
  const cur = (currency || 'EUR').toUpperCase()
  const abs = (Math.abs(cents) / 100).toFixed(2)
  return cents < 0 ? `− ${cur} ${abs}` : `${cur} ${abs}`
}

/** Human label for a Mollie payment method. NULL → "Unknown" (we don't store it on pre-0936 rows). */
function methodLabel(method: string | null | undefined): string {
  switch (method) {
    case 'ideal':
      return 'iDEAL'
    case 'creditcard':
      return 'Card'
    case 'directdebit':
      return 'SEPA Direct Debit'
    case 'banktransfer':
      return 'Bank transfer'
    case 'paypal':
      return 'PayPal'
    case 'bancontact':
      return 'Bancontact'
    case null:
    case undefined:
    case '':
      return 'Unknown'
    default:
      return method
  }
}

/** Title-case a status string for the chip ("paid" → "Paid"). */
function statusLabel(status: string): string {
  if (!status) return 'Unknown'
  return status.charAt(0).toUpperCase() + status.slice(1)
}

function statusVariant(status: string): 'green' | 'amber' | 'red' | 'default' {
  switch (status) {
    case 'paid':
    case 'issued':
      return 'green'
    case 'pending':
    case 'open':
    case 'authorized':
      return 'amber'
    case 'failed':
    case 'canceled':
    case 'expired':
      return 'red'
    default:
      return 'default'
  }
}

/**
 * The payment-history (transactions) list (task 0936) — the actual money
 * movements, SEPARATE from the legal Invoices list. Payments are positive;
 * refunds / credit notes are their own NEGATIVE entries.
 *
 * Mobile-responsive from the start (mirrors InvoiceList): a fixed-column grid
 * table at sm+, reflowing to stacked cards on narrow viewports — never a
 * horizontal scroll.
 */
export function TransactionList({ transactions, variant = 'plain' }: TransactionListProps) {
  const isCard = variant === 'card'

  // The 'card' variant (mockup #7) renders a single hairline-bordered card with
  // a "PAYMENT HISTORY" header strip and the table inside (no nested border).
  // The empty + populated states share one outer card so the borders read clean.
  if (isCard) {
    return (
      <div className="border border-line rounded-xl overflow-hidden bg-paper" data-testid="transactions-list">
        <div className="px-5 py-4 border-b border-line">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
            Payment history
          </span>
        </div>
        {transactions.length === 0 ? (
          <div className="py-10 text-center" data-testid="transactions-empty">
            <div className="w-10 h-10 rounded-xl bg-paper-2 border border-line flex items-center justify-center mx-auto mb-3">
              <Icon name="file-text" size={16} className="text-ink-3" />
            </div>
            <div className="text-sm text-ink-3 mb-0.5">No payments yet</div>
            <div className="text-xs text-ink-4">
              Payments and refunds appear here after your first charge.
            </div>
          </div>
        ) : (
          <>
            <div
              className="hidden sm:grid gap-4 px-5 py-2.5 border-b border-line bg-paper-2 text-[11px] font-semibold uppercase tracking-wider text-ink-4"
              style={{ gridTemplateColumns: '1.2fr 1fr 130px 100px' }}
            >
              <span>Description</span>
              <span>Date</span>
              <span>Amount</span>
              <span>Status</span>
            </div>
            {transactions.map((tx) => {
              const isRefund = tx.kind === 'refund'
              const invoiceRef = isRefund ? tx.original_invoice_number : tx.invoice_number
              const amountClass = isRefund ? 'text-ink-2' : 'text-ink'
              const desc = tx.description || (isRefund ? 'Refund' : methodLabel(tx.method))
              const ref = tx.reference || (isRefund ? tx.credit_note_number : invoiceRef)
              return (
                <div
                  key={tx.id}
                  className="border-b border-line last:border-b-0 hover:bg-paper-2/50 transition-colors"
                >
                  {/* Desktop / tablet: Description + tx ref / Date / Amount / Status */}
                  <div
                    className="hidden sm:grid gap-4 px-5 py-3 items-center"
                    style={{ gridTemplateColumns: '1.2fr 1fr 130px 100px' }}
                  >
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-ink truncate">{desc}</div>
                      {ref && (
                        <div className="font-mono text-[10.5px] text-ink-4 mt-0.5 break-all">{ref}</div>
                      )}
                    </div>
                    <span className="text-[12.5px] text-ink-2">{formatDate(tx.date)}</span>
                    <span className={`font-mono text-xs font-semibold ${amountClass}`}>
                      {formatCents(tx.amount_gross_cents, tx.currency)}
                    </span>
                    <span>
                      <BBChip variant={statusVariant(tx.status)}>{statusLabel(tx.status)}</BBChip>
                    </span>
                  </div>
                  {/* Mobile: stacked card */}
                  <div className="sm:hidden px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[13px] text-ink font-medium truncate">{desc}</div>
                        <div className="text-[12px] text-ink-3 mt-0.5">{formatDate(tx.date)}</div>
                      </div>
                      <BBChip variant={statusVariant(tx.status)}>{statusLabel(tx.status)}</BBChip>
                    </div>
                    <div className="flex items-end justify-between gap-3 mt-2.5">
                      <div className="min-w-0">
                        {ref && (
                          <div className="font-mono text-[10.5px] text-ink-4 break-all">{ref}</div>
                        )}
                      </div>
                      <div className={`font-mono text-sm font-semibold ${amountClass} shrink-0`}>
                        {formatCents(tx.amount_gross_cents, tx.currency)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </>
        )}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-2.5 mb-2.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
          Transactions
        </span>
      </div>
      <p className="text-xs text-ink-4 mb-2.5 -mt-1">
        Your payment history — the actual charges and refunds, separate from your invoices.
      </p>

      {transactions.length === 0 ? (
        <div
          className="border border-line rounded-xl bg-paper-2 py-8 text-center"
          data-testid="transactions-empty"
        >
          <div className="w-10 h-10 rounded-xl bg-paper border border-line flex items-center justify-center mx-auto mb-3">
            <Icon name="file-text" size={16} className="text-ink-3" />
          </div>
          <div className="text-sm text-ink-3 mb-0.5">No transactions yet</div>
          <div className="text-xs text-ink-4">
            Payments and refunds will appear here after your first charge.
          </div>
        </div>
      ) : (
        <div className="border border-line rounded-xl overflow-hidden" data-testid="transactions-list">
          {/* Column header — table layout only (sm+). On mobile the rows reflow to
              stacked cards (below), so the header would be meaningless there. */}
          <div
            className="hidden sm:grid gap-4 px-5 py-2.5 border-b border-line bg-paper-2 text-[11px] font-semibold uppercase tracking-wider text-ink-4"
            style={{ gridTemplateColumns: '1fr 1.2fr 130px 100px' }}
          >
            <span>Date</span>
            <span>Method</span>
            <span>Amount</span>
            <span>Status</span>
          </div>

          {transactions.map((tx) => {
            const isRefund = tx.kind === 'refund'
            const invoiceRef = isRefund ? tx.original_invoice_number : tx.invoice_number
            const amountClass = isRefund ? 'text-ink-2' : 'text-ink'
            return (
              <div
                key={tx.id}
                className="border-b border-line last:border-b-0 hover:bg-paper-2/50 transition-colors"
              >
                {/* Desktop / tablet: fixed-column table row (sm+). */}
                <div
                  className="hidden sm:grid gap-4 px-5 py-3 items-center"
                  style={{ gridTemplateColumns: '1fr 1.2fr 130px 100px' }}
                >
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-ink-2">{formatDate(tx.date)}</div>
                    {invoiceRef && (
                      <div className="font-mono text-[10.5px] text-ink-4 mt-0.5 break-all">
                        {invoiceRef}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-ink-2">
                      {isRefund ? 'Refund' : methodLabel(tx.method)}
                    </div>
                    {isRefund && tx.credit_note_number && (
                      <div className="font-mono text-[10.5px] text-ink-4 mt-0.5 break-all">
                        {tx.credit_note_number}
                      </div>
                    )}
                  </div>
                  <span className={`font-mono text-xs font-semibold ${amountClass}`}>
                    {formatCents(tx.amount_gross_cents, tx.currency)}
                  </span>
                  <span>
                    <BBChip variant={statusVariant(tx.status)}>{statusLabel(tx.status)}</BBChip>
                  </span>
                </div>

                {/* Mobile: stacked card — no horizontal scroll. */}
                <div className="sm:hidden px-4 py-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-[13px] text-ink font-medium">
                        {isRefund ? 'Refund' : methodLabel(tx.method)}
                      </div>
                      <div className="text-[12px] text-ink-3 mt-0.5">{formatDate(tx.date)}</div>
                    </div>
                    <BBChip variant={statusVariant(tx.status)}>{statusLabel(tx.status)}</BBChip>
                  </div>
                  <div className="flex items-end justify-between gap-3 mt-2.5">
                    <div className="min-w-0">
                      {invoiceRef && (
                        <div className="font-mono text-[10.5px] text-ink-4 break-all">
                          {isRefund ? tx.credit_note_number : invoiceRef}
                        </div>
                      )}
                    </div>
                    <div className={`font-mono text-sm font-semibold ${amountClass} shrink-0`}>
                      {formatCents(tx.amount_gross_cents, tx.currency)}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
