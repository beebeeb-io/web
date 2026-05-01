import { useEffect, useRef } from 'react'
import { Icon } from './icons'
import type { IconName } from './icons'

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
  { id: 'preview', label: 'Preview', icon: 'eye', shortcut: 'Space', dividerAfter: true },
  { id: 'share', label: 'Share', icon: 'share', shortcut: 'S' },
  { id: 'copy-link', label: 'Copy share link', icon: 'link' },
  { id: 'move', label: 'Move to...', icon: 'folder', shortcut: 'M' },
  { id: 'copy', label: 'Copy to...', icon: 'copy', shortcut: 'C', dividerAfter: true },
  { id: 'star', label: 'Star', icon: 'star', shortcut: 'F' },
  { id: 'rename', label: 'Rename', icon: 'file', shortcut: 'F2' },
  { id: 'download', label: 'Download', icon: 'download', shortcut: 'D', dividerAfter: true },
  { id: 'versions', label: 'Version history', icon: 'clock', shortcut: 'H' },
  { id: 'trash', label: 'Move to trash', icon: 'trash', danger: true, shortcut: 'Del' },
]

interface ContextMenuProps {
  open: boolean
  x: number
  y: number
  fileId: string
  fileName: string
  isFolder: boolean
  onClose: () => void
  onAction: (action: string, fileId: string) => void
}

export function ContextMenu({
  open,
  x,
  y,
  fileId,
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

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="File actions"
      className="fixed z-[60] min-w-[220px] bg-paper border border-line-2 rounded-lg shadow-3 overflow-hidden py-1"
      style={{ left: x, top: y }}
    >
      {MENU_ITEMS.map((item) => (
        <div key={item.id}>
          <button
            type="button"
            role="menuitem"
            className={`w-full text-left flex items-center gap-2.5 px-3 py-[7px] text-[13px] transition-colors ${
              item.danger
                ? 'text-red hover:bg-red/5'
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
            <div className="mx-2 my-1 h-px bg-line" />
          )}
        </div>
      ))}
    </div>
  )
}
