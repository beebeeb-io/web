import { describe, expect, test, beforeAll } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import {
  initSync,
  WasmChunkDecryptor,
  decrypt_chunk_frame,
  decrypt_file_metadata,
  decrypt_file_metadata_with_key,
  folder_key_id,
  decrypt_name_metadata_with_key,
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
  combineFolderLinkKey as combine_folder_link_key,
  deriveSharedFolderIndexKey as derive_shared_folder_index_key,
  wrapFolderChild,
  unwrapFolderChild,
  wrapOwnerFileKey,
  unwrapOwnerFileKey,
  wrapFolderCustody,
  unwrapFolderCustody,
  wrapLinkOwnerKey,
  unwrapLinkOwnerKey,
  wrapLinkOwnerToken,
  unwrapLinkOwnerToken,
  wrapInviteOwnerCopy,
  unwrapInviteOwnerCopy,
  deriveFolderLinkPassphraseStretch,
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
// The vendored copy lives at test/vectors/core-vectors.v13.json and MUST be a
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

const VENDORED_PATH = fileURLToPath(new URL('./vectors/core-vectors.v13.json', import.meta.url))
// Sibling core checkout (present on developer machines / worktrees that keep
// `core` next to `web`; absent in a bare CI checkout of web alone).
const CORE_SIBLING_PATH = fileURLToPath(new URL('../../core/test-vectors/vectors.json', import.meta.url))

// Pin from: shasum -a 256 test/vectors/core-vectors.v13.json
// v13 = core 064c622 (core#54, SF-0002): adds upper_repair_v1 and
// upper_repair_split_v1, the owner-only read repair for rows the iOS Files
// app sealed under the uppercase file id; web's owner-repair module is the
// reader under test in test/sf-0002-owner-repair.test.ts.
// v12 = core 26094b3 (core#49, task 2255 L9; the same file at core main
// 3831a05, whose WASM web vendors): adds invite_owner_copy_v1, the
// purpose-bound folder-invite owner copy;
// v11 at core c08defc (core#48, decision L8): owner_wrapped_file_key re-pinned
// to the purpose-bound owner wrap (same version number, new bytes);
// v11 = core a245a54 (core#45, task 2237d): adds owner_wrapped_file_key,
// owner_wrapped_folder_key and folder_wrapped_file_key (owned-key resolution KATs);
// v10 = core 640edab2 (core#44 + core#46, task 2237b decisions L6 and L7): adds
// folder_child_file_v1, folder_child_folder_v1, folder_custody_v1,
// link_owner_key_v1, link_owner_token_v1, folder_link_passphrase(_nfd) and
// key_wrap_v1 (the legacy unbound shape, pinned so a reader can prove it refuses it);
// v9 = core 9cbf856 (core#42, task 2237b): adds combine_folder_link_key;
// v8 = core edf7cd4 (core#41, task 2237): adds shared_folder_index_key.
const PINNED_SHA256 = '71fb633774fcb13d7cca0613603282ea47ab77e265abd09b3a2ec189689c1464'
const EXPECTED_VERSION = 13

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
  test('test/vectors/core-vectors.v13.json matches the pinned sha256', () => {
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
  'chunk_v2_stream',
  'chunk_v2_single_frame',
  'metadata_v2_name',
  'metadata_v2_name_filekey',
  'metadata_v1_name_filekey',
  'folder_key_id',
  'shared_folder_index_key',
  'combine_folder_link_key',
  'folder_child_file_v1',
  'folder_child_folder_v1',
  'folder_custody_v1',
  'link_owner_key_v1',
  'link_owner_token_v1',
  'folder_link_passphrase',
  'folder_link_passphrase_nfd',
  'key_wrap_v1',
  'owner_wrapped_file_key',
  'owner_wrapped_folder_key',
  'folder_wrapped_file_key',
  'invite_owner_copy_v1',
  'upper_repair_v1',
  'upper_repair_split_v1',
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

  test('metadata_encrypt_decrypt — the legacy raw-key open (WASM decrypt_metadata) that core’s name readers fall back to', () => {
    const v = vectors.metadata_encrypt_decrypt
    const fileKey = hexToBytes(v.file_key_hex)
    const nonce = hexToBytes(v.nonce_hex)
    const ciphertext = hexToBytes(v.ciphertext_hex)
    const decrypted = decrypt_metadata(fileKey, nonce, ciphertext) as string
    expect(decrypted).toBe(v.metadata)
  })

  test('metadata_encrypt_decrypt — readNameMetadata / readFileMetadata (src/lib/content-crypto.ts) open the same blob as a stored envelope, pin 0', () => {
    // Web no longer opens names with decrypt_metadata itself (task 1943): every
    // name goes through core's subkey-aware readers, whose legacy raw-key
    // fallback must keep opening every envelope stored before 1908.
    const v = vectors.metadata_encrypt_decrypt
    const fileKey = hexToBytes(v.file_key_hex)
    const envelope = JSON.stringify({
      cipher_suite: 'V1Aes256Gcm',
      nonce: Array.from(hexToBytes(v.nonce_hex)),
      ciphertext: Array.from(hexToBytes(v.ciphertext_hex)),
    })
    for (const read of [decrypt_name_metadata_with_key, decrypt_file_metadata_with_key]) {
      const meta = read(fileKey, envelope) as { name: string; mime_type?: string; chunk_format: number }
      // A bare-filename (legacy) plaintext: no MIME, which WASM returns as `undefined`.
      expect(meta.name).toBe(v.metadata)
      expect(meta.mime_type).toBeUndefined()
      expect(meta.chunk_format).toBe(0)
    }
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

// ─── 4. Chunk format v2 + v2 name metadata (vectors v5, core#28/#29, task 1943) ─
//
// Web's production readers for these families are `createDecryptor` /
// `decryptorPushFrame` / `decryptorFinish` and `readFileMetadata` in
// src/lib/content-crypto.ts, which the crypto worker runs as 1:1 calls into
// WASM `WasmChunkDecryptor.fromFileKey` / `pushFrame` / `finish` and
// `decrypt_file_metadata_with_key`. Same precedent as the families above: the
// WASM export is driven directly, because the worker cannot load under bun.
// web's end-to-end consumer tests over these same vectors (download, stream,
// version, share link, hostile server) are test/1943-content-reader.test.ts.

describe('core vectors KAT — chunk format v2 and v2 name metadata', () => {
  interface V2Frame { index: number; is_last: boolean; nonce_hex: string; frame_hex: string; plaintext_hex: string }

  for (const family of ['chunk_v2_stream', 'chunk_v2_single_frame'] as const) {
    test(`${family} — the streaming reader opens every frame in order under pin 2 (fromFileKey, as share recipients do)`, () => {
      const v = vectors[family]
      expect(v.chunk_format).toBe(2)
      const dec = WasmChunkDecryptor.fromFileKey(hexToBytes(v.file_key_hex), v.file_id, 2)
      const parts: string[] = []
      for (const f of v.frames as V2Frame[]) {
        const pt = dec.pushFrame(hexToBytes(f.frame_hex))
        expect(toHex(pt)).toBe(f.plaintext_hex)
        parts.push(toHex(pt))
        expect(toHex(dec.versionId as Uint8Array)).toBe(v.version_id_hex)
      }
      expect(dec.format).toBe(2)
      expect(dec.chunksDecrypted).toBe(v.chunk_count)
      expect(dec.finish()).toEqual({ chunk_count: v.chunk_count, format: 2 })
      expect(parts.join('')).toBe(v.plaintext_hex)
    })

    test(`${family} — the owner's reader derives the same file key from master_key + file_id`, () => {
      const v = vectors[family]
      const fileKey = derive_file_key(hexToBytes(v.master_key_hex), new TextEncoder().encode(v.file_id)) as Uint8Array
      expect(toHex(fileKey)).toBe(v.file_key_hex)
      const dec = new WasmChunkDecryptor(hexToBytes(v.master_key_hex), v.file_id, 2)
      const out = (v.frames as V2Frame[]).map((f) => toHex(dec.pushFrame(hexToBytes(f.frame_hex)))).join('')
      dec.finish()
      expect(out).toBe(v.plaintext_hex)
    })

    test(`${family} — random access (decrypt_chunk_frame) opens each frame at its index with the version id`, () => {
      const v = vectors[family]
      for (const f of v.frames as V2Frame[]) {
        const pt = decrypt_chunk_frame(
          hexToBytes(v.file_key_hex), v.file_id, hexToBytes(v.version_id_hex),
          f.index, f.is_last, 2, hexToBytes(f.frame_hex),
        )
        expect(toHex(pt)).toBe(f.plaintext_hex)
      }
    })

    test(`${family} — the generic decrypt_chunk (the old web content path) can NOT open a v2 frame`, () => {
      const v = vectors[family]
      const f = (v.frames as V2Frame[])[0]
      const frame = hexToBytes(f.frame_hex)
      expect(() => decrypt_chunk(hexToBytes(v.file_key_hex), frame.slice(0, 12), frame.slice(12))).toThrow()
    })
  }

  test('chunk_v2_stream — a pin-0 (unrecorded) reader detects v2 at chunk 0 and still opens the file', () => {
    const v = vectors.chunk_v2_stream
    const dec = WasmChunkDecryptor.fromFileKey(hexToBytes(v.file_key_hex), v.file_id, 0)
    const out = (v.frames as V2Frame[]).map((f) => toHex(dec.pushFrame(hexToBytes(f.frame_hex)))).join('')
    expect(dec.finish()).toEqual({ chunk_count: 3, format: 2 })
    expect(out).toBe(v.plaintext_hex)
  })

  test('chunk_v2_stream — dropping the last frame fails finish() (truncation is detected)', () => {
    const v = vectors.chunk_v2_stream
    const dec = WasmChunkDecryptor.fromFileKey(hexToBytes(v.file_key_hex), v.file_id, 2)
    for (const f of (v.frames as V2Frame[]).slice(0, 2)) dec.pushFrame(hexToBytes(f.frame_hex))
    expect(() => dec.finish()).toThrow()
  })

  test('metadata_v2_name — decrypt_file_metadata (owner) returns the name, MIME and pin 2', () => {
    const v = vectors.metadata_v2_name
    const meta = decrypt_file_metadata(hexToBytes(v.master_key_hex), v.file_id, v.name_encrypted)
    expect(meta).toEqual({ name: v.expected_name, mime_type: v.expected_mime_type, chunk_format: v.expected_chunk_format })
  })

  test('metadata_v2_name — decrypt_file_metadata_with_key (readFileMetadata, src/lib/content-crypto.ts) returns the same', () => {
    const v = vectors.metadata_v2_name
    const meta = decrypt_file_metadata_with_key(hexToBytes(v.file_key_hex), v.name_encrypted)
    expect(meta).toEqual({ name: v.expected_name, mime_type: v.expected_mime_type, chunk_format: 2 })
  })

  test('metadata_v2_name — it is sealed under the name subkey: the raw-key decrypt_metadata (the old web name path) cannot open it', () => {
    const v = vectors.metadata_v2_name
    const env = JSON.parse(v.name_encrypted) as { nonce: number[]; ciphertext: number[] }
    expect(toHex(new Uint8Array(env.nonce))).toBe(v.nonce_hex)
    expect(() =>
      decrypt_metadata(hexToBytes(v.file_key_hex), new Uint8Array(env.nonce), new Uint8Array(env.ciphertext)),
    ).toThrow()
  })

  test('metadata_v2_name_filekey — decrypt_file_metadata_with_key opens a pin-2 name sealed by encrypt_name_for; the raw key cannot', () => {
    const v = vectors.metadata_v2_name_filekey
    const meta = decrypt_file_metadata_with_key(hexToBytes(v.file_key_hex), v.name_encrypted)
    expect(meta).toEqual({ name: v.expected_name, mime_type: v.expected_mime_type, chunk_format: v.expected_chunk_format })
    const env = JSON.parse(v.name_encrypted) as { nonce: number[]; ciphertext: number[] }
    expect(() =>
      decrypt_metadata(hexToBytes(v.file_key_hex), new Uint8Array(env.nonce), new Uint8Array(env.ciphertext)),
    ).toThrow()
  })

  test('metadata_v1_name_filekey — decrypt_file_metadata_with_key opens a pin-0 name (raw-key sealed, read-only phase) with pin 0', () => {
    const v = vectors.metadata_v1_name_filekey
    const meta = decrypt_file_metadata_with_key(hexToBytes(v.file_key_hex), v.name_encrypted)
    expect(meta).toEqual({ name: v.expected_name, mime_type: v.expected_mime_type, chunk_format: v.expected_chunk_format })
  })

  test('folder_key_id — the WASM export returns the pinned 32-byte id for the fixed folder key (task 2133)', () => {
    const v = vectors.folder_key_id
    const id = folder_key_id(hexToBytes(v.folder_key_hex))
    expect(id.length).toBe(32)
    expect(toHex(id)).toBe(v.expected_key_id_hex)
  })

  test('folder_key_id — a key that is not 32 bytes is an error, not an id', () => {
    expect(() => folder_key_id(new Uint8Array(31))).toThrow()
    expect(() => folder_key_id(new Uint8Array(33))).toThrow()
  })

  test('shared_folder_index_key — the WASM export derives every pinned bucket (task 2237)', () => {
    const v = vectors.shared_folder_index_key
    const folderKey = hexToBytes(v.folder_key_hex)
    for (const { bucket, expected_hex } of v.buckets) {
      expect(toHex(derive_shared_folder_index_key(folderKey, bucket))).toBe(expected_hex)
    }
    expect(() => derive_shared_folder_index_key(folderKey, 64)).toThrow()
  })

  test('combine_folder_link_key — both modes match the pinned vectors (task 2237b)', () => {
    const v = vectors.combine_folder_link_key
    const kc = hexToBytes(v.k_c_hex)
    expect(toHex(combine_folder_link_key(kc))).toBe(v.expected_without_passphrase_hex)
    expect(toHex(combine_folder_link_key(kc, hexToBytes(v.passphrase_stretch_hex)))).toBe(
      v.expected_with_passphrase_hex,
    )
    expect(() => combine_folder_link_key(new Uint8Array(31))).toThrow()
    expect(() => combine_folder_link_key(kc, new Uint8Array(31))).toThrow()
  })
})

// ─── 4. Task 2237b decisions L6 and L7 — the owned-folder wraps ────────────
// The app reaches these through crypto.worker.ts thin pass-throughs (see the
// note at the top), so the WASM export IS the production path.

describe('core vectors KAT — L7 folder child wraps (2237b)', () => {
  for (const family of ['folder_child_file_v1', 'folder_child_folder_v1'] as const) {
    test(`${family} — unwrapFolderChild opens the pinned wrap; the same key re-wraps and opens`, () => {
      const v = vectors[family]
      const kind = Number(v.kind)
      const folderKey = hexToBytes(v.folder_key_hex)
      const opened = unwrapFolderChild(folderKey, v.shared_folder_id, v.item_id, kind, hexToBytes(v.wrapped_hex))
      expect(toHex(opened)).toBe(v.child_key_hex)
      const again = wrapFolderChild(folderKey, v.shared_folder_id, v.item_id, kind, hexToBytes(v.child_key_hex))
      expect(again.length).toBe(60)
      expect(toHex(unwrapFolderChild(folderKey, v.shared_folder_id, v.item_id, kind, again))).toBe(v.child_key_hex)
    })
  }

  test('a wrap is bound to its root, its item and its kind: every substitution is refused', () => {
    const v = vectors.folder_child_file_v1
    const folderKey = hexToBytes(v.folder_key_hex)
    const wrapped = hexToBytes(v.wrapped_hex)
    const otherId = '2237c000-0000-4000-8000-0000000000ff'
    // A's wrap on B's row (the swap), under another root, and as the other kind.
    expect(() => unwrapFolderChild(folderKey, v.shared_folder_id, otherId, 1, wrapped)).toThrow(/decryption failed/)
    expect(() => unwrapFolderChild(folderKey, otherId, v.item_id, 1, wrapped)).toThrow(/decryption failed/)
    expect(() => unwrapFolderChild(folderKey, v.shared_folder_id, v.item_id, 2, wrapped)).toThrow(/decryption failed/)
  })

  test('the legacy unbound wrap (key_wrap_v1, no AAD) is refused as a folder child', () => {
    const v = vectors.key_wrap_v1
    const child = vectors.folder_child_file_v1
    // Same key, nonce and plaintext as the L7 vector; only the AAD differs.
    expect(v.wrapper_key_hex).toBe(child.folder_key_hex)
    expect(v.inner_key_hex).toBe(child.child_key_hex)
    expect(() =>
      unwrapFolderChild(hexToBytes(v.wrapper_key_hex), child.shared_folder_id, child.item_id, 1, hexToBytes(v.wrapped_hex)),
    ).toThrow(/decryption failed/)
  })

  test('kind must be 1 or 2, ids must be UUIDs, keys must be 32 bytes, wraps 60 bytes', () => {
    const v = vectors.folder_child_file_v1
    const folderKey = hexToBytes(v.folder_key_hex)
    const child = hexToBytes(v.child_key_hex)
    expect(() => wrapFolderChild(folderKey, v.shared_folder_id, v.item_id, 3, child)).toThrow()
    expect(() => wrapFolderChild(folderKey, 'not-a-uuid', v.item_id, 1, child)).toThrow(/invalid root UUID/)
    expect(() => wrapFolderChild(folderKey, v.shared_folder_id, 'nope', 1, child)).toThrow(/invalid item UUID/)
    expect(() => wrapFolderChild(new Uint8Array(31), v.shared_folder_id, v.item_id, 1, child)).toThrow(/32 bytes/)
    expect(() => unwrapFolderChild(folderKey, v.shared_folder_id, v.item_id, 1, new Uint8Array(59))).toThrow(/60 bytes/)
  })
})

describe('core vectors KAT — L6 custody and link-owner wraps (2237b)', () => {
  const cases = [
    { family: 'folder_custody_v1', wrap: wrapFolderCustody, unwrap: unwrapFolderCustody },
    { family: 'link_owner_key_v1', wrap: wrapLinkOwnerKey, unwrap: unwrapLinkOwnerKey },
    { family: 'link_owner_token_v1', wrap: wrapLinkOwnerToken, unwrap: unwrapLinkOwnerToken },
    // v12, task 2255 (L9): the folder-invite owner copy, the same pattern.
    { family: 'invite_owner_copy_v1', wrap: wrapInviteOwnerCopy, unwrap: unwrapInviteOwnerCopy },
  ] as const
  for (const { family, wrap, unwrap } of cases) {
    test(`${family} — opens the pinned wrap, re-wraps, and refuses another record id`, () => {
      const v = vectors[family]
      const master = hexToBytes(v.master_key_hex)
      expect(toHex(unwrap(master, v.record_id, hexToBytes(v.wrapped_hex)))).toBe(v.plaintext_hex)
      const again = wrap(master, v.record_id, hexToBytes(v.plaintext_hex))
      expect(toHex(unwrap(master, v.record_id, again))).toBe(v.plaintext_hex)
      expect(() => unwrap(master, `${v.record_id}-other`, again)).toThrow(/decryption failed/)
    })
  }

  test('the three purposes never open each other, and the legacy unbound shape is not custody', () => {
    const custody = vectors.folder_custody_v1
    const master = hexToBytes(custody.master_key_hex)
    const key = hexToBytes(custody.plaintext_hex)
    const asOwnerKey = wrapLinkOwnerKey(master, custody.record_id, key)
    expect(() => unwrapFolderCustody(master, custody.record_id, asOwnerKey)).toThrow(/decryption failed/)
    expect(() => unwrapLinkOwnerToken(master, custody.record_id, asOwnerKey)).toThrow(/decryption failed/)
    const legacy = vectors.key_wrap_v1
    expect(() =>
      unwrapFolderCustody(hexToBytes(legacy.wrapper_key_hex), custody.record_id, hexToBytes(legacy.wrapped_hex)),
    ).toThrow(/decryption failed/)
  })

  test('invite_owner_copy_v1 — an invite owner copy is not a custody record, and a custody record is not an owner copy', () => {
    const v = vectors.invite_owner_copy_v1
    const master = hexToBytes(v.master_key_hex)
    const key = hexToBytes(v.plaintext_hex)
    expect(() => unwrapFolderCustody(master, v.record_id, hexToBytes(v.wrapped_hex))).toThrow(/decryption failed/)
    expect(() => unwrapInviteOwnerCopy(master, v.record_id, wrapFolderCustody(master, v.record_id, key))).toThrow(/decryption failed/)
  })
})

describe('core vectors KAT — the link passphrase stretch (2237b)', () => {
  test('key_wrap_v1 — the legacy no-AAD shape still opens through unwrapKeyFromShare (seed read only)', async () => {
    const v = vectors.key_wrap_v1
    const opened = await unwrapKeyFromShare(hexToBytes(v.wrapper_key_hex), hexToBytes(v.wrapped_hex))
    expect(toHex(opened)).toBe(v.inner_key_hex)
  })

  for (const family of ['folder_link_passphrase', 'folder_link_passphrase_nfd'] as const) {
    test(`${family} — deriveFolderLinkPassphraseStretch then combineFolderLinkKey give the pinned link key`, () => {
      const v = vectors[family]
      const stretch = deriveFolderLinkPassphraseStretch(v.passphrase, v.token)
      expect(toHex(stretch)).toBe(v.stretch_hex)
      expect(toHex(combine_folder_link_key(hexToBytes(v.k_c_hex), stretch))).toBe(v.link_key_hex)
    })
  }

  test('an empty passphrase is refused', () => {
    expect(() => deriveFolderLinkPassphraseStretch('', 'token')).toThrow(/must not be empty/)
  })
})

describe('core vectors KAT — owned-key resolution (2237d, v11)', () => {
  test('owner_wrapped_file_key — L8: unwrapOwnerFileKey (src/lib/owner-adoption.ts) opens the pinned record for its item only', () => {
    const v = vectors.owner_wrapped_file_key
    const master = hexToBytes(v.master_key_hex)
    const frame = hexToBytes(v.expected_frame_hex)
    expect(toHex(unwrapOwnerFileKey(master, v.file_id, frame))).toBe(v.child_key_hex)
    expect(() => unwrapOwnerFileKey(master, v.folder_id, frame)).toThrow(/decryption failed/)
    // The pre-L8 shape (no purpose key: decrypt under derive_file_key) does not open it.
    const derived = derive_file_key(master, new TextEncoder().encode(v.file_id)) as Uint8Array
    expect(() => decrypt_chunk(derived, frame.slice(0, 12), frame.slice(12))).toThrow()
    const again = wrapOwnerFileKey(master, v.file_id, hexToBytes(v.child_key_hex))
    expect(toHex(unwrapOwnerFileKey(master, v.file_id, again))).toBe(v.child_key_hex)
  })

  test('owner_wrapped_folder_key — the L6 custody record opens with unwrapFolderCustody for its folder only', () => {
    const v = vectors.owner_wrapped_folder_key
    const master = hexToBytes(v.master_key_hex)
    const frame = hexToBytes(v.expected_frame_hex)
    expect(toHex(unwrapFolderCustody(master, v.folder_id, frame))).toBe(v.folder_key_hex)
    expect(() => unwrapFolderCustody(master, v.file_id, frame)).toThrow(/decryption failed/)
  })

  test('folder_wrapped_file_key — the L7 child wrap opens with unwrapFolderChild for (root, item, file) only', () => {
    const v = vectors.folder_wrapped_file_key
    const folderKey = hexToBytes(v.folder_key_hex)
    const frame = hexToBytes(v.expected_frame_hex)
    expect(toHex(unwrapFolderChild(folderKey, v.shared_folder_id, v.file_id, Number(v.kind), frame))).toBe(v.child_key_hex)
    expect(() => unwrapFolderChild(folderKey, v.shared_folder_id, v.file_id, 2, frame)).toThrow(/decryption failed/)
  })
})
