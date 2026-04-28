import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from './icons'
import type { IconName } from './icons'

type NavItem = {
  id: string
  label: string
  icon: IconName
  href: string
}

const navItems: NavItem[] = [
  { id: 'profile', label: 'Profile', icon: 'users', href: '/settings/profile' },
  { id: 'account', label: 'Account & security', icon: 'shield', href: '/security' },
  { id: 'devices', label: 'Devices', icon: 'cloud', href: '/settings/devices' },
  { id: 'notifications', label: 'Notifications', icon: 'clock', href: '/settings/notifications' },
  { id: 'language', label: 'Language & region', icon: 'settings', href: '/settings/language' },
  { id: 'appearance', label: 'Appearance', icon: 'star', href: '/settings/profile' },
  { id: 'storage', label: 'Storage & data', icon: 'folder', href: '/settings/profile' },
  { id: 'billing', label: 'Plan & billing', icon: 'file', href: '/billing' },
  { id: 'advanced', label: 'Advanced', icon: 'key', href: '/settings/profile' },
]

interface SettingsShellProps {
  activeSection: string
  children: ReactNode
}

export function SettingsShell({ activeSection, children }: SettingsShellProps) {
  const location = useLocation()

  return (
    <div className="min-h-screen flex items-start justify-center bg-paper p-xl pt-12">
      <div
        className="flex overflow-hidden border border-line-2 rounded-xl shadow-2 bg-paper"
        style={{ width: 1040, minHeight: 620 }}
      >
        {/* Sidebar */}
        <div className="w-[220px] shrink-0 bg-paper-2 border-r border-line flex flex-col">
          <Link to="/" className="flex items-center gap-1.5 px-4 pt-3 pb-1 text-[11px] text-ink-3 hover:text-ink transition-colors">
            <span className="rotate-180"><Icon name="chevron-right" size={10} /></span> Back to Drive
          </Link>
          <div className="flex items-center gap-2 px-4 pt-2 pb-2.5">
            <Icon name="settings" size={13} className="text-ink-3" />
            <span className="text-sm font-semibold text-ink">Settings</span>
          </div>
          <nav className="px-3 py-1.5">
            {navItems.map((item) => {
              const isActive = item.id === activeSection || location.pathname === item.href
              return (
                <Link
                  key={item.id}
                  to={item.href}
                  className={`flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] transition-colors ${
                    isActive
                      ? 'bg-paper font-medium text-ink shadow-1'
                      : 'text-ink-2 hover:bg-paper hover:text-ink'
                  }`}
                >
                  <Icon name={item.icon} size={12} className={isActive ? 'text-ink' : 'text-ink-3'} />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
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
