import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '../../components/icons'
import type { IconName } from '../../components/icons'
import { BBChip } from '../../components/bb-chip'

type NavItem = {
  id: string
  label: string
  icon: IconName
  href: string
  badge?: string
}

const navItems: NavItem[] = [
  { id: 'users', label: 'Users', icon: 'users', href: '/admin/users' },
  { id: 'billing', label: 'Billing', icon: 'file', href: '/admin/billing' },
  { id: 'storage-pools', label: 'Storage pools', icon: 'cloud', href: '/admin/storage-pools' },
  { id: 'audit-log', label: 'Audit log', icon: 'shield', href: '/admin/audit-log' },
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
    <div className="min-h-screen flex items-start justify-center bg-paper p-xl pt-12">
      <div
        className="flex overflow-hidden border border-line-2 rounded-xl shadow-2 bg-paper"
        style={{ width: 1120, minHeight: 660 }}
      >
        {/* Sidebar */}
        <div className="w-[220px] shrink-0 bg-paper-2 border-r border-line flex flex-col">
          <div className="flex items-center gap-2 px-4 pt-4 pb-2.5">
            <Icon name="shield" size={13} className="text-ink-3" />
            <span className="text-sm font-semibold text-ink">Admin</span>
            <BBChip variant="amber" className="ml-auto text-[9px]">Business</BBChip>
          </div>
          <nav className="px-3 py-1.5">
            {navItems.map(item => {
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
                  <span className="flex-1">{item.label}</span>
                  {item.badge && (
                    <span className="font-mono text-[10px] text-amber-deep">{item.badge}</span>
                  )}
                </Link>
              )
            })}
          </nav>

          <div className="mx-4 my-2.5 border-t border-line" />

          <div className="px-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 px-2.5 pb-2">
              Workspace
            </div>
            <Link
              to="/settings/profile"
              className="flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] text-ink-2 hover:bg-paper hover:text-ink transition-colors"
            >
              <Icon name="settings" size={12} className="text-ink-3" />
              <span>Settings</span>
            </Link>
            <Link
              to="/security"
              className="flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] text-ink-2 hover:bg-paper hover:text-ink transition-colors"
            >
              <Icon name="lock" size={12} className="text-ink-3" />
              <span>Security</span>
            </Link>
          </div>

          <div className="mt-auto p-4 border-t border-line">
            <div className="flex items-center gap-2 text-[11px] text-ink-3">
              <span className="inline-block w-2 h-2 rounded-full bg-green" />
              <span className="font-mono">Frankfurt</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      </div>
    </div>
  )
}
