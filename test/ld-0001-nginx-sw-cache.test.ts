/**
 * LD-0001 PR-B (§8): `/sw.js` and every `/<name>-logic.js` must not be pinned
 * as immutable in the browser, or a deploy leaves an old service worker (and
 * an old range-responder) running for a year.
 *
 * Static check of nginx.conf, next to `test/1584-nginx-office-encoding.test.ts`
 * and using the same block parser. It also pins the COEP/CORP re-declaration:
 * a location with its own `add_header` drops the server-level ones, and both
 * files must keep serving the isolation headers every other asset has.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import path from 'path'

const conf = readFileSync(path.join(__dirname, '../nginx.conf'), 'utf8')

function locationBlocks(src: string): { header: string; body: string; start: number }[] {
  const out: { header: string; body: string; start: number }[] = []
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
    out.push({ header: m[1].trim(), body: src.slice(re.lastIndex, i - 1), start: m.index ?? 0 })
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

const blocks = locationBlocks(conf)

function findLocation(match: (header: string) => boolean) {
  return blocks.find((b) => match(b.header))
}

function expectServedFresh(body: string, label: string) {
  const d = directives(body)
  expect([label, /^\s*add_header\s+Cache-Control\s+"no-cache"/m.test(d)]).toEqual([label, true])
  expect([label, /^\s*add_header\s+Cross-Origin-Embedder-Policy\s+"require-corp"\s+always\s*;/m.test(d)]).toEqual([
    label,
    true,
  ])
  expect([label, /^\s*add_header\s+Cross-Origin-Resource-Policy\s+"cross-origin"\s+always\s*;/m.test(d)]).toEqual([
    label,
    true,
  ])
}

describe('T31 nginx_no_cache_for_sw_and_logic_js_keeps_coep_corp', () => {
  test('the exact /sw.js location is no-cache and re-declares COEP/CORP', () => {
    const block = findLocation((h) => /^=\s*\/sw\.js$/.test(h))
    expect(block).toBeDefined()
    expectServedFresh(block!.body, '/sw.js')
  })

  test('every /<name>-logic.js is no-cache and re-declares COEP/CORP', () => {
    const block = findLocation((h) => /-logic/.test(h) && h.startsWith('~'))
    expect(block).toBeDefined()
    expect(block!.header).toContain('[^/]+-logic')
    expectServedFresh(block!.body, '*-logic.js')
  })

  test('both come before the immutable hashed-asset location, so it cannot swallow them', () => {
    const hashed = findLocation((h) => /\\\.\(js\|css\|wasm/.test(h))
    expect(hashed).toBeDefined()
    const sw = findLocation((h) => /^=\s*\/sw\.js$/.test(h))!
    const logic = findLocation((h) => /-logic/.test(h) && h.startsWith('~'))!
    expect(sw.start).toBeLessThan(hashed!.start)
    expect(logic.start).toBeLessThan(hashed!.start)
  })

  test('the generic hashed assets stay immutable (the fix is scoped)', () => {
    const hashed = findLocation((h) => /\\\.\(js\|css\|wasm/.test(h))!
    expect(/add_header\s+Cache-Control\s+"public, immutable"/.test(directives(hashed.body))).toBe(true)
  })

  test('sw.js is not served by the SPA or office locations', () => {
    for (const block of blocks) {
      if (/^=\s*\/sw\.js$/.test(block.header)) continue
      expect([block.header, /\/sw\.js/.test(block.header)]).toEqual([block.header, false])
    }
  })
})
