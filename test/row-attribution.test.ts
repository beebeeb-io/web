/**
 * Task 2237b — attribution for drive rows that arrive over sync.
 *
 * The sync snapshot and the `file_create` op carry no `acted_via_share_id` /
 * `uploaded_by` / owner wrap. Without them a guest's file pushed into the
 * owner's open folder takes the master-key path and cannot be read until a
 * reload. These pin the overlay, the signature that makes the drive re-render
 * when attribution is learned, and the bounded lookup.
 */
import { describe, expect, test } from 'bun:test'
import type { DriveFile } from '../src/lib/api'
import {
  MAX_ATTRIBUTION_LOOKUPS,
  createAttributionRefresher,
  learnAttribution,
  rowsMissingAttribution,
  withAttribution,
  type RowAttribution,
} from '../src/lib/row-attribution'
import { rowsSignature } from '../src/lib/sync-rows'
import { addedBySomeoneElse } from '../src/components/file-list'

function row(id: string, extra: Partial<DriveFile> = {}): DriveFile {
  return {
    id,
    name_encrypted: '{"nonce":"n","ciphertext":"c"}',
    mime_type: null,
    size_bytes: 10,
    is_folder: false,
    is_trashed: false,
    parent_id: 'shared-root',
    chunk_count: 1,
    created_at: '2026-10-28T00:00:00Z',
    updated_at: '2026-10-28T00:00:00Z',
    ...extra,
  }
}

describe('overlay', () => {
  test('a sync row takes the attribution the API reported for the same id', () => {
    const known = new Map<string, RowAttribution>()
    learnAttribution(known, [row('g', { acted_via_share_id: 'link-1', actor_name_encrypted: 'enc' })])
    const merged = withAttribution(row('g'), known)
    expect(merged.acted_via_share_id).toBe('link-1')
    expect(merged.actor_name_encrypted).toBe('enc')
    // ...which is exactly what moves the owner onto the shared-folder key path.
    expect(addedBySomeoneElse(row('g'), 'owner')).toBe(false)
    expect(addedBySomeoneElse(merged, 'owner')).toBe(true)
  })

  test('a member upload and an owner wrap survive the overlay too', () => {
    const known = new Map<string, RowAttribution>()
    learnAttribution(known, [row('m', { uploaded_by: 'member-1', owner_wrapped_file_key: 'wrap' })])
    const merged = withAttribution(row('m'), known)
    expect(merged.uploaded_by).toBe('member-1')
    expect(merged.owner_wrapped_file_key).toBe('wrap')
  })

  test('an API row with no attribution is known (no lookup), and the row is unchanged', () => {
    const known = new Map<string, RowAttribution>()
    learnAttribution(known, [row('own')])
    expect(rowsMissingAttribution([row('own'), row('new')], known)).toEqual(['new'])
    expect(withAttribution(row('own'), known)).toEqual(row('own'))
  })

  test('the sync signature changes when attribution is learned, so the drive re-renders', () => {
    const bare = [row('g')]
    const attributed = [row('g', { acted_via_share_id: 'link-1' })]
    expect(rowsSignature(bare)).not.toBe(rowsSignature(attributed))
    expect(rowsSignature([row('m')])).not.toBe(rowsSignature([row('m', { uploaded_by: 'member-1' })]))
    expect(rowsSignature([row('w')])).not.toBe(rowsSignature([row('w', { owner_wrapped_file_key: 'x' })]))
  })
})

describe('bounded lookup', () => {
  function harness(opts: { listingInFlight?: () => boolean; failIds?: Set<string> } = {}) {
    const known = new Map<string, RowAttribution>()
    const fetched: string[] = []
    let listings = 0
    let learned = 0
    let pendingTimer: (() => void) | null = null
    const refresher = createAttributionRefresher({
      known,
      getFile: async (id) => {
        fetched.push(id)
        if (opts.failIds?.has(id)) throw new Error('offline')
        return row(id, { acted_via_share_id: 'link-1' })
      },
      listFolder: async () => {
        listings++
        return Array.from({ length: MAX_ATTRIBUTION_LOOKUPS + 1 }, (_, i) => row(`b${i}`, { acted_via_share_id: 'link-1' }))
      },
      onLearned: () => { learned++ },
      listingInFlight: opts.listingInFlight,
      setTimer: (fn) => { pendingTimer = fn; return 1 },
      clearTimer: () => { pendingTimer = null },
    })
    return {
      known, fetched, refresher,
      get listings() { return listings },
      get learned() { return learned },
      fire: async () => { const fn = pendingTimer; pendingTimer = null; fn?.(); await new Promise((r) => setTimeout(r, 0)) },
      get scheduled() { return pendingTimer !== null },
    }
  }

  test('a burst is looked up once per id, then the drive is asked to re-derive', async () => {
    const h = harness()
    h.refresher.request(['a', 'b'])
    h.refresher.request(['a'])
    await h.fire()
    expect(h.fetched.sort()).toEqual(['a', 'b'])
    expect(h.known.get('a')?.acted_via_share_id).toBe('link-1')
    expect(h.learned).toBe(1)
    // Known ids never schedule again.
    h.refresher.request(['a', 'b'])
    expect(h.scheduled).toBe(false)
  })

  test('more unknown rows than the bound become ONE folder listing, not N lookups', async () => {
    const h = harness()
    h.refresher.request(Array.from({ length: MAX_ATTRIBUTION_LOOKUPS + 1 }, (_, i) => `b${i}`))
    await h.fire()
    expect(h.fetched).toHaveLength(0)
    expect(h.listings).toBe(1)
    expect(h.known.size).toBe(MAX_ATTRIBUTION_LOOKUPS + 1)
  })

  test('while the page listing is in flight the lookup waits for it', async () => {
    let inFlight = true
    const h = harness({ listingInFlight: () => inFlight })
    h.refresher.request(['a'])
    await h.fire()
    expect(h.fetched).toHaveLength(0)
    expect(h.scheduled).toBe(true)
    // The listing learned the row meanwhile: nothing left to fetch.
    learnAttribution(h.known, [row('a')])
    inFlight = false
    await h.fire()
    expect(h.fetched).toHaveLength(0)
  })

  test('a failed lookup is not remembered, so the next burst retries it', async () => {
    const h = harness({ failIds: new Set(['x']) })
    h.refresher.request(['x'])
    await h.fire()
    expect(h.known.has('x')).toBe(false)
    expect(h.learned).toBe(0)
    h.refresher.request(['x'])
    expect(h.scheduled).toBe(true)
  })
})
