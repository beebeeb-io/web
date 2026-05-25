import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')

describe('HEIC preview routing', () => {
  test('routes HEIC/HEIF files through the dedicated client-side converter', () => {
    const source = readFileSync(join(root, 'src/components/preview/file-preview.tsx'), 'utf8')

    expect(source).toContain("import { HeicPreview } from './heic-preview'")
    expect(source).toContain('<HeicPreview')

    const heicBranch = source.slice(
      source.indexOf('if (HEIC_IMAGE_MIMES'),
      source.indexOf("if (mimeType?.startsWith('image/')"),
    )
    expect(heicBranch).not.toContain('<RawPreview')
  })

  test('declares the HEIC decoder as a lazy-loadable dependency', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
    }
    const source = readFileSync(join(root, 'src/components/preview/heic-preview.tsx'), 'utf8')

    expect(pkg.dependencies).toHaveProperty('@discourse/heic')
    expect(source).toContain("import('@discourse/heic/decode')")
    expect(source).toContain("import('@discourse/heic/codec/dec/heic_dec.wasm?url')")
  })
})
