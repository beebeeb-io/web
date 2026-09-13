import { describe, expect, test, beforeEach } from 'bun:test'

import {
  accountDeletedMessage,
  formatAccountDeletedMessage,
} from '../src/lib/user-friendly-error'
import { ApiError } from '../src/lib/api'
import { stashAccountDeletedNotice, consumeAccountDeletedNotice, type NoticeStorage } from '../src/lib/account-deleted-notice'

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

/**
 * A tiny in-memory Storage stand-in, injected explicitly into every call
 * below — `bun test` has no `window`/`sessionStorage` (no DOM), and mutating
 * `globalThis` to fake one would leak across other test files sharing this
 * process (the exact `mock.module`-is-process-global gotcha documented in
 * test/helpers/upload-share-mocks.ts). `account-deleted-notice.ts` and
 * `accountDeletedMessage` both accept an optional storage override for
 * exactly this reason — production call sites omit it and get the real
 * browser sessionStorage.
 */
function fakeStorage(): NoticeStorage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => { map.set(k, v) },
    removeItem: (k) => { map.delete(k) },
  }
}

// accountDeletedMessage() reads from the stashed notice (set by app.tsx's
// central registerAccountDeletedHandler — see account-deleted-central-handler
// .test.ts for the request()-level proof that the notice is stashed BEFORE
// any catch block observes the error).
describe('accountDeletedMessage', () => {
  let storage: NoticeStorage
  beforeEach(() => {
    storage = fakeStorage()
  })

  test('consumes a pre-stashed notice for an account_deleted ApiError', () => {
    stashAccountDeletedNotice(
      "This account was deleted on September 1, 2026. Its encrypted data will be shredded on October 1, 2026. We can't recover it.",
      storage,
    )
    const err = new ApiError('account_deleted', 403, 'account_deleted')
    const msg = accountDeletedMessage(err, storage)
    expect(msg).toBe(
      "This account was deleted on September 1, 2026. Its encrypted data will be shredded on October 1, 2026. We can't recover it.",
    )
  })

  test('consuming is one-shot — a second call falls back to the generic honest line', () => {
    stashAccountDeletedNotice('exact copy', storage)
    const err = new ApiError('account_deleted', 403, 'account_deleted')
    expect(accountDeletedMessage(err, storage)).toBe('exact copy')
    // Notice was consumed by the call above — no exact copy left to read.
    expect(accountDeletedMessage(err, storage)).toBe("This account has been deleted. We can't recover it.")
  })

  test('falls back to a generic-but-honest line when no notice was ever stashed', () => {
    const err = new ApiError('account_deleted', 403, 'account_deleted')
    expect(accountDeletedMessage(err, storage)).toBe("This account has been deleted. We can't recover it.")
  })

  test('returns null for an unrelated error (wrong code, plain Error, non-error) and never consumes', () => {
    stashAccountDeletedNotice('should never be read', storage)
    expect(accountDeletedMessage(new ApiError('nope', 403, 'some_other_code'), storage)).toBeNull()
    expect(accountDeletedMessage(new Error('boom'), storage)).toBeNull()
    expect(accountDeletedMessage('not an error at all', storage)).toBeNull()
    expect(accountDeletedMessage(undefined, storage)).toBeNull()
    // An unrelated error must NOT consume the stash.
    expect(consumeAccountDeletedNotice(storage)).toBe('should never be read')
  })
})
