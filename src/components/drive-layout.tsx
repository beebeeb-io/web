import type { ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { BBLogo } from './bb-logo'
import { Icon } from './icons'
import type { IconName } from './icons'
import { useAuth } from '../lib/auth-context'

const navItems: { path: string; icon: IconName; label: string }[] = [
  { path: '/', icon: 'folder', label: 'All files' },
  { path: '/shared', icon: 'users', label: 'Shared' },
  { path: '/photos', icon: 'image', label: 'Photos' },
  { path: '/starred', icon: 'star', label: 'Starred' },
  { path: '/recent', icon: 'clock', label: 'Recent' },
  { path: '/trash', icon: 'trash', label: 'Trash' },
]

export function DriveLayout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { logout } = useAuth()

  return (
    <div className="h-screen flex overflow-hidden bg-paper">
      <aside className="w-[220px] shrink-0 border-r border-line bg-paper-2 flex flex-col">
        <div className="px-4 pt-4 pb-3">
          <BBLogo size={14} />
        </div>

        <nav className="px-3 py-1.5">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] transition-colors ${
                  isActive
                    ? 'bg-paper-3 font-semibold text-ink'
                    : 'text-ink-2 hover:bg-paper-3/50'
                }`}
              >
                <Icon name={item.icon} size={13} className="shrink-0" />
                <span className="flex-1">{item.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="mx-4 my-2.5 h-px bg-line" />

        <div className="mt-auto px-4 py-4 border-t border-line">
          <div className="text-[10px] font-medium uppercase tracking-wider text-ink-3 mb-2">
            Storage
          </div>
          <div className="h-[3px] w-full rounded-full bg-paper-3 overflow-hidden mb-1.5">
            <div className="h-full rounded-full bg-amber" style={{ width: '0%' }} />
          </div>
          <div className="flex justify-between text-[11px]">
            <span className="font-mono tabular-nums">0 / 10 GB</span>
            <Link to="/billing" className="font-medium text-amber-deep hover:underline">
              Upgrade
            </Link>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[10px] text-ink-3">
            <Icon name="shield" size={11} className="text-amber-deep" />
            <span className="font-mono">Frankfurt · Hetzner</span>
          </div>
        </div>

        <div className="px-3 pb-3">
          <button
            onClick={logout}
            className="w-full flex items-center gap-2.5 px-2 py-[7px] rounded-md text-[13px] text-ink-3 hover:bg-paper-3/50 transition-colors text-left"
          >
            <Icon name="x" size={13} className="shrink-0" />
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        {children}
      </main>
    </div>
  )
}
