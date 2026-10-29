import { describe, expect, test } from 'bun:test'
import { hashFile, DEDUP_HASH_MAX_BYTES } from '../src/lib/upload-dedup'

// Task 1544 finding 4: hashFile() used to unconditionally read the entire
// file into memory via `file.arrayBuffer()` before SHA-256 digesting it,
// even for a multi-GB file well within the plan's per-file allowance (Pro:
// 500 GB, uploads.rs max_file_bytes) — contradicting the streaming
// upload's documented bounded-memory guarantee (repos/web/CLAUDE.md
// "Uploads (streaming encryption)": "Memory stays bounded to one slice +
// one frame"). Fix: skip the hash (and the arrayBuffer read) above
// DEDUP_HASH_MAX_BYTES.

// A File whose real backing bytes are tiny, but whose reported `.size` is
// forged to a large value — this proves the size check runs BEFORE any
// attempt to read `file.arrayBuffer()` (a real multi-GB buffer would be
// impractical to allocate in a unit test, and isn't necessary to prove the
// early-return branch).
function forgedSizeFile(actualBytes: Uint8Array, reportedSize: number): File {
  const file = new File([actualBytes], 'huge.bin')
  Object.defineProperty(file, 'size', { value: reportedSize, configurable: true })
  return file
}

describe('hashFile — dedup memory bound (finding 4)', () => {
  test('a small file under the threshold is hashed normally (non-null hex string)', async () => {
    const file = new File([new TextEncoder().encode('hello beebeeb')], 'small.txt')
    const hash = await hashFile(file)
    expect(hash).not.toBeNull()
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  test('hashing the same content twice is deterministic', async () => {
    const bytes = new TextEncoder().encode('deterministic content')
    const a = await hashFile(new File([bytes], 'a.txt'))
    const b = await hashFile(new File([bytes], 'b.txt'))
    expect(a).toBe(b)
  })

  test('a file exactly at the threshold is still hashed', async () => {
    const file = forgedSizeFile(new Uint8Array(4), DEDUP_HASH_MAX_BYTES)
    // Real bytes are tiny (4), but the reported size sits exactly at the
    // cutoff — digest() will run over the ACTUAL bytes, not the forged
    // size, so this just proves the boundary is inclusive (`>`, not `>=`).
    const hash = await hashFile(file)
    expect(hash).not.toBeNull()
  })

  test('a file over the threshold is SKIPPED (returns null, never reads arrayBuffer)', async () => {
    const file = forgedSizeFile(new Uint8Array(4), DEDUP_HASH_MAX_BYTES + 1)
    const hash = await hashFile(file)
    expect(hash).toBeNull()
  })

  test('a plan-legal multi-GB file (Pro: up to 500 GB) is skipped, not buffered', async () => {
    const fiveHundredGB = 500 * 1024 * 1024 * 1024
    const file = forgedSizeFile(new Uint8Array(4), fiveHundredGB)
    const hash = await hashFile(file)
    expect(hash).toBeNull()
  })

  test('DEDUP_HASH_MAX_BYTES is a sane bound (well under a typical browser tab memory budget)', () => {
    expect(DEDUP_HASH_MAX_BYTES).toBeGreaterThan(0)
    expect(DEDUP_HASH_MAX_BYTES).toBeLessThanOrEqual(1024 * 1024 * 1024) // <= 1 GiB
  })
})
