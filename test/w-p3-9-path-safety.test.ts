import { beforeAll, describe, expect, it } from 'bun:test'
import { archiveEntryName, checkPathComponent, sanitizePathComponent } from 'beebeeb-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import { mockModuleScoped } from './helpers/scoped-module-mock'
import type { BulkDownloadPorts, ZipSink } from '../src/lib/bulk-download'
import type { DriveFile } from '../src/lib/api'
import { safeArchiveName } from '../src/lib/archive-name'

/**
 * The path-safety vector (`test-vectors/consolidation/path_safety.json`, core
 * 8b6446c), case for case, plus the web caller that writes server-provided
 * names into a ZIP.
 *
 * The vector also carries the native half (`rel-join`, `contained`): that code
 * is `cfg(not(target_arch = "wasm32"))` in core — a browser has no symlinks or
 * local paths — so it is deliberately absent from the wasm surface. That is
 * pinned below rather than skipped silently.
 *
 * The plan's proof: a ZIP entry that would climb with `..` is refused, and the
 * file is still written under its own safe name.
 */

interface CheckCase {
  id: string
  kind: 'check'
  name: string
  portable: boolean
  windows: boolean
  expect: 'reject' | 'ok'
  reason?: string
}

interface SanitizeCase {
  id: string
  kind: 'sanitize'
  name: string
  expect: 'reject' | 'ok'
  expected?: string
}

interface NativeCase {
  id: string
  kind: 'rel-join' | 'contained'
  expect: 'reject' | 'ok'
  reason?: string
}

type VectorCase = CheckCase | SanitizeCase | NativeCase

const VECTOR: VectorCase[] = [
  { id: 'path_reject_dotdot', kind: 'check', name: '..', portable: true, windows: true, expect: 'reject', reason: "'.' and '..'" },
  { id: 'path_reject_dot', kind: 'check', name: '.', portable: true, windows: true, expect: 'reject', reason: "'.' and '..'" },
  { id: 'path_reject_absolute', kind: 'check', name: '/etc/cron.d/x', portable: true, windows: true, expect: 'reject', reason: 'path separator' },
  { id: 'path_reject_backslash_portable', kind: 'check', name: 'a\\b', portable: true, windows: false, expect: 'reject', reason: 'path separator' },
  { id: 'path_host_allows_backslash', kind: 'check', name: 'a\\b', portable: false, windows: false, expect: 'ok' },
  { id: 'path_host_windows_rejects_backslash', kind: 'check', name: 'a\\b', portable: false, windows: true, expect: 'reject', reason: 'path separator' },
  { id: 'path_reject_drive_letter', kind: 'check', name: 'C:x', portable: true, windows: false, expect: 'reject', reason: 'drive prefix' },
  { id: 'path_accept_single_letter', kind: 'check', name: 'c', portable: true, windows: true, expect: 'ok' },
  { id: 'path_reject_reserved_con', kind: 'check', name: 'CON', portable: true, windows: true, expect: 'reject', reason: 'reserved Windows device' },
  { id: 'path_reject_reserved_nul_ext', kind: 'check', name: 'nul.txt', portable: true, windows: true, expect: 'reject', reason: 'reserved Windows device' },
  { id: 'path_reject_reserved_com1', kind: 'check', name: 'COM1.log', portable: true, windows: true, expect: 'reject', reason: 'reserved Windows device' },
  { id: 'path_accept_con_on_linux', kind: 'check', name: 'CON', portable: false, windows: false, expect: 'ok' },
  { id: 'path_reject_trailing_dot', kind: 'check', name: 'report.', portable: true, windows: true, expect: 'reject', reason: 'ends with a dot or space' },
  { id: 'path_reject_trailing_space', kind: 'check', name: 'report ', portable: true, windows: true, expect: 'reject', reason: 'ends with a dot or space' },
  { id: 'path_reject_colon', kind: 'check', name: 'a:b', portable: true, windows: true, expect: 'reject', reason: 'Windows drive prefix' },
  { id: 'path_reject_windows_chars', kind: 'check', name: 'a<b>c', portable: true, windows: true, expect: 'reject', reason: 'Windows does not allow' },
  { id: 'path_reject_nul_byte', kind: 'check', name: 'a\u0000b', portable: true, windows: true, expect: 'reject', reason: 'NUL byte' },
  { id: 'path_reject_control', kind: 'check', name: 'line\nbreak', portable: true, windows: true, expect: 'reject', reason: 'control character' },
  { id: 'path_reject_empty', kind: 'check', name: '', portable: true, windows: true, expect: 'reject', reason: 'empty name' },
  { id: 'path_reject_long_name', kind: 'check', name: 'x'.repeat(256), portable: true, windows: true, expect: 'reject', reason: '255 bytes' },
  { id: 'path_accept_max_name', kind: 'check', name: 'x'.repeat(255), portable: true, windows: true, expect: 'ok' },
  { id: 'path_accept_unicode', kind: 'check', name: 'файл.txt', portable: true, windows: true, expect: 'ok' },
  { id: 'path_accept_nfd', kind: 'check', name: 'e\u0301.txt', portable: true, windows: true, expect: 'ok' },
  { id: 'path_sanitize_colon', kind: 'sanitize', name: 'ab:c', expect: 'ok', expected: 'ab_c' },
  { id: 'path_sanitize_trailing_dot', kind: 'sanitize', name: 'report.', expect: 'ok', expected: 'report_' },
  { id: 'path_sanitize_trailing_space', kind: 'sanitize', name: 'a ', expect: 'ok', expected: 'a_' },
  { id: 'path_sanitize_reserved', kind: 'sanitize', name: 'CON', expect: 'ok', expected: '_CON' },
  { id: 'path_sanitize_reserved_ext', kind: 'sanitize', name: 'nul.txt', expect: 'ok', expected: '_nul.txt' },
  { id: 'path_sanitize_bidi', kind: 'sanitize', name: 'evil\u202efdp.exe', expect: 'ok', expected: 'evilfdp.exe' },
  { id: 'path_sanitize_keeps_clean', kind: 'sanitize', name: 'photo.jpg', expect: 'ok', expected: 'photo.jpg' },
  { id: 'path_sanitize_nfd_unchanged', kind: 'sanitize', name: 'e\u0301.txt', expect: 'ok', expected: 'e\u0301.txt' },
  { id: 'path_sanitize_rejects_dotdot', kind: 'sanitize', name: '..', expect: 'reject' },
  { id: 'path_rel_join_ok', kind: 'rel-join', expect: 'ok' },
  { id: 'path_rel_join_empty_segment', kind: 'rel-join', expect: 'reject', reason: 'empty name' },
  { id: 'path_rel_join_dotdot', kind: 'rel-join', expect: 'reject', reason: "'.' and '..'" },
  { id: 'path_rel_join_long', kind: 'rel-join', expect: 'reject', reason: '4096-byte limit' },
  { id: 'path_ensure_contained_ok', kind: 'contained', expect: 'ok' },
  { id: 'path_ensure_contained_escape', kind: 'contained', expect: 'reject', reason: 'outside' },
]

