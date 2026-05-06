import { useState, useRef, useEffect } from 'react'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'

interface RenameDialogProps {
  open: boolean
  onClose: () => void
  currentName: string
  onRename: (newName: string) => void
}

export function RenameDialog({ open, onClose, currentName, onRename }: RenameDialogProps) {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const focusTrapRef = useFocusTrap<HTMLFormElement>(open)

  useEffect(() => {
    if (open) {
      setName(currentName)
      const t = setTimeout(() => {
        if (inputRef.current) {
          inputRef.current.focus()
          // Select everything before the last extension
          const dotIdx = currentName.lastIndexOf('.')
          inputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : currentName.length)
        }
      }, 50)
      return () => clearTimeout(t)
    }
  }, [open, currentName])

  if (!open) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === currentName) return
    onRename(trimmed)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/20" />

      {/* Dialog */}
      <form
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-label="Rename"
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-[24rem] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        <div className="px-xl py-lg border-b border-line flex items-center gap-2">
          <Icon name="file" size={13} className="text-ink-2" />
          <h3 className="text-sm font-semibold text-ink">Rename</h3>
        </div>

        <div className="px-xl py-lg">
          <label className="block text-xs font-medium text-ink-2 mb-1.5">
            New name
          </label>
          <div className="flex items-center gap-2 border rounded-md bg-paper px-3 py-2 border-line focus-within:ring-2 focus-within:ring-amber/30 focus-within:border-amber-deep">
            <input
              ref={inputRef}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter new name"
              className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
            />
          </div>
        </div>

        <div className="px-xl py-md border-t border-line flex justify-end gap-2">
          <BBButton type="button" variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </BBButton>
          <BBButton
            type="submit"
            variant="amber"
            size="sm"
            disabled={!name.trim() || name.trim() === currentName}
          >
            Rename
          </BBButton>
        </div>
      </form>
    </div>
  )
}
