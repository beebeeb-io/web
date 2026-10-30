/**
 * LD-0001 PR-B: the two-part state and the decision table (contract §4, §7),
 * the no-pull fallback (§3), the network-error recovery budget (§2.1) and the
 * exact streaming copy strings (§7). Injected clock only — no bun fake timers.
 */
import { describe, expect, test } from 'bun:test'
import { FakeClock } from './helpers/media-stream-fixtures'
import {
  choosePreviewPath,
  mediaStreamKillSwitch,
  WHOLE_FILE_MEDIA_CAP_BYTES,
  type PathFacts,
} from '../src/lib/media-stream/path'
import {
  createNoPullWatchdog,
  classifyElementError,
  createMediaState,
  reduceMediaState,
  isFullyVerified,
  statusCopy,
  streamingInfoLine,
  formatMB,
  canRecoverNetworkError,
  noteNetworkRecovery,
  NETWORK_LOADING,
  type MediaState,
} from '../src/lib/media-stream/state'

const MiB = 1024 * 1024

function facts(overrides: Partial<PathFacts> = {}): PathFacts {
  return {
    media: 'video',
    sharedLink: false,
    liveVersion: true,
    objectVersionId: 'ov-1',
    chunkCount: 12,
    chunkSize: 4 * MiB,
    sizeBytes: 48 * MiB,
    hasServiceWorkerController: true,
    killSwitch: false,
    canPlayType: 'probably',
    fallbackUsed: false,
    streamRejected: false,
    terminalError: null,
    elementErroredAfterMetadata: false,
    ...overrides,
  }
}

describe('T26 path_selection_table (§4, every row)', () => {
  test('row 1: every condition holds -> streaming', () => {
    expect(choosePreviewPath(facts())).toBe('streaming')
  })

  test('row 2: each failed row-1 condition falls back to whole-file', () => {
    const failures: Array<[string, Partial<PathFacts>]> = [
      ['no pin', { objectVersionId: null }],
      ['one chunk', { chunkCount: 1 }],
      ['historical version', { liveVersion: false }],
      ['S over 32 MiB', { chunkSize: 64 * MiB }],
      ['no SW controller', { hasServiceWorkerController: false }],
      ['kill switch off', { killSwitch: true }],
    ]
    for (const [label, override] of failures) {
      expect([label, choosePreviewPath(facts(override))]).toEqual([label, 'whole-file'])
    }
  })

  test('row 3: not video/audio -> whole-file', () => {
    expect(choosePreviewPath(facts({ media: null }))).toBe('whole-file')
  })

  test('row 4: shared links never stream', () => {
    expect(choosePreviewPath(facts({ sharedLink: true }))).toBe('whole-file')
  })

  test('row 5: a whole-file media load over 2 GiB is the download card', () => {
    expect(
      choosePreviewPath(facts({ objectVersionId: null, sizeBytes: WHOLE_FILE_MEDIA_CAP_BYTES + 1 })),
    ).toBe('download-card')
    expect(
      choosePreviewPath(facts({ objectVersionId: null, sizeBytes: WHOLE_FILE_MEDIA_CAP_BYTES })),
    ).toBe('whole-file')
  })

  test('row 6: a stream rejection falls back ONCE, then unsupported', () => {
    expect(choosePreviewPath(facts({ streamRejected: true }))).toBe('whole-file-fallback')
    expect(choosePreviewPath(facts({ streamRejected: true, fallbackUsed: true }))).toBe('unsupported')
    expect(
      choosePreviewPath(facts({ streamRejected: true, sizeBytes: WHOLE_FILE_MEDIA_CAP_BYTES + 1 })),
    ).toBe('download-card')
  })

  test('row 7: an element error after metadata, or an empty canPlayType, is unsupported', () => {
    expect(choosePreviewPath(facts({ elementErroredAfterMetadata: true }))).toBe('unsupported')
    expect(choosePreviewPath(facts({ canPlayType: '' }))).toBe('unsupported')
  })

  test('row 8: an authentication failure is an error, never a fallback', () => {
    expect(choosePreviewPath(facts({ terminalError: 'auth' }))).toBe('error')
    expect(choosePreviewPath(facts({ terminalError: 'auth', streamRejected: true }))).toBe('error')
  })

  test('row 9: a 409 is changed', () => {
    expect(choosePreviewPath(facts({ terminalError: 'changed' }))).toBe('changed')
  })

  test('the kill switch is read in a try/catch', () => {
    expect(mediaStreamKillSwitch({ getItem: () => 'off' })).toBe(true)
    expect(mediaStreamKillSwitch({ getItem: () => 'on' })).toBe(false)
    expect(mediaStreamKillSwitch({ getItem: () => null })).toBe(false)
    expect(
      mediaStreamKillSwitch({
        getItem: () => {
          throw new Error('denied')
        },
      }),
    ).toBe(false)
    expect(mediaStreamKillSwitch(null)).toBe(false)
  })
})

