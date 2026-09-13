import { describe, expect, test } from 'bun:test'

import {
  accountDeletedMessage,
  formatAccountDeletedMessage,
} from '../src/lib/user-friendly-error'
import { AccountDeletedError, ApiError } from '../src/lib/api'

// Task 1404 — the account_deleted 403 (task 1403) must render the exact
// brand-voice copy: "This account was deleted on <date>. Its encrypted data
// will be shredded on <date>. We can't recover it." with both dates
// date-only (no time) in the viewer's locale.
//
// Date assertions use `toContain` on the individual pieces rather than one
// exact string match — the formatted date itself is locale-dependent
// (Intl.DateTimeFormat), so pinning the whole sentence would make this test
// brittle to the CI machine's default ICU locale rather than testing our copy.

describe('formatAccountDeletedMessage', () => {
  test('renders both dates, date-only, in the exact brand copy', () => {
    const msg = formatAccountDeletedMessage(
      '2026-09-01T00:00:00Z',
      '2026-10-01T00:00:00Z',
    )
    expect(msg).not.toBeNull()
    expect(msg).toStartWith('This account was deleted on ')
    expect(msg).toContain('. Its encrypted data will be shredded on ')
    expect(msg).toEndWith(". We can't recover it.")
    // date-only — no time-of-day fragment (colon) anywhere in the message.
    expect(msg).not.toContain(':')
    // Both years present and distinguishable (deleted_at vs shred_after are
    // different months here, so this also proves both dates were actually
    // substituted, not the same value twice).
    expect(msg).toContain('2026')
  })

  test('returns null when either date is missing (falls back to the generic mapper)', () => {
    expect(formatAccountDeletedMessage(undefined, '2026-10-01T00:00:00Z')).toBeNull()
    expect(formatAccountDeletedMessage('2026-09-01T00:00:00Z', undefined)).toBeNull()
    expect(formatAccountDeletedMessage(null, null)).toBeNull()
  })

  test('returns null for an unparseable date string', () => {
    expect(formatAccountDeletedMessage('not-a-date', '2026-10-01T00:00:00Z')).toBeNull()
  })
})

describe('accountDeletedMessage', () => {
  test('maps an AccountDeletedError to the formatted copy', () => {
    const err = new AccountDeletedError('2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')
    const msg = accountDeletedMessage(err)
    expect(msg).not.toBeNull()
    expect(msg).toStartWith('This account was deleted on ')
    expect(msg).toEndWith(". We can't recover it.")
  })

  test('returns null for an unrelated error (ApiError, plain Error, non-error)', () => {
    expect(accountDeletedMessage(new ApiError('nope', 403, 'some_other_code'))).toBeNull()
    expect(accountDeletedMessage(new Error('boom'))).toBeNull()
    expect(accountDeletedMessage('not an error at all')).toBeNull()
    expect(accountDeletedMessage(undefined)).toBeNull()
  })
})
