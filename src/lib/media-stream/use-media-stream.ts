/**
 * LD-0001 PR-B: the preview's streaming session (contract §4, §7, §2.1).
 *
 * It decides the path SYNCHRONOUSLY on the first render (so the whole-file
 * effect can never start a download for a file that will stream), then opens
 * the PR-A session, registers the page bridge, wires the element events, and
 * feeds the buffering pill, the info-rail line and `tagsVerified`. A
 * `MEDIA_ERR_NETWORK` re-registers and re-sets `src` at most twice per minute,
 * restoring the playhead and the paused state. A stream rejection falls back
 * to the existing whole-file load ONCE; a codec the browser refuses shows the
 * existing unsupported card.
 *
 * Everything here is wiring: the decisions live in `path.ts`/`state.ts` and
 * the protocol in `sw-bridge.ts`, so this file stays thin.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DriveFile } from '../api'
import { openFileMetadata } from '../encrypted-download'
import { apiChunkSource, realClock, type ChunkFrameSource } from './source'
import { openStreamSession, type StreamSession } from './session'
import { createStreamBridge, type BridgeEnv, type PortLike, type StreamBridge } from './sw-bridge'
import {
  choosePreviewPath,
  mediaStreamKillSwitch,
  type MediaKind,
  type PreviewPath,
} from './path'
import {
  classifyElementError,
  classifySetupFailure,
  createMediaState,
  createNoPullWatchdog,
  isFullyVerified,
  noteNetworkRecovery,
  canRecoverNetworkError,
  reduceMediaState,
  statusCopy,
  streamErrorCopy,
  CHANGED_COPY,
  streamingInfoLine,
  type MediaEvent,
  type MediaState,
  type NoPullWatchdog,
} from './state'

const STALLED_AFTER_MS = 15_000
const MEDIA_ERR_NETWORK = 2

export interface UseMediaStreamArgs {
  file: DriveFile
  mediaKind: MediaKind | null
  /** null = the live version; streaming never covers a historical version. */
  selectedVersionId: string | null
  isUnlocked: boolean
  /** The decrypted MIME (falling back to the server field). */
  mime: string | null
  resolveFileKey: () => Promise<Uint8Array>
  /** Test seam; production resolves the API-backed source. */
  sourceFactory?: (fileId: string, objectVersionId: string) => ChunkFrameSource
  /** Test seam; production opens the PR-A session (`openStreamSession`). */
  openSession?: typeof openStreamSession
  /** Test seam; production reads the authenticated metadata (`openFileMetadata`). */
  openMetadata?: typeof openFileMetadata
}

export interface MediaStreamHandle {
  path: PreviewPath
  /** True only while a stream session owns the preview. */
  streaming: boolean
  /** `/sw-stream/<id>` once the session and its port are live. */
  src: string | null
  /** The current §7 copy (preparing, buffering, stalled, error, changed). */
  status: string | null
  /** The pill over the player: buffering / stalled only. */
  overlay: string | null
  /** The auth/network error copy (with "Try again"), or null. */
  errorCopy: string | null
  /** The info-rail line while streaming (part counts / all verified). */
  infoLine: string | null
  /** True iff every distinct chunk opened in this session (§7). */
  tagsVerified: boolean
  /**
   * B8: a video whose stream errored after `loadedmetadata` shows the
   * unsupported card; the preview must not reload it whole-file behind the
   * card. (Audio keeps its convert path, which needs the whole file.)
   */
  blockWholeFile: boolean
  /** Attach the media element the hook must drive. */
  setElement: (el: HTMLMediaElement | null) => void
  /** "Try again" for the auth/network error states. */
  retry: () => void
}

function hasServiceWorkerController(): boolean {
  try {
    return typeof navigator !== 'undefined' && !!navigator.serviceWorker?.controller
  } catch {
    return false
  }
}

function canPlayTypeFor(mediaKind: MediaKind, mime: string | null): string {
  if (!mime) return 'maybe'
  try {
    const el = document.createElement(mediaKind === 'video' ? 'video' : 'audio')
    return el.canPlayType(mime)
  } catch {
    return 'maybe'
  }
}

