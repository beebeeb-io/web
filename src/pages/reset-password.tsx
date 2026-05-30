import { Link } from 'react-router-dom'
import { AuthShell } from '../components/auth-shell'
import { BBButton } from '@beebeeb/shared'

// Password reset is intentionally disabled. Beebeeb is zero-knowledge: a
// server-side password reset cannot rewrap the user's encrypted vault, so it
// would silently orphan their data. The only safe recovery is the recovery
// phrase. The server endpoint now returns 410 Gone; this page steers anyone
// who opens an old reset link to recover-with-phrase. (Track 2 B1.)
export function ResetPassword() {
  return (
    <AuthShell
      title="Password reset isn't available"
      subtitle="Beebeeb encrypts your files with keys only you hold — we can't reset your password without losing access to your vault."
    >
      <div className="flex items-start gap-2.5 p-3 mb-4 bg-amber-bg border border-amber/20 rounded-md">
        <p className="text-xs text-ink-2 leading-relaxed">
          If you&apos;ve lost access, recover your account with your recovery
          phrase. It re-derives your keys and lets you set a new password
          without ever exposing your files to us.
        </p>
      </div>

      <Link to="/recover-with-phrase">
        <BBButton variant="amber" size="lg" className="w-full justify-center">
          Recover with your phrase
        </BBButton>
      </Link>

      <div className="text-center mt-4">
        <Link to="/login" className="text-[12px] text-ink-3 hover:text-ink-2 transition-colors">
          Back to sign in
        </Link>
      </div>
    </AuthShell>
  )
}
