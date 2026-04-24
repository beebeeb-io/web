import { Icon } from '../../components/icons'
import type { IconName } from '../../components/icons'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { AdminShell } from './admin-shell'

/* ── Framework tile ──────────────────────────────── */

type FrameworkStatus = 'ok' | 'warn' | 'fail'

function toneForStatus(status: FrameworkStatus) {
  if (status === 'ok') return { fg: 'oklch(0.45 0.12 155)', bg: 'oklch(0.94 0.06 155)' }
  if (status === 'warn') return { fg: 'var(--color-amber-deep)', bg: 'var(--color-amber-bg)' }
  return { fg: 'var(--color-red)', bg: 'oklch(0.97 0.03 25)' }
}

function FrameworkTile({ framework, icon, score, status, controls }: {
  framework: string
  icon: IconName
  score: number
  status: FrameworkStatus
  controls: number
}) {
  const tone = toneForStatus(status)
  return (
    <div className="p-4 rounded-xl bg-paper border border-line-2">
      <div className="flex items-start gap-3 mb-3">
        <div
          className="w-[30px] h-[30px] rounded-lg shrink-0 flex items-center justify-center border"
          style={{ background: tone.bg, color: tone.fg, borderColor: tone.fg }}
        >
          <Icon name={icon} size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold">{framework}</div>
          <div className="text-[10px] text-ink-3 mt-0.5">{controls} controls mapped</div>
        </div>
        <div className="font-mono text-base font-bold" style={{ color: tone.fg }}>
          {score}%
        </div>
      </div>
      <div className="w-full h-1.5 rounded-full bg-paper-3 mb-2">
        <div className="h-full rounded-full" style={{ width: `${score}%`, background: tone.fg }} />
      </div>
      <div className="flex items-center gap-1 text-[11px] text-ink-3">
        <Icon name="check" size={10} style={{ color: tone.fg }} />
        Last audit 3 Apr &middot; next 6 Jul
      </div>
    </div>
  )
}

/* ── Audit event row ─────────────────────────────── */

interface ComplianceEvent {
  actor: string
  action: string
  target: string
  when: string
  sev: 'ok' | 'warn' | 'info'
}

const events: ComplianceEvent[] = [
  { actor: 'anna@example.eu', action: 'Exported audit log', target: 'Apr 2026 · signed PDF', when: '4m ago', sev: 'info' },
  { actor: 'system', action: 'Sub-processor review completed', target: 'Hetzner Online GmbH', when: '2h ago', sev: 'ok' },
  { actor: 'marc@example.eu', action: 'Invited external viewer', target: 'Q2-financials · 24h expiry', when: '5h ago', sev: 'info' },
  { actor: 'system', action: 'Key rotation completed', target: 'Acme Studio vault · 128 files re-encrypted', when: 'yesterday', sev: 'ok' },
  { actor: 'anna@example.eu', action: 'Access request denied', target: 'jordan@example.eu · not on DPA', when: '2d ago', sev: 'warn' },
  { actor: 'system', action: 'Warrant canary updated', target: '22 Apr 2026 statement published', when: '3d ago', sev: 'info' },
]

function sevColor(sev: string): string {
  if (sev === 'ok') return 'oklch(0.55 0.12 155)'
  if (sev === 'warn') return 'var(--color-amber-deep)'
  return 'var(--color-ink-3)'
}

/* ── Sub-processors ──────────────────────────────── */

const subProcessors = [
  ['Hetzner Online GmbH', 'Object storage', 'DE', '2h ago'],
  ['Leaseweb B.V.', 'Object storage', 'NL', '6d ago'],
  ['Scaleway SAS', 'Object storage', 'FR', '6d ago'],
  ['Stripe Payments Europe', 'Billing', 'IE', '11d ago'],
]

/* ── Data residency nodes ────────────────────────── */

const dataNodes = [
  { city: 'Frankfurt · DE', size: '4.48 TB', operator: 'Hetzner', x: 190, y: 95, pct: 72 },
  { city: 'Amsterdam · NL', size: '1.37 TB', operator: 'Leaseweb', x: 160, y: 80, pct: 22 },
  { city: 'Paris · FR', size: '0.37 TB', operator: 'Scaleway', x: 140, y: 115, pct: 6 },
]

/* ── Access requests ─────────────────────────────── */

const accessRequests = [
  { who: 'data-subject@example.eu', type: 'Art. 15 · access', due: '4 days', priority: true },
  { who: 'former-client@law.eu', type: 'Art. 17 · erasure', due: '11 days', priority: false },
  { who: 'contractor@design.nl', type: 'Art. 20 · portability', due: '18 days', priority: false },
]

/* ── Main page ───────────────────────────────────── */

