/**
 * buildFullShareLink — the ONE builder for share links (task 1690).
 *
 * Sharing always yields a single, complete link: the share URL with the
 * decryption key embedded as a `#key=` fragment — Guus, 2026-10-02: "Met
 * delen voortaan altijd full link, er staat nu dat het los is maar is
 * eigenlijk alsnog 1 geheel. Maak er gewoon 1 geheel van."
 *
 * 1531 invariants carried over: the key is base64url or standard base64 and
 * is percent-encoded here; the fragment is never stripped, split off, or
 * rebuilt from anything other than the minted K_c. Consumers
 * (share-dialog.tsx on web, ShareSheetScreen.tsx on mobile) build every
 * user-visible / copyable share string through this function.
 */
export function buildFullShareLink(baseUrl: string, token: string, decryptionKey: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/s/${token}#key=${encodeURIComponent(decryptionKey)}`
}
