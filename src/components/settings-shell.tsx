import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from './icons'
import type { IconName } from './icons'
import { DriveLayout } from './drive-layout'

type NavItem = {
  id: string
  label: string
  icon: IconName
  href: string
}

const navItems: NavItem[] = [
  { id: 'profile', label: 'Profile', icon: 'users', href: '/settings/profile' },
  { id: 'security', label: 'Security', icon: 'shield', href: '/settings/security' },
  { id: 'plan', label: 'Storage & Plan', icon: 'cloud', href: '/settings/plan' },
  { id: 'privacy', label: 'Privacy', icon: 'eye-off', href: '/settings/privacy' },
  { id: 'activity', label: 'Activity', icon: 'clock', href: '/settings/activity' },
  { id: 'notifications', label: 'Notifications', icon: 'clock', href: '/settings/notifications' },
  { id: 'data-residency', label: 'Data Residency', icon: 'cloud', href: '/settings/data-residency' },
  { id: 'appearance', label: 'Appearance', icon: 'star', href: '/settings/appearance' },
  { id: 'import', label: 'Import', icon: 'download', href: '/settings/import' },
  { id: 'referrals', label: 'Referrals', icon: 'star', href: '/settings/referrals' },
  { id: 'developer', label: 'Developer', icon: 'key', href: '/settings/developer' },
]

interface SettingsShellProps {
  activeSection: string
  children: ReactNode
}

export function SettingsShell({ activeSection, children }: SettingsShellProps) {
  const location = useLocation()

  return (
    <DriveLayout>
      <div className="flex-1 flex min-h-0">
        {/* Settings sub-nav */}
        <nav
          aria-label="Settings"
          className="w-[200px] shrink-0 border-r border-line bg-paper-2 px-3 py-4 overflow-y-auto"
        >
          <div className="flex items-center gap-2 px-2 pb-2.5">
            <Icon name="settings" size={13} className="text-ink-3" />
            <span className="text-[13px] font-semibold text-ink">Settings</span>
          </div>
          {navItems.map((item) => {
            const isActive = item.id === activeSection || location.pathname === item.href
            return (
              <Link
                key={item.id}
                to={item.href}
                className={`flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] transition-colors ${
                  isActive
                    ? 'bg-paper-3 font-semibold text-ink'
                    : 'text-ink-2 hover:bg-paper-3/50'
                }`}
              >
                <Icon
                  name={item.icon}
                  size={12}
                  className={`shrink-0 ${isActive ? 'text-ink' : 'text-ink-3'}`}
                />
                <span>{item.label}</span>
              </Link>
            )
          })}
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 overflow-y-auto">{children}</div>
      </div>
    </DriveLayout>
  )
}

/* Shared layout helpers */

interface SettingsHeaderProps {
  title: string
  subtitle?: string
}

export function SettingsHeader({ title, subtitle }: SettingsHeaderProps) {
  return (
    <div className="px-7 pt-5 pb-4 border-b border-line">
      <h2 className="text-xl font-bold text-ink">{title}</h2>
      {subtitle && (
        <p className="text-[13px] text-ink-3 mt-0.5 leading-relaxed">{subtitle}</p>
      )}
    </div>
  )
}

interface SettingsRowProps {
  label: string
  hint?: string
  danger?: boolean
  children: ReactNode
}

export function SettingsRow({ label, hint, danger, children }: SettingsRowProps) {
  return (
    <div className="grid gap-5 px-7 py-4 border-b border-line" style={{ gridTemplateColumns: '240px 1fr' }}>
      <div>
        <div className={`text-[13px] font-medium ${danger ? 'text-red' : 'text-ink'}`}>{label}</div>
        {hint && (
          <div className="text-[11px] text-ink-3 mt-0.5 leading-relaxed">{hint}</div>
        )}
      </div>
      <div>{children}</div>
    </div>
  )
}
