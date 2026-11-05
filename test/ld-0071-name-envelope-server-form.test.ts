// LD-0071 (P0): since web #218 (`5a6a6d48`, live as `b01422e6`) every web
// folder create, folder import and file-request guest upload was refused with
// HTTP 400 "name_encrypted must include cipher_suite field": the writer moved to
// core's `{"ciphertext":"<b64>","nonce":"<b64>"}`, which the server's validator
// refuses. This file sends a folder create through the REAL
// `createNamedOwnerFolder` → REAL `serializeEncryptedBlob` and checks what would
// cross the wire against a mirror of that validator. Only the transport is
// stubbed: `withProxy` runs the committed WASM build (the worker cannot load
// under bun test), the id mint is fixed and `createOwnerFolder` records its
// argument instead of calling the API.
//
// Red at web `b01422e6` (core's base64 form, no suite); green once the writer
// emits the server's form again. The reader stays core's tolerant decoder, so
// names written in either form keep opening (second half).
import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as wasm from 'beebeeb-wasm'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import { decodeEnvelope, encodeEnvelope } from '../src/lib/metadata-envelope'

/**
 * A line-for-line mirror of the server's `validate_name_encrypted_format`
 * (server `beebeeb-api/src/routes/files/names.rs:76-126` at `b5ead069`), the
 * check behind folder create (`routes/files/create.rs:36`) and file-request
 * uploads (`routes/file_requests.rs:757`). Returns the 400's message, or null
 * when the server would accept the value.
 */
function serverRefusal(value: string): string | null {
  if (value === '') return 'name_encrypted must be valid JSON'
  let obj: unknown
  try {
    obj = JSON.parse(value)
  } catch {
    return 'name_encrypted must be valid JSON'
  }
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return 'invalid name_encrypted'
  const map = obj as Record<string, unknown>
  const cs = map.cipher_suite
  if (typeof cs !== 'string') return 'name_encrypted must include cipher_suite field'
  if (cs !== 'V1Aes256Gcm') return `unsupported cipher_suite: ${cs}`
  if (!('nonce' in map)) return 'name_encrypted missing nonce'
  if (!Array.isArray(map.nonce)) return 'name_encrypted.nonce must be a byte array, not a string. Use the canonical format.'
  if (map.nonce.length !== 12) return 'name_encrypted.nonce must be exactly 12 bytes'
  if (!('ciphertext' in map)) return 'name_encrypted missing ciphertext'
  if (!Array.isArray(map.ciphertext)) {
    return 'name_encrypted.ciphertext must be a byte array, not a string. Use the canonical format.'
  }
  return null
}

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

