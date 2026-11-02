// W-P3-3: the preview allowlist is core's `beebeeb_core::media`, reached through
// wasm. The gate and the renderer used to drift because each kept its own copy
// (task 1565); this vector pins the list to core's 90 extensions and records
// the entries core does not accept.
import { describe, expect, it } from 'bun:test'
import { ensurePreviewWasm, isPreviewable } from '../src/lib/preview'

const CORE_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'svg',
  'bmp',
  'ico',
  'avif',
  'heic',
  'heif',
  'tiff',
  'tif',
  'mp4',
  'mov',
  'webm',
  'mkv',
  'avi',
  'mp3',
  'flac',
  'wav',
  'aac',
  'ogg',
  'm4a',
  'opus',
  'wma',
  'pdf',
  'txt',
  'md',
  'markdown',
  'csv',
  'log',
  'rtf',
  'docx',
  'xlsx',
  'pptx',
  'odt',
  'ods',
  'odp',
  'tar',
  'gz',
  'tgz',
  'py',
  'js',
  'jsx',
  'ts',
  'tsx',
  'rs',
  'go',
  'rb',
  'java',
  'kt',
  'swift',
  'c',
  'cpp',
  'h',
  'hpp',
  'cs',
  'php',
  'sh',
  'bash',
  'zsh',
  'html',
  'htm',
  'css',
  'scss',
  'less',
  'vue',
  'svelte',
  'astro',
  'dart',
  'r',
  'ex',
  'exs',
  'zig',
  'nim',
  'v',
  'json',
  'xml',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'sql',
  'graphql',
  'proto',
  'cmake',
  'dockerfile',
  'makefile',
] as const

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

const WEB_ONLY_EXTENSIONS = [
  'aif',
  'aiff',
  'alac',
  'arw',
  'cr2',
  'cr3',
  'dng',
  'hevc',
  'key',
  'nef',
  'oga',
  'orf',
  'ppt',
  'raf',
  'rw2',
  'tsv',
  'xls',
  'zip',
] as const

describe('W-P3-3 preview list comes from core', () => {
  it('core extensions preview and the local-only ones no longer do', async () => {
    await ensurePreviewWasm()
    expect(CORE_EXTENSIONS.length).toBe(90)
    for (const ext of CORE_EXTENSIONS) {
      expect(isPreviewable(null, `report.${ext}`), ext).toBe(true)
      expect(isPreviewable(null, `REPORT.${ext.toUpperCase()}`), ext.toUpperCase()).toBe(true)
    }
    expect(WEB_ONLY_EXTENSIONS.length).toBe(18)
    for (const ext of WEB_ONLY_EXTENSIONS) {
      expect(isPreviewable(null, `report.${ext}`), ext).toBe(false)
    }
    expect(CORE_ONLY_EXTENSIONS.length).toBe(30)
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
    expect(isPreviewable(null, 'archive.tar.gz')).toBe(true)
    expect(isPreviewable(null, 'notes.txt.backup')).toBe(false)
  })
})
