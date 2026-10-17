import { beforeEach, describe, expect, test } from 'bun:test'
import type { SyncOp } from '../src/lib/api'
import { mockModuleScoped } from './helpers/scoped-module-mock'

/**
 * Task 1919, review thread on web#167: the drive gives a sync-derived row the
 * city of its node's storage pool. A new version uploaded after the person
 * picked another datacenter lands in another pool, and the V2 upload's
 * `file_update` op says which (`storage_pool_id`). The client used to keep the
 * OLD pool on every `file_update`, so the row would have shown the old city.
 */

class MemoryStorage {
  private store = new Map<string, string>()
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }
  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
  removeItem(key: string): void {
    this.store.delete(key)
  }
  clear(): void {
    this.store.clear()
  }
}
;(globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage()

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getSyncOps: async () => [],
  getSnapshot: async () => ({ seq_id: 0, nodes: [] }),
  getStreamToken: async () => ({ stream_token: 'test-token' }),
  submitSyncOps: async () => ({ applied: [], rejected: [] }),
})

const { SyncClient } = await import('../src/lib/sync-client')

const FILE_ID = 'cccccccc-1919-4919-8919-cccccccccccc'

function op(seq: number, op_type: string, payload: Record<string, unknown>): SyncOp {
  return { seq_id: seq, op_type, payload, created_at: '' }
}

beforeEach(() => {
  ;(globalThis as unknown as { localStorage: MemoryStorage }).localStorage.clear()
})

describe('file_update carries the storage pool when the op names one', () => {
  test('a new version in another pool moves the node to that pool', () => {
    const client = new SyncClient()
    client.ingestStreamFrame(
      JSON.stringify(op(1, 'file_create', { id: FILE_ID, name_encrypted: 'x', parent_id: null, size_bytes: 1, storage_pool_id: 'pool-fsn' })),
    )
    expect(client.getNode(FILE_ID)?.storage_pool_id).toBe('pool-fsn')
    client.ingestStreamFrame(
      JSON.stringify(op(2, 'file_update', { id: FILE_ID, size_bytes: 2, version_number: 2, storage_pool_id: 'pool-hel' })),
    )
    expect(client.getNode(FILE_ID)?.storage_pool_id).toBe('pool-hel')
  })

  test('an update that names no pool keeps the one the node had', () => {
    const client = new SyncClient()
    client.ingestStreamFrame(
      JSON.stringify(op(1, 'file_create', { id: FILE_ID, name_encrypted: 'x', parent_id: null, size_bytes: 1, storage_pool_id: 'pool-fsn' })),
    )
    client.ingestStreamFrame(JSON.stringify(op(2, 'file_update', { id: FILE_ID, size_bytes: 5 })))
    expect(client.getNode(FILE_ID)?.storage_pool_id).toBe('pool-fsn')
  })
})
