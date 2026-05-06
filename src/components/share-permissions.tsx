import { useState, useEffect, useRef } from 'react'
import { BBButton } from '@beebeeb/shared'
import { BBToggle } from '@beebeeb/shared'
import { useToast } from './toast'
import { patchInvite } from '../lib/api'

interface SharePermissionsProps {
  open: boolean
  x: number
  y: number
  inviteId: string
  recipientEmail: string
  canReshare: boolean
  expiresAt: string | null
  onClose: () => void
  onUpdated: () => void
}

const EXPIRY_PRESETS = [
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 24 * 7 },
  { label: '30 days', hours: 24 * 30 },
  { label: 'Never', hours: null },
] as const

function formatExpiry(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function SharePermissions({
  open,
  x,
  y,
  inviteId,
  recipientEmail,
  canReshare,
  expiresAt,
  onClose,
  onUpdated,
}: SharePermissionsProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const { showToast } = useToast()

  const [reshare, setReshare] = useState(canReshare)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setReshare(canReshare)
  }, [open, canReshare])

  useEffect(() => {
    if (!open || !panelRef.current) return
    const el = panelRef.current
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight

    if (rect.right > vw) {
      el.style.left = `${x - rect.width}px`
    }
    if (rect.bottom > vh) {
      el.style.top = `${y - rect.height}px`
    }
  }, [open, x, y])

  useEffect(() => {
    if (!open) return
    const handleClick = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleScroll = () => onClose()
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('scroll', handleScroll, true)
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  async function savePermissions() {
    setSaving(true)
    try {
      await patchInvite(inviteId, { can_reshare: reshare })
      showToast({
        icon: 'check',
        title: 'Settings updated',
      })
      onUpdated()
      onClose()
    } catch {
      showToast({
        icon: 'x',
        title: 'Failed to update settings',
        danger: true,
      })
    } finally {
      setSaving(false)
    }
  }

  async function setExpiry(hours: number | null) {
    setSaving(true)
    try {
      const expiresValue =
        hours === null
          ? 'never'
          : new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
      await patchInvite(inviteId, { expires_at: expiresValue })
      showToast({
        icon: 'clock',
        title: hours === null ? 'Expiry removed' : 'Expiry set',
      })
      onUpdated()
      onClose()
    } catch {
      showToast({
        icon: 'x',
        title: 'Failed to update expiry',
        danger: true,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      ref={panelRef}
      className="fixed z-[60] w-[280px] bg-paper border border-line-2 rounded-lg shadow-3"
      style={{ left: x, top: y }}
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-line">
        <div className="text-[13px] font-semibold text-ink">Share settings</div>
        <div className="text-[11px] text-ink-3 font-mono truncate mt-0.5">
          {recipientEmail}
        </div>
      </div>

      {/* Toggle rows */}
      <div className="px-4 py-3 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] text-ink">Can re-share</span>
          <BBToggle on={reshare} onChange={setReshare} disabled={saving} />
        </div>

        <BBButton
          variant="amber"
          size="sm"
          className="w-full"
          disabled={saving}
          onClick={savePermissions}
        >
          {saving ? 'Saving...' : 'Save'}
        </BBButton>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-line" />

      {/* Expiry section */}
      <div className="px-4 py-3">
        <div className="text-[11px] font-medium uppercase tracking-wider text-ink-3 mb-2">
          Expiry
        </div>
        <div className="flex flex-wrap gap-1.5">
          {EXPIRY_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              disabled={saving}
              onClick={() => setExpiry(preset.hours)}
              className="px-2 py-1 text-[11px] font-medium rounded border border-line bg-paper-2 text-ink-2 hover:bg-paper-3 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {preset.label}
            </button>
          ))}
        </div>
        {expiresAt && (
          <div className="text-[11px] text-ink-3 font-mono mt-2">
            Expires {formatExpiry(expiresAt)}
          </div>
        )}
      </div>
    </div>
  )
}
