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

// ─── Share Card ───────────────────────────────────────────────────────────────

function ShareCard({ share }: { share: PublicProfileShare }) {
  return (
    <a
      href={`/s/${share.token}`}
      className="group flex flex-col gap-3 rounded-xl border border-line bg-paper p-4 hover:border-amber/40 hover:shadow-1 transition-all"
      aria-label="Open shared file"
    >
      {/* File icon area */}
      <div className="w-10 h-10 rounded-lg bg-amber-bg border border-amber/20 flex items-center justify-center shrink-0">
        <Icon name="lock" size={18} className="text-amber-deep" />
      </div>

      {/* Meta */}
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[13px] font-semibold text-ink group-hover:text-amber-deep transition-colors truncate">
          Shared file
        </span>
        <div className="flex items-center gap-2 flex-wrap">
          {share.file_size != null && share.file_size > 0 && (
            <span className="font-mono text-[11px] text-ink-3">
              {formatBytes(share.file_size)}
            </span>
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

      {/* Arrow */}
      <div className="mt-auto flex items-center gap-1 text-[11px] text-ink-4 group-hover:text-amber-deep transition-colors">
        <span>Open</span>
        <Icon name="chevron-right" size={10} />
      </div>
    </a>
  )
}

// ─── E2E Banner ───────────────────────────────────────────────────────────────

function E2EBanner() {
  return (
    <div className="rounded-xl border border-amber/30 bg-amber-bg px-4 py-3 flex items-start gap-3 mb-6">
      <div className="w-0.5 self-stretch bg-amber-deep rounded-full shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <Icon name="lock" size={12} className="text-amber-deep shrink-0" />
          <span className="text-[13px] font-semibold text-ink">
            Secured by Beebeeb
          </span>
        </div>
        <p className="text-[12px] text-ink-2 leading-relaxed">
          End-to-end encrypted. Files are decrypted in your browser — Beebeeb cannot read them.
        </p>
      </div>
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
        if (e && typeof e === 'object' && 'status' in e && (e as { status: number }).status === 404) {
          setNotFound(true)
        } else {
          setError(e instanceof Error ? e.message : 'Failed to load profile')
        }
      })
      .finally(() => setLoading(false))
  }, [username])

  return (
    <div className="min-h-screen bg-paper-2 flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-paper border-b border-line px-4 py-3 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2">
          <BBLogo />
        </Link>
        <Link
          to="/signup"
          className="text-[12.5px] text-amber-deep font-semibold hover:underline underline-offset-2"
        >
          Get Beebeeb
        </Link>
      </header>

      <main id="main-content" className="flex-1 max-w-2xl w-full mx-auto px-4 py-8">
        {loading && (
          <div className="flex items-center justify-center py-24">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-amber" />
          </div>
        )}

        {notFound && (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <div className="w-12 h-12 rounded-full bg-paper-3 border border-line flex items-center justify-center mb-2">
              <Icon name="users" size={20} className="text-ink-4" />
            </div>
            <p className="text-[15px] font-semibold text-ink">Profile not found</p>
            <p className="text-[13px] text-ink-3 max-w-xs">
              This profile doesn't exist or the username may have changed.
            </p>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <div className="w-12 h-12 rounded-full bg-red/5 border border-red/20 flex items-center justify-center mb-2">
              <Icon name="x" size={20} className="text-red" />
            </div>
            <p className="text-[15px] font-semibold text-ink">Something went wrong</p>
            <p className="text-[13px] text-ink-3 max-w-xs">{error}</p>
          </div>
        )}

        {profile && (
          <>
            {/* Profile header */}
            <div className="flex items-center gap-4 mb-6">
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center text-paper text-[22px] font-semibold shrink-0"
                style={{ background: 'linear-gradient(135deg, oklch(0.8 0.15 82), oklch(0.6 0.14 50))' }}
                aria-hidden="true"
              >
                {profile.username.slice(0, 2).toUpperCase()}
              </div>
              <div className="min-w-0">
                {profile.display_name && (
                  <h1 className="text-[20px] font-bold text-ink truncate">
                    {profile.display_name}
                  </h1>
                )}
                <p className="text-[13px] text-ink-3 font-mono">
                  @{profile.username}
                </p>
              </div>
            </div>

            <E2EBanner />

            {/* Shared files */}
            <section aria-label="Shared files">
              <h2 className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 mb-3">
                Shared files
              </h2>

              {profile.shares.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center rounded-xl border border-line bg-paper">
                  <div className="w-10 h-10 rounded-lg bg-paper-3 border border-line flex items-center justify-center mb-1">
                    <Icon name="lock" size={18} className="text-ink-4" />
                  </div>
                  <p className="text-[14px] font-medium text-ink-2">No public files yet</p>
                  <p className="text-[12px] text-ink-4 max-w-xs">
                    This user hasn't shared any files publicly.
                  </p>
                </div>
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
      <footer className="border-t border-line px-4 py-4 text-center">
        <p className="text-[11px] text-ink-4">
          Stored in Falkenstein. Hetzner. Operated by{' '}
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
