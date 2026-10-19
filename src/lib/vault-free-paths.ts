/**
 * Paths that are served WITHOUT the account/vault provider stack (task 1920).
 *
 * Everything else in the app mounts AuthProvider + KeyProvider, and KeyProvider starts the crypto
 * worker and WASM and opens the local vault on mount. A person who follows the exit-survey link
 * from an email has no use for any of that: they answer one form with a link-bound token. So
 * `/surveys/:id` is rendered by `VaultFreePages` in `app.tsx` OUTSIDE those providers, and a test
 * (`test/1920-survey.test.ts`, `e2e/1920-survey.spec.ts`) proves no wasm or crypto worker is requested.
 *
 * Only exact shapes are listed; anything near them (`/surveys`, `/surveys/x/y`) falls through to the
 * normal app and its normal 404.
 */
const VAULT_FREE: RegExp[] = [
  /^\/surveys\/[^/]+\/?$/,
  // Task 1918: the one-click cancel link of an erase request (the token is in the fragment).
  /^\/erase-request\/cancel\/?$/,
  // Task 1918 round 3: the confirmation link of an erase request (the token is in the fragment).
  /^\/erase-request\/verify\/?$/,
]

export function isVaultFreePath(pathname: string): boolean {
  return VAULT_FREE.some((re) => re.test(pathname))
}
