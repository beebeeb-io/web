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
 *
 * Task 2237b adds the `path` parameter: a live folder link lives at `/f/<token>`
 * (public read/upload) while a file or bundle share stays at `/s/<token>`.
 * The default keeps every pre-2237b caller byte-identical, and the fragment
 * rule is unchanged: a folder link ALWAYS carries `#key=`, passphrase-protected
 * or not (the passphrase only stretches the unwrap key, it never replaces K_c).
 */
export function buildFullShareLink(
  baseUrl: string,
  token: string,
  decryptionKey: string,
  path: 's' | 'f' = 's',
): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path}/${token}#key=${encodeURIComponent(decryptionKey)}`
}
