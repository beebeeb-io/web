import { useEffect, useRef, useState } from 'react'
import type { ReactNode, DragEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useFrozen } from '../hooks/use-frozen'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { BBLogo } from '@beebeeb/shared'
import { Icon, type IconName } from './icons'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import {
  getIncomingInvites,
  getFolderKeys,
  getPreference,
  setPreference,
  getAdminStats,
  requestAdminHandoff,
  type ShareInvite,
} from '../lib/api'
import { useDriveData } from '../lib/drive-data-context'
import { StorageUsageBar } from './storage-usage-bar'
import { decryptFolderKey, decryptChildFileKey } from '../lib/folder-share-crypto'
import { decryptFilename, fromBase64, parseEncryptedBlob } from '../lib/crypto'
import { QuotaWarning } from './quota-warning'
import { QuickAccess } from './quick-access'
import { EmailVerifyBanner } from './email-verify-banner'
import { AnnouncementBanner } from './announcement-banner'
import { IosAppBanner } from './ios-app-banner'
import { formatStorageSI } from '../lib/format'
import { NotificationInbox, useNotifications } from './notification-inbox'

// ─── PWA install prompt ──────────────────────────────────────────────────────

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const INSTALL_DISMISS_KEY = 'beebeeb_pwa_install_dismissed'

function PwaInstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      if (sessionStorage.getItem(INSTALL_DISMISS_KEY) === '1') {
        setDismissed(true)
        return
      }
    } catch { /* ignore */ }

    function onBeforeInstall(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    return () => window.removeEventListener('beforeinstallprompt', onBeforeInstall)
  }, [])

  if (!deferredPrompt || dismissed) return null

  async function handleInstall() {
    if (!deferredPrompt) return
    await deferredPrompt.prompt()
    await deferredPrompt.userChoice
    setDeferredPrompt(null)
  }

  function handleDismiss() {
    try { sessionStorage.setItem(INSTALL_DISMISS_KEY, '1') } catch { /* ignore */ }
    setDismissed(true)
  }

  return (
    <div className="mx-3 mb-2 flex items-center gap-2 px-2 py-1.5 rounded-md bg-amber-bg text-amber-deep text-[12px]">
      <Icon name="cloud" size={12} className="shrink-0" />
      <button
        type="button"
        onClick={handleInstall}
        className="flex-1 text-left font-medium hover:opacity-80 transition-opacity cursor-pointer"
      >
        Install app
      </button>
      <button
        type="button"
        onClick={handleDismiss}
        className="shrink-0 hover:opacity-60 transition-opacity cursor-pointer"
        aria-label="Dismiss install prompt"
      >
        <Icon name="x" size={10} />
      </button>
    </div>
  )
}

// ─── Sidebar storage quota warning ──────────────────────────────────────────

interface SidebarQuotaBarProps {
  usedBytes: number
  quotaBytes: number
}

/**
 * Shows a compact warning bar below the regular storage meter when usage
 * is at or above 80%. Hidden entirely below that threshold.
 *
 * - ≥ 80% and < 95%: amber bar + "X GB of Y GB used"
 * - ≥ 95%: red bar + "Almost full — upgrade your plan" link to /billing
 */
