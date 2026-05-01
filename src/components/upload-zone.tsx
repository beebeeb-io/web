import { useState, useRef, useCallback, useEffect, type ReactNode } from 'react'
import { Icon } from './icons'

// ─── Folder traversal helpers ─────────────────────

/** A file with its relative path within the dropped/selected folder. */
export interface FolderFile {
  file: File
  /** Relative path from the root folder, e.g. "photos/2024/img.jpg" */
  relativePath: string
}

/** Recursively read all files from a FileSystemDirectoryEntry. */
function readDirectoryEntry(entry: FileSystemDirectoryEntry): Promise<FolderFile[]> {
  return new Promise((resolve) => {
    const reader = entry.createReader()
    const allEntries: FileSystemEntry[] = []

    // readEntries may return partial results — keep reading until empty
    function readBatch() {
      reader.readEntries((entries) => {
        if (entries.length === 0) {
          // All entries collected, now recurse
          processEntries(allEntries).then(resolve)
        } else {
          allEntries.push(...entries)
          readBatch()
        }
      })
    }

    readBatch()
  })
}

async function processEntries(entries: FileSystemEntry[]): Promise<FolderFile[]> {
  const results: FolderFile[] = []
  for (const entry of entries) {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry
      const file = await new Promise<File>((resolve) => fileEntry.file(resolve))
      results.push({ file, relativePath: entry.fullPath.replace(/^\//, '') })
    } else if (entry.isDirectory) {
      const children = await readDirectoryEntry(entry as FileSystemDirectoryEntry)
      results.push(...children)
    }
  }
  return results
}

/** Traverse DataTransferItems to detect folders and extract all files with paths. */
export async function extractDroppedItems(
  dataTransfer: DataTransfer,
): Promise<{ files: File[]; folderFiles: FolderFile[] } | null> {
  const items = Array.from(dataTransfer.items)
  const entries = items
    .map((item) => item.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => e != null)

  // Check if any dropped item is a directory
  const hasDirectory = entries.some((e) => e.isDirectory)

  if (!hasDirectory) {
    // Plain file drop — no folder structure
    return null
  }

  // At least one folder was dropped — traverse everything
  const folderFiles: FolderFile[] = []
  for (const entry of entries) {
    if (entry.isDirectory) {
      const children = await readDirectoryEntry(entry as FileSystemDirectoryEntry)
      // Prefix with the root folder name
      folderFiles.push(
        ...children.map((f) => ({
          ...f,
          relativePath: f.relativePath,
        })),
      )
    } else if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry
      const file = await new Promise<File>((resolve) => fileEntry.file(resolve))
      folderFiles.push({ file, relativePath: file.name })
    }
  }

  return { files: [], folderFiles }
}

// ─── UploadZone ───────────────────────────────────

interface UploadZoneProps {
  onFiles: (files: File[]) => void
  onFolderFiles?: (folderFiles: FolderFile[]) => void
  children: ReactNode
}

export function UploadZone({ onFiles, onFolderFiles, children }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false)
  // Separate state to allow CSS exit transitions before unmounting
  const [visible, setVisible] = useState(false)
  const dragCounter = useRef(0)

  // Sync dragging → visible with a small delay on exit for the fade-out
  useEffect(() => {
    if (dragging) {
      setVisible(true)
    } else {
      const id = setTimeout(() => setVisible(false), 220)
      return () => clearTimeout(id)
    }
  }, [dragging])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current++
    if (e.dataTransfer.types.includes('Files')) {
      setDragging(true)
    }
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounter.current--
    if (dragCounter.current === 0) {
      setDragging(false)
    }
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setDragging(false)

      // Try folder-aware extraction first
      if (onFolderFiles) {
        const result = await extractDroppedItems(e.dataTransfer)
        if (result && result.folderFiles.length > 0) {
          onFolderFiles(result.folderFiles)
          return
        }
      }

      // Plain file drop fallback
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) onFiles(files)
    },
    [onFiles, onFolderFiles],
  )

  return (
    <div
      className="relative flex-1 min-h-0"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {children}

      {/* Drag overlay — always mounted while visible, uses opacity for smooth transitions */}
      {visible && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center backdrop-blur-sm transition-all duration-200 ease-out"
          style={{
            opacity: dragging ? 1 : 0,
            background: 'color-mix(in oklch, var(--color-paper) 92%, transparent)',
          }}
        >
          {/* Animated dashed border inset */}
          <div
            className="absolute inset-3 rounded-xl pointer-events-none"
            style={{
              border: '2px dashed var(--color-amber)',
              opacity: dragging ? 0.6 : 0,
              transition: 'opacity 0.3s ease',
              animation: dragging ? 'upload-border-pulse 2s ease-in-out infinite' : 'none',
            }}
          />

          {/* Honeycomb pattern overlay with drift animation */}
          <div
            className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none"
            style={{
              opacity: dragging ? 0.07 : 0,
              transition: 'opacity 0.4s ease',
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                backgroundImage: `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='%23f5b800' fill-opacity='1'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
                animation: dragging ? 'upload-honeycomb-drift 12s linear infinite' : 'none',
              }}
            />
          </div>

          {/* Center content with staggered entrance */}
          <div
            className="relative text-center transition-all duration-300 ease-out"
            style={{
              opacity: dragging ? 1 : 0,
              transform: dragging ? 'translateY(0) scale(1)' : 'translateY(8px) scale(0.96)',
            }}
          >
            {/* Upload icon with glow */}
            <div
              className="w-12 h-12 mx-auto mb-3 rounded-xl flex items-center justify-center transition-transform duration-300 ease-out"
              style={{
                background: 'var(--color-amber)',
                boxShadow: '0 6px 20px -4px oklch(0.82 0.17 84 / 0.45), inset 0 1px 0 rgba(255,255,255,0.35)',
                transform: dragging ? 'scale(1)' : 'scale(0.8)',
                animation: dragging ? 'upload-icon-bob 2.4s ease-in-out infinite' : 'none',
              }}
            >
              <Icon name="shield" size={20} className="text-ink" />
            </div>

            <div
              className="text-[15px] font-semibold mb-1 transition-all duration-300 delay-75"
              style={{
                opacity: dragging ? 1 : 0,
                transform: dragging ? 'translateY(0)' : 'translateY(4px)',
              }}
            >
              Drop to encrypt &amp; upload
            </div>

            <div
              className="font-mono text-[10.5px] text-ink-3 transition-all duration-300 delay-100"
              style={{
                opacity: dragging ? 1 : 0,
                transform: dragging ? 'translateY(0)' : 'translateY(4px)',
              }}
            >
              AES-256-GCM · chunked client-side · EU-only transit
            </div>

            {/* Lock indicator */}
            <div
              className="flex items-center justify-center gap-1 mt-2 transition-all duration-300 delay-150"
              style={{
                opacity: dragging ? 0.5 : 0,
                transform: dragging ? 'translateY(0)' : 'translateY(4px)',
              }}
            >
              <Icon name="lock" size={10} className="text-ink-4" />
              <span className="font-mono text-[9px] text-ink-4 tracking-wider uppercase">
                Zero-knowledge encryption
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Separate browse button for toolbar use
export function useBrowseFiles(onFiles: (files: File[]) => void) {
  const inputRef = useRef<HTMLInputElement>(null)

  const browse = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      if (files.length > 0) onFiles(files)
      e.target.value = ''
    },
    [onFiles],
  )

  const HiddenInput = useCallback(
    () => (
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleChange}
      />
    ),
    [handleChange],
  )

  return { browse, HiddenInput }
}

// Browse folders via hidden input with webkitdirectory
export function useBrowseFolders(onFolderFiles: (files: FolderFile[]) => void) {
  const inputRef = useRef<HTMLInputElement>(null)

  const browseFolder = useCallback(() => {
    inputRef.current?.click()
  }, [])

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const fileList = Array.from(e.target.files ?? [])
      if (fileList.length === 0) return

      const folderFiles: FolderFile[] = fileList.map((f) => ({
        file: f,
        // webkitRelativePath gives "rootFolder/subfolder/file.txt"
        relativePath: f.webkitRelativePath || f.name,
      }))

      onFolderFiles(folderFiles)
      e.target.value = ''
    },
    [onFolderFiles],
  )

  const HiddenFolderInput = useCallback(
    () => (
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={handleChange}
        {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
      />
    ),
    [handleChange],
  )

  return { browseFolder, HiddenFolderInput }
}
