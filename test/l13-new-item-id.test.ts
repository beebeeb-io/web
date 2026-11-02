/**
 * Contract 2275, L13 (folded into this branch by #206) — create ids.
 *
 * T5.1: every create mints its id in core (`NewItemId`) and proposes exactly
 * that id; a guest's or member's create is a FOREIGN (F) id whose file key is
 * still derived from the MEMBER's own master; a tag/id mismatch refuses to
 * resume. Nothing here re-implements the id class or mints ids in JS.
 */
import { describe, expect, test } from 'bun:test'
import { createOwnedItemOps, FOREIGN_ID_VERSION } from '../src/lib/owned-item'
import { loadWasm } from './helpers/wasm-crypto-mirror'

const MASTER = new Uint8Array(32).fill(7)
const wasm = loadWasm()
const ops = createOwnedItemOps(wasm)

describe('L13 create ids come from core', () => {
  test('an owner create is a v4 O id; a guest/member create is an F id', async () => {
    const owner = await ops.mint(MASTER, 'owner')
    const foreign = await ops.mint(MASTER, 'foreign')
    expect(owner.idText[14]).toBe('4')
    expect(await ops.isForeign(owner.idText)).toBe(false)
    expect(foreign.idText[14]).toBe(String(FOREIGN_ID_VERSION))
    expect(await ops.isForeign(foreign.idText)).toBe(true)
    // Canonical lowercase only (L12): core's minted text is the wire text.
    expect(foreign.idText).toBe(foreign.idText.toLowerCase())
    expect(foreign.tag.length).toBe(32)
  })

  test('a minted id resumes from its own text and tag, and only from those', async () => {
    const foreign = await ops.mint(MASTER, 'foreign')
    const resumed = await ops.resume(MASTER, foreign.idText, foreign.tag)
    expect(resumed.idText).toBe(foreign.idText)
    expect(Array.from(resumed.tag)).toEqual(Array.from(foreign.tag))

    // A different id with this tag, or this id with a tampered tag, is refused
    // before any seal (L13: a substituted id cannot be sealed).
    const other = await ops.mint(MASTER, 'foreign')
    expect(() => ops.resume(MASTER, other.idText, foreign.tag)).toThrow()
    const tampered = Uint8Array.from(foreign.tag)
    tampered[0] ^= 1
    expect(() => ops.resume(MASTER, foreign.idText, tampered)).toThrow()
  })

  test('the member file key is derived from the member master under the F id', async () => {
    const foreign = await ops.mint(MASTER, 'foreign')
    const key = wasm.derive_file_key(MASTER, foreign.idText, undefined) as Uint8Array
    expect(key.length).toBe(32)
    // The same derivation core's forNewItem uses for a new row.
    const enc = wasm.WasmChunkEncryptor.forNewItem(
      wasm.resumeNewItemId(MASTER, foreign.idText, foreign.tag),
      16n,
      'web',
    )
    expect(enc.format).toBeGreaterThanOrEqual(1)
    enc.free()
  })

  test("the id class is core's answer, never the id text in JS", async () => {
    expect(() => ops.isForeign('not-a-uuid')).toThrow()
    expect(await ops.isForeign('22222222-2222-4222-8222-222222222222')).toBe(false)
    expect(await ops.isForeign('22222222-2222-8222-8222-222222222222')).toBe(true)
  })
})