function SidebarQuotaBar({ usedBytes, quotaBytes }: SidebarQuotaBarProps) {
  if (quotaBytes <= 0) return null

  const pct = Math.min(100, (usedBytes / quotaBytes) * 100)

  if (pct < 80) return null

  const isCritical = pct >= 95

  return (
    <div className="mt-2 pt-2 border-t border-line">
      {/* Bar track + fill */}
      <div className="h-[3px] w-full rounded-full bg-line overflow-hidden mb-1.5">
        <div
          className={`h-full rounded-full transition-all duration-700 ease-out ${isCritical ? 'bg-red' : 'bg-amber'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {isCritical ? (
        <div className="text-[11px] text-red leading-snug">
          Almost full —{' '}
          <Link to="/billing" className="font-semibold underline underline-offset-2 hover:text-red/80">
            upgrade your plan
          </Link>
        </div>
      ) : (
        <div className="text-[11px] text-ink-2 font-mono tabular-nums">
          {formatStorageSI(usedBytes)} of {formatStorageSI(quotaBytes)} used
        </div>
      )}
    </div>
  )
}

const navItems: { path: string; icon: IconName; label: string }[] = [
  { path: '/', icon: 'folder', label: 'All files' },
  { path: '/shared', icon: 'users', label: 'Shared' },
  { path: '/photos', icon: 'image', label: 'Photos' },
  { path: '/starred', icon: 'star', label: 'Starred' },
  { path: '/recent', icon: 'clock', label: 'Recent' },
  { path: '/trash', icon: 'trash', label: 'Trash' },
]

const REGION_META: Record<string, { label: string; flag: string }> = {
  auto: { label: 'Europe', flag: '' },
  falkenstein: { label: 'Falkenstein, DE · Hetzner', flag: '' },
  helsinki: { label: 'Helsinki, FIN · Hetzner', flag: '' },
  ede: { label: 'Ede, NL · Beebeeb', flag: '' },
  nuremberg: { label: 'Nuremberg, DE · Hetzner', flag: '' },
}

const PINNED_FOLDERS_PREF = 'pinned_folders'

// ─── Vault switcher ──────────────────────────────────────────────────────────

function VaultSwitcher() {
  const { user } = useAuth()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const email = user?.email ?? ''
  const username = email.split('@')[0] ?? ''
  const vaultName = username
    ? `${username.charAt(0).toUpperCase()}${username.slice(1)}'s vault`
    : 'My vault'

  return (
    <div ref={wrapRef} className="relative px-3 pb-2">
      {open && (
        <div
          role="menu"
          className="absolute top-full left-3 right-3 mt-1 z-50 rounded-md border border-line bg-paper shadow-2 p-1"
        >
          {/* Current vault — checked */}
          <div
            role="menuitem"
            className="flex items-center gap-2 px-2 py-[7px] rounded-md text-[13px] text-ink cursor-default"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-amber-deep shrink-0"
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            <span className="flex-1 font-medium truncate">{vaultName}</span>
          </div>

          <div className="my-1 mx-1 h-px bg-line" />

          {/* Business vaults — coming soon */}
          <div
            role="menuitem"
            aria-disabled="true"
            className="flex items-center gap-2 px-2 py-[7px] rounded-md text-[13px] text-ink-4 cursor-default select-none"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="shrink-0"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <span className="flex-1 truncate">Business</span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-line text-ink-3 shrink-0">
              Coming soon
            </span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-full border text-[13px] font-medium transition-colors cursor-pointer ${
          open
            ? 'border-line bg-paper-3 text-ink'
            : 'border-line bg-paper-2 text-ink-2 hover:bg-paper-3/60 hover:text-ink'
        }`}
      >
        <svg
          width="13"
          height="13"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="shrink-0 text-amber-deep"
        >
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
        </svg>
        <span className="flex-1 text-left truncate">{vaultName}</span>
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
    </div>
  )
}

function UserCard() {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const email = user?.email ?? ''
  const initial = email.trim().charAt(0).toUpperCase() || '?'

  const itemClass =
    'w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] text-ink-2 hover:bg-paper-3/50 transition-colors text-left cursor-pointer'

  return (
    <div ref={wrapRef} className="relative px-3 pb-3 pt-2">
      {open && (
        <div
          role="menu"
          className="absolute bottom-full left-3 right-3 mb-1 rounded-md border border-line bg-paper-2 shadow-2 p-1"
        >
          <Link
            to="/settings/profile"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={itemClass}
          >
            <Icon name="settings" size={13} className="shrink-0 text-ink-3" />
            <span className="flex-1">Profile</span>
          </Link>
          <Link
            to="/settings/billing"
            role="menuitem"
            onClick={() => setOpen(false)}
            className={itemClass}
          >
            <Icon name="cloud" size={13} className="shrink-0 text-ink-3" />
            <span className="flex-1">Billing</span>
          </Link>
          <div className="my-1 mx-1 h-px bg-line" />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              logout()
            }}
            className={itemClass}
          >
            <Icon name="x" size={13} className="shrink-0 text-ink-3" />
            <span className="flex-1">Log out</span>
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] transition-colors cursor-pointer ${
          open ? 'bg-paper-3' : 'hover:bg-paper-3/50'
        }`}
      >
        <div className="size-6 shrink-0 rounded-full bg-amber-bg text-amber-deep flex items-center justify-center text-[11px] font-semibold font-mono">
          {initial}
        </div>
        <span className="flex-1 truncate text-left text-ink-2">{email}</span>
        <Icon
          name="chevron-down"
          size={11}
          className={`shrink-0 text-ink-3 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
    </div>
  )
}

// ─── Recent-upload badge ─────────────────────────────────────────────────────
// Each entry records when a batch completed; entries older than 10 min are
// pruned on every new upload event and when the user visits /recent.
const RECENT_BADGE_TTL_MS = 10 * 60 * 1000

interface RecentUploadEntry {
  count: number
  at: number
}

function useRecentUploadBadge(pathname: string) {
  const [entries, setEntries] = useState<RecentUploadEntry[]>([])

  // Prune entries older than 10 minutes
  function pruned(list: RecentUploadEntry[]): RecentUploadEntry[] {
    const cutoff = Date.now() - RECENT_BADGE_TTL_MS
    return list.filter((e) => e.at > cutoff)
  }

  // Listen for upload completion events
  useEffect(() => {
    function onFileUploaded(e: Event) {
      const count = (e as CustomEvent<{ count?: number }>).detail?.count ?? 1
      setEntries((prev) => pruned([...prev, { count, at: Date.now() }]))
    }
    window.addEventListener('beebeeb:file-uploaded', onFileUploaded)
    return () => window.removeEventListener('beebeeb:file-uploaded', onFileUploaded)
  }, [])

  // Clear badge when user visits /recent
  useEffect(() => {
    if (pathname === '/recent') {
      setEntries([])
    }
  }, [pathname])

  // Also prune stale entries on a 60s interval so the badge disappears
  // automatically after 10 minutes even if the user stays on the same page.
  useEffect(() => {
    const id = setInterval(() => {
      setEntries((prev) => pruned(prev))
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  const badgeCount = pruned(entries).reduce((sum, e) => sum + e.count, 0)
  return badgeCount
}

export function DriveLayout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { isUnlocked, getMasterKey } = useKeys()
  const { isFrozen } = useFrozen()
  const adminUrl = import.meta.env.VITE_ADMIN_URL ?? 'https://admin.beebeeb.io'
  const { usage, planDetails: contextPlanDetails, pinnedFolderIds } = useDriveData()
  const [sharedFolders, setSharedFolders] = useState<(ShareInvite & { decryptedName?: string })[]>([])
  const [storageRegion, setStorageRegion] = useState<string>('auto')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const sidebarTrapRef = useFocusTrap<HTMLElement>(sidebarOpen)
  const [quickAccessDragOver, setQuickAccessDragOver] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const recentUploadCount = useRecentUploadBadge(location.pathname)
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications()

  useEffect(() => {
    getAdminStats().then(() => setIsAdmin(true)).catch(() => setIsAdmin(false))
  }, [])

  // Close sidebar on navigation (mobile)
  useEffect(() => {
    setSidebarOpen(false)
  }, [location.pathname])

  useEffect(() => {
    getPreference<{ pool_name: string }>('storage_region')
      .then(pref => { if (pref?.pool_name) setStorageRegion(pref.pool_name) })
      .catch(() => {})
  }, [])

  useEffect(() => {
    function onRegionChanged() {
      getPreference<{ pool_name: string }>('storage_region')
        .then(pref => { if (pref?.pool_name) setStorageRegion(pref.pool_name) })
        .catch(() => {})
    }
    window.addEventListener('beebeeb:region-changed', onRegionChanged)
    return () => {
      window.removeEventListener('beebeeb:region-changed', onRegionChanged)
    }
  }, [])

  function handleQuickAccessDragOver(e: DragEvent<HTMLDivElement>) {
    if (e.dataTransfer.types.includes('application/beebeeb-folder')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setQuickAccessDragOver(true)
    }
  }

  function handleQuickAccessDragLeave(e: DragEvent<HTMLDivElement>) {
    const related = e.relatedTarget as Node | null
    if (related && (e.currentTarget as HTMLElement).contains(related)) return
    setQuickAccessDragOver(false)
  }

  async function handleQuickAccessDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setQuickAccessDragOver(false)
    const folderId = e.dataTransfer.getData('application/beebeeb-folder')
    if (!folderId) return
    if (!pinnedFolderIds.includes(folderId)) {
      await setPreference(PINNED_FOLDERS_PREF, { folder_ids: [...pinnedFolderIds, folderId] }).catch(() => {})
      window.dispatchEvent(new Event('beebeeb:pins-changed'))
    }
  }

  async function togglePin(folderId: string) {
    const newIds = pinnedFolderIds.includes(folderId)
      ? pinnedFolderIds.filter(id => id !== folderId)
      : [...pinnedFolderIds, folderId]
    await setPreference(PINNED_FOLDERS_PREF, { folder_ids: newIds }).catch((err) => console.error('[DriveLayout] Failed to save pinned folders:', err))
    window.dispatchEvent(new Event('beebeeb:pins-changed'))
  }

  useEffect(() => {
    if (!isUnlocked) return
    getIncomingInvites().then(async (invites) => {
      const folderInvites = invites.filter(i => i.is_folder_share && i.status === 'approved')
      if (folderInvites.length === 0) {
        setSharedFolders([])
        return
      }
      const withNames = await Promise.all(folderInvites.map(async (invite) => {
        try {
          if (!invite.sender_public_key || !invite.encrypted_folder_key || !invite.file_name_encrypted) {
            return { ...invite, decryptedName: 'Shared folder' }
          }
          const folderKey = await decryptFolderKey(
            getMasterKey(),
            fromBase64(invite.sender_public_key),
            invite.file_id,
            fromBase64(invite.encrypted_folder_key),
          )
          const keys = await getFolderKeys(invite.id)
          const folderEntry = keys.find(k => k.file_id === invite.file_id)
          if (folderEntry) {
            const fileKey = await decryptChildFileKey(folderKey, folderEntry.encrypted_file_key)
            const { nonce, ciphertext } = parseEncryptedBlob(invite.file_name_encrypted)
            const name = await decryptFilename(fileKey, nonce, ciphertext)
            return { ...invite, decryptedName: name }
          }
          return { ...invite, decryptedName: 'Shared folder' }
        } catch {
          return { ...invite, decryptedName: 'Shared folder' }
        }
      }))
      setSharedFolders(withNames)
    }).catch((err) => {
      console.error('[DriveLayout] Failed to load shared folders:', err)
    })
  }, [isUnlocked, getMasterKey])

  // Derive storage display values from the context's usage object.
  // The context already merges billing-endpoint overrides when available.
  const storageLimit = usage?.plan_limit_bytes ?? contextPlanDetails.plan?.storage_bytes ?? 5_368_709_120
  const resolvedUsedBytes  = usage?.used_bytes  ?? 0
  const resolvedQuotaBytes = storageLimit
  const planName = usage?.plan_name ?? contextPlanDetails.plan?.name ?? 'Free'

  return (
    <div className="h-screen flex overflow-hidden bg-paper">
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 md:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      <aside
        ref={sidebarTrapRef}
        className={`fixed inset-y-0 left-0 z-50 w-[220px] border-r border-line bg-paper-2 flex flex-col transition-transform duration-200 md:static md:translate-x-0 md:shrink-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        aria-label="Sidebar"
      >
        <div className="px-4 pt-4 pb-3 flex items-center justify-between">
          <BBLogo size={14} />
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-1 text-ink-3 hover:text-ink transition-colors cursor-pointer"
            aria-label="Close sidebar"
          >
            <Icon name="x" size={16} />
          </button>
        </div>

        <VaultSwitcher />

        <nav aria-label="Main navigation" className="px-3 py-1.5">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                style={{ paddingTop: 'var(--sidebar-item-py, 7px)', paddingBottom: 'var(--sidebar-item-py, 7px)' }}
                className={`w-full flex items-center gap-2.5 px-2 rounded-md text-[13px] transition-colors ${
                  isActive
                    ? 'bg-paper-3 font-semibold text-ink'
                    : 'text-ink-2 hover:bg-paper-3/50'
                }`}
                {...(item.path === '/shared' ? { 'data-tour': 'share' } : {})}
              >
                <Icon name={item.icon} size={13} className="shrink-0" />
                <span className="flex-1">{item.label}</span>
                {item.label === 'Recent' && recentUploadCount > 0 && (
                  <span className="ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-amber px-1 text-[10px] font-semibold text-paper">
                    {recentUploadCount > 99 ? '99+' : recentUploadCount}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        <div
          onDragOver={handleQuickAccessDragOver}
          onDragLeave={handleQuickAccessDragLeave}
          onDrop={handleQuickAccessDrop}
          className={quickAccessDragOver ? 'ring-1 ring-amber/40 rounded-md bg-amber-bg/20 mx-1' : ''}
        >
          <QuickAccess />
          {quickAccessDragOver && (
            <div className="px-4 pb-2 text-[11px] text-amber-deep text-center">
              Drop to pin
            </div>
          )}
        </div>

        {sharedFolders.length > 0 && (
          <>
            <div className="mx-4 my-2.5 h-px bg-line" />
            <div className="px-4 py-1">
              <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3 mb-1">
                Pinned shares
              </div>
            </div>
            <nav aria-label="Shared folders" className="px-3 pb-1.5 overflow-y-auto max-h-[200px]">
              {sharedFolders.map((folder) => {
                const isActive = location.pathname === `/shared-folder/${folder.file_id}`
                return (
                  <Link
                    key={folder.id}
                    to={`/shared-folder/${folder.file_id}?invite=${folder.id}`}
                    style={{ paddingTop: 'var(--sidebar-item-py, 7px)', paddingBottom: 'var(--sidebar-item-py, 7px)' }}
                    className={`group w-full flex items-center gap-2.5 px-2 rounded-md text-[13px] transition-colors ${
                      isActive
                        ? 'bg-paper-3 font-semibold text-ink'
                        : 'text-ink-2 hover:bg-paper-3/50'
                    }`}
                  >
                    <div className="relative shrink-0">
                      <Icon name="folder" size={13} className="text-amber-deep" />
                    </div>
                    <span className="flex-1 truncate">{folder.decryptedName}</span>
                    <button
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); togglePin(folder.file_id) }}
                      className={`shrink-0 transition-opacity ${pinnedFolderIds.includes(folder.file_id) ? 'opacity-100 text-amber-deep' : 'opacity-0 group-hover:opacity-100 text-ink-3 hover:text-ink'}`}
                      title={pinnedFolderIds.includes(folder.file_id) ? 'Unpin from drive' : 'Pin to drive'}
                      aria-label={pinnedFolderIds.includes(folder.file_id) ? 'Unpin from drive' : 'Pin to drive'}
                    >
                      <Icon name="star" size={11} />
                    </button>
                  </Link>
                )
              })}
            </nav>
          </>
        )}

        <div className="mx-4 my-2.5 h-px bg-line" />

        <div className="mt-auto px-4 py-4 border-t border-line">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3">
              Storage
            </div>
            <span className="text-[10px] text-ink-3">{planName} plan</span>
          </div>
          <StorageUsageBar
            usedBytes={resolvedUsedBytes}
            quotaBytes={resolvedQuotaBytes}
            compact
          />
          <SidebarQuotaBar
            usedBytes={resolvedUsedBytes}
            quotaBytes={resolvedQuotaBytes}
          />
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-ink-3">
            {REGION_META[storageRegion]?.flag ? (
              <span className="text-[12px]">{REGION_META[storageRegion].flag}</span>
            ) : (
              <Icon name="shield" size={11} className="text-amber-deep" />
            )}
            <span className="font-mono">{REGION_META[storageRegion]?.label ?? storageRegion}</span>
          </div>
        </div>

        {isAdmin && (
          <div className="px-3 pt-2">
            <a
              href={adminUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={async () => {
                // Mint a 60s OTP, then navigate to the configured admin app.
                try {
                  const handoff = await requestAdminHandoff()
                  window.location.href = `${adminUrl}/auth/handoff?token=${encodeURIComponent(handoff.token)}`
                } catch {
                  // Fall back to a plain navigation — admin's own login
                  // page handles unauthenticated visitors.
                  window.location.href = adminUrl
                }
              }}
              className="w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] transition-colors text-ink-2 hover:bg-paper-3/50 cursor-pointer"
            >
              <Icon name="shield" size={13} className="shrink-0" />
              <span className="flex-1 text-left">Admin</span>
              <Icon name="link" size={11} className="text-ink-4 shrink-0" />
            </a>
          </div>
        )}

        <PwaInstallBanner />
        <UserCard />
      </aside>

      <main id="main-content" className="relative flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden" style={{ fontSize: 'var(--display-font-size, 15px)' }}>
        {/* Mobile header with hamburger */}
        <div className="md:hidden flex items-center gap-3 px-4 py-2.5 border-b border-line bg-paper-2">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-1 text-ink-2 hover:text-ink transition-colors cursor-pointer"
            aria-label="Open sidebar"
          >
            <Icon name="menu" size={18} />
          </button>
          <BBLogo size={12} />
          <div className="ml-auto">
            <NotificationInbox
              notifications={notifications}
              unreadCount={unreadCount}
              onMarkRead={markRead}
              onMarkAllRead={markAllRead}
            />
          </div>
        </div>

        {/* Desktop notification bar — bell in top-right, hidden on mobile */}
        <div className="hidden md:flex items-center justify-end px-5 py-1.5 border-b border-line bg-paper">
          <NotificationInbox
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
          />
        </div>
        <IosAppBanner />
        <AnnouncementBanner />
        <EmailVerifyBanner />
        {isFrozen && (
          <div className="bg-amber/10 border-b border-amber/20 px-4 py-2.5 text-center text-[13px] text-ink-2">
            Your account is frozen. You can view and download files but cannot upload, delete, or share.{' '}
            <Link to="/settings/privacy" className="text-amber-deep hover:underline font-medium">
              Unfreeze in Settings
            </Link>
          </div>
        )}
        {usage && (
          <QuotaWarning
            usedBytes={usage.used_bytes}
            limitBytes={usage.plan_limit_bytes}
          />
        )}
        {children}
      </main>
    </div>
  )
}
