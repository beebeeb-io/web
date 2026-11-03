/**
 * One rule for "is this row's name a sealed envelope?": core seals a name as a
 * JSON `{...}` metadata envelope, and a plaintext legacy name never starts with
 * `{`. The web client used to spell this test out at each site, and two of them
 * disagreed about leading whitespace (`startsWith('{')` vs
 * `trimStart().startsWith('{')`), so a row could read as sealed on one path and
 * plaintext on another. Used by the owner publish destination proof
 * (owner-upload-key.ts) and the plaintext-name read path (key-context.tsx).
 */
export function isSealedName(nameEncrypted: string): boolean {
  return nameEncrypted.trimStart().startsWith('{')
}
