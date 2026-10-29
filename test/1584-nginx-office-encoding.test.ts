/**
 * Task 1584 — the office bundle must reach the browser with ONE content
 * coding.
 *
 * Root cause of "a .docx renders as garbage on iPhone Safari": nginx served
 * each pre-compressed `/office/<version>/*.br` file with `Content-Encoding: br`
 * (add_header) AND gzipped it again on the fly (`gzip on` + gzip_types),
 * adding `Content-Encoding: gzip`. Chromium decodes the stack, WebKit does
 * not. The engine document came out as text and the editor never got past
 * "Preparing the editor…".
 *
 * This is a static check of nginx.conf. The behaviour itself was proven
 * against real nginx:1.27-alpine containers (old conf: WebKit "cannot decode
 * raw data"; new conf: WebKit iPhone opens the rich fixture) — see the task
 * file's evidence. This test keeps the fix from being undone silently.
 *
 * Also covers the service worker side: a cache generation that retires any
 * office cache an earlier generation may have filled with damaged responses,
 * and a refusal to cache a stacked Content-Encoding.
 */
import { describe, test, expect } from 'bun:test'
import { readFileSync } from 'fs'
import path from 'path'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const logic = require('../public/office-cache-logic.js')

const conf = readFileSync(path.join(__dirname, '../nginx.conf'), 'utf8')

/** Top-level `location … { … }` blocks (office locations have no nested blocks). */
function locationBlocks(src: string): { header: string; body: string }[] {
  const out: { header: string; body: string }[] = []
  const re = /^\s*location\s+([^{]+)\{/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) {
    let depth = 1
    let i = re.lastIndex
    while (depth > 0 && i < src.length) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') depth--
      i++
    }
    out.push({ header: m[1].trim(), body: src.slice(re.lastIndex, i - 1) })
  }
  return out
}

/** Directives only — comments stripped, so a comment cannot satisfy the check. */
function directives(body: string): string {
  return body
    .split('\n')
    .map((l) => l.replace(/#.*$/, ''))
    .join('\n')
}

describe('nginx.conf: pre-compressed office assets are never gzipped again', () => {
  const brBlocks = locationBlocks(conf).filter((b) => /add_header\s+Content-Encoding\s+\$office_br_encoding/.test(directives(b.body)))

  test('the check found the office asset locations (a filter matching nothing is a red)', () => {
    // wasm, data, metadata, js, html, svg, ico, txt (task 1567: THIRD_PARTY_NOTICES.txt)
    expect(brBlocks.length).toBe(8)
    for (const ext of ['wasm', 'data', 'metadata', 'js', 'html', 'svg', 'ico', 'txt']) {
      expect(brBlocks.some((b) => b.header.includes(`\\.${ext}$`))).toBe(true)
    }
  })

  test('every location that declares Content-Encoding from the br map turns gzip off', () => {
    const missing = brBlocks.filter((b) => !/^\s*gzip\s+off\s*;/m.test(directives(b.body))).map((b) => b.header)
    expect(missing).toEqual([])
  })

  test('gzip stays on server-wide for the rest of the app', () => {
    const topLevel = directives(conf.split(/^\s*location\s/m)[0])
    expect(/^\s*gzip\s+on\s*;/m.test(topLevel)).toBe(true)
  })
})

describe('service worker office cache (task 1584)', () => {
  test('cache names carry a generation, so the pre-1584 cache is retired on activate', () => {
    const current = logic.officeCacheName('72db0ce9cded3ba2')
    expect(current).toBe('beebeeb-office-g2-72db0ce9cded3ba2')
    // The exact cache name the deployed (pre-1584) worker used for the bundle
    // Guus opened — same version, older generation, possibly holding damaged
    // responses. It must be deleted even though the version did not change.
    const all = ['beebeeb-v2', 'beebeeb-office-72db0ce9cded3ba2', current]
    expect(logic.officeCacheNamesToDelete(all, current)).toEqual(['beebeeb-office-72db0ce9cded3ba2'])
  })

  test('a stacked Content-Encoding is never cached; a single one is', () => {
    const req = { method: 'GET' }
    const res = (enc: string | null) => ({ ok: true, type: 'basic', headers: { get: (n: string) => (n.toLowerCase() === 'content-encoding' ? enc : null) } })
    expect(logic.isCacheableOfficeResponse(req, res('br, gzip'))).toBe(false)
    expect(logic.isCacheableOfficeResponse(req, res('br\ngzip'))).toBe(false)
    expect(logic.isCacheableOfficeResponse(req, res('br'))).toBe(true)
    expect(logic.isCacheableOfficeResponse(req, res(null))).toBe(true)
  })
})
