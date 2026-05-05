import { useState, useEffect, useCallback } from 'react'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { BBToggle } from '../../components/bb-toggle'
import { Icon } from '../../components/icons'
import { useToast } from '../../components/toast'
import {
  getNotificationPreferences,
  setNotificationPreferences,
  ApiError,
  type NotificationPreferences,
} from '../../lib/api'

// ── Toggle definitions ────────────────────────────────────────────────────────

interface PushToggle {
  key: keyof NotificationPreferences
  label: string
  description: string
}

const PUSH_TOGGLES: PushToggle[] = [
  {
    key: 'share_received',
    label: 'Share received',
    description: 'Get notified when someone shares a file with you.',
  },
  {
    key: 'storage_warning',
    label: 'Storage warnings',
    description: 'Alert when you reach 80% or 100% of your quota.',
  },
  {
    key: 'new_device_login',
    label: 'New device sign-in',
    description: 'Security alert when a new device accesses your account.',
  },
  {
    key: 'backup_complete',
    label: 'Backup complete',
    description: 'Notification when photo backup finishes.',
  },
]

const DEFAULTS: NotificationPreferences = {
  share_received: true,
  storage_warning: true,
  new_device_login: true,
  backup_complete: false,
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettingsNotifications() {
  const { showToast } = useToast()
  const [prefs, setPrefs] = useState<NotificationPreferences>(DEFAULTS)
  const [loading, setLoading] = useState(true)
  /** true when the server endpoint is not yet deployed (404) */
  const [endpointMissing, setEndpointMissing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    getNotificationPreferences()
      .then(data => {
        if (!cancelled) {
          setPrefs(data)
          setLoading(false)
        }
      })
      .catch(err => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          // Endpoint not yet deployed — show defaults with a note
          setEndpointMissing(true)
        }
        // Any error: fall back to defaults and allow interaction
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const handleToggle = useCallback(
    async (key: keyof NotificationPreferences, value: boolean) => {
      const next: NotificationPreferences = { ...prefs, [key]: value }
      // Optimistic update
      setPrefs(next)

      if (endpointMissing) return // can't save until server is deployed

      setSaving(true)
      try {
        const saved = await setNotificationPreferences(next)
        setPrefs(saved)
        showToast({ icon: 'check', title: 'Notification preferences saved' })
      } catch (err) {
        // Roll back on error
        setPrefs(prefs)
        if (err instanceof ApiError && err.status === 404) {
          setEndpointMissing(true)
        } else {
          showToast({
            icon: 'x',
            title: 'Failed to save preferences',
            description: err instanceof Error ? err.message : 'Please try again.',
            danger: true,
          })
        }
      } finally {
        setSaving(false)
      }
    },
    [prefs, endpointMissing, showToast],
  )

  return (
    <SettingsShell activeSection="notifications">
      <SettingsHeader
        title="Notifications"
        subtitle="Choose what events you want to be notified about."
      />

      {/* Endpoint-not-deployed notice */}
      {endpointMissing && (
        <div className="mx-7 mt-4 flex items-start gap-2.5 px-4 py-3 rounded-lg border border-line bg-paper-2">
          <Icon name="cloud" size={13} className="text-ink-3 shrink-0 mt-0.5" />
          <p className="text-[12px] text-ink-3 leading-relaxed">
            Saving preferences requires the latest server update. Changes will apply once the server is updated.
          </p>
        </div>
      )}

      {/* Push notifications section */}
      <div className="mt-5 mb-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 px-7 py-3">
          Push notifications
        </h2>
      </div>

      {loading ? (
        <div className="px-7 py-6 flex items-center gap-2 text-ink-3">
          <span className="w-3.5 h-3.5 border-2 border-line-2 border-t-ink-3 rounded-full animate-spin shrink-0" />
          <span className="text-[13px]">Loading preferences…</span>
        </div>
      ) : (
        <div className="divide-y divide-line border-t border-b border-line mx-7 rounded-lg overflow-hidden">
          {PUSH_TOGGLES.map(({ key, label, description }) => (
            <div
              key={key}
              className="flex items-center gap-4 px-5 py-4 bg-paper hover:bg-paper-2 transition-colors"
            >
              {/* Text */}
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium text-ink">{label}</div>
                <div className="text-[12px] text-ink-3 mt-0.5 leading-snug">{description}</div>
              </div>

              {/* Toggle */}
              <BBToggle
                on={prefs[key]}
                onChange={(val) => void handleToggle(key, val)}
                disabled={saving}
              />
            </div>
          ))}
        </div>
      )}

      <div className="px-7 mt-4 mb-6">
        <p className="text-[11px] text-ink-4 leading-relaxed">
          Push notifications are delivered through your browser or device. Email notifications for security events (new device sign-in, password change) are always sent and cannot be disabled.
        </p>
      </div>
    </SettingsShell>
  )
}
