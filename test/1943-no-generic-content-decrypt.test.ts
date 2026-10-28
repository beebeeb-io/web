/**
 * Task 1943 — a sweep guard: file content, names and notes are opened ONLY by
 * core's 1908 readers (`src/lib/content-crypto.ts`), never again by the generic
 * no-AAD functions.
 *
 * The generic `decrypt_chunk(key, nonce, ct)` (crypto.ts `decryptChunk`) has no
 * position, opens only v1 frames and cannot be told a file's pin. It stays for
 * KEY UNWRAPPING (folder keys, user-to-user share keys). `decrypt_metadata`
 * (`decryptFilename`) opens only raw-key envelopes; names go through core's
 * subkey-aware name readers and notes through `decrypt_note`.
 *
 * This reads the source, so it fails the moment a new call site appears.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '..')
const SRC = join(ROOT, 'src')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p))
    else if (/\.(ts|tsx)$/.test(entry)) out.push(p)
  }
  return out
}

const files = sourceFiles(SRC).map((p) => ({ path: relative(ROOT, p), text: readFileSync(p, 'utf8') }))

function filesMatching(re: RegExp): string[] {
  return files.filter((f) => re.test(f.text)).map((f) => f.path).sort()
}

describe('the generic chunk decrypt is used for key unwrapping only', () => {
  test('only the key-unwrap modules call decryptChunk(...)', () => {
    expect(filesMatching(/\bdecryptChunk\(/)).toEqual([
      'src/lib/crypto.ts', //                 the definition (main-thread proxy)
      'src/lib/folder-share-crypto.ts', //    folder key + child file key unwrap
      'src/pages/shared.tsx', //              user-to-user share: file key unwrap
      'src/workers/crypto.worker.ts', //      the definition (worker pass-through)
    ])
  })

  test('the download code references neither decryptChunk nor the WASM decrypt_chunk', () => {
    const dl = files.find((f) => f.path === 'src/lib/encrypted-download.ts')!
    expect(dl.text).not.toMatch(/\bdecryptChunk\b/)
    expect(dl.text).not.toMatch(/\bdecrypt_chunk\b/)
  })

  test('the worker calls wasm.decrypt_chunk exactly once (the key-unwrap pass-through) and never the batch decrypt_chunks', () => {
    const worker = files.find((f) => f.path === 'src/workers/crypto.worker.ts')!
    expect(worker.text.match(/wasm\.decrypt_chunk\(/g) ?? []).toHaveLength(1)
    expect(worker.text).not.toMatch(/\bdecrypt_chunks\b/)
  })
})

describe('names and notes are opened by core’s readers only', () => {
  test('no source file calls the raw-key metadata decrypt (decryptFilename / wasm.decrypt_metadata)', () => {
    expect(filesMatching(/\bdecryptFilename\(/)).toEqual([])
    expect(filesMatching(/wasm\.decrypt_metadata\(/)).toEqual([])
  })

  test('the details panel seals and opens notes through file-note.ts, not the name/metadata functions', () => {
    const panel = files.find((f) => f.path === 'src/components/file-details-panel.tsx')!
    expect(panel.text).toMatch(/\bsealFileNote\(/)
    expect(panel.text).toMatch(/\bopenFileNote\(/)
    expect(panel.text).not.toMatch(/\bencryptFilename\b/)
    expect(panel.text).not.toMatch(/\bserializeEncryptedBlob\b/)
  })

  test('the note writer takes the pin from core’s FILE reader only, never the display/folder reader (web#170 review, Minor 1)', () => {
    const note = files.find((f) => f.path === 'src/lib/file-note.ts')!
    expect(note.text).toMatch(/\breadFileMetadata\(/)
    expect(note.text).not.toMatch(/\breadNameMetadata\b/)
    expect(note.text).not.toMatch(/\bisFolder\b/)
  })
})
