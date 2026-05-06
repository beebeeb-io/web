import { useEffect, useRef } from 'react'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'

export type SharedMenuTab = 'with-me' | 'by-me' | 'pending'

interface SharedMenuItem {
  id: string
  label: string
  icon: IconName
  danger?: boolean
  disabled?: boolean
  dividerAfter?: boolean
}

const WITH_ME_ITEMS: SharedMenuItem[] = [
  { id: 'download', label: 'Download', icon: 'download' },
  { id: 'save-copy', label: 'Save copy to my drive', icon: 'folder', dividerAfter: true },
  { id: 'forward', label: 'Forward to...', icon: 'share', dividerAfter: true },
  { id: 'remove-shared', label: 'Remove from shared', icon: 'x', danger: true },
]

const BY_ME_ITEMS: SharedMenuItem[] = [
  { id: 'share-settings', label: 'Share settings', icon: 'settings' },
  { id: 'view-activity', label: 'View activity', icon: 'eye', dividerAfter: true },
  { id: 'revoke-access', label: 'Revoke access', icon: 'trash', danger: true },
]

function getPendingItems(
  status?: 'invited' | 'claimed',
  role?: 'sender' | 'recipient',
): SharedMenuItem[] {
  if (status === 'invited' && role === 'sender') {
    return [
      { id: 'resend-email', label: 'Resend email', icon: 'mail' },
      { id: 'cancel-invite', label: 'Cancel invite', icon: 'x', danger: true },
    ]
  }
  if (status === 'claimed' && role === 'sender') {
    return [
      { id: 'approve', label: 'Approve', icon: 'check' },
      { id: 'deny', label: 'Deny', icon: 'x', danger: true },
    ]
  }
  if (status === 'claimed' && role === 'recipient') {
    return [
      { id: 'withdraw-claim', label: 'Withdraw claim', icon: 'x', danger: true },
    ]
  }
  return []
}

function getMenuItems(
  tab: SharedMenuTab,
  canReshare?: boolean,
  status?: 'invited' | 'claimed',
  role?: 'sender' | 'recipient',
): SharedMenuItem[] {
  if (tab === 'with-me') {
    return WITH_ME_ITEMS.map((item) =>
      item.id === 'forward' && canReshare === false
        ? { ...item, disabled: true }
        : item,
    )
  }
  if (tab === 'by-me') {
    return BY_ME_ITEMS
  }
  return getPendingItems(status, role)
}

interface SharedContextMenuProps {
  open: boolean
  x: number
  y: number
  tab: SharedMenuTab
  inviteId: string
  status?: 'invited' | 'claimed'
  role?: 'sender' | 'recipient'
  canReshare?: boolean
  onClose: () => void
  onAction: (actionId: string, inviteId: string) => void
}

export function SharedContextMenu({
  open,
  x,
  y,
  tab,
  inviteId,
  status,
  role,
  canReshare,
  onClose,
  onAction,
}: SharedContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Position adjustments so the menu doesn't overflow viewport
  useEffect(() => {
    if (!open || !menuRef.current) return
    const menu = menuRef.current
    const rect = menu.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    if (rect.right > vw) {
      menu.style.left = `${x - rect.width}px`
    }
    if (rect.bottom > vh) {
      menu.style.top = `${y - rect.height}px`
    }
  }, [open, x, y])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleScroll = () => onClose()
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [open, onClose])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const items = getMenuItems(tab, canReshare, status, role)

  return (
    <div
      ref={menuRef}
      className="fixed z-[60] min-w-[220px] bg-paper border border-line-2 rounded-lg shadow-3 overflow-hidden py-1"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <div key={item.id}>
          <button
            type="button"
            disabled={item.disabled}
            className={`w-full text-left flex items-center gap-2.5 px-3 py-[7px] text-[13px] transition-colors ${
              item.disabled
                ? 'text-ink-4 cursor-default'
                : item.danger
                  ? 'text-red hover:bg-red/5'
                  : 'text-ink hover:bg-paper-2'
            }`}
            onClick={() => {
              if (item.disabled) return
              onAction(item.id, inviteId)
              onClose()
            }}
          >
            <Icon
              name={item.icon}
              size={13}
              className={
                item.disabled
                  ? 'text-ink-4'
                  : item.danger
                    ? 'text-red'
                    : 'text-ink-3'
              }
            />
            <span className="flex-1">{item.label}</span>
          </button>
          {item.dividerAfter && (
            <div className="mx-2 my-1 h-px bg-line" />
          )}
        </div>
      ))}
    </div>
  )
}
