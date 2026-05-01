import { useEffect, useState } from 'react'
import { BBButton } from './bb-button'
import { Icon } from './icons'
import { getInviteActivity, type InviteActivity } from '../lib/api'

interface ShareActivityProps {
  open: boolean
  inviteId: string
  onClose: () => void
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  return (
    d.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }) +
    ' ' +
    d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between py-[6px]">
      <span className="text-[12px] text-ink-3">{label}</span>
      <span className={`text-[12px] text-ink ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

export function ShareActivity({ open, inviteId, onClose }: ShareActivityProps) {
  const [activity, setActivity] = useState<InviteActivity | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !inviteId) return

    setLoading(true)
    setError(null)
    setActivity(null)

    getInviteActivity(inviteId)
      .then((data) => setActivity(data))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load activity'))
      .finally(() => setLoading(false))
  }, [open, inviteId])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-ink/30" onClick={onClose} />

      {/* Card */}
      <div className="relative bg-paper border border-line-2 rounded-xl shadow-3 w-[400px] max-w-[90vw]">
        {/* Header */}
        <div className="flex items-center gap-md px-lg py-md border-b border-line">
          <div className="w-8 h-8 rounded-lg bg-amber-bg flex items-center justify-center shrink-0">
            <Icon name="eye" size={16} className="text-amber-deep" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-[14px] font-semibold text-ink">Activity</h2>
            {activity && (
              <p className="text-[11px] text-ink-3 font-mono truncate">
                {activity.recipient_email}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-1 text-ink-3 hover:text-ink cursor-pointer"
          >
            <Icon name="x" size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-lg py-md min-h-[160px]">
          {loading && (
            <div className="flex items-center justify-center py-xl">
              <svg
                className="animate-spin h-5 w-5 text-amber"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
            </div>
          )}

          {error && (
            <div className="flex items-center justify-center py-xl">
              <p className="text-[12px] text-red">{error}</p>
            </div>
          )}

          {activity && !loading && !error && (
            <div>
              <Row label="Shared" value={formatDate(activity.created_at)} />
              <Row
                label="Claimed"
                value={activity.claimed_at ? formatDate(activity.claimed_at) : 'Not yet'}
              />
              <Row
                label="Approved"
                value={activity.approved_at ? formatDate(activity.approved_at) : 'Not yet'}
              />

              <div className="border-t border-line my-sm" />

              <Row
                label="Downloads"
                value={String(activity.download_count)}
                mono
              />
              <Row
                label="First accessed"
                value={activity.first_accessed ? formatDate(activity.first_accessed) : 'Never'}
              />
              <Row
                label="Last accessed"
                value={activity.last_accessed ? formatDate(activity.last_accessed) : 'Never'}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-lg py-md border-t border-line">
          <BBButton variant="ghost" size="sm" onClick={onClose}>
            Close
          </BBButton>
        </div>
      </div>
    </div>
  )
}
