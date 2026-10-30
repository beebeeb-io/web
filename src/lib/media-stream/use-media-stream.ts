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

function streamIdFor(fileId: string): string {
  return `s-${fileId.replace(/[^A-Za-z0-9._:-]/g, '_')}`
}

export function useMediaStream(args: UseMediaStreamArgs): MediaStreamHandle {
  const { file, mediaKind, selectedVersionId, isUnlocked, mime, resolveFileKey } = args
  const row = file.download_version ?? null
  const objectVersionId = row?.object_version_id ?? null

  const [rejected, setRejected] = useState(false)
  const [fallbackUsed, setFallbackUsed] = useState(false)
  const [failed, setFailed] = useState<{ kind: 'auth' | 'changed'; index: number } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [generation, setGeneration] = useState(0)
  const [ready, setReady] = useState(false)
  const [mediaState, setMediaState] = useState<MediaState | null>(null)

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
    fallbackUsed,
    streamRejected: rejected,
    terminalError: failed?.kind ?? null,
    elementErroredAfterMetadata: false,
  })

  const streaming = path === 'streaming'
  const id = streamIdFor(file.id)
  const src = streaming && ready ? `/sw-stream/${id}${generation ? `?g=${generation}` : ''}` : null

  const sessionRef = useRef<StreamSession | null>(null)
  const bridgeRef = useRef<StreamBridge | null>(null)
  const watchdogRef = useRef<NoPullWatchdog | null>(null)
  const elementRef = useRef<HTMLMediaElement | null>(null)
  const sawMetadataRef = useRef(false)
  const rangesServedRef = useRef(false)
  const rejectedRef = useRef(false)
  const recoveryRef = useRef<number[]>([])
  const pendingRestoreRef = useRef<{ time: number; paused: boolean } | null>(null)

  const setElement = useCallback((el: HTMLMediaElement | null) => {
    elementRef.current = el
  }, [])

  const dispatch = useCallback(
    (event: MediaEvent) => {
      setMediaState((prev) =>
        reduceMediaState(prev ?? createMediaState(file.chunk_count), event),
      )
    },
    [file.chunk_count],
  )

  const teardown = useCallback(() => {
    bridgeRef.current?.close()
    bridgeRef.current = null
    const session = sessionRef.current
    sessionRef.current = null
    if (session) void session.close()
    setReady(false)
  }, [])

  /** Row 6: close, wipe, hand the preview to the whole-file load — ONCE. */
  const fallBack = useCallback(() => {
    if (rejectedRef.current) {
      setFallbackUsed(true)
      return
    }
    rejectedRef.current = true
    teardown()
    setRejected(true)
  }, [teardown])

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
    (session: StreamSession): boolean => {
      const env = makeEnv()
      if (!env) return false
      bridgeRef.current?.close()
      bridgeRef.current = createStreamBridge({
        id,
        mime: mime ?? '',
        size: session.totalSize,
        read: (reqId, offset, max) => session.read(reqId, offset, max),
        env,
        onOpenRange: () => {
          rangesServedRef.current = true
          watchdogRef.current?.openRange()
        },
        onFatal: (code, index) => {
          if (code === 'auth') setFailed({ kind: 'auth', index })
          if (code === 'changed') setFailed({ kind: 'changed', index })
        },
      })
      return true
    },
    [id, makeEnv, mime],
  )

  const mediaStateRef = useRef<MediaState | null>(null)
  useEffect(() => {
    mediaStateRef.current = mediaState
  }, [mediaState])

  /** §2.1: re-register a fresh port, re-set src, at most 2 per 60 s. */
  const recoverNetwork = useCallback(() => {
    const session = sessionRef.current
    const el = elementRef.current
    if (!session) return
    const now = Date.now()
    if (!canRecoverNetworkError(recoveryRef.current, now)) {
      dispatch({
        type: 'error',
        kind: 'network',
        index: mediaStateRef.current?.verified.size ?? 0,
      })
      return
    }
    recoveryRef.current = noteNetworkRecovery(recoveryRef.current, now)
    pendingRestoreRef.current = { time: el?.currentTime ?? 0, paused: el?.paused ?? true }
    if (!openBridge(session)) return
    setGeneration((g) => g + 1)
  }, [dispatch, openBridge])

  // ── Open the session once per (file.id, selectedVersionId, attempt) ────────
  useEffect(() => {
    if (!isUnlocked || !streaming || !mediaKind || !objectVersionId) return
    const fileId = file.id
    let cancelled = false
    let session: StreamSession | null = null

    const run = async (): Promise<void> => {
      try {
        const fileKey = await resolveFileKey()
        const meta = await openFileMetadata(fileId, fileKey, file.name_encrypted)
        const source = args.sourceFactory
          ? args.sourceFactory(fileId, objectVersionId)
          : apiChunkSource(fileId, objectVersionId)
        const opened = await openStreamSession({
          fileId,
          fileKey,
          content: meta.content,
          row: {
            chunk_count: file.chunk_count,
            size_bytes: file.size_bytes,
            download_version: row,
          },
          source,
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
            if (event.kind === 'auth') setFailed({ kind: 'auth', index: event.index })
            if (event.kind === 'changed') setFailed({ kind: 'changed', index: event.index })
          }
        })
        if (!openBridge(opened)) {
          await opened.close()
          return
        }
        setReady(true)
      } catch {
        if (!cancelled) setFailed({ kind: 'auth', index: 0 })
      }
    }
    void run()

    return () => {
      cancelled = true
      bridgeRef.current?.close()
      bridgeRef.current = null
      sessionRef.current = null
      setReady(false)
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
      const outcome = classifyElementError({
        sawLoadedMetadata: sawMetadataRef.current,
        rangesServed: rangesServedRef.current,
        canPlayType: canPlay,
      })
      if (outcome === 'stream-rejected') fallBack()
      else dispatch({ type: 'unsupported' })
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
  }, [src, streaming, canPlay, dispatch, fallBack, recoverNetwork])

  // Tear the session down when the hook stops streaming (file switch, path
  // change, unmount) so nothing survives the preview (§6 M5, A11).
  useEffect(() => {
    if (streaming) return
    teardown()
    setMediaState(null)
  }, [streaming, teardown])

  const retry = useCallback(() => {
    setFailed(null)
    rejectedRef.current = false
    setRejected(false)
    setFallbackUsed(false)
    setAttempt((n) => n + 1)
  }, [])

  const overlayCopy =
    mediaState && (mediaState.transport === 'buffering' || mediaState.transport === 'stalled')
      ? statusCopy(mediaState)
      : null
  const errorCopy = failed
    ? failed.kind === 'changed'
      ? CHANGED_COPY
      : streamErrorCopy('auth', failed.index)
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
    setElement,
    retry,
  }
}
