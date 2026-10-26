import { Fragment, type ReactNode, useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import { DriveLayout } from './drive-layout'

type NavItem = {
  id: string
  label: string
  icon: IconName
  href: string
  group: string
}

const navItems: NavItem[] = [
  { group: 'Your account', id: 'profile', label: 'Account', icon: 'users', href: '/settings/profile' },
  { group: 'Your account', id: 'billing', label: 'Plan & billing', icon: 'cloud', href: '/settings/billing' },
  { group: 'Your account', id: 'privacy', label: 'Privacy & data', icon: 'eye-off', href: '/settings/privacy' },
  { group: 'Sign-in and activity', id: 'security', label: 'Security', icon: 'shield', href: '/settings/security' },
  { group: 'Sign-in and activity', id: 'activity', label: 'Activity', icon: 'clock', href: '/settings/activity' },
  { group: 'Files & storage', id: 'data-residency', label: 'Storage location', icon: 'cloud', href: '/settings/data-residency' },
  { group: 'Files & storage', id: 'import', label: 'Import files', icon: 'download', href: '/settings/import' },
  { group: 'Preferences', id: 'notifications', label: 'Notifications', icon: 'bell', href: '/settings/notifications' },
  { group: 'Preferences', id: 'appearance', label: 'Appearance', icon: 'image', href: '/settings/appearance' },
  { group: 'Help', id: 'support', label: 'Help & about', icon: 'mail', href: '/settings/support' },
]

interface SettingsShellProps {
  activeSection: string
  children: ReactNode
}

export function SettingsShell({ activeSection, children }: SettingsShellProps) {
  const location = useLocation()
  const mobileNavRef = useRef<HTMLElement>(null)

  // When the active tab changes, scroll it into view without resetting the bar position
  useEffect(() => {
    const nav = mobileNavRef.current
    if (!nav) return
    const active = nav.querySelector('[data-active="true"]') as HTMLElement | null
    active?.scrollIntoView({ inline: 'nearest', behavior: 'smooth' })
  }, [activeSection, location.pathname])

  return (
    <DriveLayout>
      <div className="flex-1 flex flex-col md:flex-row min-h-0">
        {/* Settings sub-nav — desktop sidebar */}
        <nav
          aria-label="Settings"
          className="hidden md:flex md:flex-col w-[200px] shrink-0 border-r border-line bg-paper-2 px-3 py-4 overflow-y-auto"
        >
          <div className="flex items-center gap-2 px-2 pb-2.5">
            <Icon name="settings" size={13} className="text-ink-3" />
            <span className="text-[13px] font-semibold text-ink">Settings</span>
          </div>
          {navItems.map((item, index) => {
            const isActive = item.id === activeSection || location.pathname === item.href
            return (
              <Fragment key={item.id}>
                {(index === 0 || item.group !== navItems[index - 1].group) && (
                  <div className="px-2 pt-4 pb-1 text-[11px] font-semibold text-ink-3">{item.group}</div>
                )}
                <Link
                  to={item.href}
                  aria-current={isActive ? 'page' : undefined}
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
              </Fragment>
            )
          })}
        </nav>

        {/* Settings sub-nav — mobile horizontal tab bar */}
        <nav
          ref={mobileNavRef}
          aria-label="Settings"
          className="md:hidden flex overflow-x-auto gap-1 border-b border-line bg-paper-2 px-2 py-2 shrink-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {navItems.map((item) => {
            const isActive = item.id === activeSection || location.pathname === item.href
            return (
              <Link
                key={item.id}
                to={item.href}
                aria-current={isActive ? 'page' : undefined}
                data-active={isActive}
                className={`flex items-center gap-1.5 shrink-0 px-3 py-1.5 rounded-md text-[13px] whitespace-nowrap transition-colors ${
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
        <div className="flex-1 min-w-0 w-full overflow-y-auto">{children}</div>
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
    <div className="px-4 md:px-7 pt-5 pb-4 border-b border-line">
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
    <div className="grid grid-cols-1 md:grid-cols-[240px_1fr] gap-1 md:gap-5 px-4 md:px-7 py-4 border-b border-line">
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
