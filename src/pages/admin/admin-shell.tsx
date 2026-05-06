import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '@beebeeb/shared'
import type { IconName } from '@beebeeb/shared'
import { DriveLayout } from '../../components/drive-layout'
import { HealthBadge } from '../../components/admin/health-badge'

type NavItem = {
  id: string
  label: string
  icon: IconName
  href: string
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'eye', href: '/admin' },
  { id: 'users', label: 'Users', icon: 'users', href: '/admin/users' },
  { id: 'infrastructure', label: 'Infrastructure', icon: 'cloud', href: '/admin/infrastructure' },
  { id: 'security', label: 'Security', icon: 'shield', href: '/admin/security' },
  { id: 'billing', label: 'Billing', icon: 'file', href: '/admin/billing' },
  { id: 'compliance', label: 'Compliance', icon: 'check', href: '/admin/compliance' },
  { id: 'settings', label: 'Settings', icon: 'settings', href: '/admin/settings' },
]

interface AdminShellProps {
  activeSection: string
  children: ReactNode
}

export function AdminShell({ activeSection, children }: AdminShellProps) {
  const location = useLocation()

  return (
    <DriveLayout>
      <div className="flex-1 flex min-h-0">
        {/* Admin sub-nav */}
        <nav
          aria-label="Admin"
          className="w-[200px] shrink-0 border-r border-line bg-paper-2 px-3 py-4 overflow-y-auto"
        >
          <div className="flex items-center gap-2 px-2 pb-2.5">
            <Icon name="shield" size={13} className="text-ink-3" />
            <span className="text-[13px] font-semibold text-ink">Admin</span>
            <HealthBadge />
          </div>
          {navItems.map((item) => {
            // Match by explicit activeSection prop (set by each admin page),
            // exact pathname for the dashboard root, or startsWith for all
            // other sections so sub-pages (pool-lifecycle, mission-control,
            // individual pool pages) keep their parent item highlighted.
            const isActive =
              item.id === activeSection ||
              (item.href === '/admin'
                ? location.pathname === '/admin'
                : location.pathname.startsWith(item.href))
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
        <div className="flex-1 min-w-0 overflow-y-auto flex flex-col">{children}</div>
      </div>
    </DriveLayout>
  )
}

/* Shared layout helpers — mirror SettingsShell so admin pages have consistent chrome */

interface AdminHeaderProps {
  title: string
  subtitle?: string
  actions?: ReactNode
}

export function AdminHeader({ title, subtitle, actions }: AdminHeaderProps) {
  return (
    <div className="px-7 pt-5 pb-4 border-b border-line flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <h2 className="text-xl font-bold text-ink">{title}</h2>
        {subtitle && (
          <p className="text-[13px] text-ink-3 mt-0.5 leading-relaxed">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}
