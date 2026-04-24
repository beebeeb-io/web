import { useState } from 'react'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { BBToggle } from '../../components/bb-toggle'

interface NotifItem {
  label: string
  inApp: boolean
  email: boolean
}

interface NotifGroup {
  title: string
  hint: string | null
  items: NotifItem[]
}

const initialGroups: NotifGroup[] = [
  {
    title: 'Security',
    hint: "We can't see your files but we know when devices sign in.",
    items: [
      { label: 'New device signs in', inApp: true, email: true },
      { label: 'Recovery phrase used', inApp: true, email: true },
      { label: 'Password changed', inApp: true, email: true },
      { label: 'Sign-in from new country', inApp: true, email: false },
    ],
  },
  {
    title: 'Sharing',
    hint: 'Activity on links and folders you share.',
    items: [
      { label: 'Someone opens a link you shared', inApp: true, email: false },
      { label: 'Link expires or is revoked', inApp: false, email: false },
      { label: 'New team-vault member joins', inApp: true, email: false },
    ],
  },
  {
    title: 'System',
    hint: null,
    items: [
      { label: 'Storage near limit (>90%)', inApp: true, email: false },
      { label: 'Sub-processor changes', inApp: false, email: true },
      { label: 'Product updates & changelog', inApp: false, email: false },
    ],
  },
]

export function SettingsNotifications() {
  const [groups, setGroups] = useState(initialGroups)

  function toggleItem(gi: number, ii: number, field: 'inApp' | 'email') {
    setGroups((prev) =>
      prev.map((g, gIdx) =>
        gIdx !== gi
          ? g
          : {
              ...g,
              items: g.items.map((item, iIdx) =>
                iIdx !== ii ? item : { ...item, [field]: !item[field] },
              ),
            },
      ),
    )
  }

  return (
    <SettingsShell activeSection="notifications">
      <SettingsHeader
        title="Notifications"
        subtitle="Choose how we tell you about events. Email is always PGP-signed."
      />

      {/* Column headers */}
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
          {/* Group header */}
          <div className="px-7 pt-3.5 pb-2 bg-paper">
            <div className="text-xs font-semibold text-ink-2">{g.title}</div>
            {g.hint && (
              <div className="text-[11px] text-ink-4 mt-0.5">{g.hint}</div>
            )}
          </div>

          {/* Items */}
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
