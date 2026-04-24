import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { BBChip } from '../components/bb-chip'
import { BBButton } from '../components/bb-button'
import { BBToggle } from '../components/bb-toggle'

/* ── Score ring SVG ──────────────────────────────── */

function SecurityScoreRing({ score = 82 }: { score?: number }) {
  const r = 28
  const c = 2 * Math.PI * r
  const offset = c - (score / 100) * c
  return (
    <div className="relative shrink-0" style={{ width: 68, height: 68 }}>
      <svg width="68" height="68" viewBox="0 0 68 68">
        <circle cx="34" cy="34" r={r} fill="none" stroke="var(--color-paper-3)" strokeWidth="5" />
        <circle
          cx="34" cy="34" r={r}
          fill="none" stroke="var(--color-amber)" strokeWidth="5"
          strokeDasharray={c} strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 34 34)"
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center font-mono text-[15px] font-semibold"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {score}
      </div>
    </div>
  )
}

/* ── Sidebar nav item ────────────────────────────── */

function SideNavItem({ icon, label, active, badge, href }: {
  icon: IconName
  label: string
  active?: boolean
  badge?: string
  href: string
}) {
  return (
    <Link
      to={href}
      className={`flex items-center gap-2.5 px-2.5 py-[7px] rounded-md text-[13px] transition-colors ${
        active
          ? 'bg-paper font-medium text-ink shadow-1'
          : 'text-ink-2 hover:bg-paper hover:text-ink'
      }`}
    >
      <Icon name={icon} size={13} className={active ? 'text-ink' : 'text-ink-3'} />
      <span className="flex-1">{label}</span>
      {badge && (
        <span className={`font-mono text-[10px] ${active ? 'text-amber' : 'text-ink-4'}`}>{badge}</span>
      )}
    </Link>
  )
}

/* ── Main security page ──────────────────────────── */

const checklist = [
  { ok: true, label: 'Recovery phrase saved', hint: 'Last confirmed 14 Apr 2026' },
  { ok: true, label: 'Strong master password', hint: '24 chars · entropy 142 bits' },
  { ok: true, label: 'Two-factor authentication', hint: 'Authenticator app' },
  { ok: false, label: 'Add a passkey', hint: 'Replace your password entirely' },
  { ok: false, label: 'Set up a trusted contact', hint: 'Optional recovery helper' },
]

const trustedDevices = [
  { name: 'MacBook Pro', os: 'macOS 15.3 · Safari', loc: 'Amsterdam, NL', when: 'Active now', current: true, icon: 'cloud' as IconName, stale: false },
  { name: 'iPhone 15', os: 'iOS 18.4', loc: 'Amsterdam, NL', when: '12 min ago', current: false, icon: 'image' as IconName, stale: false },
  { name: 'Workstation', os: 'Fedora 41 · Desktop app', loc: 'Amsterdam, NL', when: '3 hours ago', current: false, icon: 'settings' as IconName, stale: false },
  { name: 'Old laptop', os: 'Windows 11 · Chrome', loc: 'Berlin, DE', when: 'Apr 2 · 14d ago', current: false, icon: 'file' as IconName, stale: true },
]

const securityEvents = [
  { icon: 'key' as IconName, label: 'Recovery phrase viewed', meta: 'From MacBook Pro · Amsterdam', when: '2m ago', tone: 'amber' as const },
  { icon: 'shield' as IconName, label: 'New sign-in approved', meta: 'iPhone 15 · passkey', when: '12m ago', tone: 'ink' as const },
  { icon: 'share' as IconName, label: 'Link shared with 3 viewers', meta: 'term-sheet-v3.docx · 24h expiry', when: '1h ago', tone: 'ink' as const },
  { icon: 'lock' as IconName, label: 'Team key rotated', meta: 'Acme Studio · re-encrypted 128 files', when: 'yesterday', tone: 'green' as const },
  { icon: 'users' as IconName, label: 'Member removed', meta: 'jordan@example.eu · access revoked', when: '3d ago', tone: 'red' as const },
]

