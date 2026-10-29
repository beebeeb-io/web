/**
 * Personal access token (PAT) facts the UI may state, and the request body it
 * may send. Task 1789 (server PR #188).
 *
 * What the server actually does, so the copy below is not a promise:
 * - `auth_with_pat` (beebeeb-api/src/auth.rs, ~:291-370) checks revoked,
 *   expired, suspended and deleted state and nothing else: there is no scope
 *   lookup anywhere, so a token carries the full authority of the account on
 *   the API it is used with.
 * - `create_token` (beebeeb-api/src/routes/tokens.rs, ~:84-180) rejects any
 *   non-empty `scopes` with 400, and accepts `expires_in_days` of 1..=366.
 *   Omitting it (JSON null) still means a non-expiring token.
 * - Create/list responses always return `scopes: []`.
 * Whether scopes get enforced later is decision 1793; until then the UI must
 * neither offer nor display scopes.
 */

/** Longest explicit lifetime the server accepts (tokens.rs MAX_PAT_LIFETIME_DAYS). */
export const PAT_MAX_LIFETIME_DAYS = 366

export const PAT_EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: 'Never', days: null },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year', days: 365 },
]

/** Shown next to the create-token form. States exactly what a token can do. */
export const PAT_ACCESS_NOTICE =
  'A token has the same access to your account as you do, through the API and the CLI. ' +
  'You cannot limit it to read-only or to some files yet. Revoke it here at any time.'

export interface CreateTokenBody {
  name: string
  expires_in_days: number | null
}

/** The only shape the UI sends to POST /api/v1/tokens: never any `scopes`. */
export function buildCreateTokenBody(name: string, expiresInDays: number | null): CreateTokenBody {
  if (expiresInDays !== null && !(Number.isInteger(expiresInDays) && expiresInDays >= 1 && expiresInDays <= PAT_MAX_LIFETIME_DAYS)) {
    throw new RangeError(`expires_in_days must be between 1 and ${PAT_MAX_LIFETIME_DAYS}`)
  }
  return { name: name.trim(), expires_in_days: expiresInDays }
}
