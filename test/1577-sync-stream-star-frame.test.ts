import { describe, expect, test, beforeEach } from 'bun:test'

/**
 * Task 1577 — starring a file from its drive row sent
 * `PATCH /files/:id/star` → 200 `{ is_starred: true }`, yet the row kept
 * reading "Star".
 *
 * Root cause: the server's `/sync/stream` SSE forwards EVERY event-bus
 * message, including the realtime `{ type: 'file.starred', data: { id,
 * is_starred } }` frame the star route publishes. `SyncClient` treated every
 * frame as a sequenced sync op: the star frame fell through
 * `applyOpToTree`'s default branch (tree unchanged, `is_starred` still
 * false), overwrote `lastSeq` with `undefined`, and emitted a tree change.
 * The drive re-derives its rows from the tree on every tree change
 * (`refreshFromSync`), so whenever that frame landed after the PATCH response
 * the stale `is_starred: false` overwrote the row.
 *
 * These tests drive the real `SyncClient.ingestStreamFrame` with the exact
 * server frame shapes.
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

const { SyncClient, classifyStreamFrame } = await import('../src/lib/sync-client')

const FILE_ID = '48fda524-1859-49b3-ba27-78124728e423'

/** A real sequenced op, as the server records it for an upload. */
function fileCreateFrame(seq: number): string {
  return JSON.stringify({
    seq_id: seq,
    op_type: 'file_create',
    payload: { id: FILE_ID, name_encrypted: 'x', parent_id: null, size_bytes: 14 },
    created_at: new Date().toISOString(),
  })
}

/** The realtime frame `routes/starred.rs` publishes (serde tag/content). */
function starredFrame(isStarred: boolean): string {
  return JSON.stringify({
    type: 'file.starred',
    data: { id: FILE_ID, is_starred: isStarred },
    timestamp: new Date().toISOString(),
  })
}

function seededClient() {
  const client = new SyncClient()
  const events: string[] = []
  client.subscribe((e) => events.push(e.type))
  client.ingestStreamFrame(fileCreateFrame(1))
  expect(client.getNode(FILE_ID)?.is_starred).toBe(false)
  events.length = 0
  return { client, events }
}

beforeEach(() => {
  ;(globalThis as { localStorage: MemoryStorage }).localStorage.clear()
})

describe('1577: /sync/stream file.starred frame', () => {
  test('a file.starred frame updates the tree node is_starred (both directions)', () => {
    const { client } = seededClient()
    client.ingestStreamFrame(starredFrame(true))
    expect(client.getNode(FILE_ID)?.is_starred).toBe(true)
    client.ingestStreamFrame(starredFrame(false))
    expect(client.getNode(FILE_ID)?.is_starred).toBe(false)
  })

  test('a realtime frame never corrupts lastSeq', () => {
    const { client } = seededClient()
    expect(client.getLastSeq()).toBe(1)
    client.ingestStreamFrame(starredFrame(true))
    client.ingestStreamFrame(JSON.stringify({ type: 'file.uploaded', data: { id: FILE_ID } }))
    expect(client.getLastSeq()).toBe(1)
    // …so the next real op is still applied in order.
    client.ingestStreamFrame(JSON.stringify({
      seq_id: 2, op_type: 'file_trash', payload: { id: FILE_ID }, created_at: '',
    }))
    expect(client.getLastSeq()).toBe(2)
    expect(client.getNode(FILE_ID)?.is_trashed).toBe(true)
    expect(client.getNode(FILE_ID)?.is_starred).toBe(true)
  })

  test('tree-change listeners fire only when the tree actually changed', () => {
    const { client, events } = seededClient()
    client.ingestStreamFrame(JSON.stringify({ type: 'share.opened', data: { share_id: 's' } }))
    expect(events).toEqual([])
    client.ingestStreamFrame(starredFrame(true))
    expect(events).toEqual(['tree'])
    client.ingestStreamFrame(starredFrame(true)) // same value again — no-op
    expect(events).toEqual(['tree'])
  })

  test('setNodeStarred (PATCH response path) records the star in the tree children', () => {
    const { client } = seededClient()
    client.setNodeStarred(FILE_ID, true)
    expect(client.getChildren(null).find((n) => n.id === FILE_ID)?.is_starred).toBe(true)
    // Unknown id is a no-op, not a throw.
    client.setNodeStarred('00000000-0000-0000-0000-000000000000', true)
  })
})

describe('1577: classifyStreamFrame', () => {
  test('sequenced op', () => {
    expect(classifyStreamFrame(JSON.parse(fileCreateFrame(7))).kind).toBe('op')
  })
  test('file.starred realtime event', () => {
    expect(classifyStreamFrame(JSON.parse(starredFrame(true)))).toEqual({
      kind: 'starred', id: FILE_ID, isStarred: true,
    })
  })
  test('other realtime events and junk are ignored', () => {
    expect(classifyStreamFrame({ type: 'file.uploaded', data: { id: FILE_ID } }).kind).toBe('ignore')
    expect(classifyStreamFrame({ type: 'file.starred', data: { file_id: FILE_ID, is_starred: true } }).kind).toBe('ignore')
    expect(classifyStreamFrame({ seq_id: 'nope', op_type: 'file_create' }).kind).toBe('ignore')
    expect(classifyStreamFrame(null).kind).toBe('ignore')
    expect(classifyStreamFrame('keepalive').kind).toBe('ignore')
  })
})