function streamState(totalParts = 120): MediaState {
  return reduceMediaState(createMediaState(totalParts), { type: 'open', mode: 'streaming' })
}

describe('T25 verified is distinct indices, done only at N (§7)', () => {
  test('verified_is_distinct_indices_done_only_at_N', () => {
    let state = reduceMediaState(streamState(4), { type: 'verified', index: 0 })
    state = reduceMediaState(state, { type: 'verified', index: 1 })
    expect(state.verified.size).toBe(2)
    expect(isFullyVerified(state)).toBe(false)
    // A re-open after eviction does not count twice.
    state = reduceMediaState(state, { type: 'verified', index: 0 })
    state = reduceMediaState(state, { type: 'verified', index: 1 })
    expect(state.verified.size).toBe(2)
    expect(isFullyVerified(state)).toBe(false)
    state = reduceMediaState(state, { type: 'verified', index: 3 })
    expect(state.verified.size).toBe(3)
    expect(isFullyVerified(state)).toBe(false)
    state = reduceMediaState(state, { type: 'verified', index: 2 })
    expect(state.verified.size).toBe(4)
    expect(isFullyVerified(state)).toBe(true)
  })

  test('tagsVerified means tags only: the info line never overclaims', () => {
    let state = streamState(4)
    for (const index of [0, 1, 2, 3]) {
      state = reduceMediaState(state, { type: 'verified', index })
    }
    const lines = [
      streamingInfoLine(state),
      statusCopy(state),
      ...['preparing', 'buffering', 'stalled', 'ended', 'error', 'changed'].map((transport) =>
        statusCopy({ ...state, transport: transport as MediaState['transport'] }),
      ),
    ].filter((line): line is string => line !== null)
    expect(streamingInfoLine(state)).toBe('All 4 parts verified')
    for (const line of lines) {
      expect(line.toLowerCase()).not.toContain('complete')
      expect(line.toLowerCase()).not.toContain('intact')
      expect(line.toLowerCase()).not.toContain('original')
    }
  })
})

