import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CreditNoteList } from '../src/components/billing/CreditNoteList'
import { InvoiceList } from '../src/components/billing/InvoiceList'
import { formatDocumentDate } from '../src/lib/format'

const cn = (d: string) =>
  [{ id: 'c1', credit_note_number: 'CN-1', credit_note_date: d, original_invoice_number: 'INV-1', amount_gross_cents: -1951, status: 'issued' }] as never
const inv = (d: string) =>
  [{ id: 'i1', invoice_number: 'INV-1', invoice_date: d, amount_gross_cents: 1951, amount_net_cents: 1612, vat_amount_cents: 339, vat_rate_bps: 2100, status: 'paid', vat_treatment: 'standard', pdf_url: '' }] as never

describe(`1899 r2: date-only documents keep their day (TZ=${process.env.TZ ?? 'unset'})`, () => {
  test('credit note list shows 12 Oct 2026', () => {
    const h = renderToStaticMarkup(<CreditNoteList creditNotes={cn('2026-10-12')} />)
    expect(h).toContain('12 Oct 2026')
    expect(h).not.toContain('11 Oct 2026')
  })
  test('invoice list shows 12 Oct 2026', () => {
    const h = renderToStaticMarkup(<InvoiceList invoices={inv('2026-10-12')} />)
    expect(h).toContain('12 Oct 2026')
    expect(h).not.toContain('11 Oct 2026')
  })
  test('helper: date-only, empty, garbage', () => {
    expect(formatDocumentDate('2026-10-12')).toBe('12 Oct 2026')
    expect(formatDocumentDate('')).toBe('-')
    expect(formatDocumentDate('nope')).toBe('nope')
  })
  test('helper: full timestamp is an instant, local time', () => {
    const iso = '2026-10-12T12:00:00Z'
    expect(formatDocumentDate(iso)).toBe(
      new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }),
    )
  })
})
