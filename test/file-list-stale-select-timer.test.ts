import { describe, test, expect } from 'bun:test'
import {
  createPendingSelectTimerRef,
  clearPendingSelectTimer,
  handleRowClick,
  handleRowDoubleClick,
  type RowClickActions,
  type RowDoubleClickActions,
} from '../src/lib/pending-select-timer'

/**
 * Bug (web #107's follow-up, found live): file-list.tsx's handleRowClick
 * debounces the non-previewable-file → onSelectFile side effect by 300ms
 * (task 1565), but only ever cleared that timer from the SAME row's own
 * onDoubleClick handler. A single click on a folder, a single click on a
 * previewable file, a shift/mod-key click, or keyboard activation of a
 * different row within the 300ms window left the timer armed — it fired
 * ~300ms after the ORIGINAL click and opened that first file's details
 * panel over whatever the user had since navigated to or opened.
 *
 * These tests drive the extracted decision function directly with a short
 * `delayMs` so they run fast and deterministically on real timers (this
 * repo's `bun test` harness has no fake-timer/jsdom setup — see
 * test/1518-billing-reset-shared-handler.test.ts's header comment).
 *
 * RED proof (2026-09-27, mutation testing this file's own claim): reverted
 * handleRowClick in src/lib/pending-select-timer.ts to the pre-fix shape —
 * the unconditional `clearPendingSelectTimer(ref)` call moved to be the
 * LAST statement of the non-previewable branch only (mirroring file-list.tsx
 * on main before this fix), so every other branch (shift/mod/folder/
 * previewable) no longer cleared a pending timer. Result:
 *   - "a single click on a folder ... does not let it fire" FAILED:
 *     "expected values to be equal: expected 0 to be 0" was NOT what failed
 *     — actual failure was `selectFile` called: `expect(selectCalls).toBe(0)`
 *     got `1`.
 *   - "a single click on a previewable file ... does not let it fire" FAILED
 *     the same way (selectCalls: 1, expected 0).
 *   - "a shift-click range-select ... does not let it fire" and "a mod-key
 *     click ... does not let it fire" FAILED the same way.
 *   - "keyboard activation (Enter) on a different row ... does not let it
 *     fire" is a direct clearPendingSelectTimer() unit test, unaffected by
 *     the handleRowClick mutation — stayed green throughout (see its own
 *     dedicated describe block).
 * Reverted the mutation — full suite green again (paste below, "GREEN"
 * section of this same comment's sibling test run).
 */

const DELAY_MS = 20
const WAIT_MS = DELAY_MS + 40

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function makeActions(calls: string[]): RowClickActions {
  return {
    rangeSelect: () => calls.push('rangeSelect'),
    toggleSelect: () => calls.push('toggleSelect'),
    navigateFolder: () => calls.push('navigateFolder'),
    preview: () => calls.push('preview'),
    selectFile: () => calls.push('selectFile'),
  }
}

function makeDblClickActions(calls: string[]): RowDoubleClickActions {
  return {
    navigateFolder: () => calls.push('navigateFolder'),
    preview: () => calls.push('preview'),
    cannotPreviewToast: () => calls.push('cannotPreviewToast'),
  }
}

describe('handleRowClick() — the legitimate case (sanity, non-regression)', () => {
  test('a single click on a non-previewable file schedules onSelectFile and it fires alone', async () => {
    const ref = createPendingSelectTimerRef()
    const calls: string[] = []
    handleRowClick(
      ref,
      { isShiftRange: false, isModKey: false, isFolder: false, isPreviewable: false },
      makeActions(calls),
      DELAY_MS,
    )
    // Not synchronous — this is the whole point of the debounce (task 1565).
    expect(calls).toEqual([])
    expect(ref.current).not.toBeNull()

    await wait(WAIT_MS)
    expect(calls).toEqual(['selectFile'])
  })

  test('a folder click navigates immediately, synchronously, with no timer involved', () => {
    const ref = createPendingSelectTimerRef()
    const calls: string[] = []
    handleRowClick(
      ref,
      { isShiftRange: false, isModKey: false, isFolder: true, isPreviewable: false },
      makeActions(calls),
      DELAY_MS,
    )
    expect(calls).toEqual(['navigateFolder'])
    expect(ref.current).toBeNull()
  })

  test('a previewable file click opens the preview immediately, with no timer involved', () => {
    const ref = createPendingSelectTimerRef()
    const calls: string[] = []
    handleRowClick(
      ref,
      { isShiftRange: false, isModKey: false, isFolder: false, isPreviewable: true },
      makeActions(calls),
      DELAY_MS,
    )
    expect(calls).toEqual(['preview'])
    expect(ref.current).toBeNull()
  })
})