const signInMethods = [
  { title: 'Passkey · MacBook Pro', subtitle: 'Added 3 Apr · Platform authenticator', icon: 'key' as IconName, on: true, cta: false, disabled: false },
  { title: 'Authenticator app', subtitle: 'Backup codes downloaded', icon: 'clock' as IconName, on: true, cta: false, disabled: false },
  { title: 'Hardware key (YubiKey)', subtitle: 'Recommended for admins', icon: 'shield' as IconName, on: false, cta: true, disabled: false },
  { title: 'SMS', subtitle: 'Not recommended — disabled by policy', icon: 'more' as IconName, on: false, cta: false, disabled: true },
]

type EventFilter = 'All' | 'Sign-ins' | 'Sharing' | 'Keys'

const toneColors: Record<string, { bg: string; fg: string }> = {
  amber: { bg: 'var(--color-amber-bg)', fg: 'var(--color-amber-deep)' },
  ink: { bg: 'var(--color-paper-2)', fg: 'var(--color-ink-2)' },
  green: { bg: 'oklch(0.96 0.04 155)', fg: 'oklch(0.45 0.12 155)' },
  red: { bg: 'oklch(0.97 0.02 25)', fg: 'var(--color-red)' },
}

export function Security() {
  const location = useLocation()
  const [eventFilter, setEventFilter] = useState<EventFilter>('All')

  return (
    <div className="min-h-screen flex items-start justify-center bg-paper p-xl pt-12">
      <div
        className="flex overflow-hidden border border-line-2 rounded-xl shadow-2 bg-paper"
        style={{ width: 1040, height: 760 }}
      >
        {/* ── Sidebar ───────────────────────────── */}
        <div className="w-[220px] shrink-0 bg-paper-2 border-r border-line flex flex-col">
          <div className="flex items-center gap-2 px-4 pt-4 pb-3">
            <Icon name="settings" size={13} className="text-ink-3" />
            <span className="text-sm font-semibold text-ink">Settings</span>
          </div>
          <nav className="px-3 py-1.5">
            <SideNavItem icon="users" label="Account" href="/settings/profile" />
            <SideNavItem icon="shield" label="Security" active={location.pathname === '/security'} badge="!" href="/security" />
            <SideNavItem icon="key" label="Passkeys & 2FA" href="/security" />
            <SideNavItem icon="cloud" label="Devices" badge="4" href="/settings/devices" />
            <SideNavItem icon="clock" label="Activity" href="/security" />
            <SideNavItem icon="download" label="Data export" href="/security" />
          </nav>
          <div className="mx-4 my-2.5 border-t border-line" />
          <div className="px-3">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 px-2.5 pb-2">Workspace</div>
            <SideNavItem icon="folder" label="Storage & plan" href="/settings/profile" />
            <SideNavItem icon="users" label="Team" href="/settings/profile" />
            <SideNavItem icon="share" label="Sharing defaults" href="/settings/profile" />
          </div>
          <div className="mt-auto p-4 border-t border-line">
            <div className="flex items-center gap-2 text-[11px] text-ink-3">
              <span className="inline-block w-2 h-2 rounded-full bg-green" />
              <span className="font-mono">Frankfurt</span>
            </div>
          </div>
        </div>

        {/* ── Main content ──────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center gap-3 px-6 py-3.5 border-b border-line">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold text-ink">Security</h2>
                <BBChip variant="amber">
                  <Icon name="shield" size={10} className="mr-1" />
                  Zero-knowledge
                </BBChip>
              </div>
              <p className="text-[11px] text-ink-3 mt-0.5">
                What we can see, reset, or recover on your behalf: nothing. Here is what you can do.
              </p>
            </div>
            <div className="ml-auto">
              <BBButton size="sm" variant="ghost">
                <Icon name="download" size={12} className="mr-1.5" />
                Export audit log
              </BBButton>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-5">

            {/* ── Security score card ────────────── */}
            <div className="grid items-center gap-4.5 p-4.5 bg-paper border border-line-2 rounded-xl" style={{ gridTemplateColumns: 'auto 1fr' }}>
              <SecurityScoreRing score={82} />
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-3 mb-0.5">Security posture</div>
                <div className="text-sm font-semibold text-ink mb-2.5">Strong — with two quick wins.</div>
                <div className="grid grid-cols-2 gap-x-5 gap-y-2">
                  {checklist.map((c, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span
                        className="w-3.5 h-3.5 rounded-[4px] shrink-0 mt-0.5 flex items-center justify-center border"
                        style={{
                          background: c.ok ? 'oklch(0.94 0.06 155)' : 'var(--color-paper-2)',
                          borderColor: c.ok ? 'oklch(0.85 0.09 155)' : 'var(--color-line-2)',
                          color: c.ok ? 'oklch(0.45 0.12 155)' : 'var(--color-ink-4)',
                        }}
                      >
                        <Icon name={c.ok ? 'check' : 'plus'} size={9} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className={`text-[12.5px] leading-tight ${c.ok ? 'text-ink-2' : 'text-ink font-medium'}`}>
                          {c.label}
                        </div>
                        <div className="text-[11px] text-ink-4 mt-px">{c.hint}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Recovery phrase + Master password ── */}
            <div className="grid grid-cols-2 gap-3.5">
              {/* Recovery phrase */}
              <div className="bg-paper border border-line-2 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-0.5">
                  <Icon name="key" size={14} className="text-amber-deep" />
                  <span className="text-sm font-semibold text-ink">Recovery phrase</span>
                  <span className="ml-auto">
                    <BBChip variant="amber">12 words · encrypted</BBChip>
                  </span>
                </div>
                <p className="text-[12.5px] text-ink-3 mb-2.5 leading-relaxed">
                  Stored as ciphertext. Unlocking it decrypts on <em>this device</em> with your master password — we never see the plaintext.
                </p>

                {/* Crypto chain */}
                <div className="flex items-center gap-1.5 flex-wrap px-2.5 py-2 mb-2.5 bg-paper-2 border border-line rounded-md font-mono text-[10.5px] text-ink-3">
                  <span className="text-ink-4">password</span>
                  <Icon name="chevron-right" size={9} className="text-ink-4" />
                  <span>Argon2id</span>
                  <Icon name="chevron-right" size={9} className="text-ink-4" />
                  <span>AES-256-GCM</span>
                  <Icon name="chevron-right" size={9} className="text-ink-4" />
                  <span className="text-amber-deep font-medium">plaintext · in memory only</span>
                </div>

                {/* Locked state */}
                <div
                  className="flex items-center gap-2.5 px-3 py-2.5 mb-2.5 rounded-md border border-dashed border-line-2"
                  style={{ background: 'oklch(0.99 0.008 85)' }}
                >
                  <div className="w-6.5 h-6.5 rounded-full bg-paper-2 border border-line flex items-center justify-center text-ink-3 shrink-0">
                    <Icon name="lock" size={12} />
                  </div>
                  <div className="flex-1">
                    <div className="text-xs font-medium text-ink">Locked — re-auth required</div>
                    <div className="text-[11px] text-ink-4 mt-px">Password or biometric · auto-hides after 30s</div>
                  </div>
                  <BBButton size="sm" variant="amber">
                    <Icon name="eye" size={11} className="mr-1.5" />
                    Unlock to reveal
                  </BBButton>
                </div>

                <div className="flex gap-2 mb-2.5">
                  <BBButton size="sm">
                    <Icon name="download" size={11} className="mr-1.5" />
                    Download PDF
                  </BBButton>
                  <BBButton size="sm" variant="ghost">Regenerate</BBButton>
                </div>

                <div className="flex items-center gap-1.5 text-[11.5px] text-ink-4">
                  <Icon name="clock" size={10} />
                  <span>Last confirmed 14 Apr · 8 days ago</span>
                </div>
              </div>

              {/* Master password */}
              <div className="bg-paper border border-line-2 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-0.5">
                  <Icon name="lock" size={14} className="text-ink-2" />
                  <span className="text-sm font-semibold text-ink">Master password</span>
                </div>
                <p className="text-[12.5px] text-ink-3 mb-3 leading-relaxed">
                  Used to decrypt your key bundle. Argon2id · memory-hard on your device.
                </p>

                <div className="flex items-center gap-2 px-2.5 py-2 bg-paper-2 border border-line rounded-md mb-2.5">
                  <span className="font-mono text-xs flex-1" style={{ letterSpacing: '0.15em' }}>
                    ••••••••••••••••••••••••
                  </span>
                  <BBChip variant="green">Strong</BBChip>
                </div>

                <div className="flex gap-2">
                  <BBButton size="sm">Change password</BBButton>
                  <BBButton size="sm" variant="ghost">Test strength</BBButton>
                </div>
              </div>
            </div>

            {/* ── Sign-in methods ─────────────────── */}
            <div className="bg-paper border border-line-2 rounded-xl overflow-hidden shrink-0">
              <div className="flex items-center gap-2 px-4 py-3.5 border-b border-line">
                <Icon name="shield" size={14} />
                <span className="text-sm font-semibold text-ink">Sign-in methods</span>
                <BBButton size="sm" variant="ghost" className="ml-auto">
                  <Icon name="plus" size={11} className="mr-1.5" />
                  Add method
                </BBButton>
              </div>
              {signInMethods.map((m, i) => (
                <div
                  key={i}
                  className={`flex items-center gap-3 px-4 py-3 ${
                    i < signInMethods.length - 1 ? 'border-b border-line' : ''
                  } ${m.disabled ? 'opacity-55' : ''}`}
                >
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center border"
                    style={{
                      background: m.on ? 'var(--color-amber-bg)' : 'var(--color-paper-2)',
                      borderColor: m.on ? 'oklch(0.86 0.07 90)' : 'var(--color-line)',
                      color: m.on ? 'var(--color-amber-deep)' : 'var(--color-ink-3)',
                    }}
                  >
                    <Icon name={m.icon} size={13} />
                  </div>
                  <div className="flex-1">
                    <div className="text-[13px] font-medium text-ink">{m.title}</div>
                    <div className="text-[11px] text-ink-3 mt-px">{m.subtitle}</div>
                  </div>
                  {m.cta ? (
                    <BBButton size="sm">Set up</BBButton>
                  ) : m.disabled ? (
                    <BBChip>Off</BBChip>
                  ) : (
                    <BBToggle on />
                  )}
                </div>
              ))}
            </div>

            {/* ── Trusted devices ─────────────────── */}
            <div className="bg-paper border border-line-2 rounded-xl overflow-hidden shrink-0">
              <div className="flex items-center gap-2 px-4 py-3.5 border-b border-line">
                <Icon name="cloud" size={14} />
                <span className="text-sm font-semibold text-ink">Trusted devices</span>
                <span className="font-mono text-[11px] text-ink-4">4 active</span>
                <BBButton size="sm" variant="danger" className="ml-auto">Sign out everywhere</BBButton>
              </div>
              {trustedDevices.map((d, i) => (
                <div
                  key={i}
                  className={`grid items-center gap-3.5 px-4 py-3 ${
                    i < trustedDevices.length - 1 ? 'border-b border-line' : ''
                  }`}
                  style={{ gridTemplateColumns: '28px 1fr 140px 110px 80px' }}
                >
                  <div
                    className="w-7 h-7 rounded-md flex items-center justify-center border"
                    style={{
                      background: d.stale ? 'var(--color-paper-2)' : d.current ? 'var(--color-ink)' : 'var(--color-paper-2)',
                      borderColor: d.current ? 'var(--color-ink)' : 'var(--color-line)',
                      color: d.current ? 'var(--color-amber)' : 'var(--color-ink-3)',
                    }}
                  >
                    <Icon name={d.icon} size={13} />
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-ink flex items-center gap-1.5">
                      {d.name}
                      {d.current && <BBChip variant="amber">This device</BBChip>}
                      {d.stale && (
                        <span className="inline-flex items-center px-sm py-xs text-[9.5px] font-medium rounded-sm bg-paper-2 border border-line" style={{ color: 'var(--color-red)', borderColor: 'oklch(0.85 0.08 25)' }}>
                          Idle 14d
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-ink-3 mt-px">{d.os}</div>
                  </div>
                  <div className="text-[11px] text-ink-3">{d.loc}</div>
                  <div className="font-mono text-[11px]" style={{ color: d.current ? 'oklch(0.45 0.12 155)' : 'var(--color-ink-3)' }}>
                    {d.when}
                  </div>
                  <div className="flex justify-end">
                    {!d.current && <BBButton size="sm" variant="danger">Revoke</BBButton>}
                  </div>
                </div>
              ))}
            </div>

            {/* ── Recent security events ──────────── */}
            <div className="bg-paper border border-line-2 rounded-xl overflow-hidden shrink-0">
              <div className="flex items-center gap-2 px-4 py-3.5 border-b border-line">
                <Icon name="clock" size={14} />
                <span className="text-sm font-semibold text-ink">Recent security events</span>
                <div className="ml-auto flex gap-1 p-[3px] bg-paper-2 rounded-md border border-line">
                  {(['All', 'Sign-ins', 'Sharing', 'Keys'] as const).map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => setEventFilter(tab)}
                      className={`px-2 py-[3px] rounded-[4px] text-[11.5px] cursor-pointer transition-colors ${
                        eventFilter === tab
                          ? 'bg-paper shadow-1 font-semibold text-ink'
                          : 'text-ink-3 hover:text-ink-2'
                      }`}
                    >
                      {tab}
                    </button>
                  ))}
                </div>
              </div>
              {securityEvents.map((e, i) => {
                const tone = toneColors[e.tone]
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 px-4 py-2.5 ${
                      i < securityEvents.length - 1 ? 'border-b border-line' : ''
                    }`}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: tone.bg, color: tone.fg }}
                    >
                      <Icon name={e.icon} size={12} />
                    </div>
                    <div className="flex-1">
                      <div className="text-[13px] font-medium text-ink">{e.label}</div>
                      <div className="text-[11px] text-ink-3 mt-px">{e.meta}</div>
                    </div>
                    <span className="font-mono text-[10.5px] text-ink-4">{e.when}</span>
                  </div>
                )
              })}
              <div className="py-2.5 text-center border-t border-line bg-paper-2">
                <span className="text-xs text-amber-deep font-medium cursor-pointer">
                  View full audit log →
                </span>
              </div>
            </div>

            {/* ── Data export + Danger zone ────────── */}
            <div className="grid grid-cols-2 gap-3.5">
              {/* Export */}
              <div className="bg-paper border border-line-2 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon name="download" size={14} />
                  <span className="text-sm font-semibold text-ink">Export your data</span>
                </div>
                <p className="text-[12.5px] text-ink-3 mb-3 leading-relaxed">
                  Download an encrypted archive of everything. Art. 20 GDPR — your right, our obligation.
                </p>
                <div className="flex gap-2">
                  <BBButton size="sm">Request export</BBButton>
                  <BBButton size="sm" variant="ghost">Schedule monthly</BBButton>
                </div>
              </div>

              {/* Danger zone */}
              <div
                className="rounded-xl p-4 border"
                style={{ background: 'oklch(0.99 0.008 25)', borderColor: 'oklch(0.88 0.05 25)' }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <Icon name="trash" size={14} className="text-red" />
                  <span className="text-sm font-semibold text-red">Danger zone</span>
                </div>
                <p className="text-[12.5px] text-ink-3 mb-3 leading-relaxed">
                  Delete account shreds keys irrecoverably. Files become mathematically unreadable — not even by us.
                </p>
                <div className="flex gap-2">
                  <BBButton size="sm" variant="danger">Delete account</BBButton>
                  <BBButton size="sm" variant="ghost">Transfer ownership</BBButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
