// The drive-ui import rule: shared Drive components import only react, @tanstack/react-virtual, the design
// system (../design, ../../design), type-only domain types (../types) and themselves. Nothing that reaches
// the API, WASM, telemetry, a router or any web app code.
import { describe, expect, test } from 'bun:test'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dir, '../packages/shared/src/drive-ui')

export function forbiddenImports(source: string, fileDir: string): string[] {
  const bad: string[] = []
  const re = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/g
  for (const m of source.matchAll(re)) {
    const spec = m[1]
    if (spec === 'react' || spec === 'react/jsx-runtime' || spec === '@tanstack/react-virtual') continue
    if (spec.startsWith('./')) continue
    if (spec.startsWith('../')) {
      const resolved = join(fileDir, spec)
      const rel = relative(ROOT, resolved)
      const inside = !rel.startsWith('..')
      const topOf = relative(join(ROOT, '..'), resolved).split('/')[0]
      if (inside) continue
      if (topOf === 'design' || topOf === 'types') continue
    }
    bad.push(spec)
  }
  return bad
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n)
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : []
  })
}

describe('drive-ui imports', () => {
  test('every drive-ui file imports only what the rule allows', () => {
    const files = walk(ROOT)
    expect(files.length).toBeGreaterThan(20)
    const bad = files.flatMap((f) => forbiddenImports(readFileSync(f, 'utf8'), join(f, '..')).map((s) => `${relative(ROOT, f)}: ${s}`))
    expect(bad).toEqual([])
  })

  test('a planted ../api, router, wasm or app import is refused', () => {
    for (const spec of ['../api', '../telemetry', 'react-router-dom', 'beebeeb-wasm', '../../../src/lib/api']) {
      expect(forbiddenImports(`import x from '${spec}'`, ROOT)).toEqual([spec])
    }
    expect(forbiddenImports(`import x from '../../api'`, join(ROOT, 'file-list'))).toEqual(['../../api'])
    expect(forbiddenImports(`import { Icon } from '../../design'`, join(ROOT, 'file-list'))).toEqual([])
  })
})
