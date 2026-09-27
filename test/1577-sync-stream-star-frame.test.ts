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
function starredFrame(isStarred: boolean, timestamp = new Date().toISOString()): string {
  return JSON.stringify({
    type: 'file.starred',
    data: { id: FILE_ID, is_starred: isStarred },
    timestamp,
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
  test('file.starred realtime event carries the server publish time', () => {
    const ts = '2026-09-27T10:00:00.123456Z'
    expect(classifyStreamFrame(JSON.parse(starredFrame(true, ts)))).toEqual({
      kind: 'starred', id: FILE_ID, isStarred: true, at: Date.parse(ts),
    })
    expect(classifyStreamFrame({ type: 'file.starred', data: { id: FILE_ID, is_starred: false } })).toEqual({
      kind: 'starred', id: FILE_ID, isStarred: false,
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

/**
 * PR #115 review (Codex P2): star → unstar, the star's `file.starred` frame
 * delayed past the unstar. The older `true` must not restore the star.
 */
describe('1577: star frame ordering', () => {
  const T0 = '2026-09-27T10:00:00.000000Z'
  const T1 = '2026-09-27T10:00:01.000000Z'
  const T2 = '2026-09-27T10:00:02.000000Z'

  test('star → unstar locally, then the delayed older true frame lands → stays false', () => {
    const { client } = seededClient()
    client.setNodeStarred(FILE_ID, true) // PATCH #1 response
    client.setNodeStarred(FILE_ID, false) // PATCH #2 response
    client.ingestStreamFrame(starredFrame(true, T0)) // PATCH #1 echo, late
    expect(client.getNode(FILE_ID)?.is_starred).toBe(false)
    client.ingestStreamFrame(starredFrame(false, T1)) // PATCH #2 echo
    expect(client.getNode(FILE_ID)?.is_starred).toBe(false)
  })

  test('an older frame arriving after a newer one is dropped (no local writes)', () => {
    const { client } = seededClient()
    client.ingestStreamFrame(starredFrame(true, T0))
    client.ingestStreamFrame(starredFrame(false, T1))
    client.ingestStreamFrame(starredFrame(true, T0)) // reordered duplicate/older publish
    expect(client.getNode(FILE_ID)?.is_starred).toBe(false)
  })

  test('once the own echo is back, another device\'s later toggle still applies', () => {
    const { client } = seededClient()
    client.setNodeStarred(FILE_ID, true)
    client.ingestStreamFrame(starredFrame(true, T0)) // own echo
    client.ingestStreamFrame(starredFrame(false, T1)) // other device unstars
    expect(client.getNode(FILE_ID)?.is_starred).toBe(false)
  })

  test('echo landing BEFORE its PATCH response does not swallow the next foreign toggle', () => {
    const { client } = seededClient()
    client.ingestStreamFrame(starredFrame(true, T0)) // echo first (published pre-response)
    client.setNodeStarred(FILE_ID, true) // then the response
    client.ingestStreamFrame(starredFrame(false, T1)) // other device unstars
    expect(client.getNode(FILE_ID)?.is_starred).toBe(false)
    client.ingestStreamFrame(starredFrame(true, T2))
    expect(client.getNode(FILE_ID)?.is_starred).toBe(true)
  })

  test('a lost echo stops holding frames back after the TTL', () => {
    const realNow = Date.now
    let now = realNow.call(Date)
    Date.now = () => now
    try {
      const { client } = seededClient()
      client.setNodeStarred(FILE_ID, true)
      client.setNodeStarred(FILE_ID, false) // both echoes lost (stream dropped)
      now += 60_000
      client.ingestStreamFrame(starredFrame(true, T2)) // later foreign star
      expect(client.getNode(FILE_ID)?.is_starred).toBe(true)
    } finally {
      Date.now = realNow
    }
  })
})
