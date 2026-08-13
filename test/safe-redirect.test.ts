import { describe, expect, test } from 'bun:test'

import { REDIRECT_ALLOWLIST, sanitizeRedirect } from '../src/lib/safe-redirect'

describe('sanitizeRedirect', () => {
  test('accepts the allowlisted /cli-auth path with its code query', () => {
    expect(sanitizeRedirect('/cli-auth?code=AB12-CD34')).toBe('/cli-auth?code=AB12-CD34')
  })

  test('accepts a bare allowlisted path (no query)', () => {
    expect(sanitizeRedirect('/cli-auth')).toBe('/cli-auth')
  })

  test('returns null for missing / empty values', () => {
    expect(sanitizeRedirect(null)).toBeNull()
    expect(sanitizeRedirect(undefined)).toBeNull()
    expect(sanitizeRedirect('')).toBeNull()
  })

  // ── Open-redirect attack vectors — every one MUST be rejected ──────────────
  test.each([
    ['absolute https URL', 'https://evil.com'],
    ['absolute http URL', 'http://evil.com/cli-auth'],
    ['scheme-only javascript', 'javascript:alert(1)'],
    ['protocol-relative URL', '//evil.com'],
    ['protocol-relative to a real-looking path', '//evil.com/cli-auth'],
    ['backslash smuggling', '/\\evil.com'],
    ['backslash-slash smuggling', '/\\/evil.com'],
    ['bare host', 'evil.com'],
    ['relative without leading slash', 'cli-auth?code=AB12-CD34'],
  ])('rejects open redirect: %s', (_label, vector) => {
    expect(sanitizeRedirect(vector)).toBeNull()
  })

  // ── Path-confusion vectors — allowlist match is EXACT ──────────────────────
  test.each([
    ['traversal out of allowlist', '/cli-auth/../admin'],
    ['prefix lookalike', '/cli-auth-evil'],
    ['subpath under allowlisted route', '/cli-auth/extra'],
    ['different non-allowlisted route', '/billing'],
    ['trailing slash variant', '/cli-auth/'],
  ])('rejects non-allowlisted path: %s', (_label, vector) => {
    expect(sanitizeRedirect(vector)).toBeNull()
  })

  // /settings/privacy is allowlisted for the GDPR data-export resume (task 0720).
  test('accepts /settings/privacy (data-export resume route)', () => {
    expect(sanitizeRedirect('/settings/privacy')).toBe('/settings/privacy')
  })

  // "/" is allowlisted (task 0839) so a copied deep-link `/?folder=<id>` survives
  // the login bounce and lands back at the exact vault location. It is our own
  // same-origin root and the match is still EXACT, so it is not an open redirect.
  test('accepts the Drive root and preserves its ?folder= deep-link query', () => {
    expect(sanitizeRedirect('/')).toBe('/')
    expect(sanitizeRedirect('/?folder=abc-123')).toBe('/?folder=abc-123')
  })

  // ── Control-character smuggling ────────────────────────────────────────────
  test('rejects embedded newline / CRLF / NUL / tab', () => {
    expect(sanitizeRedirect('/cli-auth\n')).toBeNull()
    expect(sanitizeRedirect('/cli-auth\r\nLocation: https://evil.com')).toBeNull()
    expect(sanitizeRedirect('/cli-auth\x00')).toBeNull()
    expect(sanitizeRedirect('/cli-auth\t?code=AB12-CD34')).toBeNull()
  })

  test('allowlist is the single source of truth and contains /cli-auth', () => {
    expect(REDIRECT_ALLOWLIST).toContain('/cli-auth')
  })
})
