/**
 * LD-0001 PR-B: the two-part preview state (contract §7), the no-pull
 * fallback watchdog (§3), the element-error discrimination (§4 rows 6-7) and
 * the network-error recovery budget (§2.1).
 *
 * The state is `transport` (what the network and player are doing) plus
 * `verified`, a Set of DISTINCT chunk indices opened in this session. A
 * re-open after eviction never counts twice, and `tagsVerified` is true only
 * when every chunk opened. The copy formatter is the only place these strings
 * exist; it never says "complete", "intact" or "original" for a stream.
 */
import type { Clock } from './source'

export type Transport =
  | 'preparing'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'stalled'
  | 'ended'
  | 'downloading'
  | 'decrypting'
  | 'loaded'
  | 'unsupported'
  | 'error'
  | 'changed'

export type ErrorKind = 'auth' | 'network'

export interface MediaState {
  transport: Transport
  /** N: the row's chunk count. */
  totalParts: number
  /** Distinct chunk indices that opened successfully in this session. */
  verified: ReadonlySet<number>
  receivedBytes: number
  totalBytes: number | null
  decryptedChunks: number
  errorKind: ErrorKind | null
  errorIndex: number | null
}

export type MediaEvent =
  | { type: 'open'; mode: 'streaming' | 'whole-file' }
  | { type: 'verified'; index: number }
  | { type: 'ready' }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'waiting' }
  | { type: 'data' }
  | { type: 'stalled' }
  | { type: 'attempts-failed'; index?: number }
  | { type: 'ended' }
  | { type: 'seek-back' }
  | { type: 'stream-rejected' }
  | { type: 'unsupported' }
  | { type: 'error'; kind: ErrorKind; index: number }
  | { type: 'changed' }
  | { type: 'body-ended'; partsLeft: boolean }
  | {
      type: 'progress'
      receivedBytes?: number
      totalBytes?: number | null
      decryptedChunks?: number
      totalParts?: number
    }

export function createMediaState(totalParts: number): MediaState {
  return {
    transport: 'preparing',
    totalParts,
    verified: new Set<number>(),
    receivedBytes: 0,
    totalBytes: null,
    decryptedChunks: 0,
    errorKind: null,
    errorIndex: null,
  }
}

function isPlaying(t: Transport): boolean {
  return t === 'playing' || t === 'paused' || t === 'buffering' || t === 'stalled'
}

export function reduceMediaState(state: MediaState, event: MediaEvent): MediaState {
  switch (event.type) {
    case 'open':
      return { ...state, transport: event.mode === 'streaming' ? 'preparing' : 'downloading' }
    case 'verified': {
      if (state.verified.has(event.index)) return state
      const verified = new Set(state.verified)
      verified.add(event.index)
      return { ...state, verified }
    }
    case 'ready':
      return state.transport === 'preparing' ? { ...state, transport: 'ready' } : state
    case 'play':
      return state.transport === 'ready' || isPlaying(state.transport)
        ? { ...state, transport: 'playing' }
        : state
    case 'pause':
      return state.transport === 'playing' ? { ...state, transport: 'paused' } : state
    case 'waiting':
      return state.transport === 'playing' ? { ...state, transport: 'buffering' } : state
    case 'data':
      return state.transport === 'buffering' || state.transport === 'stalled'
        ? { ...state, transport: 'playing' }
        : state
    case 'stalled':
      return state.transport === 'buffering' ? { ...state, transport: 'stalled' } : state
    case 'attempts-failed':
      if (state.transport !== 'stalled' && state.transport !== 'buffering') return state
      return {
        ...state,
        transport: 'error',
        errorKind: 'network',
        errorIndex: event.index ?? state.errorIndex ?? 0,
      }
    case 'ended':
      return state.transport === 'playing' ? { ...state, transport: 'ended' } : state
    case 'seek-back':
      return state.transport === 'ended' ? { ...state, transport: 'buffering' } : state
    case 'stream-rejected':
      return state.transport === 'preparing' || isPlaying(state.transport)
        ? { ...state, transport: 'downloading' }
        : state
    case 'unsupported':
      return isPlaying(state.transport) || state.transport === 'ready'
        ? { ...state, transport: 'unsupported' }
        : state
    case 'error':
      if (
        state.transport === 'preparing' ||
        isPlaying(state.transport) ||
        state.transport === 'downloading' ||
        state.transport === 'decrypting'
      ) {
        return { ...state, transport: 'error', errorKind: event.kind, errorIndex: event.index }
      }
      return state
    case 'changed':
      return state.transport === 'preparing' || isPlaying(state.transport)
        ? { ...state, transport: 'changed' }
        : state
    case 'body-ended':
      if (state.transport === 'downloading') {
        return { ...state, transport: event.partsLeft ? 'decrypting' : 'loaded' }
      }
      // The last part opened: the whole-file preview is loaded.
      if (state.transport === 'decrypting' && !event.partsLeft) {
        return { ...state, transport: 'loaded' }
      }
      return state
    case 'progress':
      return {
        ...state,
        receivedBytes: event.receivedBytes ?? state.receivedBytes,
        totalBytes:
          event.totalBytes === undefined ? state.totalBytes : event.totalBytes,
        decryptedChunks: event.decryptedChunks ?? state.decryptedChunks,
        totalParts: event.totalParts ?? state.totalParts,
      }
    default:
      return state
  }
}

