import { useEffect, useCallback } from 'react'

/** Detect macOS for modifier key display */
export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)

/** The platform-appropriate modifier key */
export const modKey = isMac ? 'metaKey' : 'ctrlKey'

/** Display label for the platform modifier */
export const modLabel = isMac ? '⌘' : 'Ctrl'

interface ShortcutActions {
  onCommandPalette?: () => void
  onUpload?: () => void
  onNewFolder?: () => void
  onSearch?: () => void
  onShortcuts?: () => void
  onSelectAll?: () => void
  onTrashSelected?: () => void
  onDownloadSelected?: () => void
  onStarSelected?: () => void
  onEscape?: () => void
}

/**
 * Global keyboard shortcut handler.
 * Skips shortcuts when the active element is an input, textarea, or contenteditable.
 */
export function useKeyboardShortcuts(actions: ShortcutActions) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isInput =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable

      // Escape always works (closes modals)
      if (e.key === 'Escape') {
        actions.onEscape?.()
        return
      }

      // Skip remaining shortcuts while typing in inputs
      if (isInput) return

      const mod = e[modKey]

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        actions.onCommandPalette?.()
        return
      }
      if (mod && e.key.toLowerCase() === 'u') {
        e.preventDefault()
        actions.onUpload?.()
        return
      }
      if (mod && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        actions.onNewFolder?.()
        return
      }
      if (mod && e.key.toLowerCase() === 'a') {
        if (actions.onSelectAll) {
          e.preventDefault()
          actions.onSelectAll()
          return
        }
      }
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        actions.onSearch?.()
        return
      }
      if (e.key === '/' || (mod && e.key === '/')) {
        e.preventDefault()
        actions.onShortcuts?.()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        actions.onTrashSelected?.()
        return
      }
      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        actions.onDownloadSelected?.()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        actions.onStarSelected?.()
        return
      }
    },
    [actions],
  )

  useEffect(() => {
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handler])
}
