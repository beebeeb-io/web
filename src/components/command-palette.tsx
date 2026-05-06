import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import { modLabel } from '../hooks/use-keyboard-shortcuts'
import { fetchIndex, searchIndex as doSearch, type SearchIndex, type SearchResult } from '../lib/search-index'

interface PaletteItem {
  id: string
  icon: IconName
  label: string
  description?: string
  shortcut?: string
  group: 'recent' | 'files' | 'actions' | 'navigation'
  action: () => void
}

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

/* ------------------------------------------------------------------ */
/*  Fuzzy match                                                        */
/* ------------------------------------------------------------------ */

function fuzzyMatch(query: string, text: string): boolean {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [index, setIndex] = useState<SearchIndex | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { logout } = useAuth()
  const { getMasterKey, isUnlocked } = useKeys()

  useEffect(() => {
    if (!open || !isUnlocked || index) return
    let cancelled = false
    async function load() {
      try {
        const mk = await getMasterKey()
        const idx = await fetchIndex(mk)
        if (!cancelled && idx) setIndex(idx)
      } catch { /* index not available yet */ }
    }
    load()
    return () => { cancelled = true }
  }, [open, isUnlocked, getMasterKey, index])

  const items = useMemo<PaletteItem[]>(() => {
    const all: PaletteItem[] = []

    all.push(
      { id: 'upload', icon: 'upload', label: 'Upload files...', shortcut: `${modLabel} U`, group: 'actions', action: () => { onClose() } },
      { id: 'new-folder', icon: 'folder', label: 'New folder', shortcut: `${modLabel} N`, group: 'actions', action: () => { onClose() } },
      { id: 'search', icon: 'search', label: 'Search files', shortcut: `${modLabel} F`, group: 'actions', action: () => { navigate('/search'); onClose() } },
    )

    all.push(
      { id: 'nav-settings', icon: 'settings', label: 'Go to settings', description: 'Profile, devices, notifications', group: 'navigation', action: () => { navigate('/settings'); onClose() } },
      { id: 'nav-security', icon: 'shield', label: 'Go to security', description: 'Encryption, sessions, keys', group: 'navigation', action: () => { navigate('/security'); onClose() } },
      { id: 'nav-billing', icon: 'cloud', label: 'Go to billing', description: 'Plan, usage, invoices', group: 'navigation', action: () => { navigate('/billing'); onClose() } },
      { id: 'nav-trash', icon: 'trash', label: 'Go to trash', description: 'Deleted files', group: 'navigation', action: () => { navigate('/trash'); onClose() } },
      { id: 'sign-out', icon: 'lock', label: 'Sign out', description: 'Lock vault and sign out', group: 'actions', action: () => { logout(); onClose() } },
    )

    if (query.trim() && index) {
      const results: SearchResult[] = doSearch(index, query).slice(0, 10)
      for (const r of results) {
        const isFolder = r.entry.type === 'folder'
        all.unshift({
          id: `file-${r.id}`,
          icon: isFolder ? 'folder' : 'file',
          label: r.entry.name,
          description: r.entry.path || undefined,
          group: 'files',
          action: () => {
            if (isFolder) {
              navigate(`/?folder=${r.id}`)
            } else {
              navigate(`/?folder=${r.entry.parent || ''}&highlight=${r.id}`)
            }
            onClose()
          },
        })
      }
    }

    if (query.trim()) {
      return all.filter((item) => item.group === 'files' || fuzzyMatch(query, item.label))
    }
    return all
  }, [query, navigate, onClose, logout, index])

  // Group items for rendering
  const groups = useMemo(() => {
    const map = new Map<string, PaletteItem[]>()
    const order: string[] = []
    for (const item of items) {
      const key = item.group === 'files' ? 'Jump to' : item.group === 'actions' ? 'Actions' : item.group === 'navigation' ? 'Navigation' : 'Recent'
      if (!map.has(key)) {
        map.set(key, [])
        order.push(key)
      }
      map.get(key)!.push(item)
    }
    return order.map((label) => ({ label, items: map.get(label)! }))
  }, [items])

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  // Reset active index when items change
  useEffect(() => {
    setActiveIndex(0)
  }, [items.length])

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current) return
    const active = listRef.current.querySelector('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActiveIndex((prev) => (prev + 1) % items.length)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActiveIndex((prev) => (prev - 1 + items.length) % items.length)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        items[activeIndex]?.action()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    },
    [items, activeIndex, onClose],
  )

  if (!open) return null

  let flatIndex = -1

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh]"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/20" />

      {/* Palette */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-[42rem] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-lg py-md border-b border-line">
          <Icon name="search" size={14} className="text-ink-3 shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type to search or run a command..."
            className="flex-1 bg-transparent text-lg text-ink outline-none placeholder:text-ink-4"
          />
          <kbd className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-ink-3 bg-paper-2 border border-line rounded">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[380px] overflow-auto py-1.5">
          {items.length === 0 && (
            <div className="px-lg py-xl text-center text-sm text-ink-3">
              No results for "{query}"
            </div>
          )}
          {groups.map((group) => (
            <div key={group.label}>
              <div className="px-lg pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ink-3">
                {group.label}
              </div>
              {group.items.map((item) => {
                flatIndex++
                const isActive = flatIndex === activeIndex
                const idx = flatIndex
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-active={isActive}
                    className={`w-full text-left flex items-center gap-3 px-lg py-[9px] transition-colors ${
                      isActive
                        ? 'bg-amber-bg border-l-2 border-amber-deep'
                        : 'border-l-2 border-transparent hover:bg-paper-2'
                    }`}
                    onClick={() => item.action()}
                    onMouseEnter={() => setActiveIndex(idx)}
                  >
                    <Icon
                      name={item.icon}
                      size={13}
                      className={isActive ? 'text-amber-deep' : 'text-ink-2'}
                    />
                    <span className={`text-[13px] ${isActive ? 'text-amber-deep font-medium' : 'text-ink'}`}>
                      {item.label}
                    </span>
                    {item.description && (
                      <span className="text-[11px] text-ink-3">
                        · {item.description}
                      </span>
                    )}
                    {item.shortcut && (
                      <kbd className="ml-auto inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-ink-3 bg-paper-2 border border-line rounded shrink-0">
                        {item.shortcut}
                      </kbd>
                    )}
                    {isActive && !item.shortcut && (
                      <span className="ml-auto inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono text-paper bg-ink rounded shrink-0">
                        ↵
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-4 px-lg py-2.5 border-t border-line bg-paper-2 text-[11px] text-ink-3">
          <span>
            <kbd className="inline-flex items-center px-1 py-px text-[10px] font-mono bg-paper border border-line rounded">
              ↑↓
            </kbd>{' '}
            navigate
          </span>
          <span>
            <kbd className="inline-flex items-center px-1 py-px text-[10px] font-mono bg-paper border border-line rounded">
              ↵
            </kbd>{' '}
            open
          </span>
          <span className="ml-auto">
            Search runs locally · encrypted filename index
          </span>
        </div>
      </div>
    </div>
  )
}
