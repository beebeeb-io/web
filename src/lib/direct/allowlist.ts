import type * as Wasm from 'beebeeb-wasm'
import allowlist from '../../../config/storage-allowlist.json'

export interface Pair { host: string; bucket: string }
export interface Discovery {
  download?: string[]
  upload?: string[]
  storage_hosts?: string[]
  storage_buckets?: Pair[]
}

export function storageSource(pair: Pair, dev = false): string {
  // A path segment, never a bare provider host, wildcard, query or URL.
  if (!/^[a-z0-9.-]+(?::[0-9]+)?$/.test(pair.host) || !/^[a-z0-9][a-z0-9.-]*$/.test(pair.bucket)) {
    throw new Error('Invalid storage allowlist pair')
  }
  const loopback = /^(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(pair.host)
  return `${dev && loopback ? 'http' : 'https'}://${pair.host}/${pair.bucket}/`
}

/** The rule is core's: the direction must be offered, at least one pair must be listed, and every
 * discovery pair must be in the allowlist (hosts ASCII case-insensitive, buckets exact). The core
 * surface is passed in so the decision runs on the session's engine and tests can see the call. */
export function pairsAllowed(core: Pick<typeof Wasm, 'pairsAllowed'>, discovery: Discovery, direction: 'download' | 'upload', pairs: Pair[]): boolean {
  return core.pairsAllowed(discovery, direction, pairs)
}

export function configuredPairs(): Pair[] {
  const pairs: Pair[] = [...allowlist.pairs]
  if (import.meta.env?.DEV && import.meta.env.VITE_DEV_STORAGE_PAIR) {
    const pair = JSON.parse(import.meta.env.VITE_DEV_STORAGE_PAIR) as Pair
    storageSource(pair, true)
    pairs.push(pair)
  }
  return pairs
}
