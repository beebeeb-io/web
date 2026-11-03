/**
 * Review F10 (P3) — the opened folder key is zeroized right after its one use.
 *
 * The Share panel used to keep R's custody key in React state for the life of
 * the panel. It now opens the key around one callback; this file proves the
 * bytes are gone when the callback returns (and when it throws), and that the
 * panel no longer holds a key in state.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { mockModuleScoped } from './helpers/scoped-module-mock'

const MASTER = new Uint8Array(32).fill(7)
const FOLDER_KEY = new Uint8Array(32).fill(0x5a)

let custody: { owner_wrapped_folder_key: string | null; role: string } | null = null
let openedFor: string[] = []

await mockModuleScoped('../src/lib/api', import.meta.dir, (real) => ({
  ...real,
  getSharedFolder: async () => {
    if (!custody) throw new Error('not found')
    return custody
  },
}))

await mockModuleScoped('../src/lib/folder-share-crypto', import.meta.dir, (real) => ({
  ...real,
  // The real custody open crosses to the worker; the key's bytes are what this
  // suite checks, not its derivation.
  openFolderCustody: async (_masterKey: Uint8Array, folderId: string) => {
    openedFor.push(folderId)
    return Uint8Array.from(FOLDER_KEY)
  },
}))

const { withOwnerFolderKey } = await import('../src/lib/folder-share-key-scope')

function allZero(key: Uint8Array): boolean {
  return key.every((byte) => byte === 0)
}

describe('F10: a folder key opened for one use is zeroized after it', () => {
  test('the callback sees the key, and it is zeroed when the callback returns', async () => {
    custody = { owner_wrapped_folder_key: btoa(String.fromCharCode(...new Uint8Array(48))), role: 'owner' }
    openedFor = []
    let seen: Uint8Array | null = null
    const result = await withOwnerFolderKey({ folderId: 'folder-1', masterKey: MASTER }, async (folderKey) => {
      seen = folderKey
      expect(Array.from(folderKey)).toEqual(Array.from(FOLDER_KEY))
      return 'done'
    })
    expect(result).toBe('done')
    expect(openedFor).toEqual(['folder-1'])
    expect(seen).not.toBeNull()
    expect(allZero(seen!)).toBe(true)
  })

  test('a callback that throws still leaves zeroed bytes behind', async () => {
    custody = { owner_wrapped_folder_key: btoa(String.fromCharCode(...new Uint8Array(48))), role: 'owner' }
    let seen: Uint8Array | null = null
    await expect(
      withOwnerFolderKey({ folderId: 'folder-2', masterKey: MASTER }, async (folderKey) => {
        seen = folderKey
        throw new Error('publish failed')
      }),
    ).rejects.toThrow('publish failed')
    expect(allZero(seen!)).toBe(true)
  })

  test('a member view opens nothing and calls the callback with no key', async () => {
    custody = { owner_wrapped_folder_key: null, role: 'member' }
    let called = false
    const result = await withOwnerFolderKey({ folderId: 'folder-3', masterKey: MASTER }, async () => {
      called = true
      return 'never'
    })
    expect(result).toBeNull()
    expect(called).toBe(false)
  })

  test('the panel holds no folder key in state: it scopes one per use', () => {
    const panel = readFileSync(join(import.meta.dir, '..', 'src/components/folder-share/folder-share-panel.tsx'), 'utf8')
    expect(panel).toContain('withOwnerFolderKey(')
    expect(panel).not.toContain('setFolderKey(')
  })
})
