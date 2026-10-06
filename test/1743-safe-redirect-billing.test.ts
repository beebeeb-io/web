import { describe, expect, test } from 'bun:test'
import { sanitizeRedirect } from '../src/lib/safe-redirect'

describe('1743 round 3: /settings/billing post-login redirect is bare', () => {
  test('strips a forged success flag', () => {
    expect(sanitizeRedirect('/settings/billing?success=true')).toBe('/settings/billing')
  })
  test('strips query and hash together', () => {
    expect(sanitizeRedirect('/settings/billing?upgraded=true&session_id=x#a')).toBe('/settings/billing')
  })
  test('bare path unchanged', () => {
    expect(sanitizeRedirect('/settings/billing')).toBe('/settings/billing')
  })
  test('other allowlisted paths keep their query', () => {
    expect(sanitizeRedirect('/?folder=abc')).toBe('/?folder=abc')
  })
  test('non-allowlisted still rejected', () => {
    expect(sanitizeRedirect('/settings/billing/../x')).toBeNull()
  })
})
