/**
 * Task 1605 — pure copy helpers for the never-paid-trial cancel/cap rules
 * (server PR #129). Mirrors the existing task-1604 test file's style.
 */
import { describe, expect, test } from 'bun:test'
import {
  isNeverPaidCancelledTrial,
  cancelledCardCopy,
  cancelledCompactLine,
  isTrialCapped,
  trialCapExplainer,
  payNowButtonLabel,
} from '../src/lib/trial-limits-copy'
import { formatStorageSI } from '../src/lib/format'

const ACCESS_UNTIL = '2026-10-13T00:00:00Z'
const DELETION_AT = '2026-10-27T00:00:00Z'
const PERIOD_END = '2026-11-01T00:00:00Z'
const fmt = (iso: string) => new Date(iso).toISOString().slice(0, 10)

describe('isNeverPaidCancelledTrial', () => {
  test('true only for cancelling + uploads_blocked_at set', () => {
    expect(
      isNeverPaidCancelledTrial({ status: 'cancelling', uploads_blocked_at: '2026-10-01T00:00:00Z' }),
    ).toBe(true)
  })

  test('false for a paying customer cancel (no uploads_blocked_at)', () => {
    expect(isNeverPaidCancelledTrial({ status: 'cancelling', uploads_blocked_at: null })).toBe(false)
  })

  test('false when not cancelling at all', () => {
    expect(isNeverPaidCancelledTrial({ status: 'active', uploads_blocked_at: '2026-10-01T00:00:00Z' })).toBe(false)
  })

  test('false for null/undefined subscription', () => {
    expect(isNeverPaidCancelledTrial(null)).toBe(false)
    expect(isNeverPaidCancelledTrial(undefined)).toBe(false)
  })
})

describe('cancelledCardCopy', () => {
  test('never-paid cancelled trial: kind, dates, uploadsBlockedNow', () => {
    const copy = cancelledCardCopy(
      {
        status: 'cancelling',
        uploads_blocked_at: '2026-09-29T10:00:00Z',
        access_until: ACCESS_UNTIL,
        data_deletion_at: DELETION_AT,
      },
      'Basic',
    )
    expect(copy).toEqual({
      kind: 'never_paid_trial',
      headline: 'Uploads stopped',
      accessUntilIso: ACCESS_UNTIL,
      deletionIso: DELETION_AT,
      uploadsBlockedNow: true,
    })
  })

  test('never-paid trial falls back to current_period_end when access_until is absent', () => {
    const copy = cancelledCardCopy(
      { status: 'cancelling', uploads_blocked_at: '2026-09-29T10:00:00Z', current_period_end: PERIOD_END },
      'Basic',
    )
    expect(copy?.accessUntilIso).toBe(PERIOD_END)
  })

  test('paying customer cancel: uploads NOT blocked, existing semantics', () => {
    const copy = cancelledCardCopy(
      { status: 'cancelling', current_period_end: PERIOD_END, data_deletion_at: null },
      'Pro',
    )
    expect(copy).toEqual({
      kind: 'paid_cancelling',
      headline: 'Your Pro plan stays active',
      accessUntilIso: PERIOD_END,
      deletionIso: null,
      uploadsBlockedNow: false,
    })
  })

  test('paying customer cancel with a real deletion date carries it through', () => {
    const copy = cancelledCardCopy(
      { status: 'cancelling', current_period_end: PERIOD_END, data_deletion_at: DELETION_AT },
      'Pro',
    )
    expect(copy?.deletionIso).toBe(DELETION_AT)
  })

  test('null for a non-cancelling subscription', () => {
    expect(cancelledCardCopy({ status: 'active', current_period_end: PERIOD_END }, 'Pro')).toBeNull()
  })

  test('null for a missing subscription', () => {
    expect(cancelledCardCopy(null, 'Pro')).toBeNull()
  })
})

describe('cancelledCompactLine', () => {
  test('exact "Uploads stopped · Access until <date> · Files deleted on <date>" for a never-paid trial', () => {
    const copy = cancelledCardCopy(
      { status: 'cancelling', uploads_blocked_at: '2026-09-29T10:00:00Z', access_until: ACCESS_UNTIL, data_deletion_at: DELETION_AT },
      'Basic',
    )
    expect(cancelledCompactLine(copy, fmt)).toBe(
      `Uploads stopped · Access until ${fmt(ACCESS_UNTIL)} · Files deleted on ${fmt(DELETION_AT)}`,
    )
  })

  test('never contains the word "Renews"', () => {
    const copy = cancelledCardCopy(
      { status: 'cancelling', uploads_blocked_at: '2026-09-29T10:00:00Z', access_until: ACCESS_UNTIL, data_deletion_at: DELETION_AT },
      'Basic',
    )
    expect(cancelledCompactLine(copy, fmt)).not.toContain('Renews')
  })

  test('null for a paid cancel (that card uses its own longer copy, not this compact line)', () => {
    const copy = cancelledCardCopy({ status: 'cancelling', current_period_end: PERIOD_END }, 'Pro')
    expect(cancelledCompactLine(copy, fmt)).toBeNull()
  })

  test('null when there is nothing to render at all', () => {
    expect(cancelledCompactLine(null, fmt)).toBeNull()
  })
})

describe('isTrialCapped / trialCapExplainer', () => {
  test('capped only for a trialing row with a positive trial_storage_cap_bytes', () => {
    expect(isTrialCapped({ status: 'trialing', trial_storage_cap_bytes: 25_000_000_000 })).toBe(true)
  })

  test('not capped once the server clears the field (first charge settled)', () => {
    expect(isTrialCapped({ status: 'trialing', trial_storage_cap_bytes: null })).toBe(false)
  })

  test('not capped for a non-trialing status even if the field is somehow set', () => {
    expect(isTrialCapped({ status: 'active', trial_storage_cap_bytes: 25_000_000_000 })).toBe(false)
  })

  test('trialCapExplainer names the cap and the plan, never silent about why', () => {
    const text = trialCapExplainer('Basic', 25_000_000_000, formatStorageSI)
    expect(text).toBe('25 GB during your trial — full Basic storage after your first payment.')
  })
})

describe('payNowButtonLabel', () => {
  test('names the plan the user is unlocking', () => {
    expect(payNowButtonLabel('Pro')).toBe('Pay now to unlock Pro storage')
  })
})
