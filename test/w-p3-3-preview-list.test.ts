// W-P3-3: the preview gate reads core's per-platform table through
// `previewableBatchFor(names, "web")`. Consolidation had replaced web's own
// allowlist with core's single (mobile) list and web lost 18 types it could
// render; core #65 restored a column per client. This vector pins the open
// gate to web's list from BEFORE that switch — every type web previewed then
// previews again, and nothing else does (so the gate never offers a "Preview"
// the renderer cannot open).
//
// The expected list is `git show aee93c8e^:src/lib/preview.ts`
// (`PREVIEWABLE_EXTENSIONS`, 78 entries), read before W-P3-3 landed.
import { describe, expect, it } from 'bun:test'
import { ensurePreviewWasm, isPreviewable } from '../src/lib/preview'

const WEB_PRE_SWITCH_EXTENSIONS = [
  // Images (native browser + HEIC via heic2any)
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'heic', 'heif', 'tiff', 'tif',
  // Camera RAW (download-only preview card)
  'dng', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf',
  // Video (including HEVC)
  'mp4', 'mov', 'webm', 'mkv', 'hevc',
  // Audio
  'mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'aiff', 'aif', 'wma', 'alac',
  // Text / code
  'txt', 'md', 'csv', 'json', 'xml', 'html', 'css', 'js', 'ts', 'py', 'rs', 'go', 'sh',
  'tsv', 'yaml', 'log', 'ini', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'cs', 'rb', 'php', 'sql', 'toml',
  'tsx', 'jsx', 'dockerfile',
  // Legacy .xls (XlsxRenderer mime-matches application/vnd.ms-excel)
  'xls',
  // Documents
  'pdf', 'docx', 'xlsx',
  // Presentations (download-only preview card)
  'pptx', 'ppt', 'odp', 'key',
  // Archives (honest ZIP central-directory listing, task 1574)
  'zip',
] as const

// Core's 90-extension list minus web's 60 shared entries. Web never previewed
// these before the switch, so the web gate must not start now.
const CORE_ONLY_EXTENSIONS = [
  'astro',
  'avi',
  'bash',
  'cmake',
  'conf',
  'dart',
  'ex',
  'exs',
  'graphql',
  'gz',
  'hpp',
  'htm',
  'less',
  'makefile',
  'markdown',
  'nim',
  'ods',
  'odt',
  'proto',
  'r',
  'rtf',
  'scss',
  'svelte',
  'tar',
  'tgz',
  'v',
  'vue',
  'yml',
  'zig',
  'zsh',
] as const

// The exact 18 W-P3-3 dropped (web-only in the pre-switch list): the
// regression this test exists for.
const RESTORED_EXTENSIONS = [
  'arw',
  'cr2',
  'cr3',
  'dng',
  'nef',
  'orf',
  'raf',
  'rw2',
  'hevc',
  'aiff',
  'aif',
  'alac',
  'oga',
  'ppt',
  'key',
  'zip',
  'xls',
  'tsv',
] as const

describe('W-P3-3 preview list is core\'s web column', () => {
  it('previews exactly web\'s pre-switch list: all 78, the 18 restored, no core-only type', async () => {
    await ensurePreviewWasm()
    expect(WEB_PRE_SWITCH_EXTENSIONS.length).toBe(78)
    expect(new Set(WEB_PRE_SWITCH_EXTENSIONS).size).toBe(78)
    for (const ext of WEB_PRE_SWITCH_EXTENSIONS) {
      expect(isPreviewable(null, `report.${ext}`), ext).toBe(true)
      expect(isPreviewable(null, `REPORT.${ext.toUpperCase()}`), ext.toUpperCase()).toBe(true)
    }
    expect(RESTORED_EXTENSIONS.length).toBe(18)
    for (const ext of RESTORED_EXTENSIONS) {
      expect(WEB_PRE_SWITCH_EXTENSIONS).toContain(ext as (typeof WEB_PRE_SWITCH_EXTENSIONS)[number])
      expect(isPreviewable(null, `report.${ext}`), ext).toBe(true)
    }
    expect(CORE_ONLY_EXTENSIONS.length).toBe(30)
    for (const ext of CORE_ONLY_EXTENSIONS) {
      expect(WEB_PRE_SWITCH_EXTENSIONS).not.toContain(ext as (typeof WEB_PRE_SWITCH_EXTENSIONS)[number])
      expect(isPreviewable(null, `report.${ext}`), ext).toBe(false)
    }
  })

  it('MIME class and extension are independent ways to pass', async () => {
    await ensurePreviewWasm()
    for (const mime of [
      'image/png',
      'video/mp4',
      'audio/mpeg',
      'text/plain',
      'application/pdf',
      'application/json',
      'application/xml',
      'application/javascript',
    ]) {
      expect(isPreviewable(mime, 'no-extension'), mime).toBe(true)
    }
    expect(isPreviewable('application/octet-stream', null)).toBe(false)
    expect(isPreviewable('', 'photo.heic')).toBe(true)
    expect(isPreviewable(null, 'photo.heic')).toBe(true)
    expect(isPreviewable(null, 'no-dot')).toBe(false)
    // Only the last segment counts: web previews `zip`, and never previewed
    // `gz` (core-only), which is also why the compound archive stays closed.
    expect(isPreviewable(null, 'archive.zip')).toBe(true)
    expect(isPreviewable(null, 'archive.tar.gz')).toBe(false)
    expect(isPreviewable(null, 'notes.txt.backup')).toBe(false)
  })
})
