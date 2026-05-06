import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { BBInput } from '@beebeeb/shared'
import { BBCheckbox } from '@beebeeb/shared'
import { ConfirmPasswordModal } from '../components/confirm-password-modal'
import { deleteAccountPermanently, ApiError } from '../lib/api'

const deletionItems: [string, string][] = [
  ['All files and versions', 'Encrypted blobs shredded from all regions'],
  ['All shared links', 'Active links will return 410 Gone'],
  ['Access for team members', 'All workspace memberships revoked'],
  ['Audit logs', 'Retained 12 months per GDPR Art. 17'],
]

export function DeleteAccount() {
  const navigate = useNavigate()
  const [confirmation, setConfirmation] = useState('')
  const [understood, setUnderstood] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pwPromptOpen, setPwPromptOpen] = useState(false)

  const canDelete = confirmation === 'DELETE' && understood && !loading

  const handleDelete = useCallback(() => {
    if (!canDelete) return
    setError(null)
    setPwPromptOpen(true)
  }, [canDelete])

  const performDelete = useCallback(
    async (token: string) => {
      setPwPromptOpen(false)
      setLoading(true)
      setError(null)
      try {
        await deleteAccountPermanently(confirmation, token)
        navigate('/login', { replace: true })
      } catch (e) {
        if (e instanceof ApiError && e.status === 403) {
          setError('Re-authentication expired. Try again.')
        } else {
          setError(e instanceof Error ? e.message : 'Failed to delete account')
        }
        setLoading(false)
      }
    },
    [confirmation, navigate],
  )

  return (
    <div className="min-h-screen flex items-center justify-center bg-paper p-xl">
      <ConfirmPasswordModal
        open={pwPromptOpen}
        title="Confirm account deletion"
        description="Re-enter your password to permanently delete your account. This cannot be undone."
        confirmLabel="Delete account"
        onConfirmed={performDelete}
        onCancel={() => setPwPromptOpen(false)}
      />
      <div className="w-full max-w-[480px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
        {/* Header */}
        <div className="px-xl py-lg border-b border-line">
          <div className="flex items-center gap-2">
            <Icon name="trash" size={14} className="text-red" />
            <h2 className="text-lg font-bold text-ink">Delete your account</h2>
          </div>
          <p className="text-[13px] text-ink-3 mt-1">
            This cannot be undone. Read carefully.
          </p>
        </div>

        {/* Body */}
        <div className="p-xl">
          {/* Warning banner */}
          <div className="px-3.5 py-3 rounded-lg border border-red-border bg-red-bg mb-lg">
            <p className="text-[12.5px] leading-relaxed text-red">
              Within <strong>30 days</strong>, your encrypted blobs are permanently shredded
              from all regions. After that there is nothing to recover -- not for you, not for
              us, not for anyone with a court order.
            </p>
          </div>

          {/* What gets deleted */}
          <div className="mb-lg">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-2">
              What gets deleted
            </div>
            {deletionItems.map(([label, detail], i) => (
              <div
                key={i}
                className={`flex items-center gap-2.5 py-[7px] ${
                  i < deletionItems.length - 1 ? 'border-b border-line' : ''
                }`}
              >
                <Icon name="trash" size={12} className="text-ink-3 shrink-0" />
                <span className="text-[13px] text-ink flex-1">{label}</span>
                <span className="text-[11px] font-mono text-ink-3">{detail}</span>
              </div>
            ))}
          </div>

          {/* Type DELETE */}
          <div className="mb-md">
            <label className="block text-xs font-medium text-ink-2 mb-1.5">
              Type DELETE to confirm
            </label>
            <BBInput
              value={confirmation}
              onChange={(e) => setConfirmation(e.target.value)}
              placeholder="DELETE"
              className="font-mono font-semibold"
            />
          </div>

          {/* Checkbox */}
          <div className="mb-lg">
            <BBCheckbox
              checked={understood}
              onChange={setUnderstood}
              label="I understand my files are encrypted and cannot be recovered after deletion."
            />
          </div>

          {/* Error */}
          {error && (
            <div className="mb-md px-3 py-2 bg-red/10 border border-red/20 rounded-md text-xs text-red">
              {error}
            </div>
          )}

          {/* Buttons */}
          <div className="flex gap-2.5">
            <BBButton
              size="lg"
              className="flex-1 justify-center"
              onClick={() => navigate(-1)}
            >
              Cancel
            </BBButton>
            <BBButton
              variant="danger"
              size="lg"
              className="flex-1 justify-center"
              onClick={handleDelete}
              disabled={!canDelete}
            >
              {loading ? 'Deleting...' : 'Delete permanently'}
            </BBButton>
          </div>
        </div>
      </div>
    </div>
  )
}
