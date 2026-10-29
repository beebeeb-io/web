import { describe, expect, test } from 'bun:test'
import { mapBillingCreditNotes } from '../src/lib/api'
import { formatCreditCents } from '../src/components/billing/CreditNoteList'

const RAW = {
  credit_notes: [
    {
      id: 'c1', number: 'CN-2026-000002', credit_note_date: '2026-10-12',
      original_invoice_number: 'INV-2026-000001', reason: 'Refund', currency: 'EUR',
      amount_net_cents: -1612, vat_rate_bps: 2100, amount_vat_cents: -339,
      amount_gross_cents: -1951, vat_treatment: 'domestic', status: 'issued',
      pdf_url: '/api/v1/billing/credit-notes/c1/pdf',
    },
  ],
}

describe('1899 credit-note mapping', () => {
  test('maps server `number` to credit_note_number, keeps negative amounts, drops pdf_url', () => {
    const [cn] = mapBillingCreditNotes(RAW as never)
    expect(cn.credit_note_number).toBe('CN-2026-000002')
    expect(cn.original_invoice_number).toBe('INV-2026-000001')
    expect(cn.amount_gross_cents).toBe(-1951)
    expect(cn.amount_net_cents + cn.amount_vat_cents).toBe(cn.amount_gross_cents)
    expect('number' in cn).toBe(false)
    expect('pdf_url' in cn).toBe(false)
  })
  test('missing / empty payload gives an empty list', () => {
    expect(mapBillingCreditNotes(undefined)).toEqual([])
    expect(mapBillingCreditNotes({})).toEqual([])
  })
  test('formatCreditCents renders a credit with a leading minus', () => {
    expect(formatCreditCents(-1951)).toBe('-EUR 19.51')
    expect(formatCreditCents(1951)).toBe('-EUR 19.51')
    expect(formatCreditCents(0)).toBe('EUR 0.00')
  })
})
