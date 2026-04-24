import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { BBLogo } from '../components/bb-logo'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { NotificationInbox, useNotifications } from '../components/notification-inbox'
import { useAuth } from '../lib/auth-context'
import { listSharedWithMe, type SharedWithMeItem } from '../lib/api'

// ─── Helpers ───────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  return `${weeks}w ago`
}

function formatExpiry(expiresAt: string | null): { text: string; isUrgent: boolean } {
  if (!expiresAt) return { text: 'Never', isUrgent: false }
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return { text: 'Expired', isUrgent: true }
  const hours = Math.floor(diff / (1000 * 60 * 60))
  if (hours < 48) return { text: `in ${hours}h`, isUrgent: true }
  const days = Math.floor(hours / 24)
  return { text: `in ${days} days`, isUrgent: false }
}

// ─── Filter type ──────────────────────────────────

type FilterId = 'all' | 'people' | 'anonymous'

// ─── Nav items (same as drive sidebar) ────────────

type NavId = 'files' | 'shared' | 'photos' | 'starred' | 'recent' | 'trash'

const navItems: { id: NavId; icon: IconName; label: string; count?: string; href: string }[] = [
  { id: 'files', icon: 'folder', label: 'All files', href: '/' },
  { id: 'shared', icon: 'users', label: 'Shared', count: '6', href: '/shared' },
  { id: 'photos', icon: 'image', label: 'Photos', href: '/photos' },
  { id: 'starred', icon: 'star', label: 'Starred', href: '/' },
  { id: 'recent', icon: 'clock', label: 'Recent', href: '/' },
  { id: 'trash', icon: 'trash', label: 'Trash', href: '/trash' },
]

// ─── Mock data ────────────────────────────────────

const MOCK_ITEMS: SharedWithMeItem[] = [
  { file_name_encrypted: 'editorial-review/', file_size: 0, from_email: 'anika@publication.eu', access_level: 'Can edit', expires: null, created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), is_folder: true },
  { file_name_encrypted: 'fact-check-notes.pdf', file_size: 2516582, from_email: 'anika@publication.eu', access_level: 'Read only', expires: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), is_folder: false },
  { file_name_encrypted: 'source-materials/', file_size: 0, from_email: 'legal@foundation.eu', access_level: 'Read only', expires: new Date(Date.now() + 22 * 24 * 60 * 60 * 1000).toISOString(), created_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), is_folder: true },
  { file_name_encrypted: 'leaked-contract-draft.pdf', file_size: 1153434, from_email: 'confidential-link', access_level: 'One-time view', expires: new Date(Date.now() + 47 * 60 * 60 * 1000).toISOString(), created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), is_folder: false },
  { file_name_encrypted: 'podcast-raw/', file_size: 0, from_email: 'pieter@producer.nl', access_level: 'Can edit', expires: null, created_at: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString(), is_folder: true },
]

// ─── Component ────────────────────────────────────