describe('T27 the no-pull fallback watchdog (A18)', () => {
  test('no_pull_fallback_armed_by_load_or_play', () => {
    const clock = new FakeClock()
    let fired = 0
    const watchdog = createNoPullWatchdog({ clock, onFallback: () => fired++ })
    watchdog.loadStart(NETWORK_LOADING)
    clock.advance(4999)
    expect(fired).toBe(0)
    clock.advance(1)
    expect(fired).toBe(1)
    watchdog.dispose()

    const byPlay = createNoPullWatchdog({ clock, onFallback: () => fired++ })
    byPlay.play()
    clock.advance(5000)
    expect(fired).toBe(2)
    byPlay.dispose()
  })

  test('preload_none_does_not_fall_back', () => {
    const clock = new FakeClock()
    let fired = 0
    const watchdog = createNoPullWatchdog({ clock, onFallback: () => fired++ })
    // preload="none": load start with networkState still EMPTY.
    watchdog.loadStart(0)
    clock.advance(600000)
    expect(fired).toBe(0)
    watchdog.dispose()
  })

  test('the first open-range disarms the watchdog', () => {
    const clock = new FakeClock()
    let fired = 0
    const watchdog = createNoPullWatchdog({ clock, onFallback: () => fired++ })
    watchdog.loadStart(NETWORK_LOADING)
    clock.advance(1000)
    watchdog.openRange()
    clock.advance(60000)
    expect(fired).toBe(0)
    // A later play cannot re-arm it.
    watchdog.play()
    clock.advance(60000)
    expect(fired).toBe(0)
    watchdog.dispose()
  })

  test('error_before_open_range_falls_back_now', () => {
    const clock = new FakeClock()
    let fired = 0
    const watchdog = createNoPullWatchdog({ clock, onFallback: () => fired++ })
    watchdog.loadStart(0)
    watchdog.mediaError()
    expect(fired).toBe(1)
    watchdog.dispose()

    let afterRange = 0
    const second = createNoPullWatchdog({ clock, onFallback: () => afterRange++ })
    second.loadStart(NETWORK_LOADING)
    second.openRange()
    second.mediaError()
    expect(afterRange).toBe(0)
    second.dispose()
  })
})

describe('T29 error_before_metadata_is_rejected_stream_after_is_unsupported (§4 rows 6-7)', () => {
  test('error_before_metadata_is_rejected_stream_after_is_unsupported', () => {
    expect(
      classifyElementError({ sawLoadedMetadata: false, rangesServed: true, canPlayType: 'probably' }),
    ).toBe('stream-rejected')
    expect(
      classifyElementError({ sawLoadedMetadata: true, rangesServed: true, canPlayType: 'probably' }),
    ).toBe('unsupported')
    expect(
      classifyElementError({ sawLoadedMetadata: true, rangesServed: false, canPlayType: 'probably' }),
    ).toBe('unsupported')
    expect(
      classifyElementError({ sawLoadedMetadata: false, rangesServed: false, canPlayType: '' }),
    ).toBe('unsupported')
  })

  test('the transport edges of §7', () => {
    let state = streamState(10)
    expect(state.transport).toBe('preparing')
    state = reduceMediaState(state, { type: 'ready' })
    expect(state.transport).toBe('ready')
    state = reduceMediaState(state, { type: 'play' })
    expect(state.transport).toBe('playing')
    state = reduceMediaState(state, { type: 'pause' })
    expect(state.transport).toBe('paused')
    state = reduceMediaState(state, { type: 'play' })
    state = reduceMediaState(state, { type: 'waiting' })
    expect(state.transport).toBe('buffering')
    state = reduceMediaState(state, { type: 'stalled' })
    expect(state.transport).toBe('stalled')
    state = reduceMediaState(state, { type: 'data' })
    expect(state.transport).toBe('playing')
    state = reduceMediaState(state, { type: 'ended' })
    expect(state.transport).toBe('ended')
    state = reduceMediaState(state, { type: 'seek-back' })
    expect(state.transport).toBe('buffering')
    state = reduceMediaState(state, { type: 'stream-rejected' })
    expect(state.transport).toBe('downloading')

    const prepare = streamState(10)
    expect(reduceMediaState(prepare, { type: 'stream-rejected' }).transport).toBe('downloading')
    expect(reduceMediaState(prepare, { type: 'error', kind: 'auth', index: 3 }).transport).toBe('error')
    expect(reduceMediaState(prepare, { type: 'changed' }).transport).toBe('changed')

    const playing = reduceMediaState(reduceMediaState(streamState(10), { type: 'ready' }), {
      type: 'play',
    })
    expect(reduceMediaState(playing, { type: 'unsupported' }).transport).toBe('unsupported')

    let whole = reduceMediaState(createMediaState(10), { type: 'open', mode: 'whole-file' })
    expect(whole.transport).toBe('downloading')
    whole = reduceMediaState(whole, { type: 'body-ended', partsLeft: true })
    expect(whole.transport).toBe('decrypting')
    whole = reduceMediaState(whole, { type: 'body-ended', partsLeft: false })
    expect(whole.transport).toBe('loaded')
  })
})

