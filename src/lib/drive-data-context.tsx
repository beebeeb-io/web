import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  getPreference,
  setPreference,
  getStorageUsage,
  fetchUsage,
  getPlans,
  getSubscription,
  getIncomingInvites,
  type StorageUsage,
  type Plan,
  type Subscription,
} from './api'
import { useAuth } from './auth-context'
import { useKeys } from './key-context'
import { useWsEvent } from './ws-context'
import { FEATURE_ONBOARDING_DOCUMENT } from './flags'
import { fetchOnboardingDocument } from './onboarding/client'
import type { OnboardingDocument } from './onboarding/types'
import { accountDocumentBlocks, accountStateFromDocument, effectiveAccountState } from './account-state'
import {
  initialAccountDoc,
  invalidateAccountDoc,
  landAccountDoc,
  settleAccountDoc,
  type AccountDocSlice,
} from './account-doc-cache'
import type { AccountState } from '@beebeeb/shared'

const USAGE_DEBOUNCE_MS = 500
/**
 * Floor between two event-storm-driven usage refreshes (task 1700). The 500 ms
 * trailing debounce alone still lets a sustained op storm (a desktop bulk
 * sync emitting several events per file) refetch `GET /files/usage` every
 * ~500 ms; the floor caps that at one refresh per few seconds.
 */
const USAGE_MIN_INTERVAL_MS = 3_000

const PINNED_FOLDERS_PREF = 'pinned_folders'
const LEGACY_PINNED_FOLDERS_PREF = 'pinned_shared_folders'

interface PlanDetails {
  plan: Plan | null
  subscription: Subscription | null
}

interface DriveDataState {
  pinnedFolderIds: string[]
  refreshPinnedFolders: () => void
  /**
   * Remove folder ids from Quick Access and persist. Used as the deletion hook
   * (a trashed folder must not linger as a pin) and as the self-heal path when
   * QuickAccess discovers a pinned id that no longer resolves. No-op (no PUT)
   * when none of the ids are actually pinned.
   */
  unpinFolders: (folderIds: string[]) => void

  usage: StorageUsage | null
  /** Task 1706 review #132-A — resolves true when the primary /files/usage
   * fetch delivered a value into context, false when it failed. Existing
   * fire-and-forget callers are unaffected (a statement call ignores it). */
  refreshUsage: () => Promise<boolean>

  planDetails: PlanDetails
  refreshPlanDetails: () => void
  /**
   * True once the first `GET /billing/subscription` for the signed-in account
   * has settled (success OR failure). The needs_plan route gate (task 1037)
   * waits for it so a new account never flashes the drive before being sent
   * to /choose-plan. A failure settles with `subscription: null` → "ok".
   */
  subscriptionSettled: boolean
  /**
   * Put a freshly-fetched subscription into the shared cache immediately
   * (task 1037: /choose-plan does this once the trial is live, so the route
   * gate sees the new state before it navigates to the drive).
   */
  applySubscription: (subscription: Subscription) => void
  /**
   * What the route gate, lapsed banner and upload entry points act on (task
   * 1816): the onboarding document's account state when the document is
   * available (flag on, signed in, drawable), else the legacy subscription's.
   * `source` says which one answered.
   */
  accountState: AccountState
  accountStateSource: 'document' | 'legacy'
  /** Task 1816 round 2: the account document is `blocking` (a required step is open); the route gate sends the account to /account-status. */
  accountBlocking: boolean
  /** The document's raw `account.state` label (e.g. `allowance`), or null without a document. */
  accountStateLabel: string | null

  incomingCount: number
  refreshIncoming: () => void

  /** True while the drive is serving file lists from the offline cache. */
  isOffline: boolean
  setOffline: (offline: boolean) => void
}

const DriveDataContext = createContext<DriveDataState | null>(null)

export function useDriveData(): DriveDataState {
  const ctx = useContext(DriveDataContext)
  if (!ctx) throw new Error('useDriveData must be used inside DriveDataProvider')
  return ctx
}

