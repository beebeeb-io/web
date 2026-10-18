// ─── File notes (core 1908 round 5, task 1943) ──────────────────────────────
//
// A note is stored in `files.note_encrypted` as the canonical EncryptedBlob
// JSON. Until task 1943 the details panel sealed it like a filename
// (`encrypt_metadata` under the RAW file key). Such a note has exactly the shape
// of a legacy name, so a server could serve it as a v2 file's `name_encrypted`,
// switch format detection back on, and then serve the same bytes as a one-frame
// v1 "file". Notes now have their own subkey, and both directions go through
// core:
//   - open: `decrypt_note` (the note subkey, then the legacy raw key, so every
//     note stored before this change still opens);
//   - seal: `encrypt_note_for(fileKey, text, pin)` with the pin of THIS file,
//     read from its authenticated metadata. A v2-pinned file's note is always
//     sealed under the note subkey; an unrecorded file's note follows core's
//     current write rule (the raw key until the gated v2 switch, so web tabs
//     not yet on this core keep opening it).

import { decryptNote, encryptNoteFor, readFileMetadata, readNameMetadata } from './crypto'

/** The file or folder a note belongs to, as the details panel knows it. */
export interface NoteOwner {
  /** Its current `name_encrypted`: where its pin is read. */
  nameEncrypted: string
  /** Folders read their pin with the folder reader (a plaintext legacy folder name is allowed). */
  isFolder: boolean
}

/** Open a stored note. Throws when it does not open under this key (the panel then shows no note). */
export async function openFileNote(fileKey: Uint8Array, noteEncrypted: string): Promise<string> {
  return decryptNote(fileKey, noteEncrypted)
}

/**
 * Seal a note for an EXISTING file or folder and return the value to store in
 * `note_encrypted`. The pin comes from core's FILE reader for a file (it
 * refuses a plaintext or foreign name: then no note is written) and from the
 * folder reader for a folder (folders have no content, and core keeps
 * `decrypt_name_metadata` for them).
 */
export async function sealFileNote(fileKey: Uint8Array, text: string, owner: NoteOwner): Promise<string> {
  const { pin } = owner.isFolder
    ? await readNameMetadata(fileKey, owner.nameEncrypted)
    : await readFileMetadata(fileKey, owner.nameEncrypted)
  return encryptNoteFor(fileKey, text, pin)
}
