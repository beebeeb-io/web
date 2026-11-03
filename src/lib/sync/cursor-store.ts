// Local cursor + device identity for the sync client.
//
// `bb_sync_last_seq` is the global op cursor; `bb_sync_device_id` identifies
// this tab's device to the server. Both live in localStorage, so this module
// is the only place the sync client touches persisted state.

const LAST_SEQ_KEY = 'bb_sync_last_seq'
const DEVICE_ID_KEY = 'bb_sync_device_id'

export function uuid(): string {
  const c = globalThis.crypto as Crypto & { randomUUID?: () => string }
  if (typeof c.randomUUID === 'function') {
    return c.randomUUID()
  }
  // Fallback: random bytes shaped into a v4 UUID.
  const bytes = c.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b: number) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY)
  if (!id) {
    id = uuid()
    localStorage.setItem(DEVICE_ID_KEY, id)
  }
  return id
}

export function loadLastSeq(): number {
  const raw = localStorage.getItem(LAST_SEQ_KEY)
  if (!raw) return 0
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

export function saveLastSeq(seq: number): void {
  localStorage.setItem(LAST_SEQ_KEY, String(seq))
}
