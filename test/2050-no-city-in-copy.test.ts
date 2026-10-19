import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Task 2050 (Guus, 2026-10-19): storage location is shown and chosen by
 * COUNTRY. Cities together identify the hosting provider, so no user-facing
 * string in `src/` may name one (docs/canon/data-residency.md).
 *
 * What counts as a user-facing string: any code in `src/`. Comments may explain
 * the rule and are stripped first. `src/lib/timezones.ts` is the one allowed
 * file: its IANA identifiers ('Europe/Helsinki') are machine data, not copy.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const ALLOWED = new Set(['lib/timezones.ts'])

// Case-insensitive for the unambiguous names; "Ede" only as the capitalised word
// (a place name), so "needed" or "ede" inside an identifier never trips it.
const CITY = /falkenstein|helsinki|nuremberg|n(?:ü|ue|u)rnberg|\bEde\b/i
const CITY_EDE_PLACE = /\bEde\b/

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|css|html)$/.test(name)) out.push(p)
  }
  return out
}

/** Source with block comments, JSX comments and line comments removed. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1')
}

export function cityHits(src: string): string[] {
  const code = stripComments(src)
  const hits: string[] = []
  code.split('\n').forEach((line, i) => {
    const m = line.match(CITY)
    if (!m) return
    // "ede" lower-case is only a hit through the capitalised-place rule.
    if (m[0].toLowerCase() === 'ede' && !CITY_EDE_PLACE.test(line)) return
    hits.push(`${i + 1}: ${line.trim().slice(0, 120)}`)
  })
  return hits
}

describe('the guard itself', () => {
  test('flags a city in a string, a template and JSX text', () => {
    expect(cityHits(`const a = 'Stored in Falkenstein'`)).toHaveLength(1)
    expect(cityHits('const b = `Uploading to ${x} Helsinki`')).toHaveLength(1)
    expect(cityHits('<p>Nürnberg, Germany</p>')).toHaveLength(1)
    expect(cityHits('<p>Nuremberg</p>')).toHaveLength(1)
    expect(cityHits(`const region = 'Ede'`)).toHaveLength(1)
  })

  test('ignores comments and words that merely contain "ede"', () => {
    expect(cityHits('// Falkenstein is a comment')).toHaveLength(0)
    expect(cityHits('/* Helsinki */ const a = 1')).toHaveLength(0)
    expect(cityHits('{/* Nuremberg */}')).toHaveLength(0)
    expect(cityHits('const needed = precede')).toHaveLength(0)
    expect(cityHits(`const u = 'https://example.com/a'`)).toHaveLength(0)
  })
})

describe('no city name in any user-facing string in src/', () => {
  const files = walk(SRC)

  test('the walk found the source tree (a guard that scans nothing is red)', () => {
    expect(files.length).toBeGreaterThan(100)
  })

  test('the only allow-listed file is the timezone identifier table', () => {
    expect([...ALLOWED]).toEqual(['lib/timezones.ts'])
    expect(files.some((f) => relative(SRC, f) === 'lib/timezones.ts')).toBe(true)
  })

  for (const file of files) {
    const rel = relative(SRC, file)
    if (ALLOWED.has(rel)) continue
    test(`src/${rel}`, () => {
      expect(cityHits(readFileSync(file, 'utf-8'))).toEqual([])
    })
  }
})
