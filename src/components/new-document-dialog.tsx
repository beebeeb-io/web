/**
 * Name prompt for "+ New" → a document/text type (task 1582).
 *
 * Pre-filled with a name that is unique in the current folder, with the
 * part before the extension selected so typing replaces it. The extension is
 * appended when the user leaves it off (see checkNewDocumentName).
 *
 * `onCreate` MUST be called synchronously from the submit event: for Office
 * types the caller opens the editor tab inside that same user gesture, before
 * any await, or the browser's popup blocker eats it.
 */

import { useEffect, useRef, useState } from 'react'
import { BBButton, Icon } from '@beebeeb/shared'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { checkNewDocumentName, defaultNewDocumentName, type NewDocumentType } from '../lib/new-document'

interface NewDocumentDialogProps {
  type: NewDocumentType | null
  existingNames: string[]
  onClose: () => void
  /** Returns once the file exists (or throws with a user-facing message). */
  onCreate: (type: NewDocumentType, name: string) => Promise<void>
}

export function NewDocumentDialog({ type, existingNames, onClose, onCreate }: NewDocumentDialogProps) {
  const open = type !== null
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const focusTrapRef = useFocusTrap<HTMLFormElement>(open)

  useEffect(() => {
    if (!type) return
    const initial = defaultNewDocumentName(type, existingNames)
    setName(initial)
    setError(null)
    setBusy(false)
    const t = setTimeout(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      const dot = initial.lastIndexOf('.')
      el.setSelectionRange(0, dot > 0 ? dot : initial.length)
    }, 50)
    return () => clearTimeout(t)
    // existingNames intentionally read once per open — a listing refresh
    // while the prompt is up must not overwrite what the user is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type])

  if (!type) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    const check = checkNewDocumentName(name, type, existingNames)
    if (!check.ok) {
      setError(check.reason)
      return
    }
    setBusy(true)
    setError(null)
    // Synchronous call — see the header comment.
    onCreate(type, check.name).then(
      () => onClose(),
      (err: unknown) => {
        setBusy(false)
        setError(err instanceof Error ? err.message : 'Could not create the file.')
      },
    )
  }

  const title = type.title
  const errorId = 'new-document-name-error'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={busy ? undefined : onClose}>
      <div className="absolute inset-0 bg-ink/20" />
      <form
        ref={focusTrapRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="new-document-dialog"
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) {
            e.stopPropagation()
            onClose()
          }
        }}
        className="relative w-full max-w-[26rem] mx-4 bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        <div className="px-xl py-lg border-b border-line flex items-center gap-2.5">
          <Icon name={type.icon} size={15} className="text-ink-3" />
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <span className="ml-auto font-mono text-[11px] text-ink-4">.{type.ext}</span>
        </div>

        <div className="px-xl py-lg">
          <label htmlFor="new-document-name" className="block text-xs font-medium text-ink-2 mb-1.5">
            Name
          </label>
          <div
            className={`flex items-center gap-2 border rounded-md bg-paper px-3 py-2 focus-within:ring-2 focus-within:ring-amber/30 focus-within:border-amber-deep ${error ? 'border-red-border' : 'border-line'}`}
          >
            <input
              id="new-document-name"
              ref={inputRef}
              value={name}
              disabled={busy}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              data-testid="new-document-name"
              autoComplete="off"
              spellCheck={false}
              className="flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-4"
            />
          </div>
          {error ? (
            <p id={errorId} role="alert" className="mt-1.5 text-[12px] text-red" data-testid="new-document-error">
              {error}
            </p>
          ) : (
            <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-ink-3">
              <Icon name="lock" size={11} className="text-amber-deep" />
              Encrypted on this device before it is uploaded.
            </p>
          )}
        </div>

        <div className="px-xl py-md border-t border-line flex justify-end gap-2">
          <BBButton type="button" variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </BBButton>
          <BBButton type="submit" variant="amber" size="sm" disabled={busy || !name.trim()} data-testid="new-document-create">
            {busy ? 'Creating…' : type.editor === 'office' ? 'Create and open' : 'Create'}
          </BBButton>
        </div>
      </form>
    </div>
  )
}
