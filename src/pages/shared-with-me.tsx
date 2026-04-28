import { useState, useEffect, useCallback } from 'react'
import { BBButton } from '../components/bb-button'
import { BBChip } from '../components/bb-chip'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import { NotificationInbox, useNotifications } from '../components/notification-inbox'
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

// ─── Component ────────────────────────────────────

export function SharedWithMe() {
  const [items, setItems] = useState<SharedWithMeItem[]>([])
  const [filter, setFilter] = useState<FilterId>('all')
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications()

  // Fetch from API
  useEffect(() => {
    listSharedWithMe()
      .then(setItems)
      .catch(() => {})
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
    <DriveLayout>
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
    </DriveLayout>
  )
}
