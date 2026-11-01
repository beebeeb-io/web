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
import { ApiError } from '../api'
import { UNVERIFIED_FILE_COPY } from '../encrypted-download'

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

/**
 * Why a stream stopped, as the UI tells it (round 4, B-R1). The session's
 * kinds (PR-A A-R2) plus 'metadata': the file's encrypted details did not
 * verify. Only 'auth' says a part "couldn't be verified".
 */
export type ErrorKind = 'auth' | 'network' | 'unauthorized' | 'unavailable' | 'internal' | 'metadata'

export interface MediaState {
  transport: Transport
  /** N: the row's chunk count. */
  totalParts: number
  /** Distinct chunk indices that opened successfully in this session. */
  verified: ReadonlySet<number>
  receivedBytes: number
  totalBytes: number | null
  decryptedChunks: number
  /**
   * B7: the 0-based chunk the player's latest pull needs (streaming only).
   * The buffering pill names this part; null until the first pull.
   */
  currentPart: number | null
  errorKind: ErrorKind | null
  errorIndex: number | null
}

export type MediaEvent =
  | { type: 'open'; mode: 'streaming' | 'whole-file' }
  | { type: 'verified'; index: number }
  /** The SW pulled bytes from chunk `index` (B7). */
  | { type: 'pull'; index: number }
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
    currentPart: null,
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
    case 'pull':
      return state.currentPart === event.index ? state : { ...state, currentPart: event.index }
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

/** The two §7 error copies. They name a part index (0-based in, 1-based out). */
/** 401: the session expired. The action is "Sign in", never a retry. */
export const SESSION_EXPIRED_COPY = 'Your session has expired. Sign in again to play this file.'
/** The server refused a part, or served parts that disagree with the file's record. */
export const STREAM_UNAVAILABLE_COPY = "This file can't be streamed right now. Try again, or download it."
/** The crypto worker or WASM failed in this tab. */
export const STREAM_INTERNAL_COPY =
  'Playback stopped because of a problem in this browser tab. Reload the page and try again.'

/**
 * The error copy per kind. Only 'auth' (a part's authentication tag did not
 * open) says "couldn't be verified"; nothing else claims anything about the
 * file's bytes.
 */
export function streamErrorCopy(kind: ErrorKind, index: number): string {
  switch (kind) {
    case 'auth':
      return `Part ${index + 1} of this file couldn't be verified, so playback stopped there. Nothing unverified was played.`
    case 'unauthorized':
      return SESSION_EXPIRED_COPY
    case 'unavailable':
      return STREAM_UNAVAILABLE_COPY
    case 'internal':
      return STREAM_INTERNAL_COPY
    case 'metadata':
      return UNVERIFIED_FILE_COPY
    case 'network':
    default:
      return `The download stopped at part ${index + 1}. Check your connection and try again.`
  }
}

/** What the error box offers: "Sign in" for an expired session, else "Try again". */
export function errorActionFor(kind: ErrorKind): 'retry' | 'sign-in' {
  return kind === 'unauthorized' ? 'sign-in' : 'retry'
}

const STREAM_ERROR_KINDS: ReadonlySet<string> = new Set([
  'auth',
  'changed',
  'network',
  'unauthorized',
  'unavailable',
  'internal',
])

/** A setup failure as the UI tells it. */
export type SetupFailureKind = ErrorKind | 'changed'

/**
 * B6 + round 4 B-R1: what a failed streaming SETUP shows.
 *  - a PR-A `StreamSessionError` keeps its kind: only 'auth' (a frame failed
 *    authentication) says a part "couldn't be verified";
 *  - metadata that does not verify (`UnverifiedFileMetadataError`) is
 *    'metadata', with the whole-file path's own copy;
 *  - an HTTP failure resolving the key: 401 'unauthorized', another refusal
 *    'unavailable', 409 'changed';
 *  - anything else (a key or metadata fetch that never answered) is a
 *    network error with "Try again".
 */
export function classifySetupFailure(err: unknown): { kind: SetupFailureKind; index: number } {
  const candidate = err as { name?: unknown; kind?: unknown; index?: unknown } | null
  if (candidate && typeof candidate === 'object' && candidate.name === 'StreamSessionError') {
    const index = typeof candidate.index === 'number' ? candidate.index : 0
    const kind = typeof candidate.kind === 'string' && STREAM_ERROR_KINDS.has(candidate.kind)
      ? (candidate.kind as SetupFailureKind)
      : 'internal'
    return { kind, index }
  }
  if (candidate && typeof candidate === 'object' && candidate.name === 'UnverifiedFileMetadataError') {
    return { kind: 'metadata', index: 0 }
  }
  if (err instanceof ApiError) {
    if (err.status === 401) return { kind: 'unauthorized', index: 0 }
    if (err.status === 409) return { kind: 'changed', index: 0 }
    if (err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
      return { kind: 'unavailable', index: 0 }
    }
  }
  return { kind: 'network', index: 0 }
}

/** Row 9: the pinned version is gone. Never shown as an authentication error. */
export const CHANGED_COPY =
  'This file changed while it was playing. Reopen it to play the new version.'

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
      // B7: the part the player waits on — the latest pull's chunk.
      return `Buffering · downloading part ${Math.min((state.currentPart ?? 0) + 1, Math.max(1, state.totalParts))} of ${state.totalParts}`
    case 'stalled':
      return 'Connection stalled · retrying'
    case 'ended':
      return isFullyVerified(state)
        ? `All ${state.totalParts} parts verified`
        : `Played to the end · ${state.verified.size} of ${state.totalParts} parts opened. Parts you skipped were not opened.`
    case 'error':
      return state.errorKind ? streamErrorCopy(state.errorKind, state.errorIndex ?? 0) : null
    case 'changed':
      return CHANGED_COPY
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
