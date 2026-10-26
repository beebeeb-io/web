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

export function directAllowed(discovery: Discovery, direction: 'download' | 'upload', pairs: Pair[]): boolean {
  const token = direction === 'download' ? 'object-download-v1' : 'object-upload-v1'
  return discovery[direction]?.includes(token) === true && !!discovery.storage_buckets?.length &&
    discovery.storage_buckets.every(p => pairs.some(a => a.host === p.host && a.bucket === p.bucket))
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