export function DriveDataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { isUnlocked } = useKeys()

  const [pinnedFolderIds, setPinnedFolderIds] = useState<string[]>([])
  const [usage, setUsage] = useState<StorageUsage | null>(null)
  const [planDetails, setPlanDetails] = useState<PlanDetails>({ plan: null, subscription: null })
  const [subSettled, setSubSettled] = useState(false)
  // Task 1816: the account-stage onboarding document, when the flag is on and the
  // server serves a drawable one. Null = unavailable -> the legacy subscription
  // state decides (spec 5.8 rule 6). Settled is vacuously true with the flag off.
  const [docSlice, dispatchDoc] = useReducer(
    (
      prev: AccountDocSlice,
      action:
        | { type: 'invalidate' }
        | { type: 'land'; seq: number; doc: OnboardingDocument | null }
        | { type: 'settle' },
    ): AccountDocSlice => {
      switch (action.type) {
        case 'invalidate':
          return invalidateAccountDoc(prev, FEATURE_ONBOARDING_DOCUMENT)
        case 'land':
          return landAccountDoc(prev, action.seq, action.doc)
        case 'settle':
          return settleAccountDoc(prev)
      }
    },
    FEATURE_ONBOARDING_DOCUMENT,
    initialAccountDoc,
  )
  const accountDoc = docSlice.doc
  const docSettled = docSlice.settled
  // Mirrors docSlice.seq so a request can capture the id its invalidation minted.
  const docSeqRef = useRef(0)
  const subscriptionSettled = subSettled && docSettled
  const [incomingCount, setIncomingCount] = useState(0)
  const [isOffline, setIsOffline] = useState(false)

  // Reset the offline flag whenever the browser reports it's online again.
  // The drive page will overwrite it explicitly on next failed/successful
  // listFiles, but listening here keeps the banner from getting stuck if the
  // user reconnects without navigating.
  useEffect(() => {
    function onOnline() {
      setIsOffline(false)
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [])

  // ── Pinned folders ────────────────────────────────────────────────────────

  const refreshPinnedFolders = useCallback(() => {
    getPreference<{ folder_ids: string[] }>(PINNED_FOLDERS_PREF)
      .then(async (pref) => {
        if (pref?.folder_ids?.length) {
          setPinnedFolderIds(pref.folder_ids)
          return
        }
        const legacy = await getPreference<{ folder_ids: string[] }>(LEGACY_PINNED_FOLDERS_PREF).catch(() => null)
        setPinnedFolderIds(legacy?.folder_ids ?? [])
      })
      .catch(() => {})
  }, [])

  const unpinFolders = useCallback((folderIds: string[]) => {
    if (folderIds.length === 0) return
    const removeSet = new Set(folderIds)
    setPinnedFolderIds((prev) => {
      const next = prev.filter((id) => !removeSet.has(id))
      if (next.length === prev.length) return prev // nothing was pinned → no PUT
      setPreference(PINNED_FOLDERS_PREF, { folder_ids: next }).catch(() => {})
      // Notify other consumers (the sidebar keeps a local optimistic copy).
      window.dispatchEvent(new Event('beebeeb:pins-changed'))
      return next
    })
  }, [])

  // ── Usage ─────────────────────────────────────────────────────────────────

  /**
   * Task 1706 review #132-A — awaitable outcome. Resolves true when the
   * primary `/files/usage` fetch DELIVERED a value into context, false when it
   * failed; callers that need to know whether the shared usage is now fresh
   * (billing.tsx's post-add-on-apply authority decision) await this, while
   * every existing fire-and-forget caller keeps working unchanged (a bare
   * statement call ignores the promise). The `/billing/usage` merge stays
   * best-effort enrichment that never flips the outcome.
   */
  const refreshUsage = useCallback((): Promise<boolean> => {
    return getStorageUsage()
      .then(async (u) => {
        setUsage(u)
        // Try the billing endpoint (may 404 when not yet deployed) — if it returns
        // data, merge it in so the sidebar shows the billing-aware numbers.
        // Enrichment failure does not un-freshen the primary fetch.
        try {
          const b = await fetchUsage()
          if (!b) return true
          setUsage((prev) => {
            if (!prev) return prev
            return { ...prev, used_bytes: b.used_bytes, plan_limit_bytes: b.quota_bytes }
          })
        } catch {
          // best-effort enrichment
        }
        return true
      })
      .catch(() => false)
  }, [])

  // ── Plan + subscription ───────────────────────────────────────────────────

  const refreshAccountDocument = useCallback(() => {
    if (!FEATURE_ONBOARDING_DOCUMENT) return
    // Invalidate first (Codex P2): drop the cached document and mark it
    // unsettled so a stalled request can never leave a stale document
    // overriding a fresher subscription; the 8 s safety net still bounds it.
    const seq = ++docSeqRef.current
    dispatchDoc({ type: 'invalidate' })
    void fetchOnboardingDocument()
      .then((outcome) => (outcome.kind === 'document' ? outcome.doc : null))
      .catch(() => null)
      .then((doc) => {
        // A newer request (or an applySubscription reset) supersedes this one.
        if (seq !== docSeqRef.current) return
        dispatchDoc({ type: 'land', seq, doc })
      })
  }, [])

  const refreshPlanDetails = useCallback(() => {
    refreshAccountDocument()
    // The subscription lands on its own (task 1037) — the route gate reads
    // `account_state` from it and must not wait on, or fail with, the plans
    // catalogue. The plan match follows once both are in.
    const subPromise = getSubscription()
    subPromise
      .then((subscription) => {
        setPlanDetails((prev) => ({
          plan: prev.plan && prev.plan.id === subscription.plan ? prev.plan : null,
          subscription,
        }))
      })
      .catch(() => {})
      .finally(() => setSubSettled(true))
    Promise.all([getPlans(), subPromise])
      .then(([plans, subscription]) => {
        const plan = plans.find((p) => p.id === subscription.plan) ?? null
        setPlanDetails({ plan, subscription })
      })
      .catch(() => {})
  }, [refreshAccountDocument])

  const applySubscription = useCallback(
    (subscription: Subscription) => {
      setPlanDetails((prev) => ({
        plan: prev.plan && prev.plan.id === subscription.plan ? prev.plan : null,
        subscription,
      }))
      setSubSettled(true)
      if (FEATURE_ONBOARDING_DOCUMENT) {
        // The cached document predates this change (e.g. the trial just started):
        // refreshAccountDocument() drops it so the fresh subscription decides
        // until a new document lands.
        refreshAccountDocument()
      }
    },
    [refreshAccountDocument],
  )

  // Signed out (or a different account signs in): drop the previous account's
  // subscription so the route gate never decides on someone else's state.
  const userId = user?.user_id ?? null
  useEffect(() => {
    setPlanDetails({ plan: null, subscription: null })
    setSubSettled(false)
    docSeqRef.current += 1
    dispatchDoc({ type: 'invalidate' })
  }, [userId])

  // Safety net: a subscription request that never answers must not hold every
  // protected route on a blank screen. After 8s the gate proceeds as "ok".
  useEffect(() => {
    if (subscriptionSettled || !isUnlocked || !user) return
    const t = setTimeout(() => {
      setSubSettled(true)
      dispatchDoc({ type: 'settle' })
    }, 8_000)
    return () => clearTimeout(t)
  }, [subscriptionSettled, isUnlocked, user])

  // ── Incoming share invites count ──────────────────────────────────────────

  const refreshIncoming = useCallback(() => {
    if (!isUnlocked) return
    getIncomingInvites()
      .then((invites) => setIncomingCount(invites.length))
      .catch(() => {})
  }, [isUnlocked])

  // ── Initial fetch (once, when auth + vault are ready) ────────────────────

  useEffect(() => {
    if (!isUnlocked || !user) return
    refreshPinnedFolders()
    refreshUsage()
    refreshPlanDetails()
    refreshIncoming()
  }, [isUnlocked, user, refreshPinnedFolders, refreshUsage, refreshPlanDetails, refreshIncoming])

  // ── React to plan changes (e.g. after upgrade) ────────────────────────────

  useEffect(() => {
    function onPlanChanged() {
      refreshUsage()
      refreshPlanDetails()
    }
    window.addEventListener('beebeeb:plan-changed', onPlanChanged)
    return () => window.removeEventListener('beebeeb:plan-changed', onPlanChanged)
  }, [refreshUsage, refreshPlanDetails])

  // ── Real-time quota refresh on file mutation events (debounced) ──────────
  // A mobile backup can fire 50+ file.uploaded events in a burst — coalesce.

  const usageDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastUsageRefreshAtRef = useRef(0)
  const debouncedRefreshUsage = useCallback(() => {
    if (usageDebounceRef.current) clearTimeout(usageDebounceRef.current)
    // Keep the trailing debounce, plus a floor since the last refresh so a
    // sustained event storm cannot refetch usage every window (task 1700).
    const sinceLast = Date.now() - lastUsageRefreshAtRef.current
    const delay = Math.max(USAGE_DEBOUNCE_MS, USAGE_MIN_INTERVAL_MS - sinceLast)
    usageDebounceRef.current = setTimeout(() => {
      usageDebounceRef.current = null
      lastUsageRefreshAtRef.current = Date.now()
      refreshUsage()
    }, delay)
  }, [refreshUsage])

  useWsEvent(['file.uploaded', 'file.deleted', 'file.trashed', 'file.restored'], debouncedRefreshUsage)

  // ── Real-time subscription refresh on Stripe webhook events ───────────────

  // `subscription.changed` (legacy Stripe webhook) and `billing_updated` (task
  // 0943 — the per-user event the Mollie grant/provision/renewal paths emit) both
  // mean "your billing state moved" → refresh plan + quota app-wide so storage UI
  // updates live no matter which page is open.
  useWsEvent(['subscription.changed', 'billing_updated'], useCallback(() => {
    refreshPlanDetails()
    refreshUsage()
  }, [refreshPlanDetails, refreshUsage]))

  // ── React to pin changes so all consumers stay in sync ───────────────────

  useEffect(() => {
    function onPinsChanged() {
      refreshPinnedFolders()
    }
    window.addEventListener('beebeeb:pins-changed', onPinsChanged)
    return () => window.removeEventListener('beebeeb:pins-changed', onPinsChanged)
  }, [refreshPinnedFolders])

  return (
    <DriveDataContext.Provider
      value={{
        pinnedFolderIds,
        refreshPinnedFolders,
        unpinFolders,
        usage,
        refreshUsage,
        planDetails,
        refreshPlanDetails,
        subscriptionSettled,
        applySubscription,
        accountState: effectiveAccountState(accountDoc, planDetails.subscription),
        accountBlocking: accountDocumentBlocks(accountDoc),
        accountStateSource: accountStateFromDocument(accountDoc) ? 'document' : 'legacy',
        accountStateLabel: accountStateFromDocument(accountDoc) ? (accountDoc?.account?.state ?? null) : null,
        incomingCount,
        refreshIncoming,
        isOffline,
        setOffline: setIsOffline,
      }}
    >
      {children}
    </DriveDataContext.Provider>
  )
}
