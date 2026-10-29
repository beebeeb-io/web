import { describe, expect, test } from 'bun:test'
import { buildNameToFileMap, siblingLowercaseNames, type NamedFile } from '../src/lib/name-collision'

// Task 1544 finding 3: an unguarded rename can create two files with the
// same DECRYPTED name in one folder (server can't stop this -- names are
// E2E-encrypted ciphertext, unique per nonce). The OLD buildNameToFileMap
// used a plain `Map.set()` in a for-loop, so the duplicate silently
// overwrote the earlier entry -- a later same-name re-upload's
// auto-version resolver would then attach to an ARBITRARY one of the two
// files, misattributing data.

interface TestFile extends NamedFile {
  id: string
  is_folder: boolean
}

function file(id: string, isFolder = false): TestFile {
  return { id, is_folder: isFolder }
}

describe('buildNameToFileMap — duplicate-name ambiguity (finding 3)', () => {
  test('a unique name resolves normally', () => {
    const files = [file('a'), file('b')]
    const names: Record<string, string> = { a: 'report.pdf', b: 'other.pdf' }
    const map = buildNameToFileMap(files, (f) => names[f.id])
    expect(map.get('report.pdf')?.id).toBe('a')
    expect(map.get('other.pdf')?.id).toBe('b')
  })

  test('two files sharing a decrypted name are AMBIGUOUS -- name is absent from the map, not silently assigned to either', () => {
    // Exact repro: two files both decrypt to "report.pdf" (e.g. because one
    // was renamed into collision with the other).
    const files = [file('a'), file('b')]
    const names: Record<string, string> = { a: 'report.pdf', b: 'report.pdf' }
    const map = buildNameToFileMap(files, (f) => names[f.id])
    // Neither 'a' nor 'b' is returned for this name -- the old code would
    // have returned whichever file iterated last (non-deterministic w.r.t.
    // user intent). The safe default is no match at all, so a re-upload of
    // "report.pdf" is treated as non-conflicting (creates a new file)
    // rather than auto-versioning an arbitrary sibling.
    expect(map.has('report.pdf')).toBe(false)
  })

  test('name comparison is case-insensitive for ambiguity detection too', () => {
    const files = [file('a'), file('b')]
    const names: Record<string, string> = { a: 'Report.PDF', b: 'report.pdf' }
    const map = buildNameToFileMap(files, (f) => names[f.id])
    expect(map.has('report.pdf')).toBe(false)
  })

  test('folders are excluded from the map entirely', () => {
    const files = [file('a', true)]
    const names: Record<string, string> = { a: 'Documents' }
    const map = buildNameToFileMap(files, (f) => names[f.id])
    expect(map.size).toBe(0)
  })

  test('files with no decrypted name yet are simply absent (not an ambiguity)', () => {
    const files = [file('a'), file('b')]
    const names: Record<string, string> = { a: 'report.pdf' } // 'b' not yet decrypted
    const map = buildNameToFileMap(files, (f) => names[f.id])
    expect(map.get('report.pdf')?.id).toBe('a')
    expect(map.size).toBe(1)
  })

  test('a THIRD file sharing the name stays absent (ambiguity is sticky, not reset by count)', () => {
    const files = [file('a'), file('b'), file('c')]
    const names: Record<string, string> = { a: 'x.pdf', b: 'x.pdf', c: 'x.pdf' }
    const map = buildNameToFileMap(files, (f) => names[f.id])
    expect(map.has('x.pdf')).toBe(false)
  })
})

describe('siblingLowercaseNames — rename collision guard input (finding 3)', () => {
  test('excludes the file being renamed itself', () => {
    const files = [file('a'), file('b')]
    const names: Record<string, string> = { a: 'report.pdf', b: 'other.pdf' }
    const set = siblingLowercaseNames(files, 'a', (f) => names[f.id])
    expect(set.has('report.pdf')).toBe(false) // that's 'a' itself
    expect(set.has('other.pdf')).toBe(true)
  })

  test('includes every other non-folder sibling, lowercased', () => {
    const files = [file('a'), file('b'), file('c', true)]
    const names: Record<string, string> = { a: 'Mine.pdf', b: 'Report.PDF', c: 'Docs' }
    const set = siblingLowercaseNames(files, 'a', (f) => names[f.id])
    expect(set.has('report.pdf')).toBe(true)
    expect(set.has('docs')).toBe(false) // folders excluded
  })

  test('the exact finding-3 repro: renaming a second file to an existing name is now detectable', () => {
    // Step 1: 'report.pdf' already exists as file 'a'.
    // Step 2 (the bug): file 'b' is renamed to 'report.pdf' with no check.
    // This function is what the rename-dialog guard now consults BEFORE
    // step 2 is allowed to complete, so the collision is caught here.
    const files = [file('a'), file('b')]
    const names: Record<string, string> = { a: 'report.pdf', b: 'unrelated.pdf' }
    const set = siblingLowercaseNames(files, 'b', (f) => names[f.id])
    const proposedNewName = 'report.pdf'
    expect(set.has(proposedNewName.toLowerCase())).toBe(true) // blocked
  })
})
