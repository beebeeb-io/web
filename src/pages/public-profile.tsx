import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { BBLogo } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { getPublicProfile, type PublicProfile, type PublicProfileShare } from '../lib/api'
import { formatBytes } from '../lib/format'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = Date.now()
  const diff = now - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

function getInitials(username: string, displayName?: string | null): string {
  const source = displayName ?? username
  const words = source.trim().split(/\s+/)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

// ─── Avatar ───────────────────────────────────────────────────────────────────

function Avatar({
  username,
  displayName,
}: {
  username: string
  displayName?: string | null
}) {
  const initials = getInitials(username, displayName)
  return (
    <div
      className="w-20 h-20 rounded-full flex items-center justify-center text-paper text-2xl font-bold shrink-0 select-none"
      style={{
        background:
          'linear-gradient(135deg, oklch(0.84 0.18 86), oklch(0.62 0.15 52))',
        boxShadow:
          '0 0 0 3px oklch(0.96 0.04 88), 0 4px 16px oklch(0.18 0.01 70 / 0.10)',
      }}
      aria-hidden="true"
    >
      {initials}
    </div>
  )
}

// ─── Secured badge ────────────────────────────────────────────────────────────

function SecuredBadge() {
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-bg border border-amber/25 text-amber-deep">
      <Icon name="lock" size={11} className="text-amber-deep shrink-0" />
      <span className="text-[11px] font-medium tracking-wide">
        Secured by Beebeeb
      </span>
    </div>
  )
}

// ─── Profile hero ─────────────────────────────────────────────────────────────

function ProfileHero({ profile }: { profile: PublicProfile }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <Avatar username={profile.username} displayName={profile.display_name} />

      <div className="flex flex-col items-center gap-1 mt-1">
        {profile.display_name && (
          <h1 className="text-[24px] font-bold text-ink tracking-tight leading-none">
            {profile.display_name}
          </h1>
        )}
        <p className="font-mono text-[13px] text-ink-3">@{profile.username}</p>
      </div>

      <SecuredBadge />
    </div>
  )
}

// ─── Share Card ───────────────────────────────────────────────────────────────

function ShareCard({ share }: { share: PublicProfileShare }) {
  return (
    <a
      href={`/s/${share.token}`}
      className="group flex flex-col gap-4 rounded-xl border border-line bg-paper p-5 hover:border-amber/50 hover:shadow-2 transition-all duration-200"
      aria-label="Open encrypted shared file"
    >
      {/* Top row: icon + lock badge on hover */}
      <div className="flex items-start justify-between">
        <div className="w-10 h-10 rounded-lg bg-amber-bg border border-amber/20 flex items-center justify-center shrink-0">
          <Icon name="file-text" size={18} className="text-amber-deep" />
        </div>
        <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
          <Icon name="lock" size={13} className="text-amber-deep" />
        </div>
      </div>

      {/* Title + meta */}
      <div className="flex flex-col gap-1.5 flex-1 min-w-0">
        <span className="text-[14px] font-semibold text-ink leading-snug">
          Encrypted file
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          {share.file_size != null && share.file_size > 0 && (
            <>
              <span className="font-mono text-[11px] text-ink-3 tabular-nums">
                {formatBytes(share.file_size)}
              </span>
              <span className="text-[11px] text-ink-4" aria-hidden="true">
                ·
              </span>
            </>
          )}
          <span className="text-[11px] text-ink-4">
            {formatRelativeDate(share.created_at)}
          </span>
        </div>
        {share.expires_at && (
          <span className="text-[11px] text-ink-4">
            Expires {formatRelativeDate(share.expires_at)}
          </span>
        )}
      </div>

      {/* Footer CTA */}
      <div className="flex items-center gap-1 text-[12px] font-medium text-ink-3 group-hover:text-amber-deep transition-colors duration-200 mt-auto pt-3 border-t border-line">
        <span>Open</span>
        <Icon name="chevron-right" size={12} />
      </div>
    </a>
  )
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyShares() {
  return (
    <div className="flex flex-col items-center gap-3 py-16 text-center rounded-xl border border-line bg-paper">
      <div className="w-12 h-12 rounded-xl bg-paper-3 border border-line flex items-center justify-center mb-1">
        <Icon name="lock" size={20} className="text-ink-4" />
      </div>
      <p className="text-[14px] font-semibold text-ink-2">No public files</p>
      <p className="text-[12px] text-ink-4 max-w-[22ch] leading-relaxed">
        This user hasn't shared any files publicly yet.
      </p>
    </div>
  )
}

// ─── State screens ────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div
      className="flex items-center justify-center py-24"
      aria-label="Loading profile"
    >
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-amber" />
    </div>
  )
}

