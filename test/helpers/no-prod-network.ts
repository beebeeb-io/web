/**
 * Test preload (bunfig.toml [test] preload): no unit test may reach a
 * production host. Final review P3-2: run after another file had left the
 * custody memory set, a custody-upgrade test walked to a real parent lookup
 * and sent GET /files/{id} to the default API base, which is
 * https://api.beebeeb.io whenever VITE_API_URL is unset.
 *
 * fetch to beebeeb.io or any *.beebeeb.io host is refused and recorded, and a
 * global afterEach fails the test that tried it, even when the code under test
 * swallowed the rejection. Any other host goes through unchanged. A test that
 * installs its own fetch stub replaces this for its run and restores it after.
 */
import { afterEach } from 'bun:test'

const attempts: string[] = []
const realFetch = globalThis.fetch

/** beebeeb.io itself or any subdomain, whatever the case. */
export function isProductionHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '')
  return host === 'beebeeb.io' || host.endsWith('.beebeeb.io')
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = urlOf(input)
  let host = ''
  try {
    host = new URL(url).hostname
  } catch {
    // A relative or malformed URL names no production host.
  }
  if (isProductionHost(host)) {
    attempts.push(url)
    return Promise.reject(new Error(`unit test tried a production host: ${url}`))
  }
  return realFetch(input, init)
}) as typeof fetch

/** For the guard's own test: take what it provoked, so the global hook stays quiet. */
export function takeProductionAttemptsForTests(): string[] {
  return attempts.splice(0)
}

afterEach(() => {
  if (attempts.length === 0) return
  const tried = attempts.splice(0)
  throw new Error(`a unit test tried to reach production: ${tried.join(', ')}`)
})
