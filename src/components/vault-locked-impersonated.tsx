import { AuthShell } from './auth-shell'
import { Icon } from '@beebeeb/shared'

/**
 * Task 1693 (Part B) — the honest locked state for impersonated sessions.
 *
 * Ruling D-2026-10-02 (Guus, option A): an impersonated session shows the
 * vault exactly like iOS — an explicit "Vault locked" state, everything else
 * unchanged. Under zero-knowledge the admin's support session has no key
 * material for the target account (the server never sees it either), so
 * there is deliberately NO password form here: `VaultUnlock`'s submit calls
 * `unlockVault(password, target_user_id)`, which would attack the wrong
 * vault for the wrong account. This surface is metadata-only and honest:
 * it names the state, explains why, and points the admin at their own
 * session for anything vault-protected.
 *
 * The impersonation banner (ImpersonationBanner, mounted once in App) stays
 * responsible for the red support-view strip — this is the ONE explicit
 * vault state, not another toast (ruling: one explicit state, no more
 * toasts). Amber is reserved for encryption state/primary actions; this
 * state is neutral ink on paper with a lock glyph.
 */
export function VaultLockedImpersonated() {
  return (
    <AuthShell
      title="Vault locked"
      subtitle="Files stay locked during a support session."
    >
      <div className="flex flex-col gap-3 text-[13px] text-ink-3 leading-relaxed">
        <div className="flex items-start gap-2.5">
          <Icon name="lock" size={16} className="text-ink-4 shrink-0 mt-0.5" />
          <p>
            This support session cannot access vault contents. The user's files
            are end-to-end encrypted, and the key exists only in the user's own
            browser — never on the server, and not in this session.
          </p>
        </div>
        <p>
          Account details, file names as stored, quota, billing, and sessions
          are still visible. To open the vault, use the account owner's own
          logged-in browser.
        </p>
      </div>
    </AuthShell>
  )
}