/** `tagsVerified` (info rail): true iff every distinct chunk opened. */
export function isFullyVerified(state: MediaState): boolean {
  return state.totalParts > 0 && state.verified.size === state.totalParts
}

/** Decimal-style MB used by every streaming string: `4.1 MB`. */
export function formatMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function partNumber(state: MediaState): number {
  return Math.min(state.decryptedChunks + 1, Math.max(1, state.totalParts))
}

/**
 * The exact §7 copy. `null` means this state has no copy of its own (the
 * player itself or the PR-C progress bar carries it).
 */
export function statusCopy(state: MediaState): string | null {
  switch (state.transport) {
    case 'downloading': {
      const received = formatMB(state.receivedBytes)
      if (state.totalBytes === null) return `Downloading ${received}`
      const total = formatMB(state.totalBytes)
      if (state.decryptedChunks > 0) {
        return `Downloading ${received} of ${total} · ${state.decryptedChunks} of ${state.totalParts} parts decrypted`
      }
      return `Downloading ${received} of ${total}`
    }
    case 'decrypting':
      return `Decrypting part ${partNumber(state)} of ${state.totalParts}`
    case 'preparing': {
      const received = (state.receivedBytes / (1024 * 1024)).toFixed(1)
      return state.totalBytes === null
        ? `Downloading the start · ${received} MB`
        : `Downloading the start · ${received} of ${formatMB(state.totalBytes)}`
    }
    case 'buffering':
      return `Buffering · downloading part ${partNumber(state)} of ${state.totalParts}`
    case 'stalled':
      return 'Connection stalled · retrying'
    case 'ended':
      return isFullyVerified(state)
        ? `All ${state.totalParts} parts verified`
        : `Played to the end · ${state.verified.size} of ${state.totalParts} parts opened. Parts you skipped were not opened.`
    case 'error':
      if (state.errorKind === 'auth') {
        return `Part ${(state.errorIndex ?? 0) + 1} of this file couldn't be verified, so playback stopped there. Nothing unverified was played.`
      }
      if (state.errorKind === 'network') {
        return `The download stopped at part ${(state.errorIndex ?? 0) + 1}. Check your connection and try again.`
      }
      return null
    case 'changed':
      return 'This file changed while it was playing. Reopen it to play the new version.'
    default:
      return null
  }
}

