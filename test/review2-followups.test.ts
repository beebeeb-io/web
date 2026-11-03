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

  test('the local request-row reader is gone; core resolves the row', () => {
    // §15 (2326): web holds no request-row reader and no content key. Every
    // request row goes through core's resolver, and its content stays behind a
    // decrypt-only reader.
    const src = read('../src/lib/request-row.ts')
    expect(src).toContain('resolveRequestRowWith')
    expect(src).toContain('sealRequestRenameWith')
    expect(src).not.toContain('openRequestUpload')
    const resolver = read('../src/lib/request-row-resolver.ts')
    expect(resolver).not.toContain('unwrapRequestPrivate')
    expect(resolver).not.toContain('openRequestUpload')
  })
})