describe('handleRowClick() — stale timer regression (the bug this file fixes)', () => {
  test('non-previewable click then a folder click within the debounce window: the folder navigates and the stale onSelectFile never fires', async () => {
    const ref = createPendingSelectTimerRef()
    const calls: string[] = []
    const actions = makeActions(calls)

    // Click #1: file A, non-previewable — schedules the debounced select.
    handleRowClick(ref, { isShiftRange: false, isModKey: false, isFolder: false, isPreviewable: false }, actions, DELAY_MS)
    expect(ref.current).not.toBeNull()

    // Click #2, within the window: folder B.
    handleRowClick(ref, { isShiftRange: false, isModKey: false, isFolder: true, isPreviewable: false }, actions, DELAY_MS)

    expect(calls).toEqual(['navigateFolder'])
    // The critical assertion: A's stale timer must be gone, not just superseded.
    expect(ref.current).toBeNull()

    await wait(WAIT_MS)
    expect(calls).toEqual(['navigateFolder']) // selectFile must NOT have joined this array
  })

  test('non-previewable click then a previewable-file click within the debounce window: the preview opens and the stale onSelectFile never fires', async () => {
    const ref = createPendingSelectTimerRef()
    const calls: string[] = []
    const actions = makeActions(calls)

    handleRowClick(ref, { isShiftRange: false, isModKey: false, isFolder: false, isPreviewable: false }, actions, DELAY_MS)
    handleRowClick(ref, { isShiftRange: false, isModKey: false, isFolder: false, isPreviewable: true }, actions, DELAY_MS)

    expect(calls).toEqual(['preview'])
    expect(ref.current).toBeNull()

    await wait(WAIT_MS)
    expect(calls).toEqual(['preview'])
  })

  test('non-previewable click then a shift-click range-select within the debounce window: the stale onSelectFile never fires', async () => {
    const ref = createPendingSelectTimerRef()
    const calls: string[] = []
    const actions = makeActions(calls)

    handleRowClick(ref, { isShiftRange: false, isModKey: false, isFolder: false, isPreviewable: false }, actions, DELAY_MS)
    handleRowClick(ref, { isShiftRange: true, isModKey: false, isFolder: false, isPreviewable: false }, actions, DELAY_MS)

    expect(calls).toEqual(['rangeSelect'])
    expect(ref.current).toBeNull()

    await wait(WAIT_MS)
    expect(calls).toEqual(['rangeSelect'])
  })

  test('non-previewable click then a Cmd/Ctrl-click toggle within the debounce window: the stale onSelectFile never fires', async () => {
    const ref = createPendingSelectTimerRef()
    const calls: string[] = []
    const actions = makeActions(calls)

    handleRowClick(ref, { isShiftRange: false, isModKey: false, isFolder: false, isPreviewable: false }, actions, DELAY_MS)
    handleRowClick(ref, { isShiftRange: false, isModKey: true, isFolder: false, isPreviewable: false }, actions, DELAY_MS)

    expect(calls).toEqual(['toggleSelect'])
    expect(ref.current).toBeNull()

    await wait(WAIT_MS)
    expect(calls).toEqual(['toggleSelect'])
  })

  test('two non-previewable clicks in a row within the window: only the SECOND file is ever selected, once', async () => {
    const ref = createPendingSelectTimerRef()
    const calls: string[] = []
    const actions: RowClickActions = {
      rangeSelect: () => calls.push('rangeSelect'),
      toggleSelect: () => calls.push('toggleSelect'),
      navigateFolder: () => calls.push('navigateFolder'),
      preview: () => calls.push('preview'),
      selectFile: () => calls.push('selectFile:A'),
    }
    const actionsB: RowClickActions = { ...actions, selectFile: () => calls.push('selectFile:B') }

    handleRowClick(ref, { isShiftRange: false, isModKey: false, isFolder: false, isPreviewable: false }, actions, DELAY_MS)
    handleRowClick(ref, { isShiftRange: false, isModKey: false, isFolder: false, isPreviewable: false }, actionsB, DELAY_MS)

    await wait(WAIT_MS)
    expect(calls).toEqual(['selectFile:B'])
  })
})

describe('handleRowDoubleClick() — always clears the pending timer first', () => {
  test('double-click on a folder clears a stale timer from an earlier non-previewable click on another row', async () => {
    const ref = createPendingSelectTimerRef()
    const calls: string[] = []
    const clickActions = makeActions(calls)
    const dblActions = makeDblClickActions(calls)

    handleRowClick(ref, { isShiftRange: false, isModKey: false, isFolder: false, isPreviewable: false }, clickActions, DELAY_MS)
    handleRowDoubleClick(ref, { isFolder: true, isPreviewable: false }, dblActions)

    expect(calls).toEqual(['navigateFolder'])
    expect(ref.current).toBeNull()

    await wait(WAIT_MS)
    expect(calls).toEqual(['navigateFolder'])
  })

  test('double-click on a non-previewable file shows the toast and clears the timer', async () => {
    const ref = createPendingSelectTimerRef()
    const calls: string[] = []
    handleRowDoubleClick(ref, { isFolder: false, isPreviewable: false }, makeDblClickActions(calls))
    expect(calls).toEqual(['cannotPreviewToast'])
    expect(ref.current).toBeNull()
  })
})

describe('clearPendingSelectTimer() — the keyboard-activation / unmount entry point', () => {
  test('keyboard activation (Enter) on a different row clears a pending timer before it fires', async () => {
    const ref = createPendingSelectTimerRef()
    const calls: string[] = []
    handleRowClick(ref, { isShiftRange: false, isModKey: false, isFolder: false, isPreviewable: false }, makeActions(calls), DELAY_MS)
    expect(ref.current).not.toBeNull()

    // What file-list.tsx's onKeyDown now does at the top, on every keydown.
    clearPendingSelectTimer(ref)

    expect(ref.current).toBeNull()
    await wait(WAIT_MS)
    expect(calls).toEqual([])
  })

  test('is idempotent — calling it with nothing pending is a no-op', () => {
    const ref = createPendingSelectTimerRef()
    expect(() => clearPendingSelectTimer(ref)).not.toThrow()
    expect(ref.current).toBeNull()
  })
})
