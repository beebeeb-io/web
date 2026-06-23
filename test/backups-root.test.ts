import { describe, expect, test } from 'bun:test'

import { isBackupsRoot } from '../src/lib/backups-root'

// Minimal file shapes used across tests — only the fields the function inspects.
const rootFolder = { is_folder: true, parent_id: null }
const nestedFolder = { is_folder: true, parent_id: 'parent-abc' }
const rootFile = { is_folder: false, parent_id: null }

describe('isBackupsRoot (task 0848)', () => {
  // ── Bootstrap-window guard ────────────────────────────────────────────────
  // When the decrypted name is still pending (undefined), any root folder is
  // treated conservatively as potential Backups so the warning dialog shows
  // during the ~500 ms first-load crypto bootstrap window.

  test('root folder + pending name (undefined) → true', () => {
    expect(isBackupsRoot(rootFolder, undefined)).toBe(true)
  })

  // ── Resolved-name cases ───────────────────────────────────────────────────

  test('root folder + resolved name "Backups" → true', () => {
    expect(isBackupsRoot(rootFolder, 'Backups')).toBe(true)
  })

  test('root folder + resolved name "Projects" → false (no false positive once resolved)', () => {
    expect(isBackupsRoot(rootFolder, 'Projects')).toBe(false)
  })

  test('root folder + resolved empty string (decrypt-failed fallback) → false', () => {
    // displayName() returns '' when decrypt failed; that must NOT trigger the dialog.
    expect(isBackupsRoot(rootFolder, '')).toBe(false)
  })

  test('root folder + null (decrypt failed, stored in Record as null) → false', () => {
    // externalDecryptedNames stores null when decryption failed for a file.
    // A folder whose name could not be decrypted is NOT treated as Backups.
    expect(isBackupsRoot(rootFolder, null)).toBe(false)
  })

  // ── Structural guards — parent_id / is_folder ─────────────────────────────

  test('nested folder (parent_id != null) named "Backups" → false', () => {
    expect(isBackupsRoot(nestedFolder, 'Backups')).toBe(false)
  })

  test('nested folder (parent_id != null) with pending name → false', () => {
    // Pending-name guard applies ONLY to root folders.
    expect(isBackupsRoot(nestedFolder, undefined)).toBe(false)
  })

  test('FILE at root (is_folder false) → false regardless of name', () => {
    expect(isBackupsRoot(rootFile, 'Backups')).toBe(false)
    expect(isBackupsRoot(rootFile, undefined)).toBe(false)
  })

  // ── Case sensitivity ──────────────────────────────────────────────────────

  test('lowercase "backups" → false (exact match only)', () => {
    expect(isBackupsRoot(rootFolder, 'backups')).toBe(false)
  })

  test('mixed case "BACKUPS" → false (exact match only)', () => {
    expect(isBackupsRoot(rootFolder, 'BACKUPS')).toBe(false)
  })

  test('"Backups " (trailing space) → false (exact match only)', () => {
    expect(isBackupsRoot(rootFolder, 'Backups ')).toBe(false)
  })

  // ── parent_id coercion — undefined treated same as null ───────────────────

  test('root folder with parent_id undefined (field absent) → same as null', () => {
    const fileNoParent = { is_folder: true, parent_id: undefined }
    // undefined coerced to null by the (file.parent_id ?? null) guard → root folder.
    expect(isBackupsRoot(fileNoParent, 'Backups')).toBe(true)
    expect(isBackupsRoot(fileNoParent, undefined)).toBe(true)
    expect(isBackupsRoot(fileNoParent, 'Projects')).toBe(false)
  })
})
