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
import { getPreference, setPreference, getFile } from '../lib/api'
import { decryptFilename, fromBase64 } from '../lib/crypto'

interface PinnedFolder {
  id: string
  name: string
}

function SortablePinnedFolder({ folder, isActive, onUnpin }: {
  folder: PinnedFolder
  isActive: boolean
  onUnpin: (id: string) => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: folder.id })
  const style = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="group relative">
      <Link
        to={`/?folder=${folder.id}`}
        {...listeners}
        className={`w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] transition-colors ${
          isActive ? 'bg-paper-3 font-semibold text-ink' : 'text-ink-2 hover:bg-paper-3/50'
        }`}
      >
        <Icon name="folder" size={13} className="shrink-0 text-amber-deep" />
        <span className="flex-1 truncate">{folder.name}</span>
      </Link>
      <button
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onUnpin(folder.id) }}
        className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity text-ink-3 hover:text-ink z-10"
        title="Unpin"
      >
        <Icon name="x" size={10} />
      </button>
    </div>
  )
}

export function QuickAccess() {
  const [pinnedIds, setPinnedIds] = useState<string[]>([])
  const [folders, setFolders] = useState<PinnedFolder[]>([])
  const { getFileKey, isUnlocked } = useKeys()
  const location = useLocation()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  useEffect(() => {
    getPreference<{ folder_ids: string[] }>('pinned_folders')
      .then(pref => setPinnedIds(pref?.folder_ids ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    function onPinEvent() {
      getPreference<{ folder_ids: string[] }>('pinned_folders')
        .then(pref => setPinnedIds(pref?.folder_ids ?? []))
        .catch(() => {})
    }
    window.addEventListener('beebeeb:pins-changed', onPinEvent)
    return () => window.removeEventListener('beebeeb:pins-changed', onPinEvent)
  }, [])

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
          const parsed = JSON.parse(file.name_encrypted) as { nonce: string; ciphertext: string }
          const fileKey = await getFileKey(id)
          const name = await decryptFilename(fileKey, fromBase64(parsed.nonce), fromBase64(parsed.ciphertext))
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
        <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3 mb-1">
          Quick access
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
              />
            ))}
          </SortableContext>
        </DndContext>
      </nav>
    </>
  )
}
