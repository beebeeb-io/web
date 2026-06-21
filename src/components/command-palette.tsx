import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import { useAuth } from '../lib/auth-context'
import { useKeys } from '../lib/key-context'
import { modLabel } from '../hooks/use-keyboard-shortcuts'
import { fetchIndex, searchIndex as doSearch, type SearchIndex, type SearchResult } from '../lib/search-index'
import { listClientDevices, type ClientDevice } from '../lib/api'

interface PaletteItem {
  id: string
  icon: IconName
  label: string
  description?: string
  shortcut?: string
  group: 'recent' | 'files' | 'actions' | 'navigation' | 'devices'
  /** Extra terms (not shown) that the fuzzy matcher also searches, so e.g.
   *  "invoices" finds Billing and "space" finds the Storage overview. */
  keywords?: string
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
  const [devices, setDevices] = useState<ClientDevice[]>([])
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

  // Drop the cached index when the full-vault backfill (task 0840) persists a
  // fresh one, so a just-indexed deep file is searchable on the next open (and
  // immediately if the palette is already open — the loader re-fetches).
  useEffect(() => {
    function onUpdated() { setIndex(null) }
    window.addEventListener('beebeeb:search-index-updated', onUpdated)
    return () => window.removeEventListener('beebeeb:search-index-updated', onUpdated)
  }, [])

  // Load linked devices once per open so the empty palette can surface them.
  useEffect(() => {
    if (!open || devices.length > 0) return
    let cancelled = false
    listClientDevices()
      .then((res) => { if (!cancelled) setDevices(res.devices) })
      .catch(() => { /* devices are a nice-to-have, never block the palette */ })
    return () => { cancelled = true }
  }, [open, devices.length])

  // Most-recently-changed files/folders, surfaced as "Recent" when the query is
  // empty. Derived from the (full-vault, task 0840) index.
  const recentEntries = useMemo(() => {
    if (!index) return [] as { id: string; name: string; path: string; isFolder: boolean }[]
    return Object.entries(index.files)
      .map(([id, e]) => ({ id, name: e.name, path: e.path, isFolder: e.type === 'folder', modified: e.modified }))
      .sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime())
      .slice(0, 6)
  }, [index])

  const items = useMemo<PaletteItem[]>(() => {
    const go = (path: string) => () => { navigate(path); onClose() }
    const all: PaletteItem[] = []

    // Actions
    all.push(
      { id: 'upload', icon: 'upload', label: 'Upload files...', shortcut: `${modLabel} U`, group: 'actions', keywords: 'add new file import', action: () => { onClose(); window.dispatchEvent(new Event('beebeeb:upload-trigger')) } },
      { id: 'new-folder', icon: 'folder', label: 'New folder', shortcut: `${modLabel} N`, group: 'actions', keywords: 'create directory', action: () => { onClose(); window.dispatchEvent(new Event('beebeeb:new-folder-trigger')) } },
    )

    // Navigation — every app surface, keyword-rich so "invoices", "storage",
    // "space", "subscription" etc. all resolve to the right place (task 0842).
    all.push(
      { id: 'nav-drive', icon: 'folder', label: 'All files', description: 'Your drive', group: 'navigation', keywords: 'drive home vault files root', action: go('/') },
      { id: 'nav-recent', icon: 'clock', label: 'Recent', description: 'Recently changed files', group: 'navigation', keywords: 'latest history new', action: go('/recent') },
      { id: 'nav-photos', icon: 'image', label: 'Photos', description: 'Photo & video backups', group: 'navigation', keywords: 'pictures camera images gallery video', action: go('/photos') },
      { id: 'nav-file-requests', icon: 'link', label: 'File requests', description: 'Collect files from others', group: 'navigation', keywords: 'request inbox receive upload link', action: go('/file-requests') },
      { id: 'nav-trash', icon: 'trash', label: 'Trash', description: 'Deleted files', group: 'navigation', keywords: 'deleted bin remove recover restore', action: go('/trash') },
      { id: 'nav-billing', icon: 'cloud', label: 'Billing', description: 'Plan, payments & invoices', group: 'navigation', keywords: 'invoices receipts payment subscription upgrade plan pricing card', action: go('/billing') },
      { id: 'nav-storage', icon: 'cloud', label: 'Storage overview', description: 'Usage, quota & regions', group: 'navigation', keywords: 'space quota usage capacity data residency region gb', action: go('/settings/storage') },
      { id: 'nav-security', icon: 'shield', label: 'Security', description: 'Encryption, sessions, keys', group: 'navigation', keywords: 'password 2fa passkey recovery sessions encryption', action: go('/security') },
      { id: 'nav-devices', icon: 'key', label: 'Devices', description: 'Linked devices & sessions', group: 'navigation', keywords: 'device desktop mobile windows ios sync sessions linked', action: go('/devices') },
      { id: 'nav-settings', icon: 'settings', label: 'Settings', description: 'Profile, devices, notifications', group: 'navigation', keywords: 'preferences profile account config options', action: go('/settings') },
      { id: 'nav-notifications', icon: 'bell', label: 'Notifications', description: 'Alerts & push settings', group: 'navigation', keywords: 'alerts push email mute', action: go('/settings/notifications') },
      { id: 'nav-language', icon: 'settings', label: 'Language', description: 'App language', group: 'navigation', keywords: 'locale translation i18n', action: go('/settings/language') },
      { id: 'nav-activity', icon: 'activity', label: 'Activity', description: 'Account activity log', group: 'navigation', keywords: 'audit log history events', action: go('/settings/activity') },
      { id: 'nav-referrals', icon: 'users', label: 'Referrals', description: 'Invite & earn storage', group: 'navigation', keywords: 'invite refer friends bonus', action: go('/settings/referrals') },
    )

    all.push(
      { id: 'sign-out', icon: 'lock', label: 'Sign out', description: 'Lock vault and sign out', group: 'actions', keywords: 'logout lock leave exit', action: () => { logout(); onClose() } },
    )

    // Recent files + devices only when the query is empty (a populated palette
    // beats a blank one). When searching, the Jump-to file results lead instead.
    if (!query.trim()) {
      for (const r of recentEntries) {
        all.unshift({
          id: `recent-${r.id}`,
          icon: r.isFolder ? 'folder' : 'file',
          label: r.name,
          description: r.path || undefined,
          group: 'recent',
          action: () => {
            navigate(r.isFolder ? `/?folder=${r.id}` : `/?folder=${''}&highlight=${r.id}`)
            onClose()
          },
        })
      }
      for (const d of devices) {
        all.push({
          id: `device-${d.id}`,
          icon: 'key',
          label: d.hostname,
          description: `${d.platform}${d.session_count ? ` · ${d.session_count} sync${d.session_count !== 1 ? 's' : ''}` : ''}`,
          group: 'devices',
          keywords: `${d.platform} device`,
          action: go('/devices'),
        })
      }
    }

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
      return all.filter(
        (item) =>
          item.group === 'files' ||
          fuzzyMatch(query, item.label) ||
          (item.keywords ? fuzzyMatch(query, item.keywords) : false),
      )
    }
    return all
  }, [query, navigate, onClose, logout, index, recentEntries, devices])

  // Group items for rendering
  const groups = useMemo(() => {
    const map = new Map<string, PaletteItem[]>()
    const order: string[] = []
    for (const item of items) {
      const key =
        item.group === 'files' ? 'Jump to'
        : item.group === 'recent' ? 'Recent'
        : item.group === 'devices' ? 'Devices'
        : item.group === 'actions' ? 'Actions'
        : 'Navigation'
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
