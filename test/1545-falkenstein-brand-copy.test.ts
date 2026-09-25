import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Task 1545, finding 5 — the workspace CLAUDE.md brand rule ("EU
 * references: Name the city. 'Stored in Falkenstein.'") was violated on
 * three public, unauthenticated share-recipient surfaces, which instead
 * said the generic "Stored in Europe" / "EU servers".
 */

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf-8')
}

describe('public share-recipient pages name Falkenstein, not "Europe"/"EU servers" (1545#5)', () => {
  test('share-view.tsx never says "Stored in Europe" and says "Stored in Falkenstein, Germany" at least twice (unknown-type + expired/revoked footers)', () => {
    const src = read('src/pages/share-view.tsx')
    expect(src).not.toContain('Stored in Europe')
    const matches = src.match(/Stored in Falkenstein, Germany/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  test('public-profile.tsx footer says "Stored in Falkenstein, Germany", not "EU servers"', () => {
    const src = read('src/pages/public-profile.tsx')
    expect(src).not.toContain('EU servers')
    expect(src).toContain('Stored in Falkenstein, Germany')
  })
})
