import { useEffect, useRef } from 'react'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'

interface ContextMenuItem {
  id: string
  label: string
  icon: IconName
  shortcut?: string
  danger?: boolean
  dividerAfter?: boolean
}

const MENU_ITEMS: ContextMenuItem[] = [
  { id: 'open', label: 'Open', icon: 'file', shortcut: 'Enter' },
  { id: 'share', label: 'Share', icon: 'share', shortcut: 'S' },
  { id: 'manage-shares', label: 'Manage shares', icon: 'link' },
  { id: 'move', label: 'Move to...', icon: 'folder', shortcut: 'M', dividerAfter: true },
  { id: 'star', label: 'Star', icon: 'star', shortcut: 'F' },
  { id: 'rename', label: 'Rename', icon: 'file', shortcut: 'F2' },
  { id: 'download', label: 'Download', icon: 'download', shortcut: 'D', dividerAfter: true },
  { id: 'versions', label: 'See versions', icon: 'clock', shortcut: 'H' },
  { id: 'trash', label: 'Move to trash', icon: 'trash', danger: true, shortcut: 'Del' },
]

interface ContextMenuProps {
  open: boolean
  x: number
  y: number
  fileId: string
  fileName: string
  isFolder: boolean
  /** Whether this file is currently starred — controls Star vs Unstar label */
  isStarred?: boolean
  isPinned?: boolean
  /** Show "Version history" — only true for non-folder files with version_number > 1 */
  hasVersions?: boolean
  onClose: () => void
  onAction: (action: string, fileId: string) => void
}

export function ContextMenu({
  open,
  x,
  y,
  fileId,
  fileName,
  isFolder,
  isStarred,
  isPinned,
  hasVersions,
  onClose,
  onAction,
}: ContextMenuProps) {
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

  // Keyboard navigation: Arrow keys move focus between menuitems,
  // Escape closes, Home/End jump to first/last item.
  useEffect(() => {
    if (!open || !menuRef.current) return

    // Auto-focus the first menuitem when the menu opens
    const firstItem = menuRef.current.querySelector<HTMLElement>('[role="menuitem"]')
    firstItem?.focus()

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }

      const items = Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
      )
      if (items.length === 0) return

      const focused = document.activeElement as HTMLElement
      const currentIdx = items.indexOf(focused)

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        const next = currentIdx < items.length - 1 ? currentIdx + 1 : 0
        items[next]?.focus()
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        const prev = currentIdx > 0 ? currentIdx - 1 : items.length - 1
        items[prev]?.focus()
      } else if (e.key === 'Home') {
        e.preventDefault()
        items[0]?.focus()
      } else if (e.key === 'End') {
        e.preventDefault()
        items[items.length - 1]?.focus()
      } else if (e.key === 'Tab') {
        // Keep focus inside the menu — Tab should not escape
        e.preventDefault()
        const next = currentIdx < items.length - 1 ? currentIdx + 1 : 0
        items[next]?.focus()
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  const visibleItems = MENU_ITEMS
    .filter((item) => item.id !== 'versions' || hasVersions)
    .map((item) => {
      // Dynamic star/unstar label based on current starred state
      if (item.id === 'star') {
        return isStarred
          ? { ...item, id: 'unstar', label: 'Unstar' }
          : item
      }
      return item
    })

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={`Actions for ${fileName}`}
      aria-orientation="vertical"
      className="fixed z-[60] min-w-[220px] bg-paper border border-line-2 rounded-lg shadow-3 overflow-hidden py-1 ctx-menu-enter"
      style={{ left: x, top: y, transformOrigin: '0 0' }}
    >
      {visibleItems.map((item) => (
        <div key={item.id}>
          <button
            type="button"
            role="menuitem"
            className={`w-full text-left flex items-center gap-2.5 px-3 py-[7px] text-[13px] transition-colors focus-visible:outline-none focus-visible:bg-paper-2 ${
              item.danger
                ? 'text-red hover:bg-red/5 focus-visible:bg-red/5'
                : 'text-ink hover:bg-paper-2'
            }`}
            onClick={() => {
              onAction(item.id, fileId)
              onClose()
            }}
          >
            <Icon
              name={item.icon}
              size={13}
              className={item.danger ? 'text-red' : 'text-ink-3'}
            />
            <span className="flex-1">{item.label}</span>
            {item.shortcut && (
              <kbd className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-ink-4 bg-paper-2 border border-line rounded">
                {item.shortcut}
              </kbd>
            )}
          </button>
          {item.dividerAfter && (
            <div className="mx-2 my-1 h-px bg-line" role="separator" />
          )}
        </div>
      ))}
      {isFolder && (
        <div>
          <div className="mx-2 my-1 h-px bg-line" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="w-full text-left flex items-center gap-2.5 px-3 py-[7px] text-[13px] text-ink hover:bg-paper-2 focus-visible:outline-none focus-visible:bg-paper-2 transition-colors"
            onClick={() => {
              onAction(isPinned ? 'unpin' : 'pin', fileId)
              onClose()
            }}
          >
            <Icon name="star" size={13} className="text-ink-3" />
            <span className="flex-1">{isPinned ? 'Unpin from Quick access' : 'Pin to Quick access'}</span>
          </button>
        </div>
      )}
    </div>
  )
}
