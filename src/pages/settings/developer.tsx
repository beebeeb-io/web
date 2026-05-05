/**
 * Developer Settings — Personal Access Tokens
 *
 * Create and revoke PATs for automation, CI/CD, and integrations.
 * Handles 404 gracefully — shows a "coming soon" notice when the endpoint
 * is not yet deployed.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { BBButton } from '../../components/bb-button'
import { BBChip } from '../../components/bb-chip'
import { Icon } from '../../components/icons'
import { useToast } from '../../components/toast'
import {
  listTokens,
  createToken,
  revokeToken,
  ApiError,
  type PersonalAccessToken,
  type CreateTokenResponse,
} from '../../lib/api'

// ─── Constants ────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

// ─── Sub-components ───────────────────────────────────────────────────────────

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

// ─── Main page ────────────────────────────────────────────────────────────────

export function SettingsDeveloper() {
  const { showToast } = useToast()

  const [tokens, setTokens] = useState<PersonalAccessToken[]>([])
  const [loading, setLoading] = useState(true)
  const [endpointMissing, setEndpointMissing] = useState(false)

  // Create-token form state
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [selectedScopes, setSelectedScopes] = useState<Set<string>>(new Set(['files:read', 'files:write']))
  const [expiryDays, setExpiryDays] = useState<number | null>(90)
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [newToken, setNewToken] = useState<CreateTokenResponse | null>(null)

  // Revoke state
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
      // Reset form
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

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <SettingsShell activeSection="developer">
      <SettingsHeader
        title="Developer"
        subtitle="Personal access tokens for automation, CI/CD pipelines, and integrations."
      />

      <div className="p-7 space-y-6">

        {/* ── Endpoint not deployed notice ── */}
        {endpointMissing && (
          <div className="flex items-start gap-3 p-4 rounded-xl border border-line bg-paper-2 text-[13px] text-ink-3">
            <Icon name="cloud" size={15} className="text-ink-3 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-ink mb-0.5">API tokens coming soon</div>
              The <code className="font-mono text-[11.5px] bg-paper border border-line px-1 rounded">/api/v1/tokens</code> endpoint is being deployed.
              {' '}Once live, you can create tokens for the <a href="https://docs.beebeeb.io/cli/install" target="_blank" rel="noopener" className="text-amber-deep hover:underline">CLI</a> and your own scripts.
            </div>
          </div>
        )}

        {/* ── New token reveal box ── */}
        {newToken && (
          <NewTokenBox result={newToken} onDismiss={() => setNewToken(null)} />
        )}

        {/* ── Token list ── */}
        {!endpointMissing && (
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-semibold uppercase tracking-widest text-ink-4">
                Active tokens
              </span>
              {!formOpen && (
                <BBButton size="sm" variant="amber" onClick={() => setFormOpen(true)} className="gap-1.5">
                  <Icon name="plus" size={12} />
                  New token
                </BBButton>
              )}
            </div>

            {loading ? (
              <div className="flex items-center justify-center py-10">
                <svg className="animate-spin h-5 w-5 text-amber" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
            ) : tokens.length === 0 ? (
              <div className="rounded-xl border border-line bg-paper-2 py-10 px-6 text-center">
                <div className="w-10 h-10 mx-auto mb-3 rounded-xl bg-paper border border-line flex items-center justify-center">
                  <Icon name="key" size={16} className="text-ink-3" />
                </div>
                <div className="text-[13.5px] font-medium text-ink mb-1">No tokens yet</div>
                <div className="text-[12.5px] text-ink-3 mb-4 max-w-[340px] mx-auto">
                  Create a token to use the Beebeeb API from scripts, CI/CD pipelines, or integrations.
                </div>
                <BBButton size="sm" variant="amber" onClick={() => setFormOpen(true)} className="gap-1.5">
                  <Icon name="plus" size={12} />
                  Create your first token
                </BBButton>
              </div>
            ) : (
              <div className="rounded-xl border border-line overflow-hidden">
                {/* Table header */}
                <div
                  className="grid gap-4 px-5 py-2.5 bg-paper-2 border-b border-line text-[11px] font-semibold uppercase tracking-wider text-ink-4"
                  style={{ gridTemplateColumns: '1.8fr 2fr 1fr 1fr 80px' }}
                >
                  <span>Name</span>
                  <span>Scopes</span>
                  <span>Last used</span>
                  <span>Expires</span>
                  <span />
                </div>

                {tokens.map((tok) => (
                  <div
                    key={tok.id}
                    className="grid gap-4 px-5 py-3 border-b border-line items-center last:border-b-0 hover:bg-paper-2/40 transition-colors"
                    style={{ gridTemplateColumns: '1.8fr 2fr 1fr 1fr 80px' }}
                  >
                    <div>
                      <div className="text-[13px] font-medium text-ink">{tok.name}</div>
                      <div className="text-[11px] text-ink-4 font-mono mt-0.5">
                        Created {formatRelative(tok.created_at)}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {tok.scopes.map(s => <ScopeChip key={s} scope={s} />)}
                    </div>
                    <span className="text-[12px] text-ink-3">{formatRelative(tok.last_used_at)}</span>
                    <span className="text-[12px] text-ink-3">{formatExpiry(tok.expires_at)}</span>
                    <div className="flex justify-end">
                      {confirmRevokeId === tok.id ? (
                        <div className="flex items-center gap-1.5">
                          <BBButton
                            size="sm"
                            variant="danger"
                            disabled={revokingId === tok.id}
                            onClick={() => void handleRevoke(tok.id)}
                          >
                            {revokingId === tok.id ? '…' : 'Confirm'}
                          </BBButton>
                          <button
                            type="button"
                            onClick={() => setConfirmRevokeId(null)}
                            className="text-[11px] text-ink-3 hover:text-ink transition-colors cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <BBButton
                          size="sm"
                          variant="ghost"
                          className="text-red/70 hover:text-red"
                          onClick={() => setConfirmRevokeId(tok.id)}
                        >
                          Revoke
                        </BBButton>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Create token form ── */}
        {formOpen && !endpointMissing && (
          <div className="rounded-xl border border-line bg-paper overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-line bg-paper-2">
              <span className="text-[13px] font-semibold text-ink">New access token</span>
              <button
                type="button"
                onClick={() => { setFormOpen(false); setFormError(null) }}
                className="text-ink-3 hover:text-ink transition-colors cursor-pointer"
                aria-label="Close"
              >
                <Icon name="x" size={14} />
              </button>
            </div>

            <form onSubmit={(e) => void handleCreate(e)} className="px-5 py-5 space-y-5">
              {/* Name */}
              <div>
                <label className="block text-[12.5px] font-medium text-ink mb-1.5">
                  Token name <span className="text-red">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="e.g., GitHub Actions backup"
                  maxLength={80}
                  className="w-full max-w-[440px] h-9 px-3 border border-line rounded-md bg-paper text-[13px] text-ink placeholder:text-ink-4 focus:outline-none focus:border-amber-deep focus:ring-2 focus:ring-amber/20 transition-colors"
                />
              </div>

              {/* Scopes */}
              <div>
                <div className="text-[12.5px] font-medium text-ink mb-2">Scopes</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {SCOPES.map(scope => (
                    <label
                      key={scope.id}
                      className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                        selectedScopes.has(scope.id)
                          ? 'border-amber/40 bg-amber-bg'
                          : 'border-line bg-paper-2 hover:border-line-2'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedScopes.has(scope.id)}
                        onChange={() => toggleScope(scope.id)}
                        className="mt-0.5 accent-amber-deep shrink-0"
                      />
                      <div>
                        <div className="text-[12.5px] font-medium text-ink">{scope.label}</div>
                        <div className="text-[11.5px] text-ink-3">{scope.description}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {/* Expiry */}
              <div>
                <label className="block text-[12.5px] font-medium text-ink mb-1.5">Expiry</label>
                <div className="flex gap-2 flex-wrap">
                  {EXPIRY_OPTIONS.map(opt => (
                    <button
                      key={String(opt.days)}
                      type="button"
                      onClick={() => setExpiryDays(opt.days)}
                      className={`px-3 py-1.5 text-[12.5px] rounded-md border transition-colors cursor-pointer ${
                        expiryDays === opt.days
                          ? 'bg-ink text-paper border-ink font-medium'
                          : 'border-line text-ink-2 hover:border-ink-3'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {formError && (
                <p className="text-[12px] text-red">{formError}</p>
              )}

              <div className="flex items-center gap-3 pt-1">
                <BBButton type="submit" variant="amber" size="md" disabled={creating} className="gap-1.5">
                  <Icon name="key" size={13} />
                  {creating ? 'Creating…' : 'Generate token'}
                </BBButton>
                <BBButton
                  type="button"
                  size="md"
                  variant="ghost"
                  onClick={() => { setFormOpen(false); setFormError(null) }}
                >
                  Cancel
                </BBButton>
              </div>
            </form>
          </div>
        )}

        {/* ── Footer note ── */}
        <div className="text-[12px] text-ink-4 flex items-start gap-2 pt-2">
          <Icon name="shield" size={13} className="text-ink-4 shrink-0 mt-0.5" />
          <span>
            Treat tokens like passwords — don't commit them to source control.
            Tokens can be revoked at any time from this page.{' '}
            <a href="https://docs.beebeeb.io/cli/install" target="_blank" rel="noopener noreferrer" className="text-amber-deep hover:underline">
              CLI docs →
            </a>
          </span>
        </div>
      </div>
    </SettingsShell>
  )
}
