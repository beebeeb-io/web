import { describe, expect, test } from 'bun:test'
import {
  ALLOCATION_TOLERANCE_BYTES,
  resolveMeterTotalBytes,
  resolveCurrentTotalBytes,
  storageAllocationBreakdown,
} from '../src/lib/storage-totals'

/**
 * Task 1706 review round 2 (Codex PR #132 threads) — the storage-total
 * authority decision and the "Current total" allocation breakdown.
 *
 * RED-FIRST (2026-10-02): against the pre-fix code this suite FAILED — the
 * module did not exist (missing export = import error), mirroring the
 * 1706-addon-normalization.test.ts pattern.
 *
 * Contracts under test:
 *
 * #132-A (fresh add-on result authority): right after a POST /billing/addons
 * apply succeeds, the response's `effective_storage_bytes` is the freshest
 * quota truth the page holds, but the meter reads the drive-context
 * `/files/usage` value which only refreshes asynchronously — and that refresh
 * can fail silently. `resolveMeterTotalBytes` / `resolveCurrentTotalBytes`
 * therefore take a transient `preferAddonBytes` override that promotes the
 * add-on payload's server truth to FIRST in the hierarchy until the next
 * successful contextUsage refresh clears it. With the override OFF the
 * helpers must reproduce the task-1706 hierarchy EXACTLY (context server
 * truth first, addonState's server truth next, static meta last) — no tb
 * synthesis is reintroduced anywhere.
 *
 * #132-B (bonus-aware breakdown): the parenthetical lists base + extra TB
 * while the displayed total is the bonus-inclusive server quota — with a
 * bonus the two contradict. `storageAllocationBreakdown` derives the
 * unexplained remainder and reports it so the UI can render a neutral
 * "additional storage" term (NO web payload exposes a bonus-specific field —
 * /files/usage, /billing/usage and /billing/addons carry none — so "bonus"
 * wording would be an ungrounded claim), and reports irreconcilable when the
 * parts exceed the displayed total so the parenthetical can be omitted.
 */

const TB = 1_000_000_000_000
const GB = 1_000_000_000

describe('#132-A resolveMeterTotalBytes — hierarchy identical to task 1706 with the override off', () => {
  test('valid context server truth wins', () => {
    expect(resolveMeterTotalBytes(1.2 * TB, 1.2 * TB, false, 5 * TB)).toBe(1.2 * TB)
  })

  test('invalid context → addonState server truth (raw path, 0 included)', () => {
    expect(resolveMeterTotalBytes(null, 1.2 * TB, false, 5 * TB)).toBe(1.2 * TB)
    // addonState present but the payload carried no effective field → 0; the
    // caller's outer guard (valid && > 0) then falls back to meta. The helper
    // must return the raw 0, not pre-empt the guard with meta.
    expect(resolveMeterTotalBytes(null, 0, false, 5 * TB)).toBe(0)
  })

  test('no addonState → static meta fallback', () => {
    expect(resolveMeterTotalBytes(null, undefined, false, 5 * TB)).toBe(5 * TB)
  })
})

describe('#132-A resolveMeterTotalBytes — the transient override promotes the fresh add-on result', () => {
  test('override ON: fresh add-on bytes win over the (stale) context value', () => {
    expect(resolveMeterTotalBytes(1.2 * TB, 2.2 * TB, true, 5 * TB)).toBe(2.2 * TB)
  })

  test('override ON with a 0 effective field: raw 0 preserved (caller guard falls to meta)', () => {
    expect(resolveMeterTotalBytes(1.2 * TB, 0, true, 5 * TB)).toBe(0)
  })

  test('override ON without an add-on snapshot: falls back to the normal hierarchy', () => {
    expect(resolveMeterTotalBytes(1.2 * TB, undefined, true, 5 * TB)).toBe(1.2 * TB)
    expect(resolveMeterTotalBytes(null, undefined, true, 5 * TB)).toBe(5 * TB)
  })
})

describe('#132-A resolveCurrentTotalBytes — slider readout authority', () => {
  test('override OFF: context truth, else the TB reconstruction (task-1706 behaviour unchanged)', () => {
    expect(resolveCurrentTotalBytes(2.2 * TB, 2.2 * TB, false, 2 * TB)).toBe(2.2 * TB)
    expect(resolveCurrentTotalBytes(null, 2.2 * TB, false, 2 * TB)).toBe(2 * TB)
  })

  test('override ON: fresh add-on bytes win only when positive', () => {
    expect(resolveCurrentTotalBytes(2.2 * TB, 3.2 * TB, true, 2 * TB)).toBe(3.2 * TB)
    // a 0 effective field cannot outrank the reconstruction — it is not truth
    expect(resolveCurrentTotalBytes(2.2 * TB, 0, true, 2 * TB)).toBe(2.2 * TB)
    expect(resolveCurrentTotalBytes(null, 0, true, 2 * TB)).toBe(2 * TB)
  })
})

describe('#132-B storageAllocationBreakdown — the parenthetical must not contradict the total', () => {
  test('no add-on: parenthetical hidden (unchanged behaviour)', () => {
    const b = storageAllocationBreakdown(1.2 * TB, 1, 0)
    expect(b.show).toBe(false)
    expect(b.remainderBytes).toBeNull()
  })

  test('fully explained: base + extra reconcile with the server total → no remainder term', () => {
    const b = storageAllocationBreakdown(2 * TB, 1, 1)
    expect(b.show).toBe(true)
    expect(b.baseBytes).toBe(TB)
    expect(b.extraBytes).toBe(TB)
    expect(b.remainderBytes).toBeNull()
    expect(b.irreconcilable).toBe(false)
  })

  test('bonus case: the positive unexplained remainder is reported for the neutral term', () => {
    // e.g. 1 TB admin bonus on top of a 1 TB base + 1 TB extra add-on
    const b = storageAllocationBreakdown(3.2 * TB, 1, 1)
    expect(b.show).toBe(true)
    expect(b.remainderBytes).toBe(1.2 * TB)
    expect(b.irreconcilable).toBe(false)
  })

  test('sub-tolerance rounding noise is NOT reported as a remainder', () => {
    const noise = ALLOCATION_TOLERANCE_BYTES - 1
    const b = storageAllocationBreakdown(2 * TB + noise, 1, 1)
    expect(b.show).toBe(true)
    expect(b.remainderBytes).toBeNull()
  })

  test('parts exceed the displayed total → irreconcilable, parenthetical omitted', () => {
    const b = storageAllocationBreakdown(1 * TB, 1, 1)
    expect(b.show).toBe(false)
    expect(b.irreconcilable).toBe(true)
    expect(b.remainderBytes).toBeNull()
  })

  test('non-finite displayed total → parenthetical omitted', () => {
    expect(storageAllocationBreakdown(Number.NaN, 1, 1).show).toBe(false)
  })
})
