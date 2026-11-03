/**
 * 2275 T5.5 — display markers derived from this client's own proofs.
 *
 * The F marker comes from the id class core answered (never `uploaded_by` or
 * `acted_via_share_id`); a shared root is marked from custody proven by id
 * (never from a name). A17d: a root whose name fails to decrypt is still
 * marked, by id. A17i: a collapsed trail keeps the shared root and the
 * current segment.
 */
import { describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'

const FOREIGN_ID = '99999999-9999-4999-8999-999999999999'
const ROOT_ID = '11111111-1111-4111-8111-111111111111'

const proven = new Set<string>([ROOT_ID])
const foreignIds = new Set<string>([FOREIGN_ID])

await mockModuleScoped('../src/lib/owner-adoption', import.meta.dir, {
  isForeignItemById: (id: string) => foreignIds.has(id),
  classifyItemIds: async () => {},
})
await mockModuleScoped('../src/lib/custody-memory', import.meta.dir, {
  hasSeenCustody: (id: string) => proven.has(id),
})

const {
  FOREIGN_ROW_LABEL,
  SHARED_ROOT_SUFFIX,
  foreignRowMarker,
  isSharedRootById,
  pickerFolderLabel,
  sharedRootSuffix,
  visibleCrumbs,
} = await import('../src/lib/display-markers')

describe('F row marker (by id class)', () => {
  test('a foreign id is marked, an owner id is not', () => {
    expect(foreignRowMarker(FOREIGN_ID)).toBe(FOREIGN_ROW_LABEL)
    expect(foreignRowMarker('22222222-2222-4222-8222-222222222222')).toBeNull()
  })
})

describe('shared roots (by custody proof, never by name)', () => {
  test('only the proven id is marked', () => {
    expect(isSharedRootById(ROOT_ID)).toBe(true)
    expect(isSharedRootById('33333333-3333-4333-8333-333333333333')).toBe(false)
    expect(sharedRootSuffix(ROOT_ID)).toBe(SHARED_ROOT_SUFFIX)
    expect(sharedRootSuffix(null)).toBe('')
  })

  test('a picker label carries the suffix for the proven id only', () => {
    expect(pickerFolderLabel(ROOT_ID, 'Family')).toBe('Family (shared)')
    expect(pickerFolderLabel('33333333-3333-4333-8333-333333333333', 'Family')).toBe('Family')
  })
})

describe('visibleCrumbs', () => {
  const trail = [
    { id: null, name: 'Drive' },
    { id: ROOT_ID, name: 'Family' },
    { id: '44444444-4444-4444-8444-444444444444', name: '2024' },
    { id: '55555555-5555-4555-8555-555555555555', name: 'Photos' },
    { id: '66666666-6666-4666-8666-666666666666', name: 'Trip' },
  ]

  test('a short trail is drawn whole', () => {
    const shown = visibleCrumbs(trail.slice(0, 3))
    expect(shown).toHaveLength(3)
    expect(shown.every((c) => c.kind === 'crumb')).toBe(true)
  })

  test('A17i: a collapsed trail keeps the shared root and the current segment', () => {
    const shown = visibleCrumbs(trail)
    expect(shown).toHaveLength(4)
    expect(shown[0]).toMatchObject({ kind: 'crumb', name: 'Drive', shared: false })
    expect(shown[1]).toMatchObject({ kind: 'crumb', name: 'Family', shared: true })
    expect(shown[2]).toEqual({ kind: 'ellipsis' })
    expect(shown[3]).toMatchObject({ kind: 'crumb', name: 'Trip', shared: false })
  })

  test('A17d: a shared root whose name cannot be decrypted is still marked, by id', () => {
    const shown = visibleCrumbs([
      { id: null, name: 'Drive' },
      { id: ROOT_ID, name: 'Unable to decrypt' },
      { id: '44444444-4444-4444-8444-444444444444', name: '2024' },
      { id: '55555555-5555-4555-8555-555555555555', name: 'Photos' },
      { id: '66666666-6666-4666-8666-666666666666', name: 'Trip' },
    ])
    expect(shown[1]).toMatchObject({ kind: 'crumb', id: ROOT_ID, shared: true })
  })

  test('a same-named folder is not marked without proof', () => {
    const shown = visibleCrumbs([
      { id: null, name: 'Drive' },
      { id: '77777777-7777-4777-8777-777777777777', name: 'Family' },
      { id: '44444444-4444-4444-8444-444444444444', name: '2024' },
      { id: '55555555-5555-4555-8555-555555555555', name: 'Photos' },
      { id: '66666666-6666-4666-8666-666666666666', name: 'Trip' },
    ])
    expect(shown.some((c) => c.kind === 'crumb' && c.shared)).toBe(false)
  })
})
