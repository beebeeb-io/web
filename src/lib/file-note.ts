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
//     not yet on this core keep opening it). The pin is read with core's FILE
//     reader for folders too: never chosen by the server's `is_folder` flag.

import { decryptNote, encryptNoteFor, readFileMetadata, UnverifiedFileMetadataError } from './crypto'

/** The file or folder a note belongs to, as the details panel knows it. */
export interface NoteOwner {
  /** Its current `name_encrypted`: where its pin is read (core's FILE reader, for files AND folders). */
  nameEncrypted: string
}

/** Open a stored note. Throws when it does not open under this key (the panel then shows no note). */
export async function openFileNote(fileKey: Uint8Array, noteEncrypted: string): Promise<string> {
  return decryptNote(fileKey, noteEncrypted)
}

/**
 * Seal a note for an EXISTING file or folder and return the value to store in
 * `note_encrypted`. The pin comes from core's FILE reader for every owner.
 *
 * Folders included: `is_folder` is a server field, and the folder reader reads
 * a plaintext name as pin 0. With it, a server could flag a v2 file as a folder
 * with a plaintext name and get its note sealed under the RAW file key, which
 * it could later serve as that file's name (core round 5,
 * `raw_key_note_served_as_name_downgrades_v2_file`; crypto review of web#170,
 * Minor 1). Every client writes folder names encrypted (web, mobile, cli,
 * desktop), and those read the same through the file reader. A plaintext name
 * (a legacy folder) carries no authenticated pin, so no note is written for it:
 * `UnverifiedFileMetadataError`, and the panel says so.
 */
export async function sealFileNote(fileKey: Uint8Array, text: string, owner: NoteOwner): Promise<string> {
  const pin = await readFileMetadata(fileKey, owner.nameEncrypted).then(
    (meta) => meta.pin,
    (err: unknown) => {
      throw new UnverifiedFileMetadataError(UNVERIFIED_NOTE_OWNER_COPY, { cause: err })
    },
  )
  return encryptNoteFor(fileKey, text, pin)
}

/** What the details panel shows when a note cannot be sealed for this item. */
export const UNVERIFIED_NOTE_OWNER_COPY =
  "Note not saved. This item's name could not be verified, so the note's encryption key cannot be chosen safely."
