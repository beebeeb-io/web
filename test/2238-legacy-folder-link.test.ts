/**
 * Task 2238 — the honest page for a folder link minted BEFORE this task.
 *
 * A pre-2238 folder link is a `share_type: 'file'` share over the folder's own
 * row: one wrapped key, no item list, and the server refuses the download with
 * `400 cannot download a folder`. It cannot be repaired, so the page says what
 * is true. Two signals, both real:
 *   1. `is_folder` on the share metadata (the server's single-file branch does
 *      not send it yet — see the PR notes; the client already handles it);
 *   2. the refusal message itself, for a page loaded against such a server.
 *
 * RED-first: written against the pre-2238 tree, where neither the copy nor the
 * detectors exist (0 pass, 2 fail: "Cannot find module").
 */
import { describe, expect, test } from 'bun:test'
import {
  LEGACY_FOLDER_LINK_COPY,
  isFolderDownloadRefusal,
  isFolderTarget,
} from '../src/lib/legacy-folder-link'

describe('legacy folder link — the copy', () => {
  test('is the sentence from spec 2026-10-27 §9, verbatim', () => {
    expect(LEGACY_FOLDER_LINK_COPY).toBe(
      'This link was made before folder links existed; ask the owner for a new link',
    )
    // No hosting-provider name and no emoji in user-facing copy.
    expect(LEGACY_FOLDER_LINK_COPY).not.toMatch(/vercel|netlify|cloudflare/i)
  })
})

describe('legacy folder link — the download refusal', () => {
  test('recognises the server message', () => {
    expect(isFolderDownloadRefusal({ message: 'cannot download a folder' })).toBe(true)
    expect(isFolderDownloadRefusal({ message: 'Cannot download a folder.' })).toBe(true)
  })

  test('never fires for other failures', () => {
    expect(isFolderDownloadRefusal({ message: 'Decryption failed.' })).toBe(false)
    expect(isFolderDownloadRefusal({ message: 'link has reached maximum opens' })).toBe(false)
    expect(isFolderDownloadRefusal(new Error('network down'))).toBe(false)
    expect(isFolderDownloadRefusal(null)).toBe(false)
    expect(isFolderDownloadRefusal('cannot download a folder')).toBe(false)
  })
})

describe('legacy folder link — the metadata signal', () => {
  test('only an explicit `is_folder: true` counts', () => {
    expect(isFolderTarget({ share_type: 'file', is_folder: true })).toBe(true)
    expect(isFolderTarget({ share_type: 'file' })).toBe(false)
    expect(isFolderTarget({ share_type: 'file', is_folder: 'true' })).toBe(false)
    expect(isFolderTarget({ share_type: 'file', is_folder: false })).toBe(false)
    expect(isFolderTarget(null)).toBe(false)
    expect(isFolderTarget(undefined)).toBe(false)
  })
})
