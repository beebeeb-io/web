import {
  BBButton,} from '@beebeeb/shared'
import {
  Icon,} from '@beebeeb/shared'

// ── Provider card ─────────────────────────────────────────────────────────────

export function ProviderCard({
  name, logo, status, onConnect, disabled, comingSoon, usDisclosure,
}: {
  name: string
  logo: React.ReactNode
  status: 'disconnected' | 'connecting' | 'connected'
  onConnect?: () => void
  disabled?: boolean
  comingSoon?: boolean
  usDisclosure?: string
}) {
  return (
    <div className={`rounded-xl border p-5 bg-paper flex flex-col gap-4 ${
      disabled ? 'border-line opacity-60' : 'border-line hover:border-line-2 transition-colors'
    }`}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-paper-2 border border-line flex items-center justify-center shrink-0">
          {logo}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13.5px] font-semibold text-ink">{name}</div>
          {comingSoon && <div className="text-[11px] text-ink-4">Coming soon</div>}
          {!comingSoon && status === 'connected' && <div className="text-[11px] text-green font-medium">Connected</div>}
          {!comingSoon && status === 'disconnected' && <div className="text-[11px] text-ink-3">Not connected</div>}
        </div>
      </div>

      {!comingSoon && (
        <BBButton size="sm" variant={status === 'connected' ? 'default' : 'amber'}
          onClick={onConnect} disabled={disabled || status === 'connecting'} className="gap-1.5">
          {status === 'connecting' ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              Connecting…
            </>
          ) : status === 'connected' ? (
            <><Icon name="check" size={12} /> Connected</>
          ) : (
            <><Icon name="link" size={12} /> Connect {name}</>
          )}
        </BBButton>
      )}

      {!comingSoon && usDisclosure && (
        <p className="text-[11px] text-ink-4 leading-relaxed">{usDisclosure}</p>
      )}

      {comingSoon && (
        <BBButton size="sm" variant="default" disabled className="gap-1.5">
          <Icon name="clock" size={12} />
          Coming soon
        </BBButton>
      )}
    </div>
  )
}

// ── Logos ─────────────────────────────────────────────────────────────────────

export const DropboxLogo = () => (
  <svg width="22" height="20" viewBox="0 0 40 33" fill="none">
    <path d="M10 0L0 6.5l10 6.5 10-6.5L10 0Z" fill="#0061FF"/>
    <path d="M30 0L20 6.5l10 6.5 10-6.5L30 0Z" fill="#0061FF"/>
    <path d="M0 19.5L10 26l10-6.5L10 13l-10 6.5Z" fill="#0061FF"/>
    <path d="M20 19.5L30 26l10-6.5L30 13l-10 6.5Z" fill="#0061FF"/>
    <path d="M10 27.77L20 34l10-6.23V24l-10 6.23L10 24v3.77Z" fill="#0061FF"/>
  </svg>
)

export const GoogleDriveLogo = () => (
  <svg width="22" height="20" viewBox="0 0 87.3 78" fill="none">
    <path d="M6.6 66.85l3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8H0a15.92 15.92 0 001.88 7.9z" fill="#0066DA"/>
    <path d="M43.65 25L29.9 1.2a9.45 9.45 0 00-3.3 3.3L1.89 48.1A15.92 15.92 0 000 56h27.5z" fill="#00AC47"/>
    <path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25A15.92 15.92 0 0087.3 50H59.8l5.85 12.35z" fill="#EA4335"/>
    <path d="M43.65 25L57.4 1.2C56.05.43 54.55 0 52.95 0H34.35c-1.6 0-3.1.43-4.45 1.2z" fill="#00832D"/>
    <path d="M59.8 50H27.5L13.75 73.8c1.35.77 2.85 1.2 4.45 1.2h50.5c1.6 0 3.1-.43 4.45-1.2z" fill="#2684FC"/>
    <path d="M73.4 26.15l-13.3-23.05a9.45 9.45 0 00-2.7-1.9L43.65 25 59.8 50h27.45a15.92 15.92 0 00-1.88-7.9z" fill="#FFBA00"/>
  </svg>
)
