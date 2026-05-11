import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import {
  getPreference,
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

const PINNED_FOLDERS_PREF = 'pinned_folders'
const LEGACY_PINNED_FOLDERS_PREF = 'pinned_shared_folders'

interface PlanDetails {
  plan: Plan | null
  subscription: Subscription | null
}

interface DriveDataState {
  pinnedFolderIds: string[]
  refreshPinnedFolders: () => void

  usage: StorageUsage | null
  refreshUsage: () => void

  planDetails: PlanDetails
  refreshPlanDetails: () => void

  incomingCount: number
  refreshIncoming: () => void
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
  const [incomingCount, setIncomingCount] = useState(0)

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

  // ── Usage ─────────────────────────────────────────────────────────────────

  const refreshUsage = useCallback(() => {
    getStorageUsage()
      .then((u) => setUsage(u))
      .catch(() => {})
    // Try the billing endpoint (may 404 when not yet deployed) — if it returns
    // data, merge it in so the sidebar shows the billing-aware numbers.
    fetchUsage()
      .then((b) => {
        if (!b) return
        setUsage((prev) => {
          if (!prev) return prev
          return { ...prev, used_bytes: b.used_bytes, plan_limit_bytes: b.quota_bytes }
        })
      })
      .catch(() => {})
  }, [])

  // ── Plan + subscription ───────────────────────────────────────────────────

  const refreshPlanDetails = useCallback(() => {
    Promise.all([getPlans(), getSubscription()])
      .then(([plans, subscription]) => {
        const plan = plans.find((p) => p.id === subscription.plan) ?? null
        setPlanDetails({ plan, subscription })
      })
      .catch(() => {})
  }, [])

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
        usage,
        refreshUsage,
        planDetails,
        refreshPlanDetails,
        incomingCount,
        refreshIncoming,
      }}
    >
      {children}
    </DriveDataContext.Provider>
  )
}
