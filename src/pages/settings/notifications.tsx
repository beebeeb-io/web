import { useState, useEffect, useCallback } from 'react'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { BBToggle, Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import { useToast } from '../../components/toast'
import {
  getNotificationPreferences,
  setNotificationPreferences,
  ApiError,
  type NotificationPreferences,
  type NotificationType,
  type LegacyNotificationPreferences,
} from '../../lib/api'

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Events the server emails today — unconditionally, with no per-user opt-out.
 *
 * This is the ONLY source of truth for the Email column. It mirrors the
 * senders that exist in beebeeb-api's EmailService and are called on main:
 *   - password_changed -> send_password_changed (routes/password.rs)
 *   - payment_failed   -> send_payment_failed (Stripe webhook, routes/billing.rs)
 *   - plan_expiring    -> send_trial_will_end / send_card_expiring (routes/billing.rs)
 * Every other event has no email sender (new sign-ins are push-only via
 * push_delivery::notify_new_login; 2FA and recovery-phrase events send
 * nothing), and the server never reads a per-type `email` preference. So the
 * Email switch is read-only: ON + locked for these, OFF + locked for the rest.
 * Add a type here only in the same change that ships its server sender.
 */
const EMAILED_ALWAYS: ReadonlySet<NotificationType> = new Set([
  'password_changed',
  'payment_failed',
  'plan_expiring',
])

/** Default channel state for a notification type. */
function ch(inApp: boolean, email: boolean) {
  return { in_app: inApp, email }
}

const DEFAULTS: NotificationPreferences = {
  // `email` below is never sent to or read by the server as a preference;
  // the Email column renders from EMAILED_ALWAYS instead.
  // Security
  new_device_login: ch(true, true),
  password_changed: ch(true, true),
  two_fa_changes: ch(true, true),
  recovery_phrase_used: ch(true, true),
  // Sharing
  share_received: ch(true, true),
  share_link_opened: ch(true, false),
  share_access_revoked: ch(true, true),
  // Storage
  storage_warning: ch(true, true),
  storage_critical: ch(true, true),
  storage_full: ch(true, true),
  // Backup
  backup_complete: ch(false, false),
  backup_failed: ch(true, true),
  // Account
  payment_failed: ch(true, true),
  plan_expiring: ch(true, true),
  data_export_ready: ch(true, true),
}

// ── Section definitions ──────────────────────────────────────────────────────

interface NotificationRow {
  key: NotificationType
  label: string
  description: string
}

interface NotificationSection {
  title: string
  icon: IconName
  note?: string
  rows: NotificationRow[]
}

const SECTIONS: NotificationSection[] = [
  {
    title: 'Security',
    icon: 'shield',
    note:
      'Password changes are always emailed to you. New sign-ins arrive as a push notification on devices with the Beebeeb app. Two-factor and recovery-phrase alerts are not emailed yet.',
    rows: [
      {
        key: 'new_device_login',
        label: 'New device sign-in',
        description: 'A new device or browser accessed your account.',
      },
      {
        key: 'password_changed',
        label: 'Password changed',
        description: 'Your account password was updated.',
      },
      {
        key: 'two_fa_changes',
        label: '2FA changes',
        description: 'Two-factor authentication was enabled or disabled.',
      },
      {
        key: 'recovery_phrase_used',
        label: 'Recovery phrase used',
        description: 'Your recovery phrase was used to access your account.',
      },
    ],
  },
  {
    title: 'Sharing',
    icon: 'share',
    rows: [
      {
        key: 'share_received',
        label: 'File or folder shared with you',
        description: 'Someone shared a file or folder with your account.',
      },
      {
        key: 'share_link_opened',
        label: 'Share link opened',
        description: 'A recipient opened one of your share links.',
      },
      {
        key: 'share_access_revoked',
        label: 'Share access revoked',
        description: 'Your access to a shared file or folder was removed.',
      },
    ],
  },
  {
    title: 'Storage',
    icon: 'cloud',
    rows: [
      {
        key: 'storage_warning',
        label: 'Storage quota warning',
        description: 'You have used 80% of your storage quota.',
      },
      {
        key: 'storage_critical',
        label: 'Storage critical',
        description: 'You have used 95% of your storage quota.',
      },
      {
        key: 'storage_full',
        label: 'Storage full',
        description: 'Your storage is completely full. Uploads will fail.',
      },
    ],
  },
  {
    title: 'Backup',
    icon: 'camera',
    rows: [
      {
        key: 'backup_complete',
        label: 'Backup complete',
        description: 'A photo or device backup finished successfully.',
      },
      {
        key: 'backup_failed',
        label: 'Backup failed',
        description: 'A backup could not complete and needs attention.',
      },
    ],
  },
  {
    title: 'Account',
    icon: 'settings',
    note: 'Payment and plan emails are always sent.',
    rows: [
      {
        key: 'payment_failed',
        label: 'Payment failed',
        description: 'A subscription payment could not be processed.',
      },
      {
        key: 'plan_expiring',
        label: 'Plan expiring',
        description: 'Your current plan is about to expire.',
      },
      {
        key: 'data_export_ready',
        label: 'Data export ready',
        description: 'Your requested data export is ready for download.',
      },
    ],
  },
]

// ── Migration from legacy format ─────────────────────────────────────────────

/**
 * Detect whether the server returned the old flat boolean format and migrate
 * to the new per-channel structure. Returns the new structure either way.
 */
function migratePreferences(
  data: NotificationPreferences | LegacyNotificationPreferences,
): NotificationPreferences {
  // If the data already has channel objects, use it directly
  if (
    data.new_device_login !== null &&
    typeof data.new_device_login === 'object' &&
    'in_app' in data.new_device_login
  ) {
    return data as NotificationPreferences
  }

  // Legacy format: flat booleans — migrate
  const legacy = data as LegacyNotificationPreferences
  return {
    ...DEFAULTS,
    new_device_login: ch(legacy.new_device_login, true),
    share_received: ch(legacy.share_received, legacy.share_received),
    storage_warning: ch(legacy.storage_warning, legacy.storage_warning),
    backup_complete: ch(legacy.backup_complete, false),
  }
}

// ── Page ─────────────────────────────────────────────────────────────────────

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
          setPrefs(migratePreferences(data))
          setLoading(false)
        }
      })
      .catch(err => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 404) {
          setEndpointMissing(true)
        }
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const handleToggle = useCallback(
    async (key: NotificationType, value: boolean) => {
      // Only the in-app channel is user-controlled. The Email column is a
      // read-only statement of what the server sends (see EMAILED_ALWAYS).
      const nextChannel = { ...prefs[key], in_app: value }
      const next: NotificationPreferences = { ...prefs, [key]: nextChannel }
      setPrefs(next)

      if (endpointMissing) return

      setSaving(true)
      try {
        const saved = await setNotificationPreferences(next)
        setPrefs(migratePreferences(saved))
      } catch (err) {
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
        subtitle="Choose which events you are notified about in the app. The Email column shows what we email today; those emails can't be switched off."
      />

      {/* Endpoint-not-deployed notice */}
      {endpointMissing && (
        <div className="mx-7 mt-4 flex items-start gap-2.5 px-4 py-3 rounded-lg border border-line bg-paper-2">
          <Icon name="cloud" size={13} className="text-ink-3 shrink-0 mt-0.5" />
          <p className="text-[12px] text-ink-3 leading-relaxed">
            Saving preferences requires the latest server update.
            Changes will apply once the server is updated.
          </p>
        </div>
      )}

      {loading ? (
        <div className="px-7 py-6 flex items-center gap-2 text-ink-3">
          <span className="w-3.5 h-3.5 border-2 border-line-2 border-t-ink-3 rounded-full animate-spin shrink-0" />
          <span className="text-[13px]">Loading preferences...</span>
        </div>
      ) : (
        <div className="pb-6">
          {/* Column headers — only visible on wider screens */}
          <div className="hidden sm:flex items-center justify-end gap-2 px-7 pt-5 pb-2">
            <span className="text-[11px] font-medium text-ink-4 uppercase tracking-wider w-[52px] text-center">
              In-app
            </span>
            <span className="text-[11px] font-medium text-ink-4 uppercase tracking-wider w-[52px] text-center">
              Email
            </span>
          </div>

          {SECTIONS.map((section) => (
            <div key={section.title} className="mt-2">
              {/* Section header */}
              <div className="flex items-center gap-2 px-7 py-3">
                <Icon name={section.icon} size={13} className="text-ink-3 shrink-0" />
                <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4">
                  {section.title}
                </h2>
              </div>

              {/* Rows */}
              <div className="divide-y divide-line border-t border-b border-line mx-7 rounded-lg overflow-hidden">
                {section.rows.map(({ key, label, description }) => {
                  const emailed = EMAILED_ALWAYS.has(key)
                  const pref = prefs[key]

                  return (
                    <div
                      key={key}
                      className="flex items-center gap-4 px-5 py-4 bg-paper hover:bg-paper-2 transition-colors"
                    >
                      {/* Label + description */}
                      <div className="flex-1 min-w-0">
                        <div className="text-[13px] font-medium text-ink">{label}</div>
                        <div className="text-[12px] text-ink-3 mt-0.5 leading-snug">
                          {description}
                        </div>
                      </div>

                      {/* Channel toggles */}
                      <div className="flex items-center gap-2 shrink-0">
                        {/* In-app toggle */}
                        <div className="flex flex-col items-center w-[52px]">
                          <span className="sm:hidden text-[10px] text-ink-4 mb-1">In-app</span>
                          <BBToggle
                            on={pref.in_app}
                            onChange={(val) => void handleToggle(key, val)}
                            disabled={saving}
                            aria-label={`${label} in-app notifications`}
                          />
                        </div>

                        {/* Email toggle */}
                        <div className="flex flex-col items-center w-[52px]">
                          <span className="sm:hidden text-[10px] text-ink-4 mb-1">Email</span>
                          <BBToggle
                            on={emailed}
                            disabled
                            aria-label={`${label} email notifications ${emailed ? '(always sent)' : '(not emailed)'}`}
                          />
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Section note (what is and is not emailed) */}
              {section.note && (
                <div className="px-7 mt-2">
                  <p className="text-[11px] text-ink-4 leading-relaxed flex items-center gap-1.5">
                    <Icon name="lock" size={10} className="text-ink-4 shrink-0" />
                    {section.note}
                  </p>
                </div>
              )}
            </div>
          ))}

        </div>
      )}
    </SettingsShell>
  )
}