const CHECKS = VECTOR.filter((c): c is CheckCase => c.kind === 'check')
const SANITIZE = VECTOR.filter((c): c is SanitizeCase => c.kind === 'sanitize')
const NATIVE = VECTOR.filter((c): c is NativeCase => c.kind === 'rel-join' || c.kind === 'contained')

function refusedWith(fn: () => unknown, reason: string | undefined): void {
  try {
    fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (reason !== undefined) expect(message).toContain(reason)
    return
  }
  throw new Error('expected the call to be refused')
}

beforeAll(() => {
  loadWasm()
})

describe('the check rule: portable is the strict set, windows adds host semantics', () => {
  it('all 23 check cases', () => {
    expect(CHECKS.length).toBe(23)
    for (const c of CHECKS) {
      const call = () => checkPathComponent(c.name, c.portable, c.windows)
      if (c.expect === 'reject') refusedWith(call, c.reason)
      else expect(call).not.toThrow()
    }
  })
})

describe('the archive rewrite: recoverable names are rewritten, never dropped', () => {
  it('all 9 sanitize cases, through both exports', () => {
    expect(SANITIZE.length).toBe(9)
    for (const c of SANITIZE) {
      if (c.expect === 'reject') {
        refusedWith(() => sanitizePathComponent(c.name), undefined)
        refusedWith(() => archiveEntryName(c.name), undefined)
        continue
      }
      expect(sanitizePathComponent(c.name)).toBe(c.expected!)
      // archiveEntryName is the same portable rule under the archive name.
      expect(archiveEntryName(c.name)).toBe(c.expected!)
    }
  })

  it('a refused name falls back deterministically; a safe last segment is kept', () => {
    expect(safeArchiveName('Holiday', 'folder-deadbeef')).toBe('Holiday')
    expect(safeArchiveName('repo:2026', 'folder-deadbeef')).toBe('repo_2026')
    expect(safeArchiveName('CON', 'folder-deadbeef')).toBe('_CON')
    // `..` cannot be repaired: the id name is written instead.
    expect(safeArchiveName('..', 'folder-deadbeef')).toBe('folder-deadbeef')
    // A separator is refused, but the file's own last segment is a safe name.
    expect(safeArchiveName('../escape.txt', 'file-deadbeef')).toBe('escape.txt')
    expect(safeArchiveName('a\\b.txt', 'file-deadbeef')).toBe('b.txt')
  })

  it('the native-only half is not in the wasm surface (a browser has no local paths)', () => {
    expect(NATIVE.map((c) => c.id)).toContain('path_ensure_contained_escape')
    const surface = Object.keys(loadWasm() as unknown as Record<string, unknown>)
    expect(surface).not.toContain('safeRelJoin')
    expect(surface).not.toContain('ensureContained')
    expect(surface).not.toContain('safeChild')
    expect(surface).not.toContain('defaultOutputPath')
  })
})

