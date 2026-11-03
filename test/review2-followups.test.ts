/**
 * Review-2 follow-ups: a fresh-tab drop must still move (owner-only) and say
 * so, and the unchecked request-key opener is gone.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const read = (url: string) => readFileSync(new URL(url, import.meta.url), 'utf8')

describe('review-2 follow-ups', () => {
  test('A17f: a drop in a fresh tab still moves, stays owner-only, and says so', () => {
    const src = read('../src/pages/drive/use-drive-actions.ts')
    // The anchor decides whether anything may be published, never whether the
    // user's move happens.
    expect(src).not.toContain('if (!navigationSettled()) return')
    expect(src).toContain('moveOwnerItems(')
    expect(src).toContain('Only you can open this until you share it.')
  })

  test('the unused unchecked request-key opener is deleted', () => {
    const src = read('../src/lib/file-request-crypto.ts')
    expect(src).not.toContain('resolveRequestFileKey')
  })
})
