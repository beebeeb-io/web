import { useState, useEffect, useRef, useCallback } from 'react'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import {
  listNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type Notification as ApiNotification,
} from '../lib/api'
import { useWsEvent } from '../lib/ws-context'

interface DisplayNotification {
  id: string
  type: string
  icon: IconName
  title: string
  description: string
  timestamp: string
  read: boolean
  danger?: boolean
}

function notificationIcon(type: string): IconName {
  const map: Record<string, IconName> = {
    share_received: 'share',
    share_claimed: 'users',
    share_approved: 'check',
    workspace_invite: 'users',
    quota_warning: 'cloud',
    quota_critical: 'cloud',
  }
  return map[type] ?? 'cloud'
}

function toDisplay(n: ApiNotification): DisplayNotification {
  return {
    id: n.id,
    type: n.type,
    icon: notificationIcon(n.type),
    title: n.title,
    description: n.body ?? '',
    timestamp: n.created_at,
    read: n.read,
    danger: n.type === 'quota_critical',
  }
}

function groupByTime(items: DisplayNotification[]): { heading: string; items: DisplayNotification[] }[] {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86_400_000)

  const groups: Record<string, DisplayNotification[]> = {}
  const order: string[] = []

  for (const item of items) {
    const d = new Date(item.timestamp)
    let heading: string
    if (d >= today) heading = 'Today'
    else if (d >= yesterday) heading = 'Yesterday'
    else heading = 'Earlier'

    if (!groups[heading]) {
      groups[heading] = []
      order.push(heading)
    }
    groups[heading].push(item)
  }

  return order.map((heading) => ({ heading, items: groups[heading] }))
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d`
  const weeks = Math.floor(days / 7)
  return `${weeks}w`
}

export function useNotifications() {
  const [notifications, setNotifications] = useState<DisplayNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  const refresh = useCallback(async () => {
    try {
      const data = await listNotifications()
      setNotifications(data.notifications.map(toDisplay))
      setUnreadCount(data.unread_count)
    } catch (err) {
      console.error('[Notifications] Failed to load notifications:', err)
    }
  }, [])

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 300000)
    return () => clearInterval(interval)
  }, [refresh])

  const addNotification = useCallback((n: DisplayNotification) => {
    setNotifications((prev) => {
      // Avoid duplicates (e.g. if poll and WS event arrive close together)
      if (prev.some((existing) => existing.id === n.id)) return prev
      return [n, ...prev]
    })
    if (!n.read) setUnreadCount((prev) => prev + 1)
  }, [])

  // Listen for real-time notification.created events via WebSocket
  useWsEvent(['notification.created'], useCallback((event) => {
    const data = event.data as {
      id?: string
      type?: string
      title?: string
      body?: string
    }
    if (data.id && data.title) {
      const notifType = data.type ?? 'general'
      addNotification({
        id: data.id,
        type: notifType,
        icon: notificationIcon(notifType),
        title: data.title,
        description: data.body ?? '',
        timestamp: event.timestamp,
        read: false,
        danger: notifType === 'quota_critical',
      })
    } else {
      // If the WS payload is minimal, do a full refresh to get the notification
      refresh()
    }
  }, [addNotification, refresh]))

  const markRead = useCallback(async (id: string) => {
    try {
      await markNotificationRead(id)
      setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)))
      setUnreadCount((prev) => Math.max(0, prev - 1))
    } catch (err) {
      console.error('[Notifications] Failed to mark notification read:', err)
    }
  }, [])

  const markAllRead = useCallback(async () => {
    try {
      await markAllNotificationsRead()
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch (err) {
      console.error('[Notifications] Failed to mark all read:', err)
    }
  }, [])

  return { notifications, unreadCount, addNotification, markRead, markAllRead, refresh }
}

interface NotificationInboxProps {
  notifications: DisplayNotification[]
  unreadCount: number
  onMarkRead: (id: string) => void
  onMarkAllRead: () => void
}

export function NotificationInbox({
  notifications,
  unreadCount,
  onMarkRead,
  onMarkAllRead,
}: NotificationInboxProps) {
  const [open, setOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  useEffect(() => {
    if (!open) return
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  const groups = groupByTime(notifications)

  return (
    <div ref={panelRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative p-1.5 rounded-md text-ink-2 hover:bg-paper-2 transition-colors"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
      >
        <Icon name="bell" size={14} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-amber-deep text-paper text-[9px] font-semibold">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-2 w-[420px] max-h-[620px] bg-paper border border-line-2 rounded-xl overflow-hidden z-50"
          style={{
            boxShadow: '0 22px 60px -12px rgba(0,0,0,0.22)',
          }}
        >
          <div className="px-4 py-3.5 flex items-center gap-2.5 border-b border-line">
            <span className="text-[13px] font-semibold">Activity</span>
            {unreadCount > 0 && (
              <BBChip variant="amber">{unreadCount} new</BBChip>
            )}
          </div>

          <div className="max-h-[480px] overflow-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm text-ink-3">
                No notifications yet
              </div>
            ) : (
              groups.map((group) => (
                <div key={group.heading}>
                  <div className="px-4 py-2 bg-paper-2 text-[9.5px] font-medium uppercase tracking-wider text-ink-3">
                    {group.heading}
                  </div>
                  {group.items.map((item) => (
                    <button
                      key={item.id}
                      className={`w-full grid gap-2.5 px-4 py-2.5 border-b border-line text-left transition-colors hover:bg-paper-2 ${
                        item.read ? 'bg-transparent' : 'bg-amber-bg'
                      }`}
                      style={{
                        gridTemplateColumns: '26px 1fr auto',
                        alignItems: 'flex-start',
                      }}
                      onClick={() => onMarkRead(item.id)}
                    >
                      <div
                        className={`w-[26px] h-[26px] rounded-[7px] flex items-center justify-center border ${
                          item.danger
                            ? 'bg-red/10 border-red/30'
                            : 'bg-paper-2 border-line'
                        }`}
                      >
                        <Icon
                          name={item.icon}
                          size={11}
                          className={item.danger ? 'text-red' : 'text-ink-2'}
                        />
                      </div>

                      <div className="min-w-0">
                        <div className="text-xs leading-snug">
                          <span className="font-semibold">{item.title}</span>
                        </div>
                        <div
                          className={`text-[10.5px] mt-0.5 leading-snug ${
                            item.danger ? 'text-red' : 'text-ink-3'
                          }`}
                        >
                          {item.description}
                        </div>
                      </div>

                      <span className="text-[10.5px] text-ink-4 whitespace-nowrap">
                        {timeAgo(item.timestamp)}
                      </span>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>

          {notifications.length > 0 && (
            <div className="px-4 py-2.5 bg-paper-2 border-t border-line flex items-center gap-2.5">
              <BBButton size="sm" variant="ghost" onClick={onMarkAllRead} className="gap-1.5">
                <Icon name="check" size={11} /> Mark all read
              </BBButton>
              <span className="text-[10.5px] text-ink-3 ml-auto">
                Archive after 30 days
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
