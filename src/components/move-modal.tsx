import { useState, useEffect, useCallback, useRef } from 'react'
import { BBButton } from './bb-button'
import { BBChip } from './bb-chip'
import { Icon } from './icons'
import { listFiles, createFolder } from '../lib/api'
import { useKeys } from '../lib/key-context'
import { decryptFilename, fromBase64 } from '../lib/crypto'

interface MoveModalProps {
  open: boolean
  onClose: () => void
  items: { id: string; name: string; isFolder: boolean }[]
  mode?: 'move' | 'copy'
  onConfirm: (destinationId: string | null, mode: 'move' | 'copy') => void
}

interface FolderNode {
  id: string
  name: string
  children: FolderNode[]
  loaded: boolean
  expanded: boolean
}

export function MoveModal({
  open,
  onClose,
  items,
  mode: initialMode = 'move',
  onConfirm,
}: MoveModalProps) {
  const { getFileKey, isUnlocked } = useKeys()
  const [folders, setFolders] = useState<FolderNode[]>([])
  const [decryptedNames, setDecryptedNames] = useState<Record<string, string>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: 'My files' },
  ])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [creatingFolder, setCreatingFolder] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  /** Get the display name for a folder (decrypted if available, raw otherwise). */
  function displayName(folder: FolderNode): string {
    return decryptedNames[folder.id] ?? folder.name
  }

  // Fetch folders for the current directory
  const fetchFolders = useCallback(async (parentId?: string) => {
    setLoading(true)
    try {
      const files = await listFiles(parentId, false)
      const folderFiles = files.filter((f) => f.is_folder)
      setFolders(
        folderFiles.map((f) => ({
          id: f.id,
          name: f.name_encrypted,
          children: [],
          loaded: false,
          expanded: false,
        })),
      )
    } catch {
      // API not available -- show mock folders
      setFolders([
        { id: 'f1', name: 'sources', children: [], loaded: false, expanded: false },
        { id: 'f2', name: 'drafts', children: [], loaded: false, expanded: false },
        { id: 'f3', name: 'published-2024', children: [], loaded: false, expanded: false },
        { id: 'f4', name: 'fixer-contacts', children: [], loaded: false, expanded: false },
        { id: 'f5', name: 'interviews-sep2025', children: [], loaded: false, expanded: false },
        { id: 'f6', name: '_archive', children: [], loaded: false, expanded: false },
      ])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      const currentParent = breadcrumbs[breadcrumbs.length - 1]?.id ?? undefined
      fetchFolders(currentParent)
      setSelectedId(null)
      setSearch('')
    }
  }, [open, breadcrumbs, fetchFolders])

  // Decrypt folder names when folders or unlock state change
  useEffect(() => {
    if (!isUnlocked || folders.length === 0) return
    let cancelled = false
    async function decryptAll() {
      const names: Record<string, string> = {}
      for (const folder of folders) {
        if (cancelled) return
        try {
          const parsed = JSON.parse(folder.name) as { nonce: string; ciphertext: string }
          const fileKey = await getFileKey(folder.id)
          names[folder.id] = await decryptFilename(
            fileKey,
            fromBase64(parsed.nonce),
            fromBase64(parsed.ciphertext),
          )
        } catch {
          names[folder.id] = folder.name
        }
      }
      if (!cancelled) setDecryptedNames((prev) => ({ ...prev, ...names }))
    }
    decryptAll()
    return () => { cancelled = true }
  }, [folders, isUnlocked, getFileKey])

  // Close on escape
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  const handleBreadcrumbNav = (index: number) => {
    setBreadcrumbs((prev) => prev.slice(0, index + 1))
  }

  const handleFolderOpen = (folder: FolderNode) => {
    setBreadcrumbs((prev) => [...prev, { id: folder.id, name: displayName(folder) }])
    setSelectedId(null)
  }

  const handleNewFolder = async () => {
    const name = search.trim() || 'Untitled folder'
    setCreatingFolder(true)
    try {
      const parentId = breadcrumbs[breadcrumbs.length - 1]?.id ?? undefined
      await createFolder(name, parentId)
      setSearch('')
      fetchFolders(parentId)
    } catch {
      // Mock: add folder locally
      const newFolder: FolderNode = {
        id: `new-${Date.now()}`,
        name,
        children: [],
        loaded: false,
        expanded: false,
      }
      setFolders((prev) => [newFolder, ...prev])
      setSelectedId(newFolder.id)
      setSearch('')
    } finally {
      setCreatingFolder(false)
    }
  }

  const handleConfirm = (actionMode: 'move' | 'copy') => {
    const destinationId = selectedId ?? breadcrumbs[breadcrumbs.length - 1]?.id ?? null
    onConfirm(destinationId, actionMode)
    onClose()
  }

  const filteredFolders = search
    ? folders.filter((f) => displayName(f).toLowerCase().includes(search.toLowerCase()))
    : folders

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/20" />

      {/* Modal */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[520px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        {/* Header */}
        <div className="px-xl py-lg border-b border-line flex items-center gap-2.5">
          <Icon name="folder" size={14} className="text-amber-deep" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-ink">
              {initialMode === 'move' ? 'Move' : 'Copy'} {items.length} item{items.length !== 1 ? 's' : ''}
            </div>
            <div className="text-[11px] text-ink-3">
              Destination will re-encrypt with the folder's key
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-md bg-paper-2 flex items-center justify-center text-ink-3 hover:text-ink transition-colors"
          >
            <Icon name="x" size={13} />
          </button>
        </div>

        {/* Selected items strip */}
        <div className="px-xl py-2.5 bg-paper-2 border-b border-line flex gap-1.5 flex-wrap">
          {items.map((item) => (
            <BBChip key={item.id}>
              <span className="flex items-center gap-1 text-[10.5px]">
                <Icon name={item.isFolder ? 'folder' : 'file'} size={10} />
                {item.name}
              </span>
            </BBChip>
          ))}
        </div>

        {/* Breadcrumb */}
        <div className="px-xl py-2.5 flex items-center gap-1.5 text-xs border-b border-line">
          {breadcrumbs.map((crumb, i) => {
            const isLast = i === breadcrumbs.length - 1
            return (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && (
                  <Icon name="chevron-right" size={11} className="text-ink-4" />
                )}
                {isLast ? (
                  <span className="font-semibold text-ink">{crumb.name}</span>
                ) : (
                  <button
                    onClick={() => handleBreadcrumbNav(i)}
                    className="text-amber-deep font-medium hover:underline cursor-pointer"
                  >
                    {crumb.name}
                  </button>
                )}
              </span>
            )
          })}
        </div>

        {/* Search */}
        <div className="px-lg py-2.5 border-b border-line">
          <div className="flex items-center gap-2 border rounded-md bg-paper px-3 py-2 border-line focus-within:ring-2 focus-within:ring-amber/30 focus-within:border-amber-deep">
            <Icon name="search" size={12} className="text-ink-3 shrink-0" />
            <input
              ref={searchRef}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search or type a new folder name..."
              className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
            />
          </div>
        </div>

        {/* Folder list */}
        <div className="max-h-60 overflow-y-auto">
          {loading ? (
            <div className="px-xl py-6 text-center text-sm text-ink-3">Loading...</div>
          ) : filteredFolders.length === 0 ? (
            <div className="px-xl py-6 text-center text-sm text-ink-3">
              {search ? 'No folders found' : 'Empty folder'}
            </div>
          ) : (
            filteredFolders.map((folder) => {
              const isSelected = selectedId === folder.id
              return (
                <button
                  key={folder.id}
                  type="button"
                  className="w-full text-left flex items-center gap-2.5 px-xl py-2.5 transition-colors cursor-pointer"
                  style={{
                    background: isSelected ? 'var(--color-amber-bg)' : 'transparent',
                    borderLeft: isSelected
                      ? '3px solid var(--color-amber-deep)'
                      : '3px solid transparent',
                  }}
                  onClick={() => setSelectedId(folder.id)}
                  onDoubleClick={() => handleFolderOpen(folder)}
                >
                  <Icon
                    name="folder"
                    size={14}
                    className={isSelected ? 'text-amber-deep' : 'text-ink-3'}
                  />
                  <span
                    className={`flex-1 text-[13px] ${isSelected ? 'font-semibold' : ''}`}
                  >
                    {displayName(folder)}
                  </span>
                  {isSelected && (
                    <Icon name="check" size={13} className="text-amber-deep" />
                  )}
                </button>
              )
            })
          )}
        </div>

        {/* Footer */}
        <div className="px-xl py-md border-t border-line flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleNewFolder}
            disabled={creatingFolder}
            className="flex items-center gap-1.5 text-[11.5px] text-ink-3 hover:text-ink transition-colors cursor-pointer"
          >
            <Icon name="plus" size={11} />
            New folder
          </button>
          <div className="ml-auto flex gap-2">
            <BBButton
              size="sm"
              onClick={() => handleConfirm('copy')}
            >
              Copy here
            </BBButton>
            <BBButton
              size="sm"
              variant="amber"
              onClick={() => handleConfirm('move')}
            >
              Move here
            </BBButton>
          </div>
        </div>
      </div>
    </div>
  )
}
