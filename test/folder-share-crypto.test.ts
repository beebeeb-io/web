import { describe, expect, test } from 'bun:test'
import { installMocks, setListPage } from './helpers/upload-share-mocks'

// Shared mock setup (task 0753): both this suite and encrypted-upload-v2-contract
// register the SAME superset ./api + ./crypto mocks via installMocks(), so bun's
// global mock.module doesn't collide. This suite drives listFilesPage through
// setListPage; ./crypto is stubbed (collectAllChildren never calls it).
installMocks()

type Child = { id: string; is_folder: boolean }
const full = (n: number, prefix = 'f'): Child[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, is_folder: false }))

describe('collectAllChildren — folder-share completeness guard (0739 keyset pagination)', () => {
  // (a) Pre-0739 server: a FULL page with NO cursor means there may be unreachable
  //     children → refuse loudly rather than silently half-share.
  test('refuses on a full page with NO next_cursor (pre-0739 server — never half-shares)', async () => {
    setListPage(() => ({ files: full(500), next_cursor: null }))
    const { collectAllChildren } = await import('../src/lib/folder-share-crypto')
    await expect(collectAllChildren('root')).rejects.toThrow(/too large to share/i)
  })

  // (b) Paginated server: a full page carrying next_cursor is FOLLOWED to complete
  //     enumeration — no false refusal, every child collected.
  test('follows next_cursor across a full page to complete enumeration (no false refusal)', async () => {
    const seenCursors: (string | undefined)[] = []
    setListPage(({ cursor }) => {
      seenCursors.push(cursor)
      if (!cursor) return { files: full(500, 'a'), next_cursor: 'c1' }
      if (cursor === 'c1') return { files: [{ id: 'a500', is_folder: false }], next_cursor: null }
      return { files: [], next_cursor: null }
    })
    const { collectAllChildren } = await import('../src/lib/folder-share-crypto')
    const ids = await collectAllChildren('root')
    expect(ids.length).toBe(501) // all enumerated, nothing dropped, no throw
    expect(seenCursors).toEqual([undefined, 'c1']) // exact cursor threading
  })

  // (c) Complete recursion into subfolders.
  test('collects a complete tree, recursing into subfolders', async () => {
    setListPage(({ parentId, cursor }) => {
      if (cursor) return { files: [], next_cursor: null }
      if (parentId === 'root') return { files: [{ id: 'a', is_folder: false }, { id: 'sub', is_folder: true }], next_cursor: null }
      if (parentId === 'sub') return { files: [{ id: 'b', is_folder: false }], next_cursor: null }
      return { files: [], next_cursor: null }
    })
    const { collectAllChildren } = await import('../src/lib/folder-share-crypto')
    const ids = await collectAllChildren('root')
    expect([...ids].sort()).toEqual(['a', 'b', 'sub'])
  })

  // (d) Outer bound: a descendant set beyond FILE_LIST_HARD_CAP throws rather than
  //     building an unbounded (and partial) per-recipient key set.
  test('throws when the descendant count exceeds FILE_LIST_HARD_CAP (never truncates)', async () => {
    let page = 0
    setListPage(() => {
      page++
      // 1000 per page WITH a cursor (so the (a) full-page-no-cursor guard never
      // fires); bounded at 60 pages so a broken cap can't hang the test.
      return { files: full(1000, `p${page}_`), next_cursor: page < 60 ? `c${page}` : null }
    })
    const { collectAllChildren } = await import('../src/lib/folder-share-crypto')
    await expect(collectAllChildren('root')).rejects.toThrow(/too large to share/i)
  })
})
