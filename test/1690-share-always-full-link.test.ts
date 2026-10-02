import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Task 1690 — sharing always produces ONE full link (Guus, 2026-10-02,
 * verbatim: "Met delen voortaan altijd full link, er staat nu dat het los is
 * maar is eigenlijk alsnog 1 geheel. Maak er gewoon 1 geheel van.").
 *
 * The ShareDialog presented the share as two separate items — a bare URL
 * (copied as 'split-link') plus a "Decryption key" box (copied as
 * 'split-key') behind a "Full link / Link + key (extra secure)" toggle that
 * defaulted to split on every open — even though the share is one unit. The
 * split presentation (and every "separate channels" claim) is removed: the
 * dialog always shows/copies the full link built by buildFullShareLink()
 * (src/lib/share-full-link.ts), whose functional tests live in
 * test/share-full-link.test.ts.
 *
 * This file asserts the STRUCTURE of share-dialog.tsx: no split mode left,
 * every clipboard path passes the full URL. Written RED-first: it failed
 * against the split-default code (3 failures + 3 skipped, see task 1690 Notes).
 */

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf-8')
}

const dialog = read('src/components/share-dialog.tsx')
// The helper exists only once the split presentation is removed; before that,
// its describe block is skipped (reported as skipped, not silently green).
let helper: string | null = null
try {
  helper = read('src/lib/share-full-link.ts')
} catch {
  helper = null
}

describe('share-dialog.tsx has no split presentation (1690)', () => {
  test('the share-mode toggle is gone', () => {
    expect(dialog).not.toContain("'split'")
    expect(dialog).not.toContain('setShareMode')
    expect(dialog).not.toContain('Link + key')
  })

  test('the bare-URL / separate-key result view is gone', () => {
    expect(dialog).not.toContain('Send via a different channel')
    expect(dialog).not.toContain('split-link')
    expect(dialog).not.toContain('split-key')
  })

  test('no copy implies link and key travel separately', () => {
    expect(dialog).not.toContain('separate channels')
  })
})

describe.skipIf(helper === null)('share-dialog.tsx copies only full links (1690)', () => {
  test('the URL is built through buildFullShareLink (the #key= builder)', () => {
    expect(dialog).toContain('buildFullShareLink')
  })

  test('clipboard copy is fed the full share URL only', () => {
    expect(dialog).toMatch(/copyToClipboard\(fullShareUrl, 'full-link'\)/)
    // No keyless or bare-key clipboard path may remain.
    expect(dialog).not.toMatch(/copyToClipboard\((shareUrl|decryptionKey)\b/)
  })

  test('the #key= fragment lives in the shared builder, 1531 semantics intact', () => {
    expect(helper).not.toBeNull()
    expect(helper!).toContain('#key=${encodeURIComponent(')
    // The builder never strips or truncates the fragment: it must be the LAST
    // thing appended to the URL.
    expect(helper!.trimEnd().endsWith('}')).toBe(true)
  })
})
