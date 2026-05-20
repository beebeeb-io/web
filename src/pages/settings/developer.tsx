/**
 * Developer Settings — Coming soon placeholder.
 *
 * The full PAT + webhooks + onboarding-reset UI is preserved below as
 * commented-out code and can be re-enabled when backend endpoints ship.
 */

import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { Icon } from '@beebeeb/shared'

// ─── Coming soon placeholder ─────────────────────────────────────────────────

export function SettingsDeveloper() {
  return (
    <SettingsShell activeSection="developer">
      <SettingsHeader
        title="Developer"
        subtitle="Tools for automation, integrations, and the API."
      />

      <div className="flex flex-col items-center justify-center text-center py-20 px-6">
        <div
          className="w-14 h-14 mb-4 rounded-2xl flex items-center justify-center"
          style={{
            background: 'var(--color-amber-bg)',
            border: '1.5px solid var(--color-line-2)',
          }}
        >
          <Icon name="key" size={24} className="text-amber-deep" />
        </div>

        <h2 className="text-[15px] font-semibold text-ink mb-1.5">Coming soon</h2>

        <p className="text-[13px] text-ink-3 max-w-[360px] leading-relaxed">
          Create personal access tokens for the CLI and your own scripts, set up
          webhooks for real-time event notifications, and integrate Beebeeb into
          your workflow.
        </p>
      </div>
    </SettingsShell>
  )
}

// ─── Original developer UI (preserved for re-enablement) ────────────────────
// To restore: rename _SettingsDeveloperFull back to SettingsDeveloper and
// uncomment its imports + subcomponents.

