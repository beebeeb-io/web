/**
 * 2326 review P3-4: the resolver adapter fails CLOSED.
 *
 * Core's `resolveRequestRow` always reports `chunkFormat` and `seal`. Guessing
 * chunkFormat 0 for a row that did not report one picks the v1 frame layout for
 * what may be a v2 row (every frame therefore drops as unauthenticated), and
 * guessing 'unbound' mislabels the seal. The adapter throws instead; only the
 * rename target keeps a default, because a null target is core's explicit
 * "read-only" answer.
 */
import { describe, expect, test } from 'bun:test'
import { resolveRequestRowWith, type RequestRowWasm } from '../src/lib/request-row'

const ARGS = {
  masterKey: new Uint8Array(32),
  itemId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  requestWrapContext: new Uint8Array(),
  wrappedRequestPrivate: new Uint8Array(48),
  wrapNonce: new Uint8Array(12),
  senderEphemeralPubkey: new Uint8Array(32),
  wrappedContentKey: new Uint8Array(48),
  nameEncrypted: '{}',
}

/** A fake core that reports exactly the fields given. */
function wasmReturning(raw: Record<string, unknown>): RequestRowWasm {
  return {
    resolveRequestRow: () => raw,
  } as unknown as RequestRowWasm
}

describe('resolveRequestRowWith fails closed', () => {
  test('a result without chunkFormat is refused, not defaulted to 0', () => {
    const wasm = wasmReturning({ content: {}, seal: 'unbound' })
    expect(() => resolveRequestRowWith(wasm, ARGS)).toThrow(/chunkFormat/i)
  })

  test('a result without seal is refused, not defaulted to unbound', () => {
    const wasm = wasmReturning({ content: {}, chunkFormat: 2 })
    expect(() => resolveRequestRowWith(wasm, ARGS)).toThrow(/seal/i)
  })

  test('an unknown seal value is refused', () => {
    const wasm = wasmReturning({ content: {}, chunkFormat: 2, seal: 'maybe' })
    expect(() => resolveRequestRowWith(wasm, ARGS)).toThrow(/seal/i)
  })

  test('a complete result passes through, chunkFormat 2 and seal bound intact', () => {
    const content = {}
    const resolved = resolveRequestRowWith(
      wasmReturning({ content, chunkFormat: 2, seal: 'bound', name: 'a.mp4', mimeType: 'video/mp4' }),
      ARGS,
    )
    expect(resolved.content).toBe(content as never)
    expect(resolved.chunkFormat).toBe(2)
    expect(resolved.seal).toBe('bound')
    expect(resolved.name).toBe('a.mp4')
    expect(resolved.mimeType).toBe('video/mp4')
    expect(resolved.renameTarget).toBeNull()
  })
})
