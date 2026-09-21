import { describe, expect, test, beforeAll } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  initSync,
  derive_master_key,
  derive_file_key,
  encrypt_chunk,
  decrypt_chunk,
  derive_x25519_private,
  derive_x25519_public,
  x25519_shared_secret,
  derive_share_key,
  compute_recovery_check,
  recover_from_phrase,
  decrypt_metadata,
  derive_request_wrap_key,
  unwrap_request_private,
  open_request_upload,
} from 'beebeeb-wasm'
import { unwrapKeyFromShare } from '../src/lib/crypto'
import { decryptThumbnailBlob } from '../src/lib/thumbnail'

// ─── Cross-client core-vectors KAT (audit item K2, task 1382) ──────────────
//
// This file is the CI gate that closes K2: web must consume core's shared
// cross-platform test-vector file (repos/core/test-vectors/vectors.json),
// not hand-pin its own hex constants (that was the K3/task 1383 stopgap —
// see the "cross-reference" notes below for how the two hand-pinned files
// relate to this one).
//
// ── Vendoring + refresh procedure ───────────────────────────────────────────
// The vendored copy lives at test/vectors/core-vectors.v4.json and MUST be a
// byte-for-byte copy of repos/core/test-vectors/vectors.json (so the drift
// check below is a real sha256 comparison, not a comparison against a
// modified copy). To refresh after core bumps the vector file:
//   1. cp ../core/test-vectors/vectors.json test/vectors/core-vectors.v<N>.json
//      (rename this test file's import path / vendored filename to match the
//      new version if the version number changed)
//   2. shasum -a 256 test/vectors/core-vectors.v<N>.json
//   3. Paste the new hash into PINNED_SHA256 below.
//   4. Update EXPECTED_VERSION and re-run family coverage below — a version
//      bump usually adds/renames vector families, which the "every family is
//      implemented or explicitly skipped" test will catch (it fails loudly on
//      any unrecognized name).
//
// ── Why some families call the WASM binding directly instead of crypto.ts ──
// web's production callers for most families (deriveKeys, deriveFileKey,
// encryptChunk/decryptChunk, encryptFilename/decryptFilename,
// recoverFromPhrase, deriveX25519Public/Private, computeRecoveryCheck,
// x25519SharedSecret, deriveShareKey, wrapRequestPrivate/unwrapRequestPrivate,
// sealToRequest/openRequestUpload — all in src/lib/crypto.ts) funnel through
// `withProxy()` → a Comlink Web Worker (src/workers/crypto.worker.ts) that
// imports the wasm binary via a Vite-only `?url` suffix and reads
// `import.meta.env.PROD` — neither resolves under `bun test` (no Vite
// pipeline). This is the SAME limitation documented in
// test/search-index-kat.test.ts and test/transfer-crypto.test.ts, which
// already established the precedent of driving the committed WASM build
// directly via `initSync` instead. Every crypto.worker.ts method for the
// families below is a THIN 1:1 pass-through with no extra logic beyond
// argument marshaling (confirmed by reading src/workers/crypto.worker.ts —
// e.g. `deriveKeys` is exactly `wasm.derive_master_key(password, salt).key`,
// `file_request` methods are explicitly commented "Thin pass-throughs ...
// No crypto is implemented here"). So calling the WASM export directly
// exercises byte-for-byte the same code the worker would run — it is the
// "WASM binding" production path the task brief explicitly allows, cited
// per-family below at the crypto.ts line that is the real (worker-proxied)
// caller.
//
// share_key_wrap and thumbnail_encrypt are different: wrapKeyForShare /
// unwrapKeyFromShare (crypto.ts) and encryptThumbnailBlob / decryptThumbnailBlob
// (thumbnail.ts) run entirely on the main thread via crypto.subtle — they
// never touch the worker — so those ARE called directly, exactly as the app
// calls them.

const VENDORED_PATH = fileURLToPath(new URL('./vectors/core-vectors.v4.json', import.meta.url))
// Sibling core checkout (present on developer machines / worktrees that keep
// `core` next to `web`; absent in a bare CI checkout of web alone).
const CORE_SIBLING_PATH = fileURLToPath(new URL('../../core/test-vectors/vectors.json', import.meta.url))

// Pin from: shasum -a 256 test/vectors/core-vectors.v4.json
const PINNED_SHA256 = 'a8f5320a0dbd06fa3a26ede7109f3c24295197061f13f81519c010b30157f6e5'
const EXPECTED_VERSION = 4

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Vector = Record<string, any>
let vectors: Record<string, Vector>

