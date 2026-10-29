/**
 * Task 2237b — the token a folder link sends.
 *
 * Task 17 caught this in the browser: the shared 20-byte share token (27
 * chars, the file-share shape) is rejected by POST
 * /api/v1/shares/folder-links with 400 "invalid token", because a folder link
 * is the only credential guarding a whole tree and the route requires 32
 * bytes. The folder-link mint has to use its own generator.
 */
import { describe, expect, test } from 'bun:test'

const { generateFolderLinkToken } = await import('../src/lib/shared-folder-link-crypto')

function decode(token: string): Uint8Array {
  const base64 = token.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}

describe('folder link token', () => {
  test('is 32 random bytes of URL-safe base64 with no padding', () => {
    const token = generateFolderLinkToken()
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(token).toHaveLength(43)
    expect(decode(token).length).toBe(32)
  })

  test('is fresh every time', () => {
    const tokens = new Set(Array.from({ length: 20 }, () => generateFolderLinkToken()))
    expect(tokens.size).toBe(20)
  })
})
