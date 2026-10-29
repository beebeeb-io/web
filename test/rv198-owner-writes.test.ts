/**
 * rv-web198c P2-4 and P2-5: owner writes inside a shared folder.
 *
 *  P2-4  renaming a row a guest or member added must seal the new name under
 *        THAT row's key, proven to open its current name, or be refused: it
 *        used to seal under the owner's derived key and destroy the name for
 *        everyone.
 *  P2-5  moving (or copying, which the drive treats as a move) an item into a
 *        custody folder publishes the wrap of every item moved in, a moved
 *        folder's subtree included, as an upload does; with the flag off
 *        nothing shared-folder is asked at all.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { ownedFolderCrypto } from './helpers/owned-folder-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'

const wasm = loadWasm()
const encoder = new TextEncoder()
const MASTER = new Uint8Array(32).fill(7)
const ROOT = '11111111-1111-4111-8111-111111111111'
const DEST = '77777777-7777-4777-8777-777777777777'
const MOVED_FILE = '22222222-2222-4222-8222-222222222222'
const MOVED_FOLDER = '33333333-3333-4333-8333-333333333333'
const CHILD_OWN = '44444444-4444-4444-8444-444444444444'
const CHILD_MEMBER = '55555555-5555-4555-8555-555555555555'
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)
const VIEWER = 'owner-user'

let flagOn = true
let publishFails = false
const moved: Array<{ id: string; parent: string | null }> = []
const published: Array<{ root: string; keys: { file_id: string; encrypted_file_key: string }[] }> = []
let requests = 0

await mockModuleScoped('../src/lib/use-feature-flag', import.meta.dir, (r) => ({
  ...r,
  sharedFoldersEnabled: async () => flagOn,
  sharedFoldersEnabledForWrite: async () => flagOn,
}))
const real = await mockModuleScoped('../src/lib/crypto', import.meta.dir, (r) => ({
  ...r,
  ...ownedFolderCrypto(),
  deriveFileKey: async (m: Uint8Array, id: string) => wasm.derive_file_key(m, encoder.encode(id)),
}))
await mockModuleScoped('../src/lib/api', import.meta.dir, () => ({
  updateFile: async (id: string, body: { parent_id?: string | null }) => {
    moved.push({ id, parent: body.parent_id ?? null })
    return { id }
  },
  getSharedFolder: async (folderId: string) => {
    requests += 1
    if (folderId !== ROOT) throw Object.assign(new Error('not found'), { status: 404 })
    return {
      folder_id: ROOT, role: 'owner', access_level: 'edit', key_version: 1,
      owner_wrapped_folder_key: real.toBase64(wasm.wrapFolderCustody(MASTER, ROOT, FOLDER_KEY) as Uint8Array),
      wrapped_folder_key: null,
    }
  },
  getFile: async (id: string) => {
    requests += 1
    return { id, parent_id: id === DEST ? ROOT : null }
  },
  getSentInvites: async () => {
    requests += 1
    return []
  },
  listFilesPage: async (opts: { parentId?: string }) => {
    requests += 1
    if (opts.parentId === MOVED_FOLDER) {
      return {
        files: [
          { id: CHILD_OWN, is_folder: false, uploaded_by: null, acted_via_share_id: null },
          { id: CHILD_MEMBER, is_folder: false, uploaded_by: 'member-user', acted_via_share_id: null },
        ],
        next_cursor: null,
      }
    }
    return { files: [], next_cursor: null }
  },
  publishSharedFolderKeys: async (root: string, keys: { file_id: string; encrypted_file_key: string }[]) => {
    requests += 1
    if (publishFails) throw Object.assign(new Error('boom'), { status: 500 })
    published.push({ root, keys })
    return { written: keys.length, skipped: 0 }
  },
}))

const { moveOwnerItems, MOVED_BUT_UNPUBLISHED } = await import('../src/lib/owner-upload-key')
const { renameKeyFor, RENAME_KEY_UNAVAILABLE } = await import('../src/lib/owner-rename')
const { clearSharedFolderLookups } = await import('../src/lib/owner-adoption')
const { resetCustodyMemoryForTests } = await import('../src/lib/custody-memory')

beforeEach(() => {
  flagOn = true
  publishFails = false
  moved.length = 0
  published.length = 0
  requests = 0
  clearSharedFolderLookups()
  resetCustodyMemoryForTests()
})

const rows = [
  { id: MOVED_FILE, is_folder: false, uploaded_by: null, acted_via_share_id: null },
  { id: MOVED_FOLDER, is_folder: true, uploaded_by: null, acted_via_share_id: null },
]

describe('P2-5: a move into a custody folder publishes its wraps', () => {
  test('the moved file, the moved folder and its own child get L7 wraps; a member-added child is never re-sealed', async () => {
    await moveOwnerItems({ ids: [MOVED_FILE, MOVED_FOLDER], destinationId: DEST, rows, masterKey: MASTER, viewerId: VIEWER })
    expect(moved.map((m) => m.parent)).toEqual([DEST, DEST])
    const keys = published.flatMap((p) => p.keys)
    expect(published.every((p) => p.root === ROOT)).toBe(true)
    expect(keys.map((k) => k.file_id).sort()).toEqual([CHILD_OWN, MOVED_FILE, MOVED_FOLDER].sort())
    for (const { file_id, encrypted_file_key } of keys) {
      const kind = file_id === MOVED_FOLDER ? 2 : 1
      const opened = wasm.unwrapFolderChild(FOLDER_KEY, ROOT, file_id, kind, real.fromBase64(encrypted_file_key) as Uint8Array) as Uint8Array
      expect(Array.from(opened)).toEqual(Array.from(wasm.derive_file_key(MASTER, encoder.encode(file_id)) as Uint8Array))
    }
  })

  test('an id the caller did not list is treated as someone else\'s: moved, never sealed', async () => {
    await moveOwnerItems({ ids: [MOVED_FILE], destinationId: DEST, rows: [], masterKey: MASTER, viewerId: VIEWER })
    expect(moved).toHaveLength(1)
    expect(published.flatMap((p) => p.keys)).toHaveLength(0)
  })

  test('with the flag off a move asks nothing shared-folder', async () => {
    flagOn = false
    await moveOwnerItems({ ids: [MOVED_FILE, MOVED_FOLDER], destinationId: DEST, rows, masterKey: MASTER, viewerId: VIEWER })
    expect(moved).toHaveLength(2)
    expect(requests).toBe(0)
  })

  test('a publish that fails after the move says so plainly (the move itself stands)', async () => {
    publishFails = true
    await expect(
      moveOwnerItems({ ids: [MOVED_FILE], destinationId: DEST, rows, masterKey: MASTER, viewerId: VIEWER }),
    ).rejects.toThrow(MOVED_BUT_UNPUBLISHED)
    expect(moved).toHaveLength(1)
  })

  test('every move in src/ goes through moveOwnerItems', () => {
    const root = join(import.meta.dir, '..')
    const sources = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) return sources(path)
        return /\.(ts|tsx)$/.test(name) ? [path] : []
      })
    const offenders: string[] = []
    for (const file of sources(join(root, 'src'))) {
      const relative = file.slice(root.length + 1)
      if (relative === 'src/lib/owner-upload-key.ts' || relative === 'src/lib/api.ts') continue
      readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
        if (/updateFile\([^)]*parent_id:/.test(line)) offenders.push(`${relative}:${index + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

describe("P2-4: renaming a guest's or member's row seals under ITS key or not at all", () => {
  const guestRow = { id: MOVED_FILE, name_encrypted: 'NAME', acted_via_share_id: 'share', uploaded_by: null } as never
  const ownRow = { id: MOVED_FILE, name_encrypted: 'NAME', acted_via_share_id: null, uploaded_by: null } as never
  const derived = new Uint8Array(32).fill(1)
  const shared = new Uint8Array(32).fill(2)

  test('a guest row: the shared-path key that opens its current name', async () => {
    const key = await renameKeyFor({
      fileId: MOVED_FILE, file: guestRow, viewerId: VIEWER,
      getFileKey: async () => new Uint8Array(derived),
      getFileKeyForFile: async () => new Uint8Array(shared),
      readName: async (k) => {
        if (k[0] !== 2) throw new Error('does not open')
      },
    })
    expect(Array.from(key)).toEqual(Array.from(shared))
  })

  test('a guest row whose resolved key does NOT open its name is refused, never sealed under the derived key', async () => {
    const fallen = new Uint8Array(derived) // the shared path fell through to the derived key
    await expect(
      renameKeyFor({
        fileId: MOVED_FILE, file: guestRow, viewerId: VIEWER,
        getFileKey: async () => new Uint8Array(derived),
        getFileKeyForFile: async () => fallen,
        readName: async () => {
          throw new Error('does not open')
        },
      }),
    ).rejects.toThrow(RENAME_KEY_UNAVAILABLE)
    expect(Array.from(fallen).every((b) => b === 0)).toBe(true) // zeroized
  })

  test("the owner's own row keeps its derived key", async () => {
    const key = await renameKeyFor({
      fileId: MOVED_FILE, file: ownRow, viewerId: VIEWER,
      getFileKey: async () => new Uint8Array(derived),
      getFileKeyForFile: async () => {
        throw new Error('not used for an own row')
      },
      readName: async () => undefined,
    })
    expect(Array.from(key)).toEqual(Array.from(derived))
  })

  test('without a viewer id, a member-added row (uploaded_by set) is still verified', async () => {
    const memberRow = { id: MOVED_FILE, name_encrypted: 'NAME', acted_via_share_id: null, uploaded_by: 'member-user' } as never
    await expect(
      renameKeyFor({
        fileId: MOVED_FILE, file: memberRow, viewerId: null,
        getFileKey: async () => new Uint8Array(derived),
        getFileKeyForFile: async () => new Uint8Array(derived),
        readName: async () => {
          throw new Error('does not open')
        },
      }),
    ).rejects.toThrow(RENAME_KEY_UNAVAILABLE)
  })
})
