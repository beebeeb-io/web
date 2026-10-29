import { describe, expect, test } from 'bun:test'
import { netQuotaDeltaBytes, exceedsQuota, type QuotaCheckItem } from '../src/lib/upload-quota'

// Task 1544 finding 1: a paid user at/near their quota re-uploading an
// existing filename to save a new version (auto-version or explicit
// "Replace") must be credited the existing file's size, mirroring the
// server's `projected_used = used_bytes.saturating_sub(replace_prior_size)
// .saturating_add(file_size_bytes)` (uploads.rs:495-513) -- NOT blocked by
// a raw `totalSize > remaining` comparison with no credit.

describe('netQuotaDeltaBytes', () => {
  test('a brand-new file (no replace) costs its full size', () => {
    const items: QuotaCheckItem[] = [{ sizeBytes: 100 }]
    expect(netQuotaDeltaBytes(items)).toBe(100)
  })

  test('a same-size version-replace nets to zero', () => {
    const items: QuotaCheckItem[] = [{ sizeBytes: 100, replacedSizeBytes: 100 }]
    expect(netQuotaDeltaBytes(items)).toBe(0)
  })

  test('a smaller version-replace nets negative (frees quota)', () => {
    const items: QuotaCheckItem[] = [{ sizeBytes: 40, replacedSizeBytes: 100 }]
    expect(netQuotaDeltaBytes(items)).toBe(-60)
  })

  test('a larger version-replace nets the delta, not the full size', () => {
    const items: QuotaCheckItem[] = [{ sizeBytes: 150, replacedSizeBytes: 100 }]
    expect(netQuotaDeltaBytes(items)).toBe(50)
  })

  test('a batch mixes credited replaces and full-cost new files', () => {
    const items: QuotaCheckItem[] = [
      { sizeBytes: 100, replacedSizeBytes: 100 }, // replace, net 0
      { sizeBytes: 50 }, // new file, net 50
    ]
    expect(netQuotaDeltaBytes(items)).toBe(50)
  })
})

describe('exceedsQuota', () => {
  test('null remaining (usage not loaded) never blocks', () => {
    expect(exceedsQuota([{ sizeBytes: 999_999_999_999 }], null)) .toBe(false)
  })

  // The exact finding-1 repro: user is at 0 remaining bytes (used_bytes ==
  // plan_limit_bytes) and re-uploads an existing file at the SAME size to
  // create a new version. The server allows this (net delta 0); the OLD
  // client code compared the raw upload size (100) to remaining (0) and
  // blocked it.
  test('a same-size version-replace at 0 remaining quota is ALLOWED', () => {
    const items: QuotaCheckItem[] = [{ sizeBytes: 100, replacedSizeBytes: 100 }]
    expect(exceedsQuota(items, 0)).toBe(false)
  })

  test('a same-size version-replace at 0 remaining quota would have been REJECTED under the old (pre-fix) logic', () => {
    // Reproduces the exact old bug: `totalSize > remaining` with no credit.
    const totalSize = 100
    const remaining = 0
    expect(totalSize > remaining).toBe(true) // old code: blocked (the bug)
    // New code, same scenario: not blocked.
    expect(exceedsQuota([{ sizeBytes: totalSize, replacedSizeBytes: 100 }], remaining)).toBe(false)
  })

  test('a genuinely larger replace that exceeds remaining quota IS blocked', () => {
    const items: QuotaCheckItem[] = [{ sizeBytes: 150, replacedSizeBytes: 100 }]
    expect(exceedsQuota(items, 20)).toBe(true) // net delta 50 > 20 remaining
  })

  test('a brand-new file within remaining quota is allowed', () => {
    expect(exceedsQuota([{ sizeBytes: 50 }], 100)).toBe(false)
  })

  test('a brand-new file exceeding remaining quota is blocked', () => {
    expect(exceedsQuota([{ sizeBytes: 150 }], 100)).toBe(true)
  })
})