function NotFoundState() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <div className="w-14 h-14 rounded-full bg-paper-3 border border-line flex items-center justify-center mb-2">
        <Icon name="users" size={22} className="text-ink-4" />
      </div>
      <p className="text-[16px] font-semibold text-ink">Profile not found</p>
      <p className="text-[13px] text-ink-3 max-w-[30ch] leading-relaxed">
        This profile doesn't exist or the username may have changed.
      </p>
    </div>
  )
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <div className="w-14 h-14 rounded-full bg-red/5 border border-red/20 flex items-center justify-center mb-2">
        <Icon name="x" size={22} className="text-red" />
      </div>
      <p className="text-[16px] font-semibold text-ink">Something went wrong</p>
      <p className="text-[13px] text-ink-3 max-w-[30ch] leading-relaxed">
        {message}
      </p>
    </div>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

export function PublicProfilePage() {
  const { username } = useParams<{ username: string }>()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!username) return
    setLoading(true)
    setNotFound(false)
    setError(null)
    getPublicProfile(username)
      .then(setProfile)
      .catch((e) => {
        if (
          e &&
          typeof e === 'object' &&
          'status' in e &&
          (e as { status: number }).status === 404
        ) {
          setNotFound(true)
        } else {
          setError(e instanceof Error ? e.message : 'Failed to load profile')
        }
      })
      .finally(() => setLoading(false))
  }, [username])

  return (
    <div className="min-h-screen bg-paper-2 flex flex-col">
      {/* Skip link */}
      <a href="#main-content" className="skip-to-content">
        Skip to content
      </a>

      {/* Header */}
      <header className="sticky top-0 z-10 bg-paper/90 backdrop-blur border-b border-line px-5 py-3 flex items-center justify-between">
        <Link
          to="/"
          className="flex items-center gap-2"
          aria-label="Beebeeb home"
        >
          <BBLogo />
        </Link>
        <Link
          to="/signup"
          className="text-[12.5px] text-amber-deep font-semibold hover:underline underline-offset-2 transition-opacity hover:opacity-80"
        >
          Get Beebeeb
        </Link>
      </header>

      {/* Main content */}
      <main id="main-content" className="flex-1 w-full max-w-2xl mx-auto px-4 pb-12">
        {loading && <LoadingState />}
        {notFound && <NotFoundState />}
        {error && <ErrorState message={error} />}

        {profile && (
          <>
            <ProfileHero profile={profile} />

            {/* Divider */}
            <div className="border-t border-line mb-8" />

            {/* Shared files section */}
            <section aria-label="Shared files">
              <h2 className="text-[10.5px] font-semibold uppercase tracking-widest text-ink-4 mb-4">
                Shared files
              </h2>

              {profile.shares.length === 0 ? (
                <EmptyShares />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {profile.shares.map((share) => (
                    <ShareCard key={share.token} share={share} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-line px-5 py-5 text-center space-y-1">
        <p className="text-[11px] text-ink-4 leading-relaxed">
          End-to-end encrypted · EU servers · Zero-knowledge
        </p>
        <p className="text-[11px] text-ink-4">
          Operated by{' '}
          <a
            href="https://beebeeb.io"
            className="text-amber-deep hover:underline underline-offset-2"
          >
            Initlabs B.V.
          </a>
          , Wijchen, Netherlands.
        </p>
      </footer>
    </div>
  )
}