beforeAll(() => {
  const wasmPath = fileURLToPath(new URL('../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url))
  wasm.initSync({ module: readFileSync(wasmPath) })
})

// The worker methods `withProxy` would reach, bound to the committed build.
const worker = {
  async encodeMetadataEnvelope(nonce: Uint8Array, ciphertext: Uint8Array): Promise<string> {
    return encodeEnvelope(wasm, nonce, ciphertext)
  },
  async decodeMetadataEnvelope(payload: string): Promise<{ nonce: Uint8Array; ciphertext: Uint8Array }> {
    return decodeEnvelope(wasm, payload)
  },
}
await mockModuleScoped('../src/lib/crypto/service', import.meta.dir, {
  withProxy: async (fn: (proxy: typeof worker) => unknown) => fn(worker),
})

const FOLDER_ID = 'ld0071-folder-id'
await mockModuleScoped('../src/lib/owned-item', import.meta.dir, (real) => ({
  ...real,
  ownedItem: {
    ...(real.ownedItem as Record<string, unknown>),
    mint: async (_masterKey: Uint8Array, idClass: string) => ({
      idText: FOLDER_ID,
      tag: new Uint8Array(32).fill(0x0e),
      idClass,
    }),
  },
}))

const sentNames: string[] = []
await mockModuleScoped('../src/lib/owner-upload-key', import.meta.dir, {
  createOwnerFolder: async (args: { nameEncrypted: string; folderId: string }) => {
    sentNames.push(args.nameEncrypted)
    return { id: args.folderId }
  },
})

const { createNamedOwnerFolder } = await import('../src/lib/new-folder')
const { serializeEncryptedBlob, parseEncryptedBlob } = await import('../src/lib/crypto')

describe('LD-0071: the name envelope web writes is the one the server accepts', () => {
  it('the validator mirror refuses what the server refuses (it can fail)', () => {
    const nonce = Array.from({ length: 12 }, (_, i) => i)
    // Core's base64 writer: the exact 400 users saw in prod.
    expect(serverRefusal('{"ciphertext":"EBESExQVFhcYGRobHB0eHw==","nonce":"AAECAwQFBgcICQoL"}')).toBe(
      'name_encrypted must include cipher_suite field',
    )
    expect(serverRefusal(JSON.stringify({ cipher_suite: 'V9', nonce, ciphertext: [1] }))).toBe('unsupported cipher_suite: V9')
    expect(serverRefusal(JSON.stringify({ cipher_suite: 'V1Aes256Gcm', nonce: 'AAECAwQFBgcICQoL', ciphertext: [1] }))).toContain(
      'nonce must be a byte array',
    )
    expect(serverRefusal(JSON.stringify({ cipher_suite: 'V1Aes256Gcm', nonce: nonce.slice(1), ciphertext: [1] }))).toBe(
      'name_encrypted.nonce must be exactly 12 bytes',
    )
    expect(serverRefusal(JSON.stringify({ cipher_suite: 'V1Aes256Gcm', nonce, ciphertext: 'AQ==' }))).toContain(
      'ciphertext must be a byte array',
    )
    expect(serverRefusal(JSON.stringify({ cipher_suite: 'V1Aes256Gcm', nonce }))).toBe('name_encrypted missing ciphertext')
    expect(serverRefusal('plain name.txt')).toBe('name_encrypted must be valid JSON')
    expect(serverRefusal(JSON.stringify({ cipher_suite: 'V1Aes256Gcm', nonce, ciphertext: [1, 2] }))).toBeNull()
  })

  it('a New folder create sends a name_encrypted the server accepts', async () => {
    const fileKey = crypto.getRandomValues(new Uint8Array(32))
    const before = sentNames.length
    const created = await createNamedOwnerFolder({
      name: 'Taxes 2026',
      vaultReady: true,
      getFileKey: async () => fileKey.slice(),
      getMasterKey: () => new Uint8Array(32).fill(7),
      seal: async (key, name) => {
        const sealed = wasm.encrypt_metadata(key, JSON.stringify({ name })) as { nonce: Uint8Array; ciphertext: Uint8Array }
        return { nonce: Uint8Array.from(sealed.nonce), ciphertext: Uint8Array.from(sealed.ciphertext) }
      },
    })
    expect(created.id).toBe(FOLDER_ID)
    expect(sentNames.length).toBe(before + 1)
    const sent = sentNames.at(-1)!
    expect(serverRefusal(sent)).toBeNull()
    const body = JSON.parse(sent) as { cipher_suite: string; nonce: unknown[]; ciphertext: unknown[] }
    expect(body.cipher_suite).toBe('V1Aes256Gcm')
    expect(body.nonce.length).toBe(12)
    expect(body.nonce.every((b) => typeof b === 'number')).toBe(true)
    expect(body.ciphertext.every((b) => typeof b === 'number')).toBe(true)
    // What was sent still opens to the typed name under the folder's key.
    const opened = wasm.decrypt_name_metadata_with_key(fileKey, sent) as { name: string }
    expect(opened.name).toBe('Taxes 2026')
  })

  it('serializeEncryptedBlob writes the server form; parseEncryptedBlob returns the same bytes', async () => {
    const fileKey = crypto.getRandomValues(new Uint8Array(32))
    const sealed = wasm.encrypt_metadata(fileKey, JSON.stringify({ name: 'Q3 report.pdf' })) as {
      nonce: Uint8Array
      ciphertext: Uint8Array
    }
    const stored = await serializeEncryptedBlob(sealed.nonce, sealed.ciphertext)
    expect(stored).toBe(
      JSON.stringify({ cipher_suite: 'V1Aes256Gcm', nonce: Array.from(sealed.nonce), ciphertext: Array.from(sealed.ciphertext) }),
    )
    expect(serverRefusal(stored)).toBeNull()
    const back = await parseEncryptedBlob(stored)
    expect(toHex(back.nonce)).toBe(toHex(Uint8Array.from(sealed.nonce)))
    expect(toHex(back.ciphertext)).toBe(toHex(Uint8Array.from(sealed.ciphertext)))
  })

  it('a name stored in core base64 form (written by b01422e6 on non-validated routes) still opens', async () => {
    const fileKey = crypto.getRandomValues(new Uint8Array(32))
    const sealed = wasm.encrypt_metadata(fileKey, JSON.stringify({ name: 'renamed.txt' })) as {
      nonce: Uint8Array
      ciphertext: Uint8Array
    }
    const legacy = JSON.stringify({
      ciphertext: Buffer.from(sealed.ciphertext).toString('base64'),
      nonce: Buffer.from(sealed.nonce).toString('base64'),
    })
    const back = await parseEncryptedBlob(legacy)
    expect(toHex(back.nonce)).toBe(toHex(Uint8Array.from(sealed.nonce)))
    expect(toHex(back.ciphertext)).toBe(toHex(Uint8Array.from(sealed.ciphertext)))
    expect((wasm.decrypt_name_metadata_with_key(fileKey, legacy) as { name: string }).name).toBe('renamed.txt')
  })
})
