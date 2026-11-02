/**
 * Task 2322: the shared Icon's glyph paths.
 *
 * Bug: Icon split a path on every `z` and drew each piece as its own <path>. The key glyph reads
 * `...zm0 0L15.5 7.5...`: its second piece began with a RELATIVE `m0 0`, and the first moveto of a
 * path is absolute, so the piece started at the origin and drew a stray line from the top-left
 * corner to the bow of the key. Every rendered path must therefore begin with an absolute `M`.
 *
 * Plain `.ts` + `createElement`: a bare `bun test` does not pick up `.test.tsx` (see
 * 1610-totp-section-render.test.ts).
 */
import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { Icon } from '../packages/shared/src/design/icons'
import type { IconName } from '../packages/shared/src/design/icons'

function renderedPathData(name: IconName): string[] {
  const markup = renderToStaticMarkup(createElement(Icon, { name }))
  return [...markup.matchAll(/<path d="([^"]+)"/g)].map((match) => match[1])
}

describe('Icon glyph paths', () => {
  test('key: every rendered path starts with an absolute moveto', () => {
    const paths = renderedPathData('key')
    expect(paths.length).toBeGreaterThan(0)
    for (const d of paths) expect(d.startsWith('M')).toBe(true)
  })

  // The two glyphs the product icons add; also guards the same split bug for any later glyph.
  for (const name of ['globe', 'chat'] as const) {
    test(`${name}: renders, and every rendered path starts with an absolute moveto`, () => {
      const paths = renderedPathData(name)
      expect(paths.length).toBeGreaterThan(0)
      for (const d of paths) expect(d.startsWith('M')).toBe(true)
    })
  }
})