/*
import { useState, useEffect, useCallback, useRef } from 'react'
import { BBButton } from '@beebeeb/shared'
import { BBChip } from '@beebeeb/shared'
import { useToast } from '../../components/toast'
import {
  listTokens,
  createToken,
  revokeToken,
  listWebhooks,
  createWebhook,
  deleteWebhook,
  testWebhook,
  enableWebhook,
  devResetOnboarding,
  ApiError,
  type PersonalAccessToken,
  type CreateTokenResponse,
  type Webhook,
  type CreateWebhookResponse,
} from '../../lib/api'
import { useOnboarding } from '../../lib/onboarding-context'
import { useAuth } from '../../lib/auth-context'

const SCOPES = [
  { id: 'files:read',    label: 'Files · read',    description: 'List and download files' },
  { id: 'files:write',   label: 'Files · write',   description: 'Upload, rename, and delete files' },
  { id: 'shares:create', label: 'Shares · create', description: 'Create and revoke share links' },
  { id: 'account:read',  label: 'Account · read',  description: 'Read account info and usage' },
]

const EXPIRY_OPTIONS: { label: string; days: number | null }[] = [
  { label: 'Never',   days: null },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
  { label: '1 year',  days: 365 },
]

function formatRelative(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60_000) return 'Just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatExpiry(iso: string | null): string {
  if (!iso) return 'Never'
  const d = new Date(iso)
  const now = Date.now()
  if (d.getTime() < now) return 'Expired'
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function ScopeChip({ scope }: { scope: string }) {
  const color =
    scope.startsWith('files:write') ? 'amber'
    : scope.startsWith('files:') ? 'default'
    : scope.startsWith('shares:') ? 'green'
    : 'default'
  return <BBChip variant={color as 'amber' | 'default' | 'green'}>{scope}</BBChip>
}

function NewTokenBox({ result, onDismiss }: { result: CreateTokenResponse; onDismiss: () => void }) {
  const [copied, setCopied] = useState(false)
  const copyRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function handleCopy() {
    await navigator.clipboard.writeText(result.token)
    setCopied(true)
    if (copyRef.current) clearTimeout(copyRef.current)
    copyRef.current = setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="rounded-xl border border-amber/40 bg-amber-bg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber/20">
        <Icon name="check" size={13} className="text-green shrink-0" />
        <span className="text-[13px] font-semibold text-ink">Token created — copy it now</span>
        <span className="ml-auto text-[11px] text-amber-deep font-medium">
          This is shown once and cannot be retrieved again.
        </span>
      </div>
      <div className="px-4 py-3 flex items-center gap-3">
        <code className="flex-1 font-mono text-[12px] text-ink-2 bg-paper/60 border border-line rounded-md px-3 py-2 truncate select-all">
          {result.token}
        </code>
        <BBButton
          size="sm"
          variant={copied ? 'default' : 'amber'}
          onClick={() => void handleCopy()}
          className="shrink-0 gap-1.5"
        >
          <Icon name={copied ? 'check' : 'copy'} size={12} />
          {copied ? 'Copied!' : 'Copy'}
        </BBButton>
        <button
          type="button"
          onClick={onDismiss}
          className="text-ink-3 hover:text-ink transition-colors p-1 cursor-pointer"
          aria-label="Dismiss"
        >
          <Icon name="x" size={14} />
        </button>
      </div>
    </div>
  )
}

const WEBHOOK_EVENTS = [
  { id: 'file.uploaded',          label: 'file.uploaded',         description: 'A file is uploaded' },
  { id: 'file.deleted',           label: 'file.deleted',          description: 'A file is deleted' },
  { id: 'share.created',          label: 'share.created',         description: 'A share link is created' },
  { id: 'share.opened',           label: 'share.opened',          description: 'A share link is opened' },
  { id: 'share.expired',          label: 'share.expired',         description: 'A share link expires' },
  { id: 'account.quota_warning',  label: 'account.quota_warning', description: 'Storage quota exceeds 80%' },
]

function NewWebhookSecretBox({
  result,
  onDismiss,
}: {
  result: CreateWebhookResponse
  onDismiss: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  async function handleCopy() {
    await navigator.clipboard.writeText(result.secret)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 2500)
  }

  return (
    <div className="rounded-xl border border-amber/40 bg-amber-bg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-amber/20">
        <Icon name="shield" size={13} className="text-amber-deep shrink-0" />
        <span className="text-[13px] font-semibold text-ink">Webhook created — save the signing secret now</span>
        <span className="ml-auto text-[11px] text-amber-deep font-medium">
          This is shown once and cannot be retrieved again.
        </span>
      </div>
      <div className="px-4 py-3 space-y-2">
        <div>
          <div className="text-[11px] text-ink-4 font-medium uppercase tracking-wider mb-1">Signing secret</div>
          <div className="flex items-center gap-3">
            <code className="flex-1 font-mono text-[12px] text-ink-2 bg-paper/60 border border-line rounded-md px-3 py-2 truncate select-all">
              {result.secret}
            </code>
            <BBButton
              size="sm"
              variant={copied ? 'default' : 'amber'}
              onClick={() => void handleCopy()}
              className="shrink-0 gap-1.5"
            >
              <Icon name={copied ? 'check' : 'copy'} size={12} />
              {copied ? 'Copied!' : 'Copy'}
            </BBButton>
            <button
              type="button"
              onClick={onDismiss}
              className="text-ink-3 hover:text-ink transition-colors p-1 cursor-pointer"
              aria-label="Dismiss"
            >
              <Icon name="x" size={14} />
            </button>
          </div>
        </div>
        <p className="text-[11.5px] text-ink-3">
          Use this secret to verify webhook payloads: each POST includes an
          <code className="font-mono text-[10.5px] bg-paper border border-line px-1 rounded mx-0.5">X-Beebeeb-Signature</code>
          header. Endpoint: <span className="font-mono text-[11px] text-ink-2 break-all">{result.url}</span>
        </p>
      </div>
    </div>
  )
}

function WebhooksSection() {
  // ... full webhooks section code omitted for brevity but preserved in git history
}

function OnboardingResetSection() {
  const { user } = useAuth()
  const { skipAll, refresh } = useOnboarding()
  const { showToast } = useToast()
  const [resetting, setResetting] = useState(false)

  const handleReset = useCallback(async () => {
    if (!user?.email) return
    setResetting(true)
    try {
      try { localStorage.removeItem('beebeeb_onboarding_state') } catch {}
      await devResetOnboarding(user.email)
      await refresh()
      showToast({ icon: 'check', title: 'Onboarding reset', description: 'Reload to see the welcome guide.' })
    } catch {
      try { localStorage.removeItem('beebeeb_onboarding_state') } catch {}
      await refresh()
      showToast({ icon: 'check', title: 'Local onboarding state cleared' })
    } finally {
      setResetting(false)
    }
  }, [user?.email, refresh, showToast])

  const handleSkipAll = useCallback(() => {
    skipAll()
    showToast({ icon: 'check', title: 'Onboarding guide dismissed' })
  }, [skipAll, showToast])

  return (
    <div className="border-t border-line pt-6 mt-2">
      <div className="mb-4">
        <div className="text-[15px] font-semibold text-ink mb-1">Onboarding</div>
        <div className="text-[13px] text-ink-3">
          Re-trigger the guided onboarding flow or dismiss it. Dev-only — only visible in local builds.
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <BBButton
          size="sm"
          variant="amber"
          onClick={() => void handleReset()}
          disabled={resetting}
          className="gap-1.5"
        >
          <Icon name="key" size={12} />
          {resetting ? 'Resetting…' : 'Restart onboarding tour'}
        </BBButton>
        <BBButton
          size="sm"
          variant="ghost"
          onClick={handleSkipAll}
          className="gap-1.5"
        >
          <Icon name="check" size={12} />
          Mark all steps done
        </BBButton>
      </div>
      <p className="text-[11px] text-ink-4 mt-2">
        "Restart" calls <code className="font-mono">/dev/reset-onboarding</code> then clears localStorage.
        Only works on dev builds where the endpoint is available.
      </p>
    </div>
  )
}

function _SettingsDeveloperFull() {
  const { showToast } = useToast()

  const [tokens, setTokens] = useState<PersonalAccessToken[]>([])
  const [loading, setLoading] = useState(true)
  const [endpointMissing, setEndpointMissing] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set(['files:read', 'files:write']))
  const [expiryDays, setExpiryDays] = useState<number | null>(90)
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [newToken, setNewToken] = useState<CreateTokenResponse | null>(null)

  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await listTokens()
      setTokens(data)
      setEndpointMissing(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setEndpointMissing(true)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  function toggleScope(scope: string) {
    setSelectedScopes(prev => {
      const next = new Set(prev)
      if (next.has(scope)) next.delete(scope)
      else next.add(scope)
      return next
    })
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setFormError('Name is required.'); return }
    if (selectedScopes.size === 0) { setFormError('Select at least one scope.'); return }
    setFormError(null)
    setCreating(true)
    try {
      const result = await createToken({
        name: name.trim(),
        scopes: Array.from(selectedScopes),
        expires_in_days: expiryDays,
      })
      setNewToken(result)
      setTokens(prev => [{
        id: result.id,
        name: result.name,
        scopes: result.scopes,
        created_at: new Date().toISOString(),
        last_used_at: null,
        expires_at: result.expires_at,
      }, ...prev])
      setName('')
      setSelectedScopes(new Set(['files:read', 'files:write']))
      setExpiryDays(90)
      setFormOpen(false)
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not create token.')
    } finally {
      setCreating(false)
    }
  }

  async function handleRevoke(id: string) {
    setRevokingId(id)
    setConfirmRevokeId(null)
    try {
      await revokeToken(id)
      setTokens(prev => prev.filter(t => t.id !== id))
      showToast({ icon: 'check', title: 'Token revoked' })
    } catch (err) {
      showToast({
        icon: 'x',
        title: 'Could not revoke token',
        description: err instanceof Error ? err.message : undefined,
        danger: true,
      })
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <SettingsShell activeSection="developer">
      <SettingsHeader
        title="Developer"
        subtitle="Personal access tokens for automation, CI/CD pipelines, and integrations."
      />
      <div className="p-7 space-y-6">
        {endpointMissing && (
          <div className="flex items-start gap-3 p-4 rounded-xl border border-line bg-paper-2 text-[13px] text-ink-3">
            <Icon name="cloud" size={15} className="text-ink-3 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-ink mb-0.5">API tokens coming soon</div>
              The <code className="font-mono text-[11.5px] bg-paper border border-line px-1 rounded">/api/v1/tokens</code> endpoint is being deployed.
              Once live, you can create tokens for the CLI and your own scripts.
            </div>
          </div>
        )}
        {newToken && (
          <NewTokenBox result={newToken} onDismiss={() => setNewToken(null)} />
        )}
        <div className="border-t border-line pt-6">
          <div className="mb-5">
            <div className="text-[15px] font-semibold text-ink mb-1">Webhooks</div>
            <div className="text-[13px] text-ink-3">
              Receive real-time HTTP POST notifications when events happen in your account.
            </div>
          </div>
          <WebhooksSection />
        </div>
        {import.meta.env.DEV && <OnboardingResetSection />}
        <div className="text-[12px] text-ink-4 flex items-start gap-2 pt-2">
          <Icon name="shield" size={13} className="text-ink-4 shrink-0 mt-0.5" />
          <span>
            Treat tokens like passwords — don't commit them to source control.
            Tokens can be revoked at any time from this page.
          </span>
        </div>
      </div>
    </SettingsShell>
  )
}
*/
