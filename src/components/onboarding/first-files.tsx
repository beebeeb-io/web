// Sign-up step 4: the first-files card on a new account's first drive load.
import { useCallback, useRef, useState, type DragEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { BBButton, Icon } from '@beebeeb/shared'
import { AuthShellFrame } from '../auth-shell-frame'
import { useAuth } from '../../lib/auth-context'
import { SIGNUP_STEP_LABELS } from './passkey-offer'

// One flag per account in this browser: set when the account is made, cleared when the card is
// dismissed or after the first upload, so it never comes back.
const key = (userId: string) => `bb_first_files:${userId}`

export function markFirstFilesPending(userId: string): void {
  try {
    localStorage.setItem(key(userId), 'pending')
  } catch {
    /* storage blocked: the card is simply not shown */
  }
}

export function firstFilesPending(userId: string | undefined): boolean {
  if (!userId) return false
  try {
    return localStorage.getItem(key(userId)) === 'pending'
  } catch {
    return false
  }
}

function clearFirstFiles(userId: string): void {
  try {
    localStorage.removeItem(key(userId))
  } catch {
    /* ignore */
  }
}

/** Drop or pick files (the drive's own upload path), or go on to Pass. Renders nothing once done. */
export function FirstFiles({ onFiles }: { onFiles: (files: File[]) => void }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const userId = user?.user_id
  const [closed, setClosed] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const shown = !closed && firstFilesPending(userId)

  const close = useCallback(() => {
    if (userId) clearFirstFiles(userId)
    setClosed(true)
  }, [userId])

  const take = useCallback(
    (list: FileList | File[] | null) => {
      const files = list ? Array.from(list) : []
      if (files.length === 0) return
      onFiles(files)
      close()
    },
    [onFiles, close],
  )

  if (!shown) return null

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" data-testid="first-files" role="dialog" aria-label="Add your first files">
      <AuthShellFrame
        title="Add your first files"
        subtitle="They are encrypted in this browser before they upload."
        step={4}
        totalSteps={4}
        stepLabels={SIGNUP_STEP_LABELS}
        hideTrust
      >
        <div
          onDragOver={(e: DragEvent) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e: DragEvent) => {
            e.preventDefault()
            setOver(false)
            take(e.dataTransfer.files)
          }}
          className={`flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-8 text-center ${
            over ? 'border-amber bg-amber-bg' : 'border-line-2 bg-paper-2'
          }`}
          data-testid="first-files-drop"
        >
          <Icon name="upload" size={18} className="text-ink-2" />
          <div className="text-sm font-medium text-ink">Drop files or folders here</div>
          <div className="text-xs text-ink-3 mb-2">Any size.</div>
          <BBButton variant="default" size="sm" onClick={() => input.current?.click()} data-testid="first-files-choose">
            Choose files
          </BBButton>
          <input ref={input} type="file" multiple hidden data-testid="first-files-input" onChange={(e) => {
            take(e.target.files)
            e.target.value = ''
          }} />
        </div>
        <div className="flex items-center gap-3 mt-4">
          <BBButton
            variant="ghost"
            className="gap-2"
            onClick={() => {
              close()
              navigate('/settings/import')
            }}
            data-testid="first-files-pass"
          >
            <Icon name="key" size={13} />
            Import passwords into Pass
          </BBButton>
          <BBButton variant="amber" className="flex-1" onClick={close} data-testid="first-files-open-drive">
            Open Drive
          </BBButton>
        </div>
      </AuthShellFrame>
    </div>
  )
}
