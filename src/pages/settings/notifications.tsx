import { useState, useEffect, useCallback } from 'react'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { BBToggle } from '../../components/bb-toggle'
import { getPreference, setPreference } from '../../lib/api'

interface NotifItem {
  label: string
  key: string
  inApp: boolean
  email: boolean
}

interface NotifGroup {
  title: string
  hint: string | null
  items: NotifItem[]
}

const defaultGroups: NotifGroup[] = [
  {
    title: 'Security',
    hint: "We can't see your files but we know when devices sign in.",
    items: [
      { label: 'New device signs in', key: 'new_device', inApp: true, email: true },
      { label: 'Recovery phrase used', key: 'recovery_used', inApp: true, email: true },
      { label: 'Password changed', key: 'password_changed', inApp: true, email: true },
      { label: 'Sign-in from new country', key: 'new_country', inApp: true, email: false },
    ],
  },
  {
    title: 'Sharing',
    hint: 'Activity on links and folders you share.',
    items: [
      { label: 'Someone opens a link you shared', key: 'link_opened', inApp: true, email: false },
      { label: 'Link expires or is revoked', key: 'link_expired', inApp: false, email: false },
      { label: 'New team-vault member joins', key: 'member_joined', inApp: true, email: false },
    ],
  },
  {
    title: 'System',
    hint: null,
    items: [
      { label: 'Storage near limit (>90%)', key: 'storage_warning', inApp: true, email: false },
      { label: 'Sub-processor changes', key: 'subprocessor', inApp: false, email: true },
      { label: 'Product updates & changelog', key: 'product_updates', inApp: false, email: false },
    ],
  },
]

type NotifPrefs = Record<string, { inApp: boolean; email: boolean }>

export function SettingsNotifications() {
  const [groups, setGroups] = useState(defaultGroups)

  useEffect(() => {
    getPreference<NotifPrefs>('notification_preferences')
      .then((prefs) => {
        if (!prefs) return
        setGroups((prev) =>
          prev.map((g) => ({
            ...g,
            items: g.items.map((item) => {
              const saved = prefs[item.key]
              return saved ? { ...item, inApp: saved.inApp, email: saved.email } : item
            }),
          })),
        )
      })
      .catch(() => {})
  }, [])

  const savePrefs = useCallback((updatedGroups: NotifGroup[]) => {
    const prefs: NotifPrefs = {}
    for (const g of updatedGroups) {
      for (const item of g.items) {
        prefs[item.key] = { inApp: item.inApp, email: item.email }
      }
    }
    setPreference('notification_preferences', prefs).catch(() => {})
  }, [])

  function toggleItem(gi: number, ii: number, field: 'inApp' | 'email') {
    setGroups((prev) => {
      const next = prev.map((g, gIdx) =>
        gIdx !== gi
          ? g
          : {
              ...g,
              items: g.items.map((item, iIdx) =>
                iIdx !== ii ? item : { ...item, [field]: !item[field] },
              ),
            },
      )
      savePrefs(next)
      return next
    })
  }

  return (
    <SettingsShell activeSection="notifications">
      <SettingsHeader
        title="Notifications"
        subtitle="Choose how we tell you about events. Email is always PGP-signed."
      />

      <div
        className="grid items-center px-7 py-3 bg-paper-2 border-b border-line"
        style={{ gridTemplateColumns: '1fr 100px 100px' }}
      >
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">Event</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 text-center">In-app</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 text-center">Email</span>
      </div>

      {groups.map((g, gi) => (
        <div key={gi}>
          <div className="px-7 pt-3.5 pb-2 bg-paper">
            <div className="text-xs font-semibold text-ink-2">{g.title}</div>
            {g.hint && (
              <div className="text-[11px] text-ink-4 mt-0.5">{g.hint}</div>
            )}
          </div>

          {g.items.map((item, ii) => (
            <div
              key={ii}
              className="grid items-center px-7 py-2.5 border-b border-line"
              style={{ gridTemplateColumns: '1fr 100px 100px' }}
            >
              <span className="text-[13px] text-ink">{item.label}</span>
              <div className="flex justify-center">
                <BBToggle on={item.inApp} onChange={() => toggleItem(gi, ii, 'inApp')} />
              </div>
              <div className="flex justify-center">
                <BBToggle on={item.email} onChange={() => toggleItem(gi, ii, 'email')} />
              </div>
            </div>
          ))}
        </div>
      ))}
    </SettingsShell>
  )
}