describe('T30 network error recovery budget (§2.1)', () => {
  test('network_error_reregisters_twice_per_minute_then_errors', () => {
    let times: number[] = []
    expect(canRecoverNetworkError(times, 0)).toBe(true)
    times = noteNetworkRecovery(times, 0)
    expect(canRecoverNetworkError(times, 1000)).toBe(true)
    times = noteNetworkRecovery(times, 1000)
    expect(canRecoverNetworkError(times, 2000)).toBe(false)
    expect(canRecoverNetworkError(times, 59000)).toBe(false)
    // The first attempt has left the 60 s window, so one recovery is left.
    expect(canRecoverNetworkError(times, 60000)).toBe(true)
    // ...and a third attempt inside one window is still refused.
    const dense = noteNetworkRecovery(noteNetworkRecovery([], 30000), 31000)
    expect(canRecoverNetworkError(dense, 32000)).toBe(false)
  })
})

describe('T32 streaming_copy_strings_exact (§7)', () => {
  test('streaming_copy_strings_exact', () => {
    const base = streamState(120)
    expect(formatMB(4.1 * MiB)).toBe('4.1 MB')
    expect(statusCopy(reduceMediaState(base, { type: 'progress', receivedBytes: 4.1 * MiB, totalBytes: 32 * MiB }))).toBe(
      'Downloading the start · 4.1 of 32.0 MB',
    )
    const playing = reduceMediaState(
      reduceMediaState(base, { type: 'ready' }),
      { type: 'play' },
    )
    expect(streamingInfoLine(playing)).toBe('Streaming · 0 of 120 parts verified')
    const fortyOne = reduceMediaState(playing, { type: 'progress', decryptedChunks: 36, totalParts: 120 })
    expect(streamingInfoLine(fortyOne)).toBe('Streaming · 0 of 120 parts verified')
    expect(statusCopy(reduceMediaState(fortyOne, { type: 'waiting' }))).toBe(
      'Buffering · downloading part 37 of 120',
    )
    const waiting = reduceMediaState(fortyOne, { type: 'waiting' })
    expect(statusCopy(reduceMediaState(waiting, { type: 'stalled' }))).toBe(
      'Connection stalled · retrying',
    )
    let verified = playing
    for (let i = 0; i < 41; i++) verified = reduceMediaState(verified, { type: 'verified', index: i })
    expect(streamingInfoLine(verified)).toBe('Streaming · 41 of 120 parts verified')
    let ended = reduceMediaState(verified, { type: 'ended' })
    expect(statusCopy(ended)).toBe(
      'Played to the end · 41 of 120 parts opened. Parts you skipped were not opened.',
    )
    for (let i = 41; i < 120; i++) ended = reduceMediaState(ended, { type: 'verified', index: i })
    expect(statusCopy(ended)).toBe('All 120 parts verified')
    expect(
      statusCopy(reduceMediaState(base, { type: 'error', kind: 'auth', index: 36 })),
    ).toBe(
      "Part 37 of this file couldn't be verified, so playback stopped there. Nothing unverified was played.",
    )
    expect(
      statusCopy(reduceMediaState(playing, { type: 'error', kind: 'network', index: 36 })),
    ).toBe('The download stopped at part 37. Check your connection and try again.')
    expect(statusCopy(reduceMediaState(playing, { type: 'changed' }))).toBe(
      'This file changed while it was playing. Reopen it to play the new version.',
    )
  })
})
