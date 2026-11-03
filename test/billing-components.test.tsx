/**
 * Task W-P2-2 — the billing page's extracted pieces draw the same money text,
 * the same invoice chips and the same plan/usage/payment-method facts as the
 * page did before the split. These are the unit tests for the new types
 * (`InvoiceRow`) and the extracted formatting helper; the page itself stays
 * covered by its Playwright snapshot pair.
 */
import { beforeAll, describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { invoiceRow, invoiceRowChipVariant, invoiceRowLabel, InvoiceTable } from '../src/components/billing/InvoiceTable'
import { formatCentsAsEur, formatMoneyCents } from '../src/lib/billing/money'
import { ensureWasm } from '../src/lib/format'
import type { BillingInvoice, PaymentMethod } from '../src/lib/api'
import { PaymentMethodPanel } from '../src/pages/billing/PaymentMethodPanel'
import { PlanCard } from '../src/pages/billing/PlanCard'
import { UsagePanel } from '../src/pages/billing/UsagePanel'

// `format.ts` starts the wasm init on import but does not wait for it; alone
// (the guard's isolated step, or a loaded CI runner) the first size assertion
// can beat it and read the raw-byte fallback ("1000000000000 B").
beforeAll(async () => {
  await ensureWasm()
})

const html = (el: React.ReactElement) => renderToStaticMarkup(el)

function invoice(over: Partial<BillingInvoice> & { status: string; id: string }): BillingInvoice {
  return {
    invoice_number: `INV-${over.id}`,
    invoice_date: '2026-10-12',
    amount_gross_cents: 3995,
    amount_net_cents: 3302,
    vat_amount_cents: 693,
    vat_rate_bps: 2100,
    vat_treatment: 'domestic',
    pdf_url: `/api/v1/billing/invoices/${over.id}/pdf`,
    ...over,
  }
}

describe('billing money formatting', () => {
  test('formatCentsAsEur keeps the old bare-EUR ladder', () => {
    expect(formatCentsAsEur(3900)).toBe('39')
    expect(formatCentsAsEur(3995)).toBe('39.95')
    expect(formatCentsAsEur(0)).toBe('0')
    expect(formatCentsAsEur(Number.NaN)).toBe('0.00')
  })

  test('formatMoneyCents equals main for EUR, USD and GBP (sign + currency)', () => {
    expect(formatMoneyCents(3995, 'EUR')).toBe('EUR 39.95')
    expect(formatMoneyCents(1200, 'USD')).toBe('USD 12.00')
    expect(formatMoneyCents(0, 'GBP')).toBe('GBP 0.00')
    expect(formatMoneyCents(-1099, 'EUR')).toBe('− EUR 10.99')
    expect(formatMoneyCents(150, '')).toBe('EUR 1.50')
    expect(formatMoneyCents(Number.NaN, 'EUR')).toBe('EUR 0.00')
  })
})

describe('InvoiceRow', () => {
  test('maps the server status onto the row union', () => {
    expect(invoiceRow(invoice({ id: 'a', status: 'paid' })).status).toBe('paid')
    expect(invoiceRow(invoice({ id: 'b', status: 'upcoming' })).status).toBe('unpaid')
    expect(invoiceRow(invoice({ id: 'c', status: 'open' })).status).toBe('unpaid')
    expect(invoiceRow(invoice({ id: 'd', status: 'void' })).status).toBe('other')
  })

  test('chip colour is exhaustive over the union', () => {
    expect(invoiceRowChipVariant(invoiceRow(invoice({ id: 'a', status: 'paid' })))).toBe('green')
    expect(invoiceRowChipVariant(invoiceRow(invoice({ id: 'b', status: 'open' })))).toBe('amber')
    expect(invoiceRowChipVariant(invoiceRow(invoice({ id: 'c', status: 'refunded' })))).toBe('default')
  })

  test('the chip keeps the server word, capitalised', () => {
    expect(invoiceRowLabel(invoiceRow(invoice({ id: 'a', status: 'paid' })))).toBe('Paid')
    expect(invoiceRowLabel(invoiceRow(invoice({ id: 'b', status: 'upcoming' })))).toBe('Upcoming')
  })

  test('renders one row per invoice with its money and status', () => {
    const rows = ['paid', 'open', 'void'].map((status, i) => invoiceRow(invoice({ id: String(i), status })))
    const out = html(<InvoiceTable rows={rows} downloadingId={null} onDownload={() => {}} />)
    expect(out).toContain('INV-0')
    expect(out).toContain('EUR 39.95')
    expect(out).toContain('Paid')
    expect(out).toContain('Open')
    expect(out).toContain('Void')
    expect(out).toContain('Domestic VAT')
  })
})

const FREE_PLAN_PROPS = {
  planName: 'Free',
  badge: null,
  noCardTrial: null,
  price: null,
  isFreeWithoutPlan: true,
  accountState: 'needs_plan' as const,
  accountStateLabel: 'allowance',
  allowanceLine: 'You can store 5 GB before you need a plan.',
  uploadsBlockedNow: false,
  canCancel: false,
  usage: { usedBytes: 1_000_000_000, totalStorageBytes: 5_000_000_000, usedPercent: 20, extraTb: 0, addonPerTbCents: 1099, cycle: null },
  footer: { kind: 'none' as const },
  payNow: { trialCapped: false, explainer: null, heldUntil: false, label: 'Pay now', phase: 'idle' as const, message: null, onPayNow: () => {} },
  onChangePlan: () => {},
  onCancel: () => {},
}

describe('PlanCard', () => {
  test('free plan draws the allowance line and the choose CTA', () => {
    const out = html(<PlanCard {...FREE_PLAN_PROPS} />)
    expect(out).toContain('5 GB encrypted storage')
    expect(out).toContain('You can store 5 GB before you need a plan.')
    expect(out).toContain('Choose a plan')
    expect(out).toContain('billing-current-plan-card')
  })

  test('paid plan draws the server-truth price breakdown', () => {
    const out = html(
      <PlanCard
        {...FREE_PLAN_PROPS}
        planName="Pro"
        isFreeWithoutPlan={false}
        accountState="ok"
        price={{ label: 'Pro', totalCents: 3995, baseCents: 2900, extraTb: 2, addonPerTbCents: 1099, interval: 'month', cycle: 'monthly' }}
        usage={{ usedBytes: 1_000_000_000, totalStorageBytes: 5_000_000_000, usedPercent: 20, extraTb: 2, addonPerTbCents: 1099, cycle: 'monthly' }}
        canCancel
        footer={{ kind: 'period', label: 'Renews', dateLabel: '12 Nov 2026', cancelKind: null, extra: null, paymentBrand: 'Visa', includesAddon: true }}
      />,
    )
    expect(out).toContain('EUR 39.95 / month')
    expect(out).toContain('Pro EUR 29 + 2 TB')
    expect(out).toContain('Change plan')
    expect(out).toContain('Cancel')
    expect(out).toContain('Renews')
    expect(out).toContain('via')
    expect(out).toContain('incl. add-on storage')
  })

  test('a cancelled never-paid trial footer uses the compact cancelling line', () => {
    const out = html(
      <PlanCard
        {...FREE_PLAN_PROPS}
        footer={{ kind: 'never_paid_trial', compactLine: 'Uploads stopped · Access until 12 Nov' }}
      />,
    )
    expect(out).toContain('cancelling-card')
    expect(out).toContain('Uploads stopped')
  })

  test('a capped trial offers pay now and shows the pending row', () => {
    const out = html(
      <PlanCard
        {...FREE_PLAN_PROPS}
        payNow={{ trialCapped: true, explainer: 'Trial storage is capped at 25 GB.', heldUntil: false, label: 'Pay now', phase: 'pending', message: 'Confirming your payment…', onPayNow: () => {} }}
      />,
    )
    expect(out).toContain('trial-cap-card')
    expect(out).toContain('capped at 25 GB')
    expect(out).toContain('pay-now-button')
    expect(out).toContain('pay-now-pending')
  })
})

describe('UsagePanel', () => {
  test('meters variant draws the add-on meter at the server per-TB price', () => {
    const out = html(
      <UsagePanel variant="meters" usedBytes={1_000_000_000_000} totalStorageBytes={3_000_000_000_000} usedPercent={33} extraTb={2} addonPerTbCents={1099} billingCycle="yearly" />,
    )
    expect(out).toContain('1.0 TB')
    expect(out).toContain('/ 3.0 TB')
    expect(out).toContain('+2 TB')
    expect(out).toContain('EUR 10.99 / extra TB')
    expect(out).toContain('annually')
  })

  test('progress variant explains a nearly-full trial', () => {
    const out = html(
      <UsagePanel variant="progress" usedBytes={24_000_000_000} totalStorageBytes={25_000_000_000} usedPercent={96} extraTb={0} baseTb={1} canAddStorage={false} noCardTrial />,
    )
    expect(out).toContain('Your trial is almost full')
  })
})

const CARD: PaymentMethod = { type: 'creditcard', brand: 'Visa', last4: '4242', exp_month: 4, exp_year: 2030, is_default: true }
const SEPA: PaymentMethod = { type: 'directdebit', is_default: true, iban_masked: 'NL10 •••• 9438', mandate_reference: 'SD54-2280', account_holder_name: 'T. Test' }

describe('PaymentMethodPanel', () => {
  test('summary variant shows the card, the default chip and the quiet link', () => {
    const out = html(<PaymentMethodPanel variant="summary" method={CARD} busy={false} onUpdate={() => {}} />)
    expect(out).toContain('Payment method')
    expect(out).toContain('Visa')
    expect(out).toContain('4242')
    expect(out).toContain('Default')
    expect(out).toContain('Update method')
  })

  test('a SEPA mandate shows the IBAN and mandate reference in both variants', () => {
    for (const variant of ['summary', 'detailed'] as const) {
      const out = html(<PaymentMethodPanel variant={variant} method={SEPA} busy={false} onUpdate={() => {}} />)
      expect(out).toContain('SEPA')
      expect(out).toContain('NL10 •••• 9438')
      expect(out).toContain('SD54-2280')
    }
  })

  test('no method on file is honest in both variants', () => {
    expect(html(<PaymentMethodPanel variant="summary" method={null} busy={false} onUpdate={() => {}} />)).toContain('No payment method on file')
    const detailed = html(<PaymentMethodPanel variant="detailed" method={null} busy={false} onUpdate={() => {}} />)
    expect(detailed).toContain('Add payment method')
    expect(html(<PaymentMethodPanel variant="detailed" method={null} busy onUpdate={() => {}} />)).toContain('Redirecting...')
  })
})
