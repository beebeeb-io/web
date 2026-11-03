/**
 * LD-0001 PR-A: the worker-owned reader handle (content-crypto ops).
 * Contract §5.1, §10 T18; A26; §6 M5/M6 (no key leaves the worker).
 */
import { describe, expect, test } from 'bun:test'
import { toHex, loadWasm, hexToBytes } from './helpers/wasm-crypto-mirror'
import { encryptFixture } from './helpers/media-stream-fixtures'
import {
  createContentOps,
  type ContentWasm,
} from '../src/lib/content-crypto'

const wasm = loadWasm()

// ── A stub WASM module: forces states real core cannot reach (format 1 under a v2 pin) ──

interface CapturedOpen {
  key: Uint8Array
  fileId: string
  versionId: Uint8Array
  index: number
  isLast: boolean
  format: number
  frame: Uint8Array
}

function stubModule() {
  const opens: CapturedOpen[] = []
  const live: StubDecryptor[] = []
  class StubDecryptor {
    chunksDecrypted = 0
    format = 0
    versionId: Uint8Array | undefined = undefined
    freed = false
    static fromFileKey(_key: Uint8Array, _fileId: string, _pin: number): StubDecryptor {
      const d = new StubDecryptor()
      live.push(d)
      return d
    }
    pushFrame(_frame: Uint8Array): Uint8Array {
      this.chunksDecrypted += 1
      this.format = this.forcedFormat ?? 2
      this.versionId =
        this.format === 2 ? (this.forcedVersionId ?? new Uint8Array(12).fill(10)) : undefined
      return new Uint8Array([42])
    }
    finish(): unknown {
      return { chunk_count: this.chunksDecrypted, format: this.format }
    }
    free(): void {
      this.freed = true
    }
    forcedFormat?: number
    forcedVersionId?: Uint8Array
  }
  const module = {
    WasmChunkDecryptor: StubDecryptor,
    decrypt_chunk_frame(
      key: Uint8Array,
      fileId: string,
      versionId: Uint8Array,
      index: number,
      isLast: boolean,
      format: number,
      frame: Uint8Array,
    ): Uint8Array {
      opens.push({ key, fileId, versionId, index, isLast, format, frame })
      return new Uint8Array([index, format, isLast ? 1 : 0, frame.length])
    },
  }
  return { module: module as unknown as ContentWasm, opens, live }
}

describe('LD-0001 worker reader handle', () => {
  test('handle_refuses_format_1_on_pin_2', () => {
    // Real core, the strong form: a v1 frame never opens under a pin-2 pin at all.
    const v1 = encryptFixture({ pin: 0, plaintext: new Uint8Array(64) })
    const realOps = createContentOps(wasm)
    const realHandle = realOps.createDecryptor(v1.fileKey, v1.fileId, 2)
    expect(() => realOps.decryptorPushFrame(realHandle, v1.frames[0])).toThrow()
    realOps.decryptorDispose(realHandle)
    expect(realOps.liveDecryptorCount()).toBe(0)

    // The handle's own guard: even if a decryptor reported format 1 after a
    // pin-2 request (the downgrade this refuses), creation fails and the
    // decryptor is not silently turned into a v1 reader.
    const stub = stubModule()
    const ops = createContentOps(stub.module)
    const handle = ops.createDecryptor(new Uint8Array(32).fill(7), 'file-a', 2)
    stub.live[0].forcedFormat = 1
    ops.decryptorPushFrame(handle, new Uint8Array([1, 2, 3]))
    expect(() => ops.createChunkReader(handle)).toThrow(/format 1/)
    ops.decryptorDispose(handle)
    expect(ops.liveReaderCount()).toBe(0)
    expect(stub.live[0].freed).toBe(true)
  })

  test('the reader refuses to be created before chunk 0 was pushed', () => {
    const stub = stubModule()
    const ops = createContentOps(stub.module)
    const handle = ops.createDecryptor(new Uint8Array(32).fill(7), 'file-a', 0)
    expect(() => ops.createChunkReader(handle)).toThrow(/chunk 0/)
    ops.decryptorDispose(handle)
  })

  test('open_chunk_at_carries_no_key_format_or_version_from_the_page', () => {
    const stub = stubModule()
    const ops = createContentOps(stub.module)
    const key = new Uint8Array(32).fill(9)
    const handle = ops.createDecryptor(key, 'file-v2', 2)
    ops.decryptorPushFrame(handle, new Uint8Array([1]))
    const reader = ops.createChunkReader(handle)
    expect(ops.liveDecryptorCount()).toBe(0)
    expect(ops.liveReaderCount()).toBe(1)
    expect(stub.live[0].freed).toBe(true)

    const plaintext = ops.openChunkAt(reader, 3, false, new Uint8Array([7, 7, 7, 7]))
    expect(toHex(plaintext)).toBe(toHex(new Uint8Array([3, 2, 0, 4])))
    const open = stub.opens[0]
    expect(open.fileId).toBe('file-v2')
    expect(open.index).toBe(3)
    expect(open.isLast).toBe(false)
    expect(open.format).toBe(2)
    expect(toHex(open.versionId)).toBe('0a'.repeat(12))
    // The key the worker used is its own copy, not the page's array.
    expect(open.key).not.toBe(key)
    expect(toHex(open.key)).toBe(toHex(key))

    ops.closeChunkReader(reader)
    expect(ops.liveReaderCount()).toBe(0)
  })

  test('reader_key_wiped_on_close', () => {
    const stub = stubModule()
    const ops = createContentOps(stub.module)
    const handle = ops.createDecryptor(new Uint8Array(32).fill(5), 'file-b', 0)
    stub.live[0].forcedFormat = 1
    stub.live[0].forcedVersionId = undefined
    ops.decryptorPushFrame(handle, new Uint8Array([1]))
    const reader = ops.createChunkReader(handle)
    ops.openChunkAt(reader, 0, false, new Uint8Array([1, 2]))
    const captured = stub.opens[0]
    expect(captured.key.some((b) => b !== 0)).toBe(true)
    // v1: no version id crossed.
    expect(captured.versionId.length).toBe(0)

    ops.closeChunkReader(reader)
    expect(captured.key.every((b) => b === 0)).toBe(true)
    expect(() => ops.closeChunkReader(reader)).not.toThrow()
    expect(ops.liveReaderCount()).toBe(0)
  })

  test('readers count in the live gate and a real v2 fixture opens at its own index', () => {
    const fx = encryptFixture({ pin: 2, chunkSize: 32, plaintext: new Uint8Array(96).fill(3) })
    const ops = createContentOps(wasm)
    const d = ops.createDecryptor(fx.fileKey, fx.fileId, 2)
    const head = ops.decryptorPushFrame(d, fx.frames[0])
    expect(head.length).toBe(32)
    const reader = ops.createChunkReader(d)
    expect(ops.liveDecryptorCount()).toBe(0)
    expect(ops.liveReaderCount()).toBe(1)
    expect(toHex(ops.openChunkAt(reader, 1, false, fx.frames[1]))).toBe('03'.repeat(32))
    expect(toHex(ops.openChunkAt(reader, 2, true, fx.frames[2]))).toBe('03'.repeat(32))
    // v2 binds position: opening frame 1 at index 2 fails.
    expect(() => ops.openChunkAt(reader, 2, true, fx.frames[1])).toThrow()
    ops.closeChunkReader(reader)
    expect(ops.liveReaderCount()).toBe(0)
  })
})
