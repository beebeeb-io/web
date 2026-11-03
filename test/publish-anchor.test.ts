/**
 * Task 2275 L15 option A (spec §14 amendment): web publishes from an in-tab
 * click trail only, and defers otherwise. Each test names the A row it covers.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import {
  PUBLISH_QUEUE_KEY,
  PUBLISH_QUEUE_TTL_MS,
  canPublishAnchored,
  deferPublish,
  dropDeferredForItems,
  noteFolderClick,
  noteUrlFolder,
  readDeferredPublishes,
  resetAnchorsForTests,
  type DeferredPublish,
} from '../src/lib/publish-anchor'

class MemoryStore {
  private readonly map = new Map<string, string>()
  getItem(key: string): string | null {
    return this.map.get(key) ?? null
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value)
  }
}

const ROOT = '11111111-1111-4111-8111-111111111111'
const FOLDER = '22222222-2222-4222-8222-222222222222'
const ELSEWHERE = '33333333-3333-4333-8333-333333333333'
const ITEM = '44444444-4444-8444-8444-444444444444'

beforeEach(() => resetAnchorsForTests())

describe('anchored publishes (L15/§14)', () => {
  test('A14: a folder the user clicked through in this tab anchors', () => {
    noteFolderClick(ROOT)
    noteFolderClick(FOLDER)
    noteUrlFolder(FOLDER)
    expect(canPublishAnchored(FOLDER, ROOT)).toBe(true)
    // R is on the path, but the path ends at the destination; a create into R
    // itself is not anchored by an earlier visit that has since been left.
    expect(canPublishAnchored(ROOT, ROOT)).toBe(false)
  })

  test('A17i: a navigation that is not a child click resets the path', () => {
    // The user clicked into R, then left it for somewhere else, then clicked
    // into a decoy folder. R is in the tab's history but no longer on the
    // current path, so it cannot anchor the decoy create.
    noteFolderClick(ROOT)
    noteUrlFolder(ROOT)
    noteUrlFolder(ELSEWHERE)
    noteFolderClick(ELSEWHERE)
    noteUrlFolder(ELSEWHERE)
    noteFolderClick(FOLDER)
    noteUrlFolder(FOLDER)
    expect(canPublishAnchored(FOLDER, ROOT)).toBe(false)
  })

  test('A13/A17e: a deep link or ?folder= the user never clicked does not anchor', () => {
    // The app opened straight into the folder: the URL knows it, the trail does not.
    noteUrlFolder(FOLDER)
    expect(canPublishAnchored(FOLDER, ROOT)).toBe(false)
    // A trail rebuilt from the server's parent walk looks the same as this: no
    // click was recorded, so nothing anchors.
  })

  test('A17i: My files in the URL is not a settled navigation into the last folder', () => {
    noteFolderClick(ROOT)
    noteUrlFolder(ROOT)
    noteUrlFolder(null)
    expect(canPublishAnchored(ROOT, ROOT)).toBe(false)
  })

  test('A17e: nothing anchors while a navigation is in flight', () => {
    noteFolderClick(ROOT)
    noteFolderClick(FOLDER)
    // The user clicked, then navigated elsewhere before the create landed.
    noteUrlFolder(ELSEWHERE)
    expect(canPublishAnchored(FOLDER, ROOT)).toBe(false)
    noteUrlFolder(FOLDER)
    expect(canPublishAnchored(FOLDER, ROOT)).toBe(true)
  })

  test('A15/A16: a create for a server-reported parent never anchors by itself', () => {
    // A remote move or an existing-row save names the root as its parent, but
    // this tab never clicked it, so there is no anchor.
    noteUrlFolder(ROOT)
    expect(canPublishAnchored(ROOT, ROOT)).toBe(false)
  })
})

describe('deferrals (L15)', () => {
  const row = (over: Partial<DeferredPublish> = {}): DeferredPublish => ({
    id: ITEM,
    parentId: FOLDER,
    rootId: ROOT,
    at: Date.now(),
    own: true,
    ...over,
  })

  test('A17j: pre-L15 queue rows (no pinned root) are dropped on hydrate', () => {
    const store = new MemoryStore()
    store.setItem(
      PUBLISH_QUEUE_KEY,
      JSON.stringify([
        { id: ITEM, parentId: FOLDER, rootId: null, at: Date.now(), own: true },
        { id: '55555555-5555-8555-8555-555555555555', parentId: FOLDER }, // pre-L15 shape
        row(),
      ]),
    )
    expect(readDeferredPublishes(store).map((r) => r.id)).toEqual([ITEM])
  })

  test('rows older than 7 days are dropped; a fresh one stays', () => {
    const store = new MemoryStore()
    const now = 1_000_000_000_000
    store.setItem(
      PUBLISH_QUEUE_KEY,
      JSON.stringify([row({ at: now - PUBLISH_QUEUE_TTL_MS - 1 }), row({ id: '55555555-5555-8555-5555-555555555555', at: now })]),
    )
    expect(readDeferredPublishes(store, now).map((r) => r.id)).toEqual(['55555555-5555-8555-5555-555555555555'])
  })

  test('A18: an item this client moved or trashed loses its deferral', () => {
    const store = new MemoryStore()
    deferPublish(store, row())
    deferPublish(store, row({ id: '55555555-5555-8555-5555-555555555555' }))
    dropDeferredForItems(store, [ITEM])
    const live = readDeferredPublishes(store).map((r) => r.id)
    expect(live.length).toBe(1)
    expect(live[0]).toBe('55555555-5555-8555-5555-555555555555')
  })
})

describe('the upload sink has no publish hook (L15)', () => {
  test('encrypted-upload.ts does not import or call the owner publish path', () => {
    const src = readFileSync(new URL('../src/lib/encrypted-upload.ts', import.meta.url), 'utf8')
    expect(src).not.toContain('publishOwnerUploadKey')
    expect(src).not.toContain('publishOrDeferOwnerUpload')
  })
})
