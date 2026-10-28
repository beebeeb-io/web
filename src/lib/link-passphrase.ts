/**
 * Task 2237b — the one form of a folder-link passphrase (crypto review).
 *
 * Kept apart from the crypto module so the public transport and the key code
 * can both use it without importing each other.
 */

/** A link passphrase that is empty or only spaces protects nothing; refuse it. */
export class EmptyLinkPassphraseError extends Error {
  constructor() {
    super("A passphrase can't be empty or only spaces.")
    this.name = 'EmptyLinkPassphraseError'
  }
}

/**
 * The one form of a link passphrase every client stretches and sends: Unicode
 * NFC (crypto review, core #44 pins NFC in core too), otherwise exactly as
 * typed (no trimming), so "é" typed as one code point or as e + accent opens
 * the same link. Empty or whitespace-only is refused, never treated as "no
 * passphrase" (that would silently make a plain link).
 */
export function normalizeLinkPassphrase(raw: string): string {
  const passphrase = raw.normalize('NFC')
  if (passphrase.trim().length === 0) throw new EmptyLinkPassphraseError()
  return passphrase
}

