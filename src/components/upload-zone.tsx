import { useState, useRef, useCallback, type ReactNode } from 'react'
import { Icon } from './icons'
import { BBButton } from './bb-button'

interface UploadZoneProps {
  onFiles: (files: File[]) => void
  children: ReactNode
}

export function UploadZone({ onFiles, children }: UploadZoneProps) {
  const [dragging, setDragging] = useState(false)
  const dragCounter = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragCounter.current = 0
      setDragging(false)

      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) onFiles(files)
    },
    [onFiles],
  )

  const handleBrowse = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files ?? [])
      if (files.length > 0) onFiles(files)
      // Reset so the same file can be selected again
      e.target.value = ''
    },
    [onFiles],
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

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleInputChange}
      />

      {/* Drag overlay */}
      {dragging && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-paper/90 backdrop-blur-sm">
          {/* Honeycomb pattern overlay */}
          <div
            className="absolute inset-0 opacity-[0.08]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='%23f5b800' fill-opacity='1'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          />
          <div className="relative text-center">
            <div
              className="w-11 h-11 mx-auto mb-2.5 rounded-xl flex items-center justify-center"
              style={{
                background: 'var(--color-amber)',
                boxShadow: '0 4px 14px -4px oklch(0.82 0.17 84 / 0.5), inset 0 1px 0 rgba(255,255,255,0.4)',
              }}
            >
              <Icon name="arrow-up" size={20} className="text-ink" />
            </div>
            <div className="text-[15px] font-semibold mb-1">Drop files to encrypt</div>
            <div className="font-mono text-[10.5px] text-ink-3">
              AES-256-GCM · chunked client-side · EU-only transit
            </div>
            <BBButton
              size="sm"
              className="mt-3"
              onClick={(e) => {
                e.stopPropagation()
                handleBrowse()
              }}
            >
              or browse...
            </BBButton>
          </div>
        </div>
      )}

      {/* Expose browse trigger for external use */}
      <button ref={(_el) => {
        // Store the browse function as a data attribute for parent access
        // This is a no-op render; parent uses onFiles callback
      }} data-browse="" onClick={handleBrowse} className="hidden" />
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
