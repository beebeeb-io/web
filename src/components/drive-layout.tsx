import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { BBLogo } from './bb-logo'
import { Icon } from './icons'
import type { IconName } from './icons'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import {
  getSubscription,
  getPlans,
  getStorageUsage,
  getIncomingInvites,
  getFolderKeys,
  getPreference,
  setPreference,
  type Subscription,
  type Plan,
  type ShareInvite,
  type StorageUsage,
} from '../lib/api'
import { decryptFolderKey, decryptChildFileKey } from '../lib/folder-share-crypto'
import { decryptFilename, fromBase64 } from '../lib/crypto'

const navItems: { path: string; icon: IconName; label: string }[] = [
  { path: '/', icon: 'folder', label: 'All files' },
  { path: '/shared', icon: 'users', label: 'Shared' },
  { path: '/photos', icon: 'image', label: 'Photos' },
  { path: '/starred', icon: 'star', label: 'Starred' },
  { path: '/recent', icon: 'clock', label: 'Recent' },
  { path: '/trash', icon: 'trash', label: 'Trash' },
]

function formatStorage(bytes: number): string {
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function regionLabel(region: string): string {
  const map: Record<string, string> = {
    frankfurt: 'Frankfurt · Hetzner',
    falkenstein: 'Falkenstein · Hetzner',
    helsinki: 'Helsinki · Hetzner',
  }
  return map[region] ?? region
}

export function DriveLayout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const { logout } = useAuth()
  const { isUnlocked, getMasterKey } = useKeys()
  const [sub, setSub] = useState<Subscription | null>(null)
  const [planDetails, setPlanDetails] = useState<Plan | null>(null)
  const [sharedFolders, setSharedFolders] = useState<(ShareInvite & { decryptedName?: string })[]>([])
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const [usage, setUsage] = useState<StorageUsage | null>(null)

  useEffect(() => {
    getSubscription().then(setSub).catch((err) => console.error('[DriveLayout] Failed to load subscription:', err))
    getStorageUsage().then(setUsage).catch((err) => console.error('[DriveLayout] Failed to load storage usage:', err))
    getPlans().then((plans) => {
      getSubscription().then((s) => {
        const match = plans.find((p) => p.id === s.plan)
        if (match) setPlanDetails(match)
      }).catch((err) => console.error('[DriveLayout] Failed to load subscription for plan match:', err))
    }).catch((err) => console.error('[DriveLayout] Failed to load plans:', err))
  }, [])

  useEffect(() => {
    getPreference<{ folder_ids: string[] }>('pinned_shared_folders')
      .then(pref => setPinnedIds(pref?.folder_ids ?? []))
      .catch((err) => console.error('[DriveLayout] Failed to load pinned folders:', err))
  }, [])

  async function togglePin(folderId: string) {
    const newIds = pinnedIds.includes(folderId)
      ? pinnedIds.filter(id => id !== folderId)
      : [...pinnedIds, folderId]
    setPinnedIds(newIds)
    await setPreference('pinned_shared_folders', { folder_ids: newIds }).catch((err) => console.error('[DriveLayout] Failed to save pinned folders:', err))
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
            const parsed = JSON.parse(invite.file_name_encrypted) as { nonce: string; ciphertext: string }
            const name = await decryptFilename(fileKey, fromBase64(parsed.nonce), fromBase64(parsed.ciphertext))
            return { ...invite, decryptedName: name }
          }
          return { ...invite, decryptedName: 'Shared folder' }
        } catch {
          return { ...invite, decryptedName: invite.file_name_encrypted ?? 'Shared folder' }
        }
      }))
      setSharedFolders(withNames)
    }).catch((err) => {
      console.error('[DriveLayout] Failed to load shared folders:', err)
    })
  }, [isUnlocked, getMasterKey])

  const storageLimit = usage?.plan_limit_bytes ?? planDetails?.storage_bytes ?? 5_368_709_120
  const storageLabel = formatStorage(storageLimit)
  const usedBytes = usage?.used_bytes ?? 0
  const usedPct = storageLimit > 0 ? Math.min(100, (usedBytes / storageLimit) * 100) : 0

  return (
    <div className="h-screen flex overflow-hidden bg-paper">
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>
      <aside className="w-[220px] shrink-0 border-r border-line bg-paper-2 flex flex-col" aria-label="Sidebar">
        <div className="px-4 pt-4 pb-3">
          <BBLogo size={14} />
        </div>

        <nav aria-label="Main navigation" className="px-3 py-1.5">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] transition-colors ${
                  isActive
                    ? 'bg-paper-3 font-semibold text-ink'
                    : 'text-ink-2 hover:bg-paper-3/50'
                }`}
              >
                <Icon name={item.icon} size={13} className="shrink-0" />
                <span className="flex-1">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {sharedFolders.length > 0 && (
          <>
            <div className="mx-4 my-2.5 h-px bg-line" />
            <div className="px-4 py-1">
              <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3 mb-1">
                Shared with me
              </div>
            </div>
            <nav aria-label="Shared folders" className="px-3 pb-1.5 overflow-y-auto max-h-[200px]">
              {sharedFolders.map((folder) => {
                const isActive = location.pathname === `/shared-folder/${folder.file_id}`
                return (
                  <Link
                    key={folder.id}
                    to={`/shared-folder/${folder.file_id}?invite=${folder.id}`}
                    className={`group w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] transition-colors ${
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
                      className={`shrink-0 transition-opacity ${pinnedIds.includes(folder.file_id) ? 'opacity-100 text-amber-deep' : 'opacity-0 group-hover:opacity-100 text-ink-3 hover:text-ink'}`}
                      title={pinnedIds.includes(folder.file_id) ? 'Unpin from drive' : 'Pin to drive'}
                      aria-label={pinnedIds.includes(folder.file_id) ? 'Unpin from drive' : 'Pin to drive'}
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
          <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3 mb-2">
            Storage
          </div>
          <div className="h-[3px] w-full rounded-full bg-paper-3 overflow-hidden mb-1.5">
            <div className="h-full rounded-full bg-amber" style={{ width: `${usedPct}%` }} />
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="font-mono tabular-nums">
              {formatStorage(usedBytes)} / {storageLabel}
            </span>
            <Link to="/billing" className="font-medium text-amber-deep hover:underline">
              Upgrade
            </Link>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-ink-3">
            <Icon name="shield" size={11} className="text-amber-deep" />
            <span className="font-mono">{regionLabel(sub?.region ?? 'frankfurt')}</span>
          </div>
        </div>

        <div className="px-3 pb-3">
          <button
            onClick={logout}
            aria-label="Log out"
            className="w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] text-ink-3 hover:bg-paper-3/50 transition-colors text-left"
          >
            <Icon name="x" size={13} className="shrink-0" />
            Log out
          </button>
        </div>
      </aside>

      <main id="main-content" className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  )
}