export function Compliance() {
  return (
    <AdminShell activeSection="compliance">
      {/* Header */}
      <div className="flex items-center gap-3 px-6 py-3.5 border-b border-line">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-ink">Compliance overview</h2>
            <BBChip variant="green">Posture strong</BBChip>
          </div>
          <div className="text-[10px] text-ink-3 mt-0.5">
            Acme Studio B.V. &middot; 8 seats &middot; live status across 4 frameworks
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <BBButton size="sm">
            <Icon name="download" size={12} className="mr-1.5" />
            Evidence bundle
          </BBButton>
          <BBButton size="sm" variant="amber">
            <Icon name="file" size={12} className="mr-1.5" />
            Export compliance PDF
          </BBButton>
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-6 py-5 flex flex-col gap-4">
        {/* Framework tiles */}
        <div className="grid grid-cols-4 gap-3">
          <FrameworkTile framework="GDPR" icon="shield" score={100} status="ok" controls={47} />
          <FrameworkTile framework="NIS2" icon="lock" score={92} status="ok" controls={32} />
          <FrameworkTile framework="DORA" icon="cloud" score={88} status="warn" controls={24} />
          <FrameworkTile framework="ISO 27001" icon="key" score={95} status="ok" controls={114} />
        </div>

        {/* Data residency + Access requests */}
        <div className="grid gap-3" style={{ gridTemplateColumns: '1.3fr 1fr' }}>
          {/* Data residency map */}
          <div className="rounded-xl bg-paper border border-line-2 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
              <Icon name="cloud" size={13} />
              <span className="text-[13px] font-semibold">Where your data lives --- right now</span>
              <BBButton size="sm" variant="ghost" className="ml-auto">Change residency</BBButton>
            </div>
            {/* Abstract EU map */}
            <div className="relative h-[220px] bg-paper-2 border-b border-line overflow-hidden">
              <svg viewBox="0 0 400 220" className="absolute inset-0 w-full h-full">
                <path
                  d="M60 80 Q 80 40 130 50 Q 180 30 230 60 Q 290 40 330 80 Q 350 120 320 160 Q 280 190 220 180 Q 160 200 110 180 Q 70 160 60 120 Z"
                  fill="oklch(0.96 0.012 82)" stroke="var(--color-line-2)" strokeWidth="1"
                />
                {dataNodes.map((n, i) => (
                  <g key={i}>
                    <circle cx={n.x} cy={n.y} r="16" fill="var(--color-amber-bg)" opacity="0.6" />
                    <circle cx={n.x} cy={n.y} r="8" fill="var(--color-amber)" stroke="var(--color-ink)" strokeWidth="1.3" />
                    <circle cx={n.x} cy={n.y} r="3" fill="var(--color-ink)" />
                    <text x={n.x} y={n.y - 22} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="9" fill="var(--color-ink-2)" fontWeight="600">{n.city.split(' ')[0]}</text>
                    <text x={n.x} y={n.y + 28} textAnchor="middle" fontFamily="ui-monospace, monospace" fontSize="10" fill="var(--color-ink)" fontWeight="700">{n.pct}%</text>
                  </g>
                ))}
              </svg>
            </div>
            <div className="grid grid-cols-3 gap-3 p-4">
              {dataNodes.map((n, i) => (
                <div key={i}>
                  <div className="text-xs font-semibold">{n.city}</div>
                  <div className="font-mono text-[11px] text-ink-2">{n.size}</div>
                  <div className="text-[10px] text-ink-4">{n.operator}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Access requests */}
          <div className="rounded-xl bg-paper border border-line-2 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
              <Icon name="users" size={13} />
              <span className="text-[13px] font-semibold">GDPR access requests</span>
              <span className="ml-auto inline-flex items-center px-sm py-xs text-[9.5px] font-medium rounded-sm bg-paper-2 border text-amber-deep" style={{ borderColor: 'oklch(0.86 0.07 90)' }}>3 open</span>
            </div>
            {accessRequests.map((r, i, arr) => (
              <div
                key={i}
                className={`flex items-center gap-2.5 px-4 py-3 ${
                  i < arr.length - 1 ? 'border-b border-line' : ''
                }`}
              >
                <div className="flex-1 min-w-0">
                  <div className="font-mono text-[11.5px] font-medium truncate">{r.who}</div>
                  <div className="text-[10px] text-ink-3 mt-0.5">{r.type}</div>
                </div>
                <span
                  className="font-mono text-[10.5px] px-1.5 py-0.5 rounded border font-semibold"
                  style={{
                    background: r.priority ? 'var(--color-amber-bg)' : 'var(--color-paper-2)',
                    color: r.priority ? 'var(--color-amber-deep)' : 'var(--color-ink-3)',
                    borderColor: r.priority ? 'oklch(0.86 0.07 90)' : 'var(--color-line)',
                  }}
                >
                  {r.due}
                </span>
              </div>
            ))}
            <div className="py-2.5 text-center border-t border-line bg-paper-2">
              <span className="text-xs text-amber-deep font-medium cursor-pointer">
                Handle requests &rarr;
              </span>
            </div>
          </div>
        </div>

        {/* Sub-processors */}
        <div className="rounded-xl bg-paper border border-line-2 overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
            <Icon name="link" size={13} />
            <span className="text-[13px] font-semibold">Sub-processors</span>
            <span className="font-mono text-[11px] text-ink-4">4 active &middot; all EU</span>
            <BBButton size="sm" variant="ghost" className="ml-auto">
              <Icon name="download" size={11} className="mr-1.5" />
              Download list
            </BBButton>
          </div>
          <div
            className="grid gap-3.5 px-4 py-2.5 border-b border-line bg-paper-2"
            style={{ gridTemplateColumns: '1.4fr 1fr 1fr 1fr 90px' }}
          >
            {['Vendor', 'Purpose', 'Jurisdiction', 'Last review', ''].map(h => (
              <span key={h} className="text-[10px] font-semibold uppercase tracking-wider text-ink-3">{h}</span>
            ))}
          </div>
          {subProcessors.map((r, i, arr) => (
            <div
              key={i}
              className={`grid gap-3.5 px-4 py-3 items-center ${
                i < arr.length - 1 ? 'border-b border-line' : ''
              }`}
              style={{ gridTemplateColumns: '1.4fr 1fr 1fr 1fr 90px' }}
            >
              <span className="text-[12.5px] font-medium">{r[0]}</span>
              <span className="text-[10px] text-ink-2">{r[1]}</span>
              <span className="font-mono text-[11px]">{r[2]}</span>
              <span className="font-mono text-[11px] text-ink-3">{r[3]}</span>
              <div className="flex justify-end">
                <BBChip variant="green" className="text-[9.5px]">Signed DPA</BBChip>
              </div>
            </div>
          ))}
        </div>

        {/* Audit log + Warrant canary */}
        <div className="grid gap-3" style={{ gridTemplateColumns: '1.5fr 1fr' }}>
          {/* Mini audit log */}
          <div className="rounded-xl bg-paper border border-line-2 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-3 border-b border-line">
              <Icon name="clock" size={13} />
              <span className="text-[13px] font-semibold">Audit log &middot; live</span>
              <BBButton size="sm" variant="ghost" className="ml-auto">
                <Icon name="download" size={11} className="mr-1.5" />
                Signed export
              </BBButton>
            </div>
            {events.map((e, i, arr) => (
              <div
                key={i}
                className={`flex items-center gap-2.5 px-4 py-2.5 ${
                  i < arr.length - 1 ? 'border-b border-line' : ''
                }`}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: sevColor(e.sev) }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px]">
                    <span className="font-mono text-[11px] text-ink-3">{e.actor}</span>{' '}
                    <span className="font-medium">{e.action}</span>
                  </div>
                  <div className="text-[10px] text-ink-3 mt-0.5">{e.target}</div>
                </div>
                <span className="font-mono text-[10.5px] text-ink-4">{e.when}</span>
              </div>
            ))}
          </div>

          {/* Warrant canary */}
          <div
            className="rounded-xl p-4 border overflow-hidden"
            style={{ background: 'var(--color-ink)', borderColor: 'var(--color-ink)', color: 'var(--color-paper)' }}
          >
            <div className="flex items-center gap-2 mb-2.5">
              <Icon name="shield" size={13} style={{ color: 'var(--color-amber)' }} />
              <span className="text-[13px] font-semibold" style={{ color: 'var(--color-paper)' }}>
                Warrant canary
              </span>
              <span className="ml-auto inline-flex items-center px-sm py-xs text-[9.5px] font-medium rounded-sm" style={{ background: 'oklch(0.22 0.01 80)', color: 'var(--color-amber)', borderColor: 'oklch(0.28 0.01 80)' }}>
                Alive
              </span>
            </div>
            <div className="text-xs leading-relaxed mb-3" style={{ opacity: 0.78 }}>
              As of 22 April 2026, Beebeeb (operated by Initlabs B.V., KvK 95157565) has received{' '}
              <strong style={{ color: 'var(--color-amber)' }}>zero</strong>{' '}
              gag orders, national security letters, or secret production requests.
            </div>
            <div
              className="p-2.5 rounded-md font-mono text-[10px] leading-relaxed break-all"
              style={{ background: 'oklch(0.22 0.01 80)', border: '1px solid oklch(0.28 0.01 80)', color: 'oklch(0.8 0.02 82)' }}
            >
              sha256 &middot; 4f9e...a20b<br />
              signed &middot; 22 Apr 2026 09:00 UTC<br />
              notaries &middot; 3 / 3
            </div>
            <BBButton
              size="sm"
              variant="ghost"
              className="mt-2.5"
              style={{ color: 'var(--color-amber)', borderColor: 'oklch(0.3 0.01 80)' }}
            >
              View signed statement &rarr;
            </BBButton>
          </div>
        </div>

        {/* DPA banner */}
        <div className="flex items-center gap-3.5 p-4 rounded-xl bg-paper border border-line-2">
          <Icon name="file" size={14} className="text-amber-deep shrink-0" />
          <div className="flex-1">
            <div className="text-[13px] font-semibold">DPA signed &middot; v2.3</div>
            <div className="text-[10px] text-ink-3">
              Executed 6 May 2025 &middot; Anna Kovac (Acme Studio) &middot; Bram Langelaar, CEO (Beebeeb)
            </div>
          </div>
          <BBButton size="sm" variant="ghost">
            <Icon name="download" size={11} className="mr-1.5" />
            Download
          </BBButton>
          <BBButton size="sm" variant="ghost">View history</BBButton>
        </div>
      </div>
    </AdminShell>
  )
}