export function SharedWithMe() {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [items, setItems] = useState<SharedWithMeItem[]>(MOCK_ITEMS)
  const [filter, setFilter] = useState<FilterId>('all')
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications()

  // Fetch from API
  useEffect(() => {
    listSharedWithMe()
      .then(setItems)
      .catch(() => {
        // API unavailable, keep mock data
      })
  }, [])

  const isAnonymous = useCallback((item: SharedWithMeItem) => {
    return !item.from_email.includes('@')
  }, [])

  const filteredItems = items.filter((item) => {
    if (filter === 'people') return !isAnonymous(item)
    if (filter === 'anonymous') return isAnonymous(item)
    return true
  })

  const peopleCt = items.filter((i) => !isAnonymous(i)).length
  const anonCt = items.filter((i) => isAnonymous(i)).length

  return (
    <div className="h-screen flex overflow-hidden bg-paper">
      {/* ─── Sidebar ─────────────────────────── */}
      <aside className="w-[220px] shrink-0 border-r border-line bg-paper-2 flex flex-col">
        <div className="px-4 pt-4 pb-3">
          <BBLogo size={14} />
        </div>

        <div className="px-3 pb-2.5">
          <BBButton
            variant="amber"
            className="w-full justify-center gap-1.5"
            onClick={() => navigate('/')}
          >
            <Icon name="plus" size={13} /> New
          </BBButton>
        </div>

        <nav className="px-3 py-1.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => navigate(item.href)}
              className={`w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] transition-colors text-left ${
                item.id === 'shared'
                  ? 'bg-paper-3 font-semibold text-ink'
                  : 'text-ink-2 hover:bg-paper-3/50'
              }`}
            >
              <Icon name={item.icon} size={13} className="shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.count && (
                <span className="font-mono text-[10px] text-ink-4">{item.count}</span>
              )}
            </button>
          ))}
        </nav>

        <div className="mx-4 my-2.5 h-px bg-line" />

        <div className="px-3">
          <div className="px-2 pb-2 text-[10px] font-medium uppercase tracking-wider text-ink-3">
            Teams
          </div>
          {[
            { name: 'Acme Studio', amber: true },
            { name: 'Personal', amber: false },
          ].map((team) => (
            <button
              key={team.name}
              className="w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] text-ink-2 hover:bg-paper-3/50 transition-colors text-left"
            >
              <span
                className="shrink-0 rounded-[3px] border border-line-2"
                style={{
                  width: 14,
                  height: 14,
                  background: team.amber ? 'var(--color-amber)' : 'var(--color-paper-3)',
                }}
              />
              <span className="flex-1">{team.name}</span>
            </button>
          ))}
        </div>

        <div className="mt-auto px-4 py-4 border-t border-line">
          <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3 mb-2">
            Storage
          </div>
          <div className="h-[3px] w-full rounded-full bg-paper-3 overflow-hidden mb-1.5">
            <div className="h-full rounded-full bg-amber" style={{ width: '38%' }} />
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="font-mono tabular-nums">76 / 200 GB</span>
            <span className="font-medium text-amber-deep cursor-pointer hover:underline">
              Upgrade
            </span>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-ink-3">
            <Icon name="shield" size={11} className="text-amber-deep" />
            <span className="font-mono">EU-WEST · AES-256</span>
          </div>
        </div>

        <div className="px-3 pb-3">
          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] text-ink-3 hover:bg-paper-3/50 transition-colors text-left"
          >
            <Icon name="x" size={13} className="shrink-0" />
            Log out
          </button>
        </div>
      </aside>

      {/* ─── Main area ───────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-line flex items-center gap-2.5">
          <Icon name="share" size={14} className="text-amber-deep" />
          <div>
            <h1 className="text-sm font-semibold text-ink">Shared with me</h1>
            <p className="text-[11px] text-ink-3">
              Their key granted you — they can still revoke
            </p>
          </div>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setFilter('all')}
              className="cursor-pointer"
            >
              <BBChip variant={filter === 'all' ? 'amber' : 'default'} className="text-[10.5px]">
                All · {items.length}
              </BBChip>
            </button>
            <button
              onClick={() => setFilter('people')}
              className="cursor-pointer"
            >
              <BBChip variant={filter === 'people' ? 'amber' : 'default'} className="text-[10.5px]">
                People · {peopleCt}
              </BBChip>
            </button>
            <button
              onClick={() => setFilter('anonymous')}
              className="cursor-pointer"
            >
              <BBChip variant={filter === 'anonymous' ? 'amber' : 'default'} className="text-[10.5px]">
                Anonymous links · {anonCt}
              </BBChip>
            </button>
          </div>

          <NotificationInbox
            notifications={notifications}
            unreadCount={unreadCount}
            onMarkRead={markRead}
            onMarkAllRead={markAllRead}
          />
        </div>

        {/* Column header */}
        <div
          className="px-[18px] py-2.5 border-b border-line bg-paper-2"
          style={{
            display: 'grid',
            gridTemplateColumns: '32px 1.4fr 1fr 140px 120px 100px 80px',
            gap: 14,
          }}
        >
          <span />
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Name</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">From</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Access</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Expires</span>
          <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">Size</span>
          <span />
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto">
          {filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-20">
              <div
                className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center"
                style={{
                  background: 'var(--color-amber-bg)',
                  border: '1.5px dashed var(--color-line-2)',
                }}
              >
                <Icon name="share" size={24} className="text-amber-deep" />
              </div>
              <div className="text-[15px] font-semibold text-ink mb-1">Nothing shared with you yet</div>
              <div className="text-[13px] text-ink-3">
                When someone shares a file or folder with you, it will appear here
              </div>
            </div>
          ) : (
            filteredItems.map((item, i, arr) => {
              const isFolder = item.is_folder
              const isAnon = isAnonymous(item)
              const expiry = formatExpiry(item.expires)
              const sizeStr = isFolder ? `${Math.floor(Math.random() * 200)} files` : formatBytes(item.file_size)

              return (
                <div
                  key={i}
                  className="group hover:bg-paper-2 transition-colors cursor-pointer"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '32px 1.4fr 1fr 140px 120px 100px 80px',
                    gap: 14,
                    padding: '11px 18px',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--color-line)' : 'none',
                  }}
                >
                  <Icon
                    name={isFolder ? 'folder' : 'file'}
                    size={14}
                    className={isFolder ? 'text-amber-deep self-center' : 'text-ink-2 self-center'}
                  />
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[13px] font-medium truncate">{item.file_name_encrypted}</span>
                    <span className="text-[11px] text-ink-4 shrink-0">{timeAgo(item.created_at)}</span>
                  </div>
                  <span className={`font-mono text-[11.5px] self-center ${isAnon ? 'text-ink-3 italic' : 'text-ink-2'}`}>
                    {item.from_email}
                  </span>
                  <div className="self-center">
                    <BBChip
                      variant={item.access_level === 'One-time view' ? 'amber' : 'default'}
                      className="text-[10px]"
                    >
                      {item.access_level}
                    </BBChip>
                  </div>
                  <span className={`font-mono text-[11px] self-center ${expiry.isUrgent ? 'text-red' : 'text-ink-3'}`}>
                    {expiry.text}
                  </span>
                  <span className="font-mono text-[11px] text-ink-3 self-center">
                    {sizeStr}
                  </span>
                  <div className="flex justify-end self-center">
                    <BBButton
                      size="sm"
                      variant="ghost"
                      className="opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Icon name="more" size={13} />
                    </BBButton>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* Status bar */}
        <div className="px-5 py-2 border-t border-line bg-paper-2 flex items-center gap-3.5 text-[11px] text-ink-3">
          <span className="font-mono">{filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''}</span>
          <span>·</span>
          <span className="flex items-center gap-1.5">
            <Icon name="shield" size={12} className="text-amber-deep" />
            End-to-end encrypted
          </span>
        </div>
      </main>
    </div>
  )
}
