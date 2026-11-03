/**
 * The payment-method panel (task W-P2-2).
 *
 * The summary view (#7) and the change-plan view draw the same facts from the
 * same `PaymentMethod` fields (type / brand / last4 / iban_last4 / is_default)
 * with a different affordance — a quiet text link vs a ghost button — so it is
 * one component with an explicit variant. SEPA-aware (task 1064, D3): a
 * directdebit mandate gets IBAN + mandate-reference fidelity instead of a
 * misleading "Card" fallback.
 */

import { BBButton, BBChip, Icon } from '@beebeeb/shared'
import type { PaymentMethod } from '../../lib/api'
import { Card, SectionLabel } from './ui'

interface PaymentMethodPanelBaseProps {
  readonly method: PaymentMethod | null
  readonly onUpdate: () => void
  /** A redirect is in flight. */
  readonly busy: boolean
}

export type PaymentMethodPanelProps =
  | (PaymentMethodPanelBaseProps & { readonly variant: 'summary' })
  | (PaymentMethodPanelBaseProps & { readonly variant: 'detailed' })

export function PaymentMethodPanel(props: PaymentMethodPanelProps) {
  switch (props.variant) {
    case 'summary':
      return <SummaryPanel {...props} />
    case 'detailed':
      return <DetailedPanel {...props} />
    default: {
      const unreachable: never = props
      return unreachable
    }
  }
}

/** #7 card: uppercase label + a quiet "Update method" text link. */
function SummaryPanel({ method, onUpdate, busy }: PaymentMethodPanelBaseProps & { variant: 'summary' }) {
  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-line">
        <SectionLabel>Payment method</SectionLabel>
        <button
          className="inline-flex items-center gap-1.5 text-[12px] font-medium text-amber-deep hover:text-amber transition-colors disabled:opacity-50"
          onClick={onUpdate}
          disabled={busy}
        >
          <Icon name="plus" size={12} />
          {busy ? 'Redirecting...' : method ? 'Update method' : 'Add method'}
        </button>
      </div>
      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <MethodDetail method={method} variant="summary" />
        {method?.is_default && (
          <BBChip variant="green">Default</BBChip>
        )}
      </div>
    </Card>
  )
}

/** Change-plan panel: same facts, a secondary button instead of the link. */
function DetailedPanel({ method, onUpdate, busy }: PaymentMethodPanelBaseProps & { variant: 'detailed' }) {
  return (
    <div className="border border-line rounded-xl overflow-hidden bg-paper">
      <div className="px-5 py-4 border-b border-line">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-4">
          Payment method
        </div>
      </div>
      <div className="px-5 py-4 flex items-center justify-between gap-4">
        <MethodDetail method={method} variant="detailed" />
        <BBButton
          size="sm"
          variant="ghost"
          onClick={onUpdate}
          disabled={busy}
        >
          {busy
            ? 'Redirecting...'
            : method
              ? 'Update payment method'
              : 'Add payment method'}
        </BBButton>
      </div>
    </div>
  )
}

function MethodDetail({ method, variant }: { method: PaymentMethod | null; variant: 'summary' | 'detailed' }) {
  if (!method) {
    return (
      <div className="flex items-center gap-3 min-w-0">
        <Icon name="shield" size={16} className="text-ink-3 shrink-0" />
        <div className="text-[13px] text-ink-2">No payment method on file</div>
      </div>
    )
  }
  // SEPA mandate (#7): a "SEPA" badge + the masked IBAN (mono) and a
  // muted "{holder} · mandate {ref}" line. We treat it as SEPA when the
  // method type is directdebit OR the new mandate fields are present.
  if (method.type === 'directdebit' || method.iban_masked || method.mandate_reference) {
    return <SepaDetail method={method} />
  }
  switch (variant) {
    case 'summary':
      return <SummaryCardDetail method={method} />
    case 'detailed':
      return <DetailedCardDetail method={method} />
    default: {
      const unreachable: never = variant
      return unreachable
    }
  }
}

function SepaDetail({ method }: { method: PaymentMethod }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="shrink-0 inline-flex items-center justify-center px-2 py-1 rounded-md border border-line bg-paper-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-2">
        SEPA
      </span>
      <div className="min-w-0">
        <div className="font-mono text-[13px] text-ink truncate">
          {method.iban_masked
            ?? (method.iban_last4 ? `•••• ${method.iban_last4}` : 'SEPA Direct Debit')}
        </div>
        {(method.account_holder_name || method.mandate_reference) && (
          <div className="text-[11.5px] text-ink-3 mt-0.5 truncate">
            {method.account_holder_name && (
              <span>{method.account_holder_name}</span>
            )}
            {method.account_holder_name && method.mandate_reference && ' · '}
            {method.mandate_reference && (
              <>mandate <span className="font-mono">{method.mandate_reference}</span></>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** #7: brand badge, brand + last digits (IBAN tail first), expiry. */
function SummaryCardDetail({ method }: { method: PaymentMethod }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <span className="shrink-0 inline-flex items-center justify-center px-2 py-1 rounded-md border border-line bg-paper-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-ink-2">
        {method.brand ?? 'Card'}
      </span>
      <div className="min-w-0">
        <div className="text-[13px] text-ink flex items-center gap-2 flex-wrap">
          <span className="font-medium">{method.brand ?? 'Card'}</span>
          {(method.iban_last4 || method.last4) && (
            <span className="font-mono text-ink-2">
              •••• {method.iban_last4 ?? method.last4}
            </span>
          )}
        </div>
        {method.exp_month && method.exp_year && (
          <div className="text-[11.5px] text-ink-3 mt-0.5">
            Expires{' '}
            <span className="font-mono">
              {String(method.exp_month).padStart(2, '0')}/{method.exp_year}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

/** Change-plan: shield + brand/last4 only (no badge, no IBAN tail). */
function DetailedCardDetail({ method }: { method: PaymentMethod }) {
  return (
    <div className="flex items-center gap-3 min-w-0">
      <Icon name="shield" size={16} className="text-ink-3 shrink-0" />
      <div className="min-w-0">
        <div className="text-[13px] text-ink flex items-center gap-2 flex-wrap">
          <span className="font-medium">{method.brand ?? 'Card'}</span>
          {method.last4 && (
            <span className="font-mono text-ink-2">•••• {method.last4}</span>
          )}
        </div>
        {method.exp_month && method.exp_year && (
          <div className="text-[11.5px] text-ink-3 mt-0.5">
            Expires{' '}
            <span className="font-mono">
              {String(method.exp_month).padStart(2, '0')}/{method.exp_year}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
