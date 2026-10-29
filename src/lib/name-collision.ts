/**
 * name-collision.ts
 *
 * Shared duplicate-decrypted-name detection for the drive file list.
 * Extracted from drive.tsx's former inline `buildNameToFileMap` so the
 * ambiguity-handling logic is independently testable (task 1544 finding 3).
 *
 * Filenames are E2E-encrypted, so the server cannot enforce per-folder
 * uniqueness (ciphertext differs per upload due to a fresh nonce even for
 * the same plaintext name). If two files in the same folder ever end up
 * with the same DECRYPTED name -- e.g. because an unguarded rename created
 * one -- a naive "last one wins" map silently makes a later same-name
 * re-upload auto-version an ARBITRARY one of the duplicates, misattributing
 * the new version to a file the user may not have intended.
 *
 * This builder instead treats a duplicate name as AMBIGUOUS: the name is
 * removed from the map entirely, so a same-name upload for it falls through
 * as non-conflicting (creates a new file) rather than silently attaching to
 * the wrong sibling. A missed auto-version is a much safer default than a
 * misattributed one.
 */

export interface NamedFile {
  id: string
  is_folder: boolean
}

/**
 * Builds a lowercase-decrypted-name -> file map for same-name upload
 * conflict/auto-version detection. Folders are skipped (folder names are
 * not part of this conflict domain). `decryptedName` returns undefined for
 * files that have not decrypted yet -- those are simply absent from the map.
 */
export function buildNameToFileMap<T extends NamedFile>(
  files: T[],
  decryptedName: (file: T) => string | null | undefined,
): Map<string, T> {
  const map = new Map<string, T>()
  const seen = new Set<string>()
  for (const file of files) {
    if (file.is_folder) continue
    const name = decryptedName(file)
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) {
      // Ambiguous: a second file shares this decrypted name. Remove it from
      // the map rather than overwrite -- see module doc comment.
      map.delete(key)
      continue
    }
    seen.add(key)
    map.set(key, file)
  }
  return map
}

/**
 * Lowercase decrypted names of every non-folder sibling EXCEPT `excludeId`
 * (the file being renamed). Used to block a rename into a name that would
 * create exactly the ambiguity `buildNameToFileMap` above has to defend
 * against.
 */
export function siblingLowercaseNames<T extends NamedFile>(
  files: T[],
  excludeId: string,
  decryptedName: (file: T) => string | null | undefined,
): Set<string> {
  const names = new Set<string>()
  for (const file of files) {
    if (file.is_folder || file.id === excludeId) continue
    const name = decryptedName(file)
    if (name) names.add(name.toLowerCase())
  }
  return names
}