beforeAll(() => {
  const wasmPath = fileURLToPath(
    new URL('../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url),
  )
  initSync({ module: readFileSync(wasmPath) })

  const root = JSON.parse(readFileSync(VENDORED_PATH, 'utf8')) as { version: number; vectors: Vector[] }
  vectors = Object.fromEntries(root.vectors.map((v) => [v.name as string, v]))
})

// ─── 1. Vendored-file checksum guard ────────────────────────────────────────

describe('vendored vector checksum guard', () => {
  test('test/vectors/core-vectors.v4.json matches the pinned sha256', () => {
    const buf = readFileSync(VENDORED_PATH)
    expect(sha256Hex(buf)).toBe(PINNED_SHA256)
  })

  test('vendored copy matches ../core/test-vectors/vectors.json when the sibling repo is present (dev machines / worktrees)', () => {
    if (!existsSync(CORE_SIBLING_PATH)) {
      // Expected on a bare CI checkout of web alone — the pinned-hash test
      // above is the real gate there.
      return
    }
    const vendoredBuf = readFileSync(VENDORED_PATH)
    const coreBuf = readFileSync(CORE_SIBLING_PATH)
    expect(sha256Hex(vendoredBuf)).toBe(sha256Hex(coreBuf))
  })

  test('vendored file version matches EXPECTED_VERSION', () => {
    const root = JSON.parse(readFileSync(VENDORED_PATH, 'utf8')) as { version: number }
    expect(root.version).toBe(EXPECTED_VERSION)
  })
})

// ─── 2. Family coverage — every family in vectors.json, implemented or skipped ─

const IMPLEMENTED_FAMILIES = new Set([
  'master_key_from_password',
  'file_key_derivation',
  'chunk_encrypt_decrypt',
  'x25519_identity_keypair',
  'x25519_share_key_exchange',
  'recovery_check',
  'recovery_phrase_roundtrip',
  'metadata_encrypt_decrypt',
  'file_request_seal_open',
  'share_key_wrap',
  'thumbnail_encrypt',
])

const SKIPPED_FAMILIES: Record<string, string> = {
  envelope_serialization:
    'not implemented client-side in web: repos/core/beebeeb-wasm/src/lib.rs exposes no ' +
    'OpaqueEnvelope::to_bytes/from_bytes WASM binding (checked the full export list — only ' +
    'opaque_registration_start/finish and opaque_login_start/finish are exposed, none return or ' +
    'accept a raw 96-byte envelope). The envelope type is core/server-internal ' +
    '(repos/core/beebeeb-core/src/opaque.rs:8) — web never constructs or parses one.',
}

describe('vendored vector family coverage', () => {
  test('every family in the vendored file is implemented or explicitly skipped with a reason', () => {
    const allNames = Object.keys(vectors)
    expect(allNames.length).toBeGreaterThan(0)

    for (const name of allNames) {
      const implemented = IMPLEMENTED_FAMILIES.has(name)
      const skipped = name in SKIPPED_FAMILIES
      if (!implemented && !skipped) {
        throw new Error(
          `vector family '${name}' is neither implemented nor explicitly skipped in ` +
            'test/core-vectors-kat.test.ts — add coverage or add it to SKIPPED_FAMILIES with a reason',
        )
      }
      if (skipped) {
        // eslint-disable-next-line no-console
        console.warn(`SKIP family=${name}: ${SKIPPED_FAMILIES[name]}`)
      }
    }

    // Catch stale entries pointing at families that no longer exist.
    for (const name of IMPLEMENTED_FAMILIES) {
      expect(allNames).toContain(name)
    }
    for (const name of Object.keys(SKIPPED_FAMILIES)) {
      expect(allNames).toContain(name)
    }
  })
})

// ─── 3. Per-family KATs — production code path, byte equality ──────────────

describe('core vectors KAT (production code paths)', () => {
  test('master_key_from_password — deriveKeys (src/lib/crypto.ts:211) via WASM derive_master_key', () => {
    const v = vectors.master_key_from_password
    const salt = hexToBytes(v.salt_hex)
    const result = derive_master_key(v.password as string, salt) as { key: Uint8Array }
    expect(toHex(result.key)).toBe(v.expected_master_key_hex)
  })

  test('file_key_derivation — deriveFileKey (src/lib/crypto.ts:220) via WASM derive_file_key', () => {
    const v = vectors.file_key_derivation
    const masterKey = hexToBytes(v.master_key_hex)
    const fileId = hexToBytes(v.file_id_hex)
    const fileKey = derive_file_key(masterKey, fileId) as Uint8Array
    expect(toHex(fileKey)).toBe(v.expected_file_key_hex)
  })

  test('chunk_encrypt_decrypt — decryptChunk (src/lib/crypto.ts:247) via WASM decrypt_chunk', () => {
    const v = vectors.chunk_encrypt_decrypt
    const fileKey = hexToBytes(v.file_key_hex)
    const nonce = hexToBytes(v.nonce_hex)
    const ciphertext = hexToBytes(v.ciphertext_hex)
    const decrypted = decrypt_chunk(fileKey, nonce, ciphertext) as Uint8Array
    expect(toHex(decrypted)).toBe(v.plaintext_hex)
  })

  test('chunk_encrypt_decrypt roundtrip — encryptChunk -> decryptChunk (src/lib/crypto.ts:235,247)', () => {
    const v = vectors.chunk_encrypt_decrypt
    const fileKey = hexToBytes(v.file_key_hex)
    const plaintext = hexToBytes(v.plaintext_hex)
    const enc = encrypt_chunk(fileKey, plaintext) as { nonce: Uint8Array; ciphertext: Uint8Array }
    const decrypted = decrypt_chunk(fileKey, enc.nonce, enc.ciphertext) as Uint8Array
    expect(toHex(decrypted)).toBe(v.plaintext_hex)
  })

  test('x25519_identity_keypair — deriveX25519Private/deriveX25519Public (src/lib/crypto.ts:401,410)', () => {
    const v = vectors.x25519_identity_keypair
    const masterKey = hexToBytes(v.master_key_hex)
    const priv = derive_x25519_private(masterKey) as Uint8Array
    expect(toHex(priv)).toBe(v.expected_x25519_private_hex)
    const pub = derive_x25519_public(priv) as Uint8Array
    expect(toHex(pub)).toBe(v.expected_x25519_public_hex)
  })

  test('x25519_share_key_exchange — x25519SharedSecret + deriveShareKey (src/lib/crypto.ts:415,423)', () => {
    const v = vectors.x25519_share_key_exchange
    const mkA = hexToBytes(v.alice_master_key_hex)
    const mkB = hexToBytes(v.bob_master_key_hex)
    const fileId = hexToBytes(v.file_id_hex)

    const privA = derive_x25519_private(mkA) as Uint8Array
    const pubA = derive_x25519_public(privA) as Uint8Array
    const privB = derive_x25519_private(mkB) as Uint8Array
    const pubB = derive_x25519_public(privB) as Uint8Array
    expect(toHex(pubA)).toBe(v.alice_x25519_public_hex)
    expect(toHex(pubB)).toBe(v.bob_x25519_public_hex)

    const sharedAB = x25519_shared_secret(privA, pubB) as Uint8Array
    const sharedBA = x25519_shared_secret(privB, pubA) as Uint8Array
    expect(toHex(sharedAB)).toBe(toHex(sharedBA))
    expect(toHex(sharedAB)).toBe(v.expected_shared_secret_hex)

    const shareKey = derive_share_key(sharedAB, fileId) as Uint8Array
    expect(toHex(shareKey)).toBe(v.expected_share_key_hex)
  })

  test('recovery_check — computeRecoveryCheck (src/lib/crypto.ts:405) via WASM compute_recovery_check', () => {
    const v = vectors.recovery_check
    const masterKey = hexToBytes(v.master_key_hex)
    const rc = compute_recovery_check(masterKey) as Uint8Array
    expect(toHex(rc)).toBe(v.expected_recovery_check_hex)
  })

  test('recovery_phrase_roundtrip — recoverFromPhrase (src/lib/crypto.ts:370) via WASM recover_from_phrase', () => {
    const v = vectors.recovery_phrase_roundtrip
    const masterKey = recover_from_phrase(v.mnemonic as string) as Uint8Array
    expect(toHex(masterKey)).toBe(v.expected_master_key_hex)
  })

  test('metadata_encrypt_decrypt — decryptFilename (src/lib/crypto.ts:289) via WASM decrypt_metadata', () => {
    const v = vectors.metadata_encrypt_decrypt
    const fileKey = hexToBytes(v.file_key_hex)
    const nonce = hexToBytes(v.nonce_hex)
    const ciphertext = hexToBytes(v.ciphertext_hex)
    const decrypted = decrypt_metadata(fileKey, nonce, ciphertext) as string
    expect(decrypted).toBe(v.metadata)
  })

  test('file_request_seal_open — unwrapRequestPrivate/openRequestUpload (src/lib/crypto.ts:796,817) + WASM derive_request_wrap_key/derive_x25519_public', () => {
    const v = vectors.file_request_seal_open
    const masterKey = hexToBytes(v.master_key_hex)
    const requestId = hexToBytes(v.request_id_hex)
    const rPriv = hexToBytes(v.r_priv_hex)
    const fileId = hexToBytes(v.file_id_hex)
    const ePub = hexToBytes(v.e_pub_hex)
    const wrappedKey = hexToBytes(v.wrapped_key_hex)
    const wrappedPrivate = hexToBytes(v.wrapped_private_hex)
    const wrapNonce = hexToBytes(v.wrap_nonce_hex)

    // derive_request_wrap_key is exposed by the WASM binding but web never
    // calls it as a standalone step — wrapRequestPrivate/unwrapRequestPrivate
    // (crypto.ts:787,796) derive it internally on the Rust side. Verified
    // directly against the WASM export (the same code those crypto.ts
    // functions call into) since there's no separate crypto.ts wrapper to cite.
    const wrapKey = derive_request_wrap_key(masterKey, requestId) as Uint8Array
    expect(toHex(wrapKey)).toBe(v.expected_wrap_key_hex)

    const rPub = derive_x25519_public(rPriv) as Uint8Array
    expect(toHex(rPub)).toBe(v.r_pub_hex)

    const recoveredPriv = unwrap_request_private(masterKey, requestId, wrappedPrivate, wrapNonce) as Uint8Array
    expect(toHex(recoveredPriv)).toBe(v.r_priv_hex)

    const opened = open_request_upload(rPriv, ePub, fileId, wrappedKey) as Uint8Array
    expect(toHex(opened)).toBe(v.content_key_hex)
  })

  // ── share_key_wrap ─────────────────────────────────────────────────────────
  // Cross-reference: test/share-wrap-kat.test.ts already has the full
  // bidirectional live-WASM cross-check + a mutation-checked tamper test for
  // this family, hand-pinning the same hex the vendored vector file carries.
  // Kept separate (not folded in) because that file's job is proving web's
  // wrapKeyForShare/unwrapKeyFromShare == core's encrypt_chunk/decrypt_chunk
  // in BOTH directions; this file's job is proving the vendored vector file
  // drives that same assertion, so a future core vector regen is caught here
  // even if nobody touches share-wrap-kat.test.ts's hard-coded constants.
  test('share_key_wrap — unwrapKeyFromShare (src/lib/crypto.ts:1025) decrypts the vendored vector; cross-ref test/share-wrap-kat.test.ts', async () => {
    const v = vectors.share_key_wrap
    const wrapKey = hexToBytes(v.wrap_key_hex)
    const wrapped = hexToBytes((v.nonce_hex as string) + (v.ciphertext_hex as string))
    expect(wrapped.length).toBe(60)
    const unwrapped = await unwrapKeyFromShare(wrapKey, wrapped)
    expect(toHex(unwrapped)).toBe(v.key_to_wrap_hex)
  })

  test('share_key_wrap tamper — a flipped ciphertext byte fails GCM authentication', async () => {
    const v = vectors.share_key_wrap
    const wrapKey = hexToBytes(v.wrap_key_hex)
    const wrapped = hexToBytes((v.nonce_hex as string) + (v.ciphertext_hex as string))
    wrapped[15] ^= 0x01
    await expect(unwrapKeyFromShare(wrapKey, wrapped)).rejects.toThrow()
  })

  // ── thumbnail_encrypt ──────────────────────────────────────────────────────
  // Cross-reference: test/thumbnail-kat.test.ts has the full bidirectional
  // live-WASM cross-check + mutation-checked tamper test. Same relationship as
  // share_key_wrap above.
  test('thumbnail_encrypt — decryptThumbnailBlob (src/lib/thumbnail.ts:160) decrypts the vendored vector; cross-ref test/thumbnail-kat.test.ts', async () => {
    const v = vectors.thumbnail_encrypt
    const fileKey = hexToBytes(v.file_key_hex)
    const encrypted = hexToBytes((v.nonce_hex as string) + (v.ciphertext_hex as string))
    const decrypted = await decryptThumbnailBlob(encrypted, fileKey)
    expect(toHex(new Uint8Array(decrypted))).toBe(v.plaintext_hex)
  })

  test('thumbnail_encrypt tamper — a flipped ciphertext byte fails GCM authentication', async () => {
    const v = vectors.thumbnail_encrypt
    const fileKey = hexToBytes(v.file_key_hex)
    const encrypted = hexToBytes((v.nonce_hex as string) + (v.ciphertext_hex as string))
    encrypted[20] ^= 0x01
    await expect(decryptThumbnailBlob(encrypted, fileKey)).rejects.toThrow()
  })
})
