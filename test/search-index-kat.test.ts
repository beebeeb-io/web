import { describe, expect, test, beforeAll } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { webcrypto } from 'node:crypto'
import { initSync, WasmSearchIndex } from 'beebeeb-wasm'

// ─── Cross-client search-index KAT (B4, task 0871) ─────────────────────────
//
// THE contract this whole migration rides on: web, mobile, and core must derive
// BYTE-IDENTICAL per-bucket shard keys, so a vault's encrypted search index
// follows the user across devices. All three route through core
// `kdf::derive_search_index_key` (HKDF-SHA256, label `beebeeb-search-index-
// shard-v1`, bucket as LE u32). The pinned vectors live at
// `repos/core/beebeeb-core/src/kdf.rs` (`search_index_key_known_answer_vectors`).
//
// We prove equality two ways:
//  (1) Reproduce the HKDF derivation in JS (WebCrypto) and assert it matches the
//      3 pinned hex vectors for buckets 0 / 7 / 63 — the derivation contract.
//  (2) Build a real `WasmSearchIndex` with the KAT master key, `encryptShards`,
//      and DECRYPT each produced shard blob under the JS-derived KAT key for its
//      bucket. A successful AES-256-GCM open proves the WASM/core shard key ==
//      the KAT key == mobile's key — byte-for-byte. If core ever drifts, the
//      decrypt fails (wrong key → AEAD auth error) and this test goes red.
//
// The crypto.ts wrappers funnel through a Comlink worker that uses Vite-only
// `?url` imports — not loadable under `bun test` — so (like transfer-crypto.
// test.ts) this drives the committed WASM directly via initSync.

const subtle = webcrypto.subtle

// Master key: 32 bytes all 0x01 (matches core KAT_MASTER_KEY).
const KAT_MASTER_KEY = new Uint8Array(32).fill(0x01)

// The pinned per-bucket HKDF outputs (lowercase hex) from kdf.rs.
const KAT_VECTORS: Record<number, string> = {
  0: '08c1676ae10ef9b8cfb4993db59bb7f899885b9364e54c466e80b4ca1047c364',
  7: '352c86bacad05a8e681ae66080c1b79b304c5e8451672dc9a62f85ee2a29b920',
  63: 'd1e0ac588ec8a495e527f9b80364bbac628f97dc782d08cde4897603dddd1e27',
}

const DEFAULT_NUM_SHARDS = 64

beforeAll(() => {
  const wasmPath = fileURLToPath(
    new URL('../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url),
  )
  initSync({ module: readFileSync(wasmPath) })
})

/** Reproduce core `derive_search_index_key(master_key, bucket)` in WebCrypto. */
async function deriveShardKeyBytes(masterKey: Uint8Array, bucket: number): Promise<Uint8Array> {
  const base = await subtle.importKey('raw', masterKey, 'HKDF', false, ['deriveBits'])
  const label = new TextEncoder().encode('beebeeb-search-index-shard-v1')
  const bucketLe = new Uint8Array(4)
  new DataView(bucketLe.buffer).setUint32(0, bucket, true) // little-endian u32
  const info = new Uint8Array(label.length + 4)
  info.set(label, 0)
  info.set(bucketLe, label.length)
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info },
    base,
    256,
  )
  return new Uint8Array(bits)
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface EncryptedShard {
  bucket: number
  page: number
  blob: Uint8Array
}

describe('search-index cross-client KAT (web == core == mobile)', () => {
  test('(1) JS HKDF reproduces the 3 pinned shard-key vectors exactly', async () => {
    for (const [bucketStr, expectedHex] of Object.entries(KAT_VECTORS)) {
      const bucket = Number(bucketStr)
      const key = await deriveShardKeyBytes(KAT_MASTER_KEY, bucket)
      expect(key.length).toBe(32)
      expect(toHex(key)).toBe(expectedHex)
    }
  })

  test('(2) a WASM-encrypted shard decrypts ONLY under the KAT-derived shard key', async () => {
    // Build an index with enough distinct entries that the 64-bucket hash spread
    // very likely populates buckets 0, 7 and 63. We then verify EVERY produced
    // shard against its KAT-or-derived key — and assert at least one of the
    // pinned KAT buckets was actually exercised.
    const files: Array<{ fileId: string; name: string }> = []
    for (let i = 0; i < 600; i++) {
      files.push({ fileId: `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`, name: `report-${i}-café` })
    }
    const index = WasmSearchIndex.build(files, DEFAULT_NUM_SHARDS)
    const shards = index.encryptShards(KAT_MASTER_KEY) as EncryptedShard[]
    expect(shards.length).toBeGreaterThan(0)

    let verifiedAnyKatBucket = false
    for (const shard of shards) {
      // Blob wire format = nonce(12) || ciphertext || tag(16). Decrypt under the
      // shard key derived in JS for this bucket — a successful open proves the
      // WASM/core per-bucket key matches the KAT derivation byte-for-byte.
      const keyBytes = await deriveShardKeyBytes(KAT_MASTER_KEY, shard.bucket)
      const key = await subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
      const nonce = shard.blob.slice(0, 12)
      const ciphertext = shard.blob.slice(12)
      // Throws (OperationError) if the key is wrong → this assert fails loudly.
      const plaintext = await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext)
      expect(plaintext.byteLength).toBeGreaterThan(0)

      if (shard.bucket in KAT_VECTORS) {
        // Belt-and-suspenders: the key we just decrypted under IS the pinned KAT
        // value for this bucket.
        expect(toHex(keyBytes)).toBe(KAT_VECTORS[shard.bucket])
        verifiedAnyKatBucket = true
      }
    }

    expect(verifiedAnyKatBucket).toBe(true)
    index.free()
  })

  test('(2b) a shard does NOT decrypt under the WRONG bucket key (AEAD authenticity)', async () => {
    const index = WasmSearchIndex.build(
      [{ fileId: '11111111-1111-1111-1111-111111111111', name: 'invoice-final.pdf' }],
      DEFAULT_NUM_SHARDS,
    )
    const shards = index.encryptShards(KAT_MASTER_KEY) as EncryptedShard[]
    expect(shards.length).toBeGreaterThan(0)
    const shard = shards[0]

    // Derive a DIFFERENT bucket's key (shard.bucket + 1, wrapped) → wrong key.
    const wrongBucket = (shard.bucket + 1) % DEFAULT_NUM_SHARDS
    const wrongKeyBytes = await deriveShardKeyBytes(KAT_MASTER_KEY, wrongBucket)
    const wrongKey = await subtle.importKey('raw', wrongKeyBytes, 'AES-GCM', false, ['decrypt'])
    const nonce = shard.blob.slice(0, 12)
    const ciphertext = shard.blob.slice(12)

    await expect(
      subtle.decrypt({ name: 'AES-GCM', iv: nonce }, wrongKey, ciphertext),
    ).rejects.toThrow()
    index.free()
  })
})