/**
 * B2: one id per SESSION, `s-<fileId>-<128-bit random>`. Two tabs (or two
 * sessions of one file) never share an id, so neither can reach the other's
 * registry entry; the SW also checks the owner on register and close.
 */
function streamIdFor(fileId: string): string {
  const token = new Uint8Array(16)
  crypto.getRandomValues(token)
  const hex = Array.from(token, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `s-${fileId.replace(/[^A-Za-z0-9._:-]/g, '_')}-${hex}`
}

type StreamFailure = { kind: 'auth' | 'changed' | 'network'; index: number }

/** What belongs to ONE file of the preview (B5): reset on Next/Prev. */
interface PerFileState {
  key: string
  rejected: boolean
  fallbackUsed: boolean
  failed: StreamFailure | null
  generation: number
  /** Row 7: the element errored after `loadedmetadata` (B8). */
  unsupported: boolean
}

interface PerFileRefs {
  key: string
  rejected: boolean
  recovery: number[]
}

function freshPerFile(key: string): PerFileState {
  return { key, rejected: false, fallbackUsed: false, failed: null, generation: 0, unsupported: false }
}

export function useMediaStream(args: UseMediaStreamArgs): MediaStreamHandle {
  const { file, mediaKind, selectedVersionId, isUnlocked, mime, resolveFileKey } = args
  const row = file.download_version ?? null
  const objectVersionId = row?.object_version_id ?? null

  // B5: everything that belongs to ONE file is keyed by (file.id, version), so
  // Next/Prev starts the new file clean: no inherited failure, rejection,
  // fallback, recovery budget, generation, media state or stream id.
  const fileKey = `${file.id}\u0000${selectedVersionId ?? ''}`
  const fileKeyRef = useRef(fileKey)
  fileKeyRef.current = fileKey
  const [perFileRaw, setPerFileRaw] = useState<PerFileState>(() => freshPerFile(fileKey))
  const perFile = perFileRaw.key === fileKey ? perFileRaw : freshPerFile(fileKey)
  const [attempt, setAttempt] = useState(0)
  const [mediaSlot, setMediaSlot] = useState<{ key: string; state: MediaState } | null>(null)
  const mediaState = mediaSlot && mediaSlot.key === fileKey ? mediaSlot.state : null
  /** The live session's stream id once its bridge is registered (= ready). */
  const [streamSlot, setStreamSlot] = useState<{ key: string; id: string } | null>(null)
  const streamId = streamSlot && streamSlot.key === fileKey ? streamSlot.id : null
  const streamIdRef = useRef<string | null>(null)
  const perFileRefs = useRef<PerFileRefs>({ key: fileKey, rejected: false, recovery: [] })
  if (perFileRefs.current.key !== fileKey) {
    perFileRefs.current = { key: fileKey, rejected: false, recovery: [] }
  }

  const updatePerFile = useCallback(
    (patch: (state: PerFileState) => Partial<PerFileState>) => {
      const key = fileKeyRef.current
      setPerFileRaw((prev) => {
        const base = prev.key === key ? prev : freshPerFile(key)
        return { ...base, ...patch(base) }
      })
    },
    [],
  )

  const setMediaState = useCallback(
    (next: MediaState | null | ((prev: MediaState | null) => MediaState | null)) => {
      const key = fileKeyRef.current
      setMediaSlot((prev) => {
        const base = prev && prev.key === key ? prev.state : null
        const value = typeof next === 'function' ? next(base) : next
        return value ? { key, state: value } : null
      })
    },
    [],
  )

  const canPlay = useMemo(
    () => (mediaKind ? canPlayTypeFor(mediaKind, mime) : ''),
    [mediaKind, mime],
  )

  const path = choosePreviewPath({
    media: mediaKind,
    sharedLink: false,
    liveVersion: selectedVersionId === null,
    objectVersionId,
    chunkCount: file.chunk_count,
    chunkSize: row?.chunk_size_bytes ?? null,
    sizeBytes: file.size_bytes,
    hasServiceWorkerController: hasServiceWorkerController(),
    killSwitch:
      typeof localStorage === 'undefined' ? false : mediaStreamKillSwitch(localStorage),
    canPlayType: canPlay,
    fallbackUsed: perFile.fallbackUsed,
    streamRejected: perFile.rejected,
    terminalError: perFile.failed?.kind ?? null,
    elementErroredAfterMetadata: perFile.unsupported,
  })

  const streaming = path === 'streaming'
  const src =
    streaming && streamId
      ? `/sw-stream/${streamId}${perFile.generation ? `?g=${perFile.generation}` : ''}`
      : null

  const sessionRef = useRef<StreamSession | null>(null)
  const bridgeRef = useRef<StreamBridge | null>(null)
  const watchdogRef = useRef<NoPullWatchdog | null>(null)
  const elementRef = useRef<HTMLMediaElement | null>(null)
  const sawMetadataRef = useRef(false)
  const rangesServedRef = useRef(false)
  const pendingRestoreRef = useRef<{ time: number; paused: boolean } | null>(null)
  const lastPullPartRef = useRef<number | null>(null)

  const setElement = useCallback((el: HTMLMediaElement | null) => {
    elementRef.current = el
  }, [])

  const dispatch = useCallback(
    (event: MediaEvent) => {
      setMediaState((prev) =>
        reduceMediaState(prev ?? createMediaState(file.chunk_count), event),
      )
    },
    [file.chunk_count, setMediaState],
  )

  const teardown = useCallback(() => {
    bridgeRef.current?.close()
    bridgeRef.current = null
    const session = sessionRef.current
    sessionRef.current = null
    if (session) void session.close()
    setStreamSlot(null)
  }, [])

  /** Row 6: close, wipe, hand the preview to the whole-file load — ONCE. */
  const fallBack = useCallback(() => {
    if (perFileRefs.current.rejected) {
      updatePerFile(() => ({ fallbackUsed: true }))
      return
    }
    perFileRefs.current.rejected = true
    teardown()
    updatePerFile(() => ({ rejected: true }))
  }, [teardown, updatePerFile])

  const makeEnv = useCallback((): BridgeEnv | null => {
    const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined
    if (!sw) return null
    return {
      clock: realClock,
      container: {
        postMessage(message: unknown, transfer?: unknown[]) {
          sw.controller?.postMessage(message, transfer as Transferable[])
        },
        addEventListener(type: 'message', listener: (event: { data: unknown }) => void) {
          sw.addEventListener(type, listener as unknown as EventListener)
        },
        removeEventListener(type: 'message', listener: (event: { data: unknown }) => void) {
          sw.removeEventListener(type, listener as unknown as EventListener)
        },
      },
      onControllerChange(cb: () => void) {
        sw.addEventListener('controllerchange', cb)
        return () => sw.removeEventListener('controllerchange', cb)
      },
      createChannel() {
        const channel = new MessageChannel()
        return {
          port1: channel.port1 as unknown as PortLike,
          port2: channel.port2,
        }
      },
    }
  }, [])

  const openBridge = useCallback(
    (session: StreamSession, id: string): boolean => {
      const env = makeEnv()
      if (!env) return false
      bridgeRef.current?.close()
      bridgeRef.current = createStreamBridge({
        id,
        mime: mime ?? '',
        size: session.totalSize,
        read: (reqId, offset, max) => {
          // B7: the buffering pill names the chunk the player is waiting on.
          const part = session.chunkSize > 0 ? Math.floor(offset / session.chunkSize) : 0
          if (part !== lastPullPartRef.current) {
            lastPullPartRef.current = part
            dispatch({ type: 'pull', index: part })
          }
          return session.read(reqId, offset, max)
        },
        env,
        onOpenRange: () => {
          rangesServedRef.current = true
          watchdogRef.current?.openRange()
        },
        onFatal: (code, index) => {
          if (code === 'auth') updatePerFile(() => ({ failed: { kind: 'auth', index } }))
          if (code === 'changed') updatePerFile(() => ({ failed: { kind: 'changed', index } }))
        },
      })
      return true
    },
    [dispatch, makeEnv, mime, updatePerFile],
  )

  const mediaStateRef = useRef<MediaState | null>(null)
  useEffect(() => {
    mediaStateRef.current = mediaState
  }, [mediaState])

  /** §2.1: re-register a fresh port, re-set src, at most 2 per 60 s. */
  const recoverNetwork = useCallback(() => {
    const session = sessionRef.current
    const el = elementRef.current
    const id = streamIdRef.current
    if (!session || !id) return
    const now = Date.now()
    if (!canRecoverNetworkError(perFileRefs.current.recovery, now)) {
      dispatch({
        type: 'error',
        kind: 'network',
        index: mediaStateRef.current?.verified.size ?? 0,
      })
      return
    }
    perFileRefs.current.recovery = noteNetworkRecovery(perFileRefs.current.recovery, now)
    pendingRestoreRef.current = { time: el?.currentTime ?? 0, paused: el?.paused ?? true }
    if (!openBridge(session, id)) return
    updatePerFile((state) => ({ generation: state.generation + 1 }))
  }, [dispatch, openBridge, updatePerFile])

  // ── Open the session once per (file.id, selectedVersionId, attempt) ────────
  useEffect(() => {
    if (!isUnlocked || !streaming || !mediaKind || !objectVersionId) return
    const fileId = file.id
    const key = fileKey
    let cancelled = false
    let session: StreamSession | null = null
    // A7: an abandoned open (file switch, unmount, retry) is aborted, so the
    // worker reader and its key copy never outlive this effect.
    const opening = new AbortController()
    // A new session starts with no media state of its own (a retry too).
    setMediaState(null)
    lastPullPartRef.current = null

    const run = async (): Promise<void> => {
      try {
        const fileKey = await resolveFileKey()
        const meta = await (args.openMetadata ?? openFileMetadata)(fileId, fileKey, file.name_encrypted)
        const source = args.sourceFactory
          ? args.sourceFactory(fileId, objectVersionId)
          : apiChunkSource(fileId, objectVersionId)
        const opened = await (args.openSession ?? openStreamSession)({
          fileId,
          fileKey,
          content: meta.content,
          row: {
            chunk_count: file.chunk_count,
            size_bytes: file.size_bytes,
            download_version: row,
          },
          source,
          signal: opening.signal,
        })
        if (cancelled) {
          await opened.close()
          return
        }
        session = opened
        sessionRef.current = opened
        setMediaState(createMediaState(opened.chunkCount))
        opened.onEvent((event) => {
          setMediaState((prev) => {
            const base = prev ?? createMediaState(opened.chunkCount)
            if (event.type === 'error') {
              // A replaced file (409) is the `changed` path, not an error state.
              if (event.kind === 'changed') return base
              return reduceMediaState(base, {
                type: 'error',
                kind: event.kind,
                index: event.index,
              })
            }
            if (event.type === 'verified') {
              return reduceMediaState(base, { type: 'verified', index: event.index })
            }
            if (event.type === 'received') {
              return reduceMediaState(base, {
                type: 'progress',
                receivedBytes: base.receivedBytes + event.bytes,
              })
            }
            return base
          })
          if (event.type === 'error') {
            if (event.kind === 'auth') updatePerFile(() => ({ failed: { kind: 'auth', index: event.index } }))
            if (event.kind === 'changed') updatePerFile(() => ({ failed: { kind: 'changed', index: event.index } }))
          }
        })
        const id = streamIdFor(fileId)
        if (!openBridge(opened, id)) {
          await opened.close()
          return
        }
        streamIdRef.current = id
        setStreamSlot({ key, id })
      } catch (err) {
        if (cancelled || opening.signal.aborted) return
        // B6: only the session's own authentication failure claims anything
        // about the file; a key, metadata or network failure is a network
        // error with "Try again".
        const failure = classifySetupFailure(err)
        updatePerFile(() => ({ failed: failure }))
      }
    }
    void run()

    return () => {
      cancelled = true
      opening.abort()
      bridgeRef.current?.close()
      bridgeRef.current = null
      sessionRef.current = null
      streamIdRef.current = null
      setStreamSlot(null)
      if (session) void session.close()
    }
    // `row` and the file object are read through the ids only: a parent
    // re-render with a new `file` object must not restart playback (§7).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, isUnlocked, file.id, selectedVersionId, attempt, mediaKind, objectVersionId])

  // ── Element events ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = elementRef.current
    if (!el || !src || !streaming) return
    const watchdog = createNoPullWatchdog({ clock: realClock, onFallback: fallBack })
    watchdogRef.current = watchdog
    sawMetadataRef.current = false
    rangesServedRef.current = false
    let stallTimer: ReturnType<typeof setTimeout> | null = null

    const clearStall = () => {
      if (stallTimer !== null) {
        clearTimeout(stallTimer)
        stallTimer = null
      }
    }
    const onLoadStart = () => watchdog.loadStart(el.networkState)
    const onPlay = () => {
      watchdog.play()
      dispatch({ type: 'play' })
    }
    const onPause = () => dispatch({ type: 'pause' })
    const onWaiting = () => {
      dispatch({ type: 'waiting' })
      clearStall()
      stallTimer = setTimeout(() => {
        stallTimer = null
        dispatch({ type: 'stalled' })
      }, STALLED_AFTER_MS)
    }
    const onPlaying = () => {
      clearStall()
      dispatch({ type: 'data' })
    }
    const onEnded = () => {
      clearStall()
      dispatch({ type: 'ended' })
    }
    const onLoadedMetadata = () => {
      sawMetadataRef.current = true
      dispatch({ type: 'ready' })
      const restore = pendingRestoreRef.current
      if (restore) {
        pendingRestoreRef.current = null
        try {
          el.currentTime = restore.time
        } catch {
          // A seek before the media is seekable is not fatal.
        }
        if (!restore.paused) void el.play().catch(() => {})
      }
    }
    const onError = () => {
      clearStall()
      if (el.error?.code === MEDIA_ERR_NETWORK && sessionRef.current) {
        recoverNetwork()
        return
      }
      // B8 (§3): an element error before any range was served fires the
      // no-pull fallback at once (row 6), without waiting out its 5 s.
      if (!rangesServedRef.current && !sawMetadataRef.current) {
        watchdog.mediaError()
        return
      }
      const outcome = classifyElementError({
        sawLoadedMetadata: sawMetadataRef.current,
        rangesServed: rangesServedRef.current,
        canPlayType: canPlay,
      })
      if (outcome === 'stream-rejected') {
        fallBack()
        return
      }
      // Row 7: the unsupported card (the path follows the per-file flag).
      dispatch({ type: 'unsupported' })
      updatePerFile(() => ({ unsupported: true }))
    }

    el.addEventListener('loadstart', onLoadStart)
    el.addEventListener('play', onPlay)
    el.addEventListener('pause', onPause)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('playing', onPlaying)
    el.addEventListener('ended', onEnded)
    el.addEventListener('loadedmetadata', onLoadedMetadata)
    el.addEventListener('error', onError)
    return () => {
      clearStall()
      watchdog.dispose()
      watchdogRef.current = null
      el.removeEventListener('loadstart', onLoadStart)
      el.removeEventListener('play', onPlay)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('waiting', onWaiting)
      el.removeEventListener('playing', onPlaying)
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('loadedmetadata', onLoadedMetadata)
      el.removeEventListener('error', onError)
    }
  }, [src, streaming, canPlay, dispatch, fallBack, recoverNetwork, updatePerFile])

  // Tear the session down when the hook stops streaming (file switch, path
  // change, unmount) so nothing survives the preview (§6 M5, A11).
  useEffect(() => {
    if (streaming) return
    teardown()
    setMediaState(null)
  }, [streaming, teardown])

  const retry = useCallback(() => {
    perFileRefs.current.rejected = false
    updatePerFile(() => ({ failed: null, rejected: false, fallbackUsed: false, unsupported: false }))
    setAttempt((n) => n + 1)
  }, [updatePerFile])

  const overlayCopy =
    mediaState && (mediaState.transport === 'buffering' || mediaState.transport === 'stalled')
      ? statusCopy(mediaState)
      : null
  const failed = perFile.failed
  const errorCopy = failed
    ? failed.kind === 'changed'
      ? CHANGED_COPY
      : streamErrorCopy(failed.kind, failed.index)
    : mediaState && mediaState.transport === 'error'
      ? statusCopy(mediaState)
      : null

  return {
    path,
    streaming,
    src,
    status: mediaState ? statusCopy(mediaState) : null,
    overlay: overlayCopy,
    errorCopy,
    infoLine: mediaState ? streamingInfoLine(mediaState) : null,
    tagsVerified: mediaState ? isFullyVerified(mediaState) : false,
    blockWholeFile: perFile.unsupported && mediaKind === 'video',
    setElement,
    retry,
  }
}
