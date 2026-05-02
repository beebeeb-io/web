import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '../../components/icons'
import type { IconName } from '../../components/icons'
import { DriveLayout } from '../../components/drive-layout'

type NavItem = {
  id: string
  label: string
  icon: IconName
  href: string
}

const navItems: NavItem[] = [
  { id: 'monitoring', label: 'Monitoring', icon: 'eye', href: '/admin/monitoring' },
  { id: 'users', label: 'Users', icon: 'users', href: '/admin/users' },
  { id: 'waitlist', label: 'Waitlist', icon: 'mail', href: '/admin/waitlist' },
  { id: 'billing', label: 'Billing', icon: 'file', href: '/admin/billing' },
  { id: 'storage-pools', label: 'Storage pools', icon: 'cloud', href: '/admin/storage-pools' },
  { id: 'migrations', label: 'Migrations', icon: 'arrow-up', href: '/admin/migrations' },
  { id: 'audit-log', label: 'Audit log', icon: 'shield', href: '/admin/audit-log' },
  { id: 'abuse-reports', label: 'Abuse reports', icon: 'shield', href: '/admin/abuse-reports' },
  { id: 'compliance', label: 'Compliance', icon: 'check', href: '/admin/compliance' },
  { id: 'sso', label: 'SSO / SAML', icon: 'key', href: '/admin/sso' },
  { id: 'data-export', label: 'Data export', icon: 'download', href: '/admin/data-export' },
  { id: 'api-tokens', label: 'API tokens', icon: 'link', href: '/admin/api-tokens' },
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
