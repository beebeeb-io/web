import { expect, test } from 'bun:test'
import { readFileSync, existsSync } from 'node:fs'
import { checkCsp, renderCsp } from '../scripts/check-storage-csp'
import allowlist from '../config/storage-allowlist.json'
import { storageSource } from '../src/lib/direct/allowlist'
const sources = allowlist.pairs.map(p => storageSource(p))
test('source page and three nginx policies match allowlist; Office stays isolated', () => {
  checkCsp(readFileSync('index.html', 'utf8'), sources, 1)
  const nginx = readFileSync('nginx.conf', 'utf8')
  checkCsp(nginx, sources, 3)
  expect(nginx.match(/connect-src 'self';/g)?.length).toBe(1)
})
test('guard rejects a bare host, missing slash, extra bucket and missing policy', () => {
  const text = "connect-src 'self' https://api.beebeeb.io https://s3.test/bb/;"
  checkCsp(text, ['https://s3.test/bb/'], 1)
  for (const bad of ['https://s3.test', 'https://s3.test/bb', 'https://s3.test/evil/']) {
    expect(() => checkCsp(text.replace('https://s3.test/bb/', bad), ['https://s3.test/bb/'], 1)).toThrow()
  }
  expect(() => checkCsp(text, [], 2)).toThrow()
  expect(renderCsp("connect-src 'self';", sources)).toBe("connect-src 'self';")
})
// Build validation invokes the same checker unconditionally after Vite, including in CI.
test('built page has no development storage pair when a build is present', () => {
  if (existsSync('dist/index.html')) checkCsp(readFileSync('dist/index.html', 'utf8'), sources, 1)
  expect(readFileSync('vite.config.ts', 'utf8')).toContain("apply: 'serve'")
})
