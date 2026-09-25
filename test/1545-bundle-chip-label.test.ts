import { describe, expect, test } from 'bun:test'
import { bundleChipLabel } from '../src/pages/shared.tsx'

/**
 * Task 1545, finding 4 — the owner's "Shared → By me" list rendered a
 * multi-file bundle share as a single file, with no indication of how many
 * files (or how much content) the link actually exposes. Server's
 * `GET /api/v1/shares/mine` already returns `share_type` + `item_count`
 * per row (repos/server shares.rs list_my_shares) — the client type/UI
 * simply never read them.
 */
describe('bundleChipLabel (1545#4)', () => {
  test('a bundle share with 5 items renders "bundle · 5 files"', () => {
    expect(bundleChipLabel({ share_type: 'bundle', item_count: 5 })).toBe('bundle · 5 files')
  })

  test('a bundle share with exactly 1 item uses the singular "file"', () => {
    expect(bundleChipLabel({ share_type: 'bundle', item_count: 1 })).toBe('bundle · 1 file')
  })

  test('a bundle share with a missing item_count defaults to 0, not "undefined"', () => {
    expect(bundleChipLabel({ share_type: 'bundle', item_count: undefined })).toBe('bundle · 0 files')
  })

  test('a plain file share (share_type "file") renders no chip', () => {
    expect(bundleChipLabel({ share_type: 'file', item_count: 0 })).toBeNull()
  })

  test('a legacy row with no share_type at all renders no chip (never a false "bundle · 0 files")', () => {
    expect(bundleChipLabel({ share_type: undefined, item_count: undefined })).toBeNull()
  })
})
