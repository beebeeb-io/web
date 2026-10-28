/**
 * Task 2237b — drag and drop for a folder link.
 *
 * Folders keep their structure: a dropped directory becomes tasks whose
 * `relativePath` mirrors the tree. A plain file drop falls back to
 * `dataTransfer.files`. The overlay only exists while a drag is in progress.
 */
import { useCallback, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { extractDroppedItems } from '../upload-zone'
import type { GuestUploadTask } from '../../lib/guest-upload'

export async function tasksFromDrop(dataTransfer: DataTransfer): Promise<GuestUploadTask[]> {
  const extracted = await extractDroppedItems(dataTransfer)
  if (extracted && extracted.folderFiles.length > 0) {
    return extracted.folderFiles.map((entry) => ({
      file: entry.file,
      relativePath: entry.relativePath,
    }))
  }
  return Array.from(dataTransfer.files ?? []).map((file) => ({ file, relativePath: null }))
}

export function GuestDropZone(props: {
  disabled: boolean
  onTasks: (tasks: GuestUploadTask[]) => void
  children: ReactNode
}) {
  const [dragging, setDragging] = useState(false)
  const depth = useRef(0)

  const onDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (props.disabled) return
      event.preventDefault()
      depth.current += 1
      setDragging(true)
    },
    [props.disabled],
  )

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
  }, [])

  const onDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setDragging(false)
  }, [])

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault()
      depth.current = 0
      setDragging(false)
      if (props.disabled) return
      const dataTransfer = event.dataTransfer
      if (!dataTransfer) return
      void tasksFromDrop(dataTransfer).then((tasks) => {
        if (tasks.length > 0) props.onTasks(tasks)
      })
    },
    [props.disabled, props.onTasks],
  )

  return (
    <div
      className="relative"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {props.children}
      {dragging && !props.disabled ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-lg border-2 border-dashed border-line bg-paper-2/90"
        >
          <p className="text-sm font-medium text-ink-3">Drop files or a folder to add them here.</p>
        </div>
      ) : null}
    </div>
  )
}