// ─── The web caller ──────────────────────────────────────────────────────────

function file(id: string, name: string, overrides: Partial<DriveFile> = {}): DriveFile {
  return {
    id,
    name_encrypted: name,
    mime_type: null,
    size_bytes: 4,
    is_folder: false,
    is_trashed: false,
    parent_id: null,
    chunk_count: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const dots = file('f-dots', '..', { is_folder: true, size_bytes: 0 })
const slashed = file('f-slash', 'a/b', { is_folder: true, size_bytes: 0 })
const escape = file('f-esc', '../escape.txt', { parent_id: 'f-dots' })
const angled = file('f-angle', 'a<b>c.txt', { parent_id: 'f-dots' })
const note = file('f-note', 'note.txt', { parent_id: 'f-slash' })

const tree: Record<string, DriveFile[]> = {
  root: [dots, slashed],
  'f-dots': [escape, angled],
  'f-slash': [note],
}

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  listFiles: async (folderId: string) => tree[folderId] ?? [],
})

const names: Record<string, string> = {
  'f-esc': '../escape.txt',
  'f-angle': 'a<b>c.txt',
  'f-note': 'note.txt',
}

const { downloadAsZipWith } = await import('../src/lib/bulk-download')

function recordingSink(): { sink: ZipSink; bytes: () => Uint8Array } {
  const chunks: Uint8Array[] = []
  return {
    sink: {
      write: async (chunk) => {
        chunks.push(chunk)
      },
      close: async () => {},
      abort: async () => {},
    },
    bytes: () => {
      const total = chunks.reduce((n, c) => n + c.length, 0)
      const out = new Uint8Array(total)
      let at = 0
      for (const chunk of chunks) {
        out.set(chunk, at)
        at += chunk.length
      }
      return out
    },
  }
}

/** Names in the order their local file headers appear in the archive. */
function entryNames(bytes: Uint8Array): string[] {
  const found: string[] = []
  for (let i = 0; i + 30 <= bytes.length; i++) {
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 0x03 || bytes[i + 3] !== 0x04) {
      continue
    }
    const nameLength = bytes[i + 26] | (bytes[i + 27] << 8)
    if (nameLength <= 0 || i + 30 + nameLength > bytes.length) continue
    found.push(new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLength)))
  }
  return found
}

function ports(): BulkDownloadPorts {
  return {
    listChildren: async (folderId) => tree[folderId] ?? [],
    getFileKey: async (f) => new TextEncoder().encode(f.id.padEnd(32, '.')),
    decryptToBlob: async (f) => ({
      plaintext: new Blob([`bytes:${f.id}`]),
      filename: names[f.id] ?? `file-${f.id}`,
    }),
  }
}

describe('bulk download: no archive entry can climb out of its folder', () => {
  it('a `..` folder, a slashed folder, and a `../` file are all written safely', async () => {
    const recording = recordingSink()
    const result = await downloadAsZipWith(ports(), [dots, slashed], {
      sink: recording.sink,
      zipFilename: 'a.zip',
    })

    expect(result.errorCount).toBe(0)
    const packed = entryNames(recording.bytes())
    // Core's rule keeps the file's own last segment; `..` as a folder name is
    // unrecoverable, so the id name is written instead. Nothing is dropped.
    expect(packed).toEqual([
      'folder-f-dots/escape.txt',
      'folder-f-dots/a_b_c.txt',
      'b/note.txt',
    ])
    for (const name of packed) {
      expect(name.includes('..')).toBe(false)
      expect(name.startsWith('/')).toBe(false)
    }
    // The entries carry the files' bytes, not just their names.
    expect(recording.bytes().length).toBeGreaterThan(0)
  })
})
