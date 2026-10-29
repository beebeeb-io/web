/**
 * Task 1828 — /settings/billing?success=true must not claim "Your subscription is now active".
 * Nothing links with success=true (server return URLs use ?upgraded=true / session_id), so the
 * bare flag proves nothing. The page cannot be SSR-rendered past its loading skeleton without the
 * whole drive/toast provider tree, so this pins (1) the pure return-detection helper and
 * (2) that the page source no longer carries the unconditional claim. The browser behaviour is
 * proven by e2e/1828-billing-success-flag.spec.ts.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isCheckoutReturn } from '../src/lib/checkout-return'

const q = (s: string) => new URLSearchParams(s)

describe('1828 checkout return detection', () => {
  test('a crafted ?success=true is not a checkout return', () => {
    expect(isCheckoutReturn(q('success=true'))).toBe(false)
  })
  test('?upgraded=true and ?session_id=... are returns (they poll before claiming anything)', () => {
    expect(isCheckoutReturn(q('upgraded=true'))).toBe(true)
    expect(isCheckoutReturn(q('session_id=cs_123'))).toBe(true)
  })
  test('nothing and upgraded=false are not returns', () => {
    expect(isCheckoutReturn(q(''))).toBe(false)
    expect(isCheckoutReturn(q('upgraded=false'))).toBe(false)
  })
})

describe('1828 billing page source', () => {
  const src = readFileSync(join(import.meta.dir, '../src/pages/billing.tsx'), 'utf8')
  test('no unconditional "subscription is now active" claim', () => {
    expect(src).not.toContain('Your subscription is now active')
  })
  test('no bare success=true read', () => {
    expect(src).not.toMatch(/get\('success'\)/)
  })
})
