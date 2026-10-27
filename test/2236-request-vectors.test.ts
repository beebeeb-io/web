import { beforeAll, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as wasm from 'beebeeb-wasm'
import fixture from './fixtures/request-upload-v1.json'
import { serializeEncryptedBlob } from '../src/lib/crypto'

const bytes = (s:string) => new Uint8Array(Buffer.from(s,'base64'))
const empty = new Uint8Array()
beforeAll(() => wasm.initSync({module:readFileSync(new URL('../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm',import.meta.url))}))

// This runs the committed core WASM used by the public uploader. The mobile
// companion fixture test consumes these exact bytes through its real resolver
// and downloader, modeling the native cryptographic boundary independently.
for (const file of fixture.files) {
  test(`2236 v1 stored ${file.name} opens metadata and original bytes in core`, () => {
    const privateKey = wasm.unwrap_request_private(bytes(fixture.masterKey),empty,bytes(fixture.wrapped_private_key),bytes(fixture.wrap_nonce))
    const key = wasm.open_request_upload(privateKey,bytes(file.sender_ephemeral_pubkey),empty,bytes(file.wrapped_content_key))
    expect(Buffer.from(key).toString('base64')).toBe(file.contentKey)
    const metadata = JSON.parse(file.name_encrypted)
    expect(serializeEncryptedBlob(new Uint8Array(metadata.nonce),new Uint8Array(metadata.ciphertext))).toBe(file.name_encrypted)
    expect(JSON.parse(wasm.decrypt_metadata(key,new Uint8Array(metadata.nonce),new Uint8Array(metadata.ciphertext)))).toEqual({name:file.name,mime_type:file.mime})
    const frame = bytes(file.frame)
    const plaintext = wasm.decrypt_chunk(key,frame.slice(0,12),frame.slice(12))
    expect(createHash('sha256').update(plaintext).digest('hex')).toBe(file.sha256)
    const normalKey = wasm.derive_file_key(bytes(fixture.masterKey),new TextEncoder().encode(file.id))
    expect(() => wasm.decrypt_chunk(normalKey,frame.slice(0,12),frame.slice(12))).toThrow()
    privateKey.fill(0);key.fill(0);normalKey.fill(0)
  })
}
test('2236 empty request/file contexts are the existing v1 contract', () => {
  expect(() => wasm.unwrap_request_private(bytes(fixture.masterKey),new Uint8Array([1]),bytes(fixture.wrapped_private_key),bytes(fixture.wrap_nonce))).toThrow()
  const file=fixture.files[0]
  expect(() => wasm.open_request_upload(bytes(fixture.requestPrivate),bytes(file.sender_ephemeral_pubkey),new Uint8Array([1]),bytes(file.wrapped_content_key))).toThrow()
})
