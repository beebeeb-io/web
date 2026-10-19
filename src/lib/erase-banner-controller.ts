/**
 * Task 1918 round 4d — the pending-erase banner's behaviour, without React.
 *
 * `erase-request-banner.tsx` binds to this (`useSyncExternalStore`); the tests drive it with a
 * fake status cache, fake requests, event targets for window / document, and fake timers.
 *
 * - reads through the shared status cache (focus and visibility use the cache; the due-time timer
 *   and every read after an own action read fresh);
 * - Cancel: `cancelErase` with the shown request's id; the cache is invalidated; an unknown outcome
 *   keeps "Check again" up by the screen's 'cancel' rule (`checkAgainAfterRead`), and the note
 *   says what a later read showed: nothing pending, it had already run, or the move has started.
 */
import {
  attachEraseRefresh,
  cancelErase,
  cancelNote,
  checkAgainAfterRead,
  createLatestGate,
  eraseCard,
  eraseRefreshPlan,
  type CheckAgainMode,
  type EraseCard,
  type EraseDeps,
  type EraseStatus,
  type RefreshHooks,
} from './erase-request'
import type { EraseStatusCache } from './erase-status-store'

export type BannerCard = Extract<EraseCard, { kind: 'awaiting' | 'pending' | 'moving' }>

export interface BannerState {
  card: BannerCard | null
  busy: boolean
  note: string
  error: string
  checkAgain: boolean
  /** Bumped after an action's outcome: the error (if any) takes the focus, else the note. */
  focusTick: number
}

export interface BannerControllerOptions {
  cache: EraseStatusCache
  key: string
  deps: EraseDeps
  win: RefreshHooks['win']
  doc: RefreshHooks['doc']
  /** Timers for the refresh hooks (default: the real ones). */
  timers?: Pick<RefreshHooks, 'setTimeoutFn' | 'clearTimeoutFn' | 'setIntervalFn' | 'clearIntervalFn'>
  now?: () => number
}

export interface BannerController {
  getState(): BannerState
  subscribe(listener: () => void): () => void
  load(opts?: { force?: boolean; followUp?: boolean }): Promise<void>
  cancel(): Promise<void>
  /** A click on "Check again": a fresh read that counts as the follow-up. */
  checkAgain(): Promise<void>
  attach(): void
  detach(): void
}

function bannerCardOf(status: EraseStatus): BannerCard | null {
  const card = eraseCard(status)
  return card.kind === 'awaiting' || card.kind === 'pending' || card.kind === 'moving' ? card : null
}

export function createBannerController(opts: BannerControllerOptions): BannerController {
  const now = opts.now ?? (() => Date.now())
  const gate = createLatestGate()
  let state: BannerState = { card: null, busy: false, note: '', error: '', checkAgain: false, focusTick: 0 }
  const listeners = new Set<() => void>()
  let attached = false
  let detachRefresh: (() => void) | null = null
  let refreshKey = ''
  let mode: CheckAgainMode = null
  /** The request an unknown cancel was for (round 4d). */
  let cancelledId: string | null = null

  const keyOf = (card: BannerCard | null) => (card ? `${card.kind}:${card.request.due_at}` : 'none')

  const syncRefresh = () => {
    const next = attached ? keyOf(state.card) : ''
    if (next === refreshKey) return
    detachRefresh?.()
    detachRefresh = null
    refreshKey = next
    if (!attached) return
    detachRefresh = attachEraseRefresh({
      win: opts.win,
      doc: opts.doc,
      // Focus and visibility go through the cache (a fresh answer is reused for 30 s).
      refresh: () => void controller.load(),
      // The due-time timer reads fresh (round 4c).
      refreshDue: () => void controller.load({ force: true }),
      plan: eraseRefreshPlan(state.card, now()),
      ...opts.timers,
    })
  }

  const set = (patch: Partial<BannerState>) => {
    state = { ...state, ...patch }
    syncRefresh()
    for (const listener of [...listeners]) listener()
  }

  const controller: BannerController = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    async load({ force = false, followUp = false } = {}) {
      if (!opts.key) return
      const seq = gate.begin()
      let status: EraseStatus | null
      try {
        status = await opts.cache.read(opts.key, { force: force || followUp })
      } catch {
        return // no banner without a status; the next refresh tries again
      }
      if (!attached || !gate.isLatest(seq) || !status) return
      const after = checkAgainAfterRead(mode, status, followUp, cancelledId)
      mode = after.mode
      if (mode === null) cancelledId = null
      const patch: Partial<BannerState> = { card: bannerCardOf(status), checkAgain: mode !== null }
      if (after.note) patch.note = after.note
      set(patch)
    },
    async cancel() {
      const card = state.card
      if (!card || state.busy) return
      mode = null
      cancelledId = null
      set({ busy: true, error: '', note: '', checkAgain: false })
      const outcome = await cancelErase(opts.deps, card.request.id)
      if (!attached) return
      gate.supersede()
      opts.cache.invalidate()
      const patch: Partial<BannerState> = { busy: false, focusTick: state.focusTick + 1 }
      if (outcome.kind === 'still_pending') {
        patch.error = outcome.message
      } else {
        patch.note = cancelNote(outcome) ?? ''
        if (outcome.kind === 'replaced') patch.card = bannerCardOf(outcome.status)
        else if (outcome.kind === 'unknown') {
          mode = 'cancel'
          cancelledId = card.request.id
          patch.checkAgain = true
        } else if (outcome.kind !== 'already_started') patch.card = null
      }
      set(patch)
      void controller.load({ force: true })
    },
    checkAgain() {
      return controller.load({ followUp: true })
    },
    attach() {
      attached = true
      syncRefresh()
      void controller.load()
    },
    detach() {
      attached = false
      syncRefresh()
    },
  }
  return controller
}
