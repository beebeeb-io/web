import { describe, expect, it, test } from 'bun:test'

import { backupsDepth, backupsRootFirst, backupsRootRefusal, isBackupsRoot, isProtectedBackupsRoot, isStepUpRequired } from '../src/lib/backups-root'

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

describe('isProtectedBackupsRoot (LD-0113: the server flag, never the name)', () => {
  it('is true only for system_role "backups_root"', () => {
    expect(isProtectedBackupsRoot({ system_role: 'backups_root' })).toBe(true)
    expect(isProtectedBackupsRoot({ system_role: null })).toBe(false)
    expect(isProtectedBackupsRoot({})).toBe(false)
    expect(isProtectedBackupsRoot({ system_role: 'Backups' })).toBe(false)
  })
})

describe('backupsRootRefusal', () => {
  it("gives core's words for trash, delete, move and rename, and null otherwise", () => {
    expect(backupsRootRefusal('trash')).toBe("Backups is a system folder and can't be deleted.")
    expect(backupsRootRefusal('delete')).toBe("Backups is a system folder and can't be deleted.")
    expect(backupsRootRefusal('move')).toBe("Backups is a system folder and can't be moved.")
    expect(backupsRootRefusal('rename')).toBe("Backups is a system folder and can't be renamed.")
    expect(backupsRootRefusal('open')).toBeNull()
    expect(backupsRootRefusal('download')).toBeNull()
  })
})

describe('backupsRootFirst', () => {
  const root = { system_role: 'backups_root' }
  const plain = { system_role: null }
  it('puts the protected root first and leaves other pairs to the sort', () => {
    expect(backupsRootFirst(root, plain)).toBe(-1)
    expect(backupsRootFirst(plain, root)).toBe(1)
    expect(backupsRootFirst(plain, {})).toBe(0)
    expect([plain, {}, root].sort(backupsRootFirst)[0]).toBe(root)
  })
  it('refuses sharing the root with the server words', () => {
    expect(backupsRootRefusal('share')).toBe("Folders in Backups can't be shared. You can share a single file.")
    expect(backupsRootRefusal('manage-shares')).toBe("Folders in Backups can't be shared. You can share a single file.")
  })
})

describe('backupsDepth (LD-0113: where an item sits under the Backups root)', () => {
  const nodes: Record<string, { parent_id: string | null; system_role?: string | null }> = {
    root: { parent_id: null, system_role: 'backups_root' },
    laptop: { parent_id: 'root' },
    ssh: { parent_id: 'laptop' },
    key: { parent_id: 'ssh' },
    photos: { parent_id: null },
    lonely: { parent_id: 'gone' },
  }
  const get = (id: string) => nodes[id]
  it('counts from the root: root 0, device 1, category 2, deeper 3', () => {
    expect([backupsDepth('root', get), backupsDepth('laptop', get), backupsDepth('ssh', get), backupsDepth('key', get)]).toEqual([0, 1, 2, 3])
  })
  it('is null outside Backups, for the vault root, and when an ancestor is not known', () => {
    expect([backupsDepth('photos', get), backupsDepth(null, get), backupsDepth('lonely', get)]).toEqual([null, null, null])
  })
  it('recognises the server refusal that asks for the password', () => {
    expect(isStepUpRequired({ status: 403, code: 'step_up_required' })).toBe(true)
    expect(isStepUpRequired({ status: 403, code: 'forbidden' })).toBe(false)
    expect(isStepUpRequired(new Error('x'))).toBe(false)
  })
})
