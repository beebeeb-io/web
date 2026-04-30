import { useState, useEffect } from 'react'
import { DriveLayout } from '../components/drive-layout'
import { Icon } from '../components/icons'
import type { IconName } from '../components/icons'
import { BBChip } from '../components/bb-chip'
import { BBButton } from '../components/bb-button'
import { BBToggle } from '../components/bb-toggle'
import { ChangePasswordDialog } from '../components/change-password-dialog'
import { useToast } from '../components/toast'
import { listSessions, revokeSession, type Session } from '../lib/api'

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

/* ── Main security page ──────────────────────────── */

const checklist = [
  { ok: true, label: 'Recovery phrase saved', hint: 'Last confirmed 14 Apr 2026' },
  { ok: true, label: 'Strong master password', hint: '24 chars · entropy 142 bits' },
  { ok: true, label: 'Two-factor authentication', hint: 'Authenticator app' },
  { ok: false, label: 'Add a passkey', hint: 'Replace your password entirely' },
  { ok: false, label: 'Set up a trusted contact', hint: 'Optional recovery helper' },
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
  const [eventFilter, setEventFilter] = useState<EventFilter>('All')
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const [sessions, setSessions] = useState<Session[]>([])
  const { showToast } = useToast()

  useEffect(() => {
    listSessions().then((data) => setSessions(data.sessions)).catch(() => {})
  }, [])

  async function handleRevokeSession(id: string) {
    if (!confirm('Revoke this session? The device will be signed out.')) return
    try {
      await revokeSession(id)
      setSessions((prev) => prev.filter((s) => s.id !== id))
      showToast({ icon: 'check', title: 'Session revoked' })
    } catch {
      showToast({ icon: 'x', title: 'Failed to revoke', danger: true })
    }
  }

  return (
    <DriveLayout>
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
                  <BBButton size="sm" onClick={() => setChangePasswordOpen(true)}>Change password</BBButton>
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

            {/* ── Active sessions ─────────────────── */}
            <div className="bg-paper border border-line-2 rounded-xl overflow-hidden shrink-0">
              <div className="flex items-center gap-2 px-4 py-3.5 border-b border-line">
                <Icon name="cloud" size={14} />
                <span className="text-sm font-semibold text-ink">Active sessions</span>
                <span className="font-mono text-[11px] text-ink-4">{sessions.length} active</span>
              </div>
              {sessions.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-ink-3">Loading sessions...</div>
              ) : sessions.map((s, i) => (
                <div
                  key={s.id}
                  className={`grid items-center gap-3.5 px-4 py-3 ${
                    i < sessions.length - 1 ? 'border-b border-line' : ''
                  }`}
                  style={{ gridTemplateColumns: '28px 1fr 140px 80px' }}
                >
                  <div
                    className="w-7 h-7 rounded-md flex items-center justify-center border"
                    style={{
                      background: s.is_current ? 'var(--color-ink)' : 'var(--color-paper-2)',
                      borderColor: s.is_current ? 'var(--color-ink)' : 'var(--color-line)',
                      color: s.is_current ? 'var(--color-amber)' : 'var(--color-ink-3)',
                    }}
                  >
                    <Icon name="lock" size={13} />
                  </div>
                  <div>
                    <div className="text-[13px] font-medium text-ink flex items-center gap-1.5">
                      Session
                      {s.is_current && <BBChip variant="amber">Current</BBChip>}
                    </div>
                    <div className="text-[11px] font-mono text-ink-3 mt-px">
                      Created {new Date(s.created_at).toLocaleDateString()} · expires {new Date(s.expires_at).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="font-mono text-[11px]" style={{ color: s.is_current ? 'oklch(0.45 0.12 155)' : 'var(--color-ink-3)' }}>
                    {s.is_current ? 'Active now' : new Date(s.created_at).toLocaleDateString()}
                  </div>
                  <div className="flex justify-end">
                    {!s.is_current && (
                      <BBButton size="sm" variant="danger" onClick={() => handleRevokeSession(s.id)}>
                        Revoke
                      </BBButton>
                    )}
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

        {/* Change password dialog */}
        <ChangePasswordDialog
          open={changePasswordOpen}
          onClose={() => setChangePasswordOpen(false)}
          onSuccess={() => {
            showToast({ icon: 'check', title: 'Password changed', description: 'All other sessions have been signed out' })
          }}
        />
    </DriveLayout>
  )
}
