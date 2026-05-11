import { useState, useEffect, useCallback } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from './icons'
import { useKeys } from '../lib/key-context'
import { setPreference, getFile } from '../lib/api'
import { decryptFileMetadata } from '../lib/crypto'
import { getFolderColorDot } from '../lib/folder-colors'
import { useDriveData } from '../lib/drive-data-context'

interface PinnedFolder {
  id: string
  name: string
}

function SortablePinnedFolder({ folder, isActive, onUnpin, colorDot }: {
  folder: PinnedFolder
  isActive: boolean
  onUnpin: (id: string) => void
  colorDot?: string | null
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: folder.id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  const [dragOver, setDragOver] = useState(false)

  // Native HTML5 drop target — accepts file ids dragged from the main file
  // list. Sortable reordering uses pointer events (dnd-kit), so the two
  // event streams don't collide.
  function handleDragOver(e: React.DragEvent) {
    if (!e.dataTransfer.types.includes('text/plain')) return
    // Don't accept the folder itself (pinning self into self).
    if (e.dataTransfer.types.includes('application/beebeeb-folder')) {
      try {
        // We can't read getData on dragover, so trust the move on drop.
      } catch { /* ignore */ }
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOver(true)
  }

  function handleDragLeave(e: React.DragEvent) {
    const related = e.relatedTarget as Node | null
    if (related && (e.currentTarget as HTMLElement).contains(related)) return
    setDragOver(false)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    let fileIds: string[]
    try {
      fileIds = JSON.parse(e.dataTransfer.getData('text/plain')) as string[]
    } catch { return }
    fileIds = fileIds.filter((id) => id !== folder.id)
    if (fileIds.length === 0) return
    window.dispatchEvent(
      new CustomEvent('beebeeb:drop-into-folder', {
        detail: { folderId: folder.id, fileIds, folderName: folder.name },
      }),
    )
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={`group relative rounded-md transition-shadow ${
        dragOver ? 'ring-2 ring-amber ring-inset bg-amber-bg/50' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <Link
        to={`/?folder=${folder.id}`}
        {...listeners}
        className={`w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] transition-colors ${
          isActive ? 'bg-paper-3 font-semibold text-ink' : 'text-ink-2 hover:bg-paper-3/50'
        }`}
      >
        <Icon name="folder" size={13} className="shrink-0 text-amber-deep" />
        {colorDot && (
          <span
            aria-hidden="true"
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: colorDot,
              flexShrink: 0,
            }}
          />
        )}
        <span className="flex-1 truncate">{folder.name}</span>
      </Link>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUnpin(folder.id) }}
        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-amber-deep hover:text-ink z-10"
        title="Unpin from Quick access"
      >
        <Icon name="pin" size={10} />
      </button>
    </div>
  )
}

export function QuickAccess() {
  const { pinnedFolderIds: contextPinnedIds } = useDriveData()
  // Local copy for optimistic drag-to-reorder; synced from context on change.
  const [pinnedIds, setPinnedIds] = useState<string[]>(() => contextPinnedIds.slice(0, 10))
  const [folders, setFolders] = useState<PinnedFolder[]>([])
  const [folderColorDots, setFolderColorDots] = useState<Record<string, string | null>>({})
  const { getFileKey, isUnlocked } = useKeys()
  const location = useLocation()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Sync local list from context whenever the server-side list changes.
  useEffect(() => {
    setPinnedIds(contextPinnedIds.slice(0, 10))
  }, [contextPinnedIds])

  useEffect(() => {
    if (!isUnlocked || pinnedIds.length === 0) {
      setFolders([])
      return
    }
    let cancelled = false
    async function loadNames() {
      const results: PinnedFolder[] = []
      for (const id of pinnedIds) {
        try {
          const file = await getFile(id)
          const fileKey = await getFileKey(id)
          const { name } = await decryptFileMetadata(fileKey, file.name_encrypted)
          results.push({ id, name })
        } catch {
          results.push({ id, name: 'Folder' })
        }
      }
      if (!cancelled) setFolders(results)
    }
    loadNames()
    return () => { cancelled = true }
  }, [pinnedIds, isUnlocked, getFileKey])

  // Load color dots whenever the folder list changes
  useEffect(() => {
    const dots: Record<string, string | null> = {}
    for (const folder of folders) {
      dots[folder.id] = getFolderColorDot(folder.id)
    }
    setFolderColorDots(dots)
  }, [folders])

  // Listen for color changes dispatched by file-list
  useEffect(() => {
    function onColorChanged(e: Event) {
      const { folderId } = (e as CustomEvent<{ folderId: string }>).detail
      setFolderColorDots((prev) => ({ ...prev, [folderId]: getFolderColorDot(folderId) }))
    }
    window.addEventListener('beebeeb:folder-color-changed', onColorChanged)
    return () => window.removeEventListener('beebeeb:folder-color-changed', onColorChanged)
  }, [])

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = pinnedIds.indexOf(active.id as string)
    const newIndex = pinnedIds.indexOf(over.id as string)
    const newOrder = arrayMove(pinnedIds, oldIndex, newIndex)
    setPinnedIds(newOrder)
    setPreference('pinned_folders', { folder_ids: newOrder }).catch(() => {})
  }, [pinnedIds])

  const handleUnpin = useCallback((folderId: string) => {
    const newIds = pinnedIds.filter(id => id !== folderId)
    setPinnedIds(newIds)
    setPreference('pinned_folders', { folder_ids: newIds }).catch(() => {})
    window.dispatchEvent(new Event('beebeeb:pins-changed'))
  }, [pinnedIds])

  if (folders.length === 0) return null

  const currentFolder = new URLSearchParams(location.search).get('folder')

  return (
    <>
      <div className="mx-4 my-2.5 h-px bg-line" />
      <div className="px-4 py-1">
        <div className="flex items-center gap-1.5 mb-1">
          <Icon name="pin" size={10} className="text-amber-deep shrink-0" />
          <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3">
            Quick access
          </div>
        </div>
      </div>
      <nav className="px-3 pb-1.5">
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={pinnedIds} strategy={verticalListSortingStrategy}>
            {folders.map(folder => (
              <SortablePinnedFolder
                key={folder.id}
                folder={folder}
                isActive={currentFolder === folder.id}
                onUnpin={handleUnpin}
                colorDot={folderColorDots[folder.id]}
              />
            ))}
          </SortableContext>
        </DndContext>
      </nav>
    </>
  )
}
