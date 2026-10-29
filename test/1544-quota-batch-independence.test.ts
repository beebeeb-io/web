import { describe, expect, test } from 'bun:test'
import { requiredQuotaBytes, exceedsQuota, UploadQuotaLedger, type QuotaCheckItem } from '../src/lib/upload-quota'

// Task 1544 finding 2 — two related bugs in queueResolvedUploads' quota
// pre-check (drive.tsx), both stemming from checking each call in
// isolation against a single stale snapshot of `storageUsage`:
//
// (2a) The check runs PER INVOCATION against storageUsage, which only
// updates after a fetch/refresh completes. The dedup-warning banner's
// "Upload anyway" path calls queueResolvedUploads TWICE for one selection
// (queueResolvedUploads([{file}]) for the confirmed file, then
// handleFilesSelected(otherFiles) for the rest) — both calls can each
// independently pass their own check against the SAME stale baseline, and
// together exceed the real remaining quota. Fix: a local "reserved bytes"
// ledger that persists across invocations until each upload settles.
//
// (2b) Within ONE call, netting deltas across the whole batch lets a
// shrinking replacement (negative net) fund a DIFFERENT file's upload —
// but doEncryptedUpload is invoked once per item, independently; nothing
// waits for the shrink to actually land before the other upload starts.
// Fix: clamp each item's own net contribution to >= 0 before summing, so a
// replacement's credit is scoped to itself and never spills onto siblings.

describe('requiredQuotaBytes — per-item clamp (finding 2b)', () => {
  test('a brand-new file costs its full size', () => {
    expect(requiredQuotaBytes([{ sizeBytes: 100 }])).toBe(100)
  })

  test('a shrinking replacement alone requires zero (its own credit covers it)', () => {
    const items: QuotaCheckItem[] = [{ sizeBytes: 40, replacedSizeBytes: 100 }]
    expect(requiredQuotaBytes(items)).toBe(0)
  })

  test('a shrinking replacement does NOT fund a sibling brand-new upload in the same batch', () => {
    // Old (buggy) netQuotaDeltaBytes math: (40 - 100) + 200 = 140 -- looks
    // like it fits in 150 remaining. The two uploads start independently
    // (doEncryptedUpload per item), so the correct requirement treats the
    // shrink as free ON ITS OWN (clamped to 0) and the new file at its full
    // cost: 0 + 200 = 200 -- which does NOT fit in 150.
    const items: QuotaCheckItem[] = [
      { sizeBytes: 40, replacedSizeBytes: 100 }, // shrink: net -60, clamped to 0
      { sizeBytes: 200 }, // brand-new: net +200
    ]
    expect(requiredQuotaBytes(items)).toBe(200)
  })

  test('a growing replacement still costs only its delta', () => {
    const items: QuotaCheckItem[] = [{ sizeBytes: 150, replacedSizeBytes: 100 }]
    expect(requiredQuotaBytes(items)).toBe(50)
  })

  test('multiple growing replacements + a new file sum their own deltas (no cross-crediting needed to prove correct here)', () => {
    const items: QuotaCheckItem[] = [
      { sizeBytes: 150, replacedSizeBytes: 100 }, // +50
      { sizeBytes: 60, replacedSizeBytes: 100 }, // shrink, clamped to 0
      { sizeBytes: 30 }, // +30
    ]
    expect(requiredQuotaBytes(items)).toBe(80)
  })
})

describe('exceedsQuota — uses the clamped per-item requirement (finding 2b)', () => {
  test('the exact repro: shrink + new-file batch that the OLD netted math would have allowed is BLOCKED', () => {
    const items: QuotaCheckItem[] = [
      { sizeBytes: 40, replacedSizeBytes: 100 },
      { sizeBytes: 200 },
    ]
    // Old buggy net: 140 <= 150 remaining -> would NOT have blocked.
    expect(140).toBeLessThanOrEqual(150) // sanity: the old math looked fine
    expect(exceedsQuota(items, 150)).toBe(true) // new math: 200 > 150 -> blocked
  })

  test('a same-size replace alongside a new file that genuinely fits is still allowed', () => {
    const items: QuotaCheckItem[] = [
      { sizeBytes: 100, replacedSizeBytes: 100 }, // net 0
      { sizeBytes: 50 },
    ]
    expect(exceedsQuota(items, 50)).toBe(false)
  })
})

describe('UploadQuotaLedger — reservations persist across invocations (finding 2a)', () => {
  test('freshly created, an empty ledger reserves nothing', () => {
    const ledger = new UploadQuotaLedger()
    expect(ledger.reservedBytes).toBe(0)
  })

  test('reserving an item raises reservedBytes by its clamped net cost', () => {
    const ledger = new UploadQuotaLedger()
    ledger.reserve('upload-1', { sizeBytes: 100 })
    expect(ledger.reservedBytes).toBe(100)
  })

  test('a shrinking replacement reserves ZERO, not a negative amount (never frees budget early for a not-yet-completed replace)', () => {
    const ledger = new UploadQuotaLedger()
    ledger.reserve('upload-1', { sizeBytes: 40, replacedSizeBytes: 100 })
    expect(ledger.reservedBytes).toBe(0)
  })

  test('release() removes exactly that reservation', () => {
    const ledger = new UploadQuotaLedger()
    ledger.reserve('upload-1', { sizeBytes: 100 })
    ledger.reserve('upload-2', { sizeBytes: 50 })
    ledger.release('upload-1')
    expect(ledger.reservedBytes).toBe(50)
  })

  test('release() on an unknown id is a harmless no-op', () => {
    const ledger = new UploadQuotaLedger()
    ledger.reserve('upload-1', { sizeBytes: 100 })
    ledger.release('nonexistent')
    expect(ledger.reservedBytes).toBe(100)
  })

  // The exact finding-2a repro: dedup banner's "Upload anyway" queues one
  // file directly, then routes the rest through handleFilesSelected --
  // TWO separate queueResolvedUploads calls, both checked against the same
  // stale `remaining` before either upload has settled.
  test('a second call sees the first call\'s still-in-flight reservation and is correctly blocked', () => {
    const ledger = new UploadQuotaLedger()
    const remaining = 150

    // First call: confirmed dedup file, 100 bytes. Fits alone.
    const firstBatch: QuotaCheckItem[] = [{ sizeBytes: 100 }]
    expect(ledger.wouldExceed(firstBatch, remaining)).toBe(false)
    ledger.reserve('upload-1', firstBatch[0])

    // Second call: the "rest" of the selection, arrives before the first
    // upload has settled (storageUsage is still the SAME stale snapshot).
    // 100 (already reserved) + 80 (this batch) = 180 > 150 remaining.
    const secondBatch: QuotaCheckItem[] = [{ sizeBytes: 80 }]
    expect(ledger.wouldExceed(secondBatch, remaining)).toBe(true)
  })

  test('once the first upload settles (release), the second call is re-evaluated and fits', () => {
    const ledger = new UploadQuotaLedger()
    const remaining = 150
    ledger.reserve('upload-1', { sizeBytes: 100 })
    ledger.release('upload-1') // e.g. it failed -- nothing changed server-side
    const secondBatch: QuotaCheckItem[] = [{ sizeBytes: 80 }]
    expect(ledger.wouldExceed(secondBatch, remaining)).toBe(false)
  })

  test('null remaining (usage not loaded yet) never blocks, regardless of reservations', () => {
    const ledger = new UploadQuotaLedger()
    ledger.reserve('upload-1', { sizeBytes: 1_000_000 })
    expect(ledger.wouldExceed([{ sizeBytes: 1 }], null)).toBe(false)
  })
})