/** The info-rail line while a stream is active (contract §7). */
export function streamingInfoLine(state: MediaState): string | null {
  if (
    state.transport !== 'playing' &&
    state.transport !== 'paused' &&
    state.transport !== 'buffering' &&
    state.transport !== 'stalled' &&
    state.transport !== 'preparing' &&
    state.transport !== 'ready' &&
    state.transport !== 'ended'
  ) {
    return null
  }
  if (isFullyVerified(state)) return `All ${state.totalParts} parts verified`
  return `Streaming · ${state.verified.size} of ${state.totalParts} parts verified`
}

// ── The no-pull fallback watchdog (§3) ──────────────────────────────────────

/** `HTMLMediaElement.NETWORK_LOADING`. */
export const NETWORK_LOADING = 2
export const NO_PULL_FALLBACK_MS = 5000

export interface NoPullWatchdog {
  /** Arm on `loadstart` only when the element is actually loading. */
  loadStart(networkState: number | null): void
  /** Arm on the first `play`. */
  play(): void
  /** The SW served a range: the player IS pulling, so never fall back. */
  openRange(): void
  /** An element `error` fires the fallback at once when no range was served. */
  mediaError(): void
  readonly fired: boolean
  dispose(): void
}

/**
 * Armed by `loadstart` + `NETWORK_LOADING`, or by `play` — never by a
 * `preload="none"` load alone, which would misfire before the player asks for
 * anything. The first `open-range` disarms it. It fires `delayMs` after
 * arming, or at once on an error that saw no range.
 */
export function createNoPullWatchdog(opts: {
  clock: Clock
  onFallback: () => void
  delayMs?: number
}): NoPullWatchdog {
  const delayMs = opts.delayMs ?? NO_PULL_FALLBACK_MS
  let armed = false
  let fired = false
  let disarmed = false
  let timer: unknown = null

  const clear = () => {
    if (timer !== null) {
      opts.clock.clearTimeout(timer)
      timer = null
    }
  }
  const arm = () => {
    if (armed || fired || disarmed) return
    armed = true
    timer = opts.clock.setTimeout(() => {
      timer = null
      if (disarmed || fired) return
      fired = true
      opts.onFallback()
    }, delayMs)
  }

  return {
    loadStart(networkState) {
      if (networkState === NETWORK_LOADING) arm()
    },
    play() {
      arm()
    },
    openRange() {
      if (fired) return
      disarmed = true
      clear()
    },
    mediaError() {
      if (fired || disarmed) return
      fired = true
      clear()
      opts.onFallback()
    },
    get fired() {
      return fired
    },
    dispose() {
      disarmed = true
      clear()
    },
  }
}

// ── Element error discrimination (§4 rows 6-7) ──────────────────────────────

/**
 * Row 6: an error before `loadedmetadata` after ranges were served means the
 * browser rejected the 206 stream → fall back whole-file ONCE.
 * Row 7: an error after metadata, or a codec the browser refuses, is today's
 * unsupported card.
 */
export function classifyElementError(facts: {
  sawLoadedMetadata: boolean
  rangesServed: boolean
  canPlayType: string
}): 'stream-rejected' | 'unsupported' {
  if (facts.canPlayType === '') return 'unsupported'
  if (!facts.sawLoadedMetadata && facts.rangesServed) return 'stream-rejected'
  return 'unsupported'
}

// ── Network-error recovery budget (§2.1: at most 2 per 60 s) ────────────────

export const NETWORK_RECOVERY_LIMIT = 2
export const NETWORK_RECOVERY_WINDOW_MS = 60_000

function inWindow(times: readonly number[], now: number): number[] {
  return times.filter((at) => now - at < NETWORK_RECOVERY_WINDOW_MS)
}

/** Whether a `MEDIA_ERR_NETWORK` may re-register and re-set `src` right now. */
export function canRecoverNetworkError(times: readonly number[], now: number): boolean {
  return inWindow(times, now).length < NETWORK_RECOVERY_LIMIT
}

/** Record one recovery. Callers keep the returned array. */
export function noteNetworkRecovery(times: readonly number[], now: number): number[] {
  return [...inWindow(times, now), now]
}
