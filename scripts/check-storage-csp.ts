import { readFileSync, writeFileSync } from 'node:fs'
import { storageSource } from '../src/lib/direct/allowlist'
import allowlist from '../config/storage-allowlist.json'

export function renderCsp(text: string, sources: string[]): string {
  return text.replace(/connect-src ([^;]+);/g, (match, entries: string) => {
    if (!entries.includes('https://api.beebeeb.io')) return match // Office sandbox stays local.
    const base = entries.split(/\s+/).filter(s => !/^https?:\/\//.test(s) ||
      ['https://api.beebeeb.io', 'https://status.beebeeb.io', 'https://errors.beebeeb.io'].includes(s))
    return `connect-src ${[...base, ...sources].join(' ')};`
  })
}

export function checkCsp(text: string, sources: string[], expected: number): void {
  const actual = [...text.matchAll(/connect-src ([^;]+);/g)].filter(m => m[1].includes('https://api.beebeeb.io'))
  if (actual.length !== expected || renderCsp(text, sources) !== text) throw new Error('Storage CSP drift')
}

if (import.meta.main) {
  const sources = allowlist.pairs.map(p => storageSource(p))
  const check = process.argv.includes('--check')
  for (const [path, count] of [['index.html', 1], ['nginx.conf', 3]] as const) {
    const text = readFileSync(path, 'utf8')
    if (check) checkCsp(text, sources, count)
    else writeFileSync(path, renderCsp(text, sources))
  }
  if (check) checkCsp(readFileSync('dist/index.html', 'utf8'), sources, 1)
  console.log(`Storage CSP: ${check ? 5 : 4} policies checked; ${sources.length} bucket sources`)
}
