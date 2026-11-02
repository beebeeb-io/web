

// ─── Key resolution ────────────────────────────────────────────────────────────

/** A file/share key (the file key, or the client key K_c) is always 32 bytes. */
export const KEY_BYTES = 32

/**
 * Discriminated outcome of resolving the file decryption key, so the recipient
 * UI can tell the truth per failure instead of collapsing every case into one
 * generic "Decryption failed" (0709). We NEVER silently use K_c as the file key.
 */
export type KeyOutcome =
  | { kind: 'ok'; key: Uint8Array }
  | { kind: 'no-key' }             // no #key= fragment — show the manual-entry form
  | { kind: 'malformed-key' }      // fragment present but not a 32-byte key (truncated/corrupt link)
  | { kind: 'damaged-link' }       // share metadata inconsistent (double_encrypted ⇎ wrapped_file_key)
  | { kind: 'wrong-key' }          // the key did not unwrap/authenticate against this share
  | { kind: 'crypto-unavailable' } // WASM crypto failed to initialise

/** Hard key errors (everything except a successful resolve or a missing key). */
export type KeyErrorKind = Exclude<KeyOutcome['kind'], 'ok' | 'no-key'>

/** Honest, actionable, brand-voice copy for each key-resolution failure. */
export function keyErrorMessage(kind: KeyErrorKind): { title: string; body: string } {
  switch (kind) {
    case 'malformed-key':
      return {
        title: 'This link is incomplete',
        body: 'The decryption key looks truncated. Re-copy the whole link — everything including the part after #key= — and open it again.',
      }
    case 'damaged-link':
      return {
        title: 'This share link is damaged',
        body: "The link and the file's encryption don't match up. Ask the sender for a fresh link.",
      }
    case 'wrong-key':
      return {
        title: "This key doesn't match this file",
        body: 'The decryption key in the link is not the one this file was encrypted with. Re-copy the full link, or ask the sender for a new one.',
      }
    case 'crypto-unavailable':
      return {
        title: "Couldn't start decryption",
        body: 'The in-browser decryption engine failed to load. Reload the page and try again.',
      }
  }
}
