import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { knownPoolLocation, learnPoolLocations, poolKey } from '../src/lib/sync-storage-locations'
import { fileStorageCity } from '../src/lib/storage-regions'
import { rowsSignature } from '../src/lib/sync-rows'
import type { DriveFile } from '../src/lib/api'

/**
 * Task 1919, review thread on web#167: a sync-derived drive refresh (a remote
 * upload, any tree bump that changes the row signature) replaced the API rows
 * with rows built from sync nodes, which carry no `storage_location`, so every
 * row's city fell back to plain "Europe" until the next API refresh.
 *
 * The fix learns pool -> location from API rows joined to their sync nodes and
 * gives every sync-derived row its own pool's location.
 */

const HEL = { region: 'europe', city: 'Helsinki', provider: 'x' }
const FSN = { region: 'europe', city: 'Falkenstein', provider: 'x' }
const T1 = '2026-10-17T10:00:00Z'
const T2 = '2026-10-17T11:00:00Z'

describe('learnPoolLocations + knownPoolLocation', () => {
  test('a sync node gets the city its pool had in the API list (the reported case)', () => {
    const known = new Map<string, unknown>()
    learnPoolLocations(
      known,
      [{ id: 'a', updated_at: T1, storage_pool_id: 'pool-hel' }],
      [{ id: 'a', updated_at: T1, storage_location: HEL }],
    )
    // Remote upload: a NEW file in the same pool, never seen in an API row.
    const loc = knownPoolLocation(known, { id: 'b', updated_at: T2, storage_pool_id: 'pool-hel' })
    expect(fileStorageCity({ storage_location: loc })).toBe('Helsinki')
    // And the file the API row was about keeps its city too.
    expect(fileStorageCity({ storage_location: knownPoolLocation(known, { id: 'a', storage_pool_id: 'pool-hel' }) })).toBe(
      'Helsinki',
    )
  })

  test('a file in another pool takes ITS pool city, not the city of the file id', () => {
    const known = new Map<string, unknown>()
    learnPoolLocations(
      known,
      [
        { id: 'a', updated_at: T1, storage_pool_id: 'pool-hel' },
        { id: 'b', updated_at: T1, storage_pool_id: 'pool-fsn' },
      ],
      [
        { id: 'a', updated_at: T1, storage_location: HEL },
        { id: 'b', updated_at: T1, storage_location: FSN },
      ],
    )
    // `a` got a new version that landed in the Falkenstein pool.
    const loc = knownPoolLocation(known, { id: 'a', updated_at: T2, storage_pool_id: 'pool-fsn' })
    expect(fileStorageCity({ storage_location: loc })).toBe('Falkenstein')
  })

  test('a node that moved on since the API row teaches nothing (no stale city for a new pool)', () => {
    const known = new Map<string, unknown>()
    learnPoolLocations(
      known,
      [{ id: 'a', updated_at: T2, storage_pool_id: 'pool-nbg' }],
      [{ id: 'a', updated_at: T1, storage_location: HEL }],
    )
    expect(knownPoolLocation(known, { id: 'a', storage_pool_id: 'pool-nbg' })).toBeUndefined()
  })

  test('an unknown pool stays unknown: no invented city', () => {
    const known = new Map<string, unknown>()
    learnPoolLocations(known, [{ id: 'a', updated_at: T1, storage_pool_id: 'pool-hel' }], [
      { id: 'a', updated_at: T1, storage_location: HEL },
    ])
    expect(knownPoolLocation(known, { id: 'z', storage_pool_id: 'pool-other' })).toBeUndefined()
  })

  test('"Unknown" and missing cities are never learned', () => {
    const known = new Map<string, unknown>()
    learnPoolLocations(
      known,
      [
        { id: 'a', updated_at: T1, storage_pool_id: 'p' },
        { id: 'b', updated_at: T1, storage_pool_id: 'q' },
      ],
      [
        { id: 'a', updated_at: T1, storage_location: { region: 'europe', city: 'Unknown', provider: 'Unknown' } },
        { id: 'b', updated_at: T1 },
      ],
    )
    expect(known.size).toBe(0)
  })

  test('a null pool id is the default pool and is learned under its own key', () => {
    const known = new Map<string, unknown>()
    learnPoolLocations(known, [{ id: 'a', updated_at: T1, storage_pool_id: null }], [
      { id: 'a', updated_at: T1, storage_location: FSN },
    ])
    expect(poolKey(null)).toBe(poolKey(undefined))
    expect(fileStorageCity({ storage_location: knownPoolLocation(known, { id: 'c', storage_pool_id: null }) })).toBe(
      'Falkenstein',
    )
    expect(knownPoolLocation(known, { id: 'c', storage_pool_id: 'pool-hel' })).toBeUndefined()
  })

  test('survives an intermediate empty list (the map is not the list state)', () => {
    const known = new Map<string, unknown>()
    learnPoolLocations(known, [{ id: 'a', updated_at: T1, storage_pool_id: 'h' }], [
      { id: 'a', updated_at: T1, storage_location: HEL },
    ])
    learnPoolLocations(known, [], [])
    learnPoolLocations(known, [{ id: 'a', updated_at: T1, storage_pool_id: 'h' }], [])
    expect(fileStorageCity({ storage_location: knownPoolLocation(known, { id: 'a', storage_pool_id: 'h' }) })).toBe(
      'Helsinki',
    )
  })
})

describe('rowsSignature renders the city', () => {
  function row(loc?: unknown): DriveFile {
    return {
      id: 'a',
      name_encrypted: 'n',
      mime_type: null,
      size_bytes: 1,
      is_folder: false,
      is_trashed: false,
      parent_id: null,
      chunk_count: 1,
      created_at: T1,
      updated_at: T1,
      ...(loc === undefined ? {} : { storage_location: loc }),
    } as DriveFile
  }

  test('rows that differ only in their city are not "the same rows"', () => {
    // Otherwise a sync derive that lost (or gained) the city is skipped or kept
    // by the no-redraw check and the row shows the wrong place.
    expect(rowsSignature([row(HEL)])).not.toBe(rowsSignature([row()]))
    expect(rowsSignature([row(HEL)])).not.toBe(rowsSignature([row(FSN)]))
  })

  test('the same city from either source is the same row (no redraw)', () => {
    expect(rowsSignature([row(HEL)])).toBe(rowsSignature([row({ ...HEL })]))
  })
})

describe('the drive wires it', () => {
  const drive = readFileSync(fileURLToPath(new URL('../src/pages/drive.tsx', import.meta.url)), 'utf8')

  test('sync-derived rows take their pool location; API lists teach it', () => {
    // The mapper attaches the learned location of the node's pool.
    expect(drive).toMatch(/knownPoolLocation\(poolLocationsRef\.current, n\)/)
    // refreshFromSync learns from the rows on screen before replacing them, and
    // fetchFiles learns from the API list it just received.
    expect((drive.match(/learnPoolLocations\(/g) ?? []).length).toBeGreaterThanOrEqual(2)
  })
})
