import { describe, expect, test } from 'bun:test'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { createContentOps } from '../src/lib/content-crypto'

// The decrypt path takes the authenticated metadata record (pin + version commitment) that core's
// decrypt_file_metadata returned; a v2 record without a commitment is refused by core.
describe('content readers take the metadata record (pin and version commitment)', () => {
  const w = loadWasm()
  const ops = createContentOps(w)
  const masterKey = new Uint8Array(32).fill(7)
  const fileId = 'file-version-commitment'
  const plaintext = new Uint8Array(150).map((_, i) => i % 251)

  function frames() {
    const enc = w.WasmChunkEncryptor.withChunkSize(masterKey, fileId, BigInt(plaintext.length), BigInt(64))
    const out: Uint8Array[] = []
    for (let off = 0; off < plaintext.length; off += 64) out.push(enc.pushChunk(plaintext.slice(off, off + 64)) as Uint8Array)
    const c = enc.versionCommitment(null) as { versionId: Uint8Array; versionCounter: number }
    enc.finish()
    const hex = Array.from(c.versionId, (b) => b.toString(16).padStart(2, '0')).join('')
    return { out, version: { version_id: hex, version_counter: c.versionCounter } }
  }

  test('sequential and random-access opens work with the commitment', () => {
    const { out, version } = frames()
    const key = w.derive_file_key(masterKey, new TextEncoder().encode(fileId)) as Uint8Array
    const h = ops.createDecryptor(key, fileId, 2, version)
    const got: number[] = []
    for (const f of out) got.push(...ops.decryptorPushFrame(h, f))
    expect(got).toEqual(Array.from(plaintext))
    // a seeking reader over the same record
    const h2 = ops.createDecryptor(key, fileId, 2, version)
    ops.decryptorPushFrame(h2, out[0])
    const r = ops.createChunkReader(h2)
    expect(Array.from(ops.openChunkAt(r, 1, false, out[1]))).toEqual(Array.from(plaintext.slice(64, 128)))
    ops.closeChunkReader(r)
  })

  test('a v2 record without a commitment is refused, and a foreign commitment fails frame 0', () => {
    const { out, version } = frames()
    const key = w.derive_file_key(masterKey, new TextEncoder().encode(fileId)) as Uint8Array
    expect(() => ops.createDecryptor(key, fileId, 2)).toThrow()
    const other = { ...version, version_id: 'ab'.repeat(12) }
    const h = ops.createDecryptor(key, fileId, 2, other)
    expect(() => ops.decryptorPushFrame(h, out[0])).toThrow()
  })
})
