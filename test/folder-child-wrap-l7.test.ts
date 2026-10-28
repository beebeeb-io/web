/**
 * Decision L7 (core #45 review, P1 proven red) — PENDING on core #44.
 *
 * Every child key sealed under a shared folder's key (a file key, or a
 * sub-folder's name key) must be bound to WHERE it belongs:
 * AAD = "beebeeb-folder-child-v1" || shared ROOT id (16 B) || item id (16 B) ||
 * kind (0x01 file, 0x02 folder), through core's wrap_folder_child /
 * unwrap_folder_child. Today the web seals with the generic empty-AAD wrap
 * (encryptChildFileKey / wrapKeyForShare), so a server can serve item A's wrap,
 * name and content on item B's row and the client opens it.
 *
 * These cases are `test.todo` until core #44 merges and its WASM is vendored;
 * the follow-up commit that replaces every TODO(core#44-L7) call site turns
 * them into plain tests (and must see them fail first against the unbound
 * seal). The export names below are core #44's; adjust only if it renames them.
 */
import { describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'

const ROOT = '11111111-1111-4111-8111-111111111111'
const ITEM_A = '22222222-2222-4222-8222-222222222222'
const ITEM_B = '33333333-3333-4333-8333-333333333333'
const FILE = 1
const FOLDER = 2

function uuidBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, '')
  return Uint8Array.from({ length: 16 }, (_, i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16))
}

type ChildWrapExports = {
  wrap_folder_child: (folderKey: Uint8Array, rootId: Uint8Array, itemId: Uint8Array, kind: number, childKey: Uint8Array) => Uint8Array
  unwrap_folder_child: (folderKey: Uint8Array, rootId: Uint8Array, itemId: Uint8Array, kind: number, wrapped: Uint8Array) => Uint8Array
}

describe('L7: a folder child wrap opens only on its own row (pending core #44)', () => {
  test.todo("B's row carrying A's wrap must fail to open", () => {
    const core = loadWasm() as unknown as ChildWrapExports
    const folderKey = crypto.getRandomValues(new Uint8Array(32))
    const keyA = crypto.getRandomValues(new Uint8Array(32))
    const wrapA = core.wrap_folder_child(folderKey, uuidBytes(ROOT), uuidBytes(ITEM_A), FILE, keyA)
    // Its own row opens.
    expect(Array.from(core.unwrap_folder_child(folderKey, uuidBytes(ROOT), uuidBytes(ITEM_A), FILE, wrapA))).toEqual(Array.from(keyA))
    // Another row (the server swapped the wraps) does not.
    expect(() => core.unwrap_folder_child(folderKey, uuidBytes(ROOT), uuidBytes(ITEM_B), FILE, wrapA)).toThrow()
  })

  test.todo('a file wrap does not open as a folder wrap, nor under another shared root', () => {
    const core = loadWasm() as unknown as ChildWrapExports
    const folderKey = crypto.getRandomValues(new Uint8Array(32))
    const key = crypto.getRandomValues(new Uint8Array(32))
    const wrap = core.wrap_folder_child(folderKey, uuidBytes(ROOT), uuidBytes(ITEM_A), FILE, key)
    expect(() => core.unwrap_folder_child(folderKey, uuidBytes(ROOT), uuidBytes(ITEM_A), FOLDER, wrap)).toThrow()
    expect(() => core.unwrap_folder_child(folderKey, uuidBytes(ITEM_B), uuidBytes(ITEM_A), FILE, wrap)).toThrow()
  })

  test.todo('the unbound pre-L7 wrap is refused, never opened as a fallback', () => {
    // After the follow-up: decryptChildFileKey's replacement must reject a
    // generic empty-AAD seal of a valid key outright.
    expect(true).toBe(false)
  })
})
