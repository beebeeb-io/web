/**
 * Task 1531 — one shared share-decryption-key parser, used by BOTH the
 * automatic `#key=…` URL-fragment path and the manual key-entry form
 * (share-view.tsx). Before this, the two paths disagreed: the fragment path
 * normalized base64url ('-'/'_') to standard base64 before decoding; the
 * manual form called `atob()` directly and threw on any '-'/'_' character.
 * Since every share key is minted as base64url (toBase64url() in
 * share-dialog.tsx / share-link.ts), a 43-char key has roughly a 3-in-4
 * chance of containing '-' or '_' (P(none) = (62/64)^43 ≈ 25%) — so most
 * manual pastes of a perfectly valid key failed with "Invalid key format."
 *
 * Deliberately does NOT use URLSearchParams anywhere in this module:
 * URLSearchParams decodes '+' as a space (application/x-www-form-urlencoded
 * semantics), which would silently corrupt a standard-base64 key containing
 * '+'. We extract the `key=` value with plain string ops and percent-decode
 * it with decodeURIComponent, which never treats '+' specially.
 */

/** Every Beebeeb share/file key is exactly 32 bytes (AES-256). */
export const SHARE_KEY_BYTES = 32

export class ShareKeyParseError extends Error {
  constructor(public readonly reason: string) {
    super(`share key parse error: ${reason}`)
    this.name = 'ShareKeyParseError'
  }
}

/** Union of the standard-base64 and base64url alphabets, plus up to 2 '=' padding chars. */
const BASE64_ALPHABET = /^[A-Za-z0-9+/_-]+={0,2}$/

/**
 * Locate the key token inside `input`, which may be:
 *   - a bare key (nothing else — no URL, no `key=` marker)
 *   - a `#key=…` fragment or `?key=…` query string (with or without the
 *     leading `#`/`?`)
 *   - a `key=…` paste with NO leading `#`/`?`/`&` at all — e.g. someone
 *     copied only the trailing part of a share link
 *   - a whole pasted share URL containing one of the above
 *
 * The marker only counts at the very START of the (trimmed) input, or when
 * immediately preceded by `#`/`?`/`&`. This is deliberate: it lets a bare
 * "key=…" paste (Codex P2 follow-up, task 1531) be recognised, while still
 * refusing to misread a literal bare key that merely CONTAINS the substring
 * "key=" somewhere in its middle (never a marker there) as if it introduced
 * a value — that would silently drop everything before it.
 *
 * Returns null when no key can be found (empty input, or a URL with no
 * `key=` marker at all — never guess by scanning URL path segments).
 */
export function extractShareKeyToken(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const marker = trimmed.match(/(?:^|[#?&])key=/)
  let candidate: string
  if (marker && marker.index !== undefined) {
    const start = marker.index + marker[0].length
    const rest = trimmed.slice(start)
    // Stop at the next '&' (another fragment/query param) or a stray '#'.
    const stopIdx = rest.search(/[&#]/)
    candidate = stopIdx === -1 ? rest : rest.slice(0, stopIdx)
  } else if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    // A full URL with no `key=` marker anywhere — nothing to extract.
    return null
  } else {
    // No URL, no marker — treat the whole trimmed input as the bare key.
    candidate = trimmed
  }

  candidate = candidate.trim()
  if (!candidate) return null

  // Percent-decode a copied fragment/URL's key value. A bare pasted key is
  // never percent-encoded, so this is a no-op for that case (and falls back
  // to the raw candidate if it contains a bare '%' that isn't valid
  // percent-encoding, rather than throwing).
  try {
    candidate = decodeURIComponent(candidate)
  } catch {
    /* not percent-encoded (or a literal '%'); use as-is */
  }
  return candidate
}

/**
 * Decode a base64 / base64url token (padded or not) to raw bytes.
 * Does NOT assert a specific length — resolveFileKeyOutcome() in
 * share-view.tsx relies on being able to tell "a key was present, but the
 * wrong length" (malformed-key) apart from "no key at all" (no-key), which
 * needs the decode step to succeed independent of length.
 */
export function decodeShareKeyToken(token: string): Uint8Array {
  if (!BASE64_ALPHABET.test(token)) {
    throw new ShareKeyParseError('invalid-characters')
  }
  const normalized = token.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    throw new ShareKeyParseError('invalid-base64')
  }
}

/**
 * Full pipeline used by the manual key-entry form: extract + decode +
 * REQUIRE exactly 32 bytes. Accepts a bare key, a `#key=…`/`?key=…` value, or
 * a whole pasted share URL — base64url or standard base64, padded or not.
 * Throws ShareKeyParseError on any failure; share-view.tsx maps that to the
 * existing "Invalid key format" brand-voice copy (unchanged by this task).
 */
export function parseShareKey(input: string): Uint8Array {
  const token = extractShareKeyToken(input)
  if (!token) throw new ShareKeyParseError('empty')
  const bytes = decodeShareKeyToken(token)
  if (bytes.length !== SHARE_KEY_BYTES) {
    throw new ShareKeyParseError('wrong-length')
  }
  return bytes
}
