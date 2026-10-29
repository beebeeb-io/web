/**
 * Task 1605 — upload/share refusals that aren't `account_state` values:
 * `trial_cancelled_read_only` (409) and the 25 GB trial-cap `quota_exceeded`
 * (413, `is_trial_cap: true`). See ../src/lib/account-state.ts.
 */
import { describe, expect, test } from 'bun:test'
import { uploadRefusalNotice } from '../src/lib/account-state'
import { ApiError } from '../src/lib/api'
import { userFriendlyError } from '../src/lib/user-friendly-error'

describe('uploadRefusalNotice', () => {
  test('trial_cancelled_read_only → a clear notice routed to /billing', () => {
    const err = new ApiError('cancelled', 409, 'trial_cancelled_read_only')
    const notice = uploadRefusalNotice(err)
    expect(notice).not.toBeNull()
    expect(notice?.href).toBe('/billing')
    expect(notice?.description).toContain('cancelled your trial')
  })

  test('quota_exceeded with is_trial_cap: true → the server message, routed to /billing', () => {
    const err = new ApiError(
      "You've reached the 25 GB trial storage cap. Pay now to unlock your full plan storage.",
      413,
      'quota_exceeded',
      { error: 'quota_exceeded', limit_bytes: 25_000_000_000, used_bytes: 25_000_000_000, is_trial_cap: true, message: "You've reached the 25 GB trial storage cap. Pay now to unlock your full plan storage." },
    )
    const notice = uploadRefusalNotice(err)
    expect(notice).not.toBeNull()
    expect(notice?.href).toBe('/billing')
    expect(notice?.description).toBe("You've reached the 25 GB trial storage cap. Pay now to unlock your full plan storage.")
  })

  test('quota_exceeded WITHOUT is_trial_cap (an ordinary plan-quota hit) → not this notice at all', () => {
    const err = new ApiError('over quota', 413, 'quota_exceeded', {
      error: 'quota_exceeded',
      limit_bytes: 1_000_000_000_000,
      used_bytes: 1_000_000_000_000,
      is_trial_cap: false,
    })
    expect(uploadRefusalNotice(err)).toBeNull()
  })

  test('an unrelated error code → null', () => {
    expect(uploadRefusalNotice(new ApiError('nope', 404, 'not_found'))).toBeNull()
  })

  test('a non-ApiError value → null, never throws', () => {
    expect(uploadRefusalNotice(new Error('plain'))).toBeNull()
    expect(uploadRefusalNotice(null)).toBeNull()
  })
})

describe('userFriendlyError — task 1605 branches', () => {
  test('trial_cancelled_read_only gets its own honest copy', () => {
    const err = new ApiError('cancelled', 409, 'trial_cancelled_read_only')
    expect(userFriendlyError(err)).toContain('cancelled your trial')
  })

  test('quota_exceeded + is_trial_cap uses the server actionable message, not the generic "Storage full"', () => {
    const err = new ApiError('cap message', 413, 'quota_exceeded', { is_trial_cap: true })
    expect(userFriendlyError(err)).toBe('cap message')
  })

  test('quota_exceeded without is_trial_cap keeps the existing generic copy', () => {
    const err = new ApiError('over quota', 413, 'quota_exceeded', { is_trial_cap: false })
    expect(userFriendlyError(err)).toBe('Storage full. Free up space or upgrade your plan to keep uploading.')
  })

  test('quota_exceeded with no details at all (older server) still falls back safely', () => {
    const err = new ApiError('over quota', 413, 'quota_exceeded')
    expect(userFriendlyError(err)).toBe('Storage full. Free up space or upgrade your plan to keep uploading.')
  })
})
