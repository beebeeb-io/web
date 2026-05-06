/**
 * Privacy tools page — GDPR Articles 15-22 self-service UI (spec 025).
 *
 * Sections:
 *   1. Your Data     — export request + status poll + download
 *   2. Activity Tracking — cross-link to account.tsx#privacy
 *   3. Restrict Processing — freeze / unfreeze account
 *   4. Delete Account — link to /settings/delete-account
 *   5. Your Rights  — plain-language GDPR summary
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import { useToast } from '../../components/toast'
import { ConfirmPasswordModal } from '../../components/confirm-password-modal'
import { useAuth } from '../../lib/auth-context'
import { useFrozen } from '../../hooks/use-frozen'
import {
  requestDataExport,
  getDataExportStatus,
  freezeAccount,
  unfreezeAccount,
  getToken,
  ApiError,
  type DataExportStatus,
} from '../../lib/api'
import { formatBytes } from '../../lib/format'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatExpiry(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

// ── Card wrapper ──────────────────────────────────────────────────────────────

function Card({
  title,
  children,
  danger,
}: {
  title: string
  children: React.ReactNode
  danger?: boolean
}) {
  return (
    <div
      className={`mx-7 rounded-lg border overflow-hidden ${
        danger ? 'border-red/20 bg-red/5' : 'border-line bg-paper'
      }`}
    >
      <div className="px-5 py-3.5 border-b border-line bg-paper-2">
        <h3
          className={`text-[11px] font-semibold uppercase tracking-widest ${
            danger ? 'text-red' : 'text-ink-4'
          }`}
        >
          {title}
        </h3>
      </div>
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

// ── 1. Data export card ───────────────────────────────────────────────────────

function DataExportCard() {
  const { showToast } = useToast()
  const [requesting, setRequesting] = useState(false)
  const [exportStatus, setExportStatus] = useState<DataExportStatus | null>(null)
  const [endpointMissing, setEndpointMissing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }, [])

  const pollStatus = useCallback((exportId: string) => {
    stopPolling()
    pollRef.current = setInterval(async () => {
      try {
        const s = await getDataExportStatus(exportId)
        setExportStatus(s)
        if (s.status === 'ready' || s.status === 'failed') {
          stopPolling()
        }
      } catch {
        stopPolling()
      }
    }, 5000)
  }, [stopPolling])

  useEffect(() => () => stopPolling(), [stopPolling])

  const handleRequest = useCallback(async (confirmToken: string) => {
    setConfirmOpen(false)
    setRequesting(true)
    setEndpointMissing(false)
    try {
      // The server may return a resumed job (200 with resumed:true) when an
      // export already exists. The response carries the same fields as the
      // status endpoint, so we copy any populated fields straight in.
      const res = await requestDataExport(confirmToken)
      const initial: DataExportStatus = {
        export_id: res.export_id,
        status: res.status,
        file_count: res.file_count,
        total_bytes: res.total_bytes,
        download_url: res.download_url,
        expires_at: res.expires_at,
      }
      setExportStatus(initial)
      if (res.status !== 'ready' && res.status !== 'failed') {
        pollStatus(res.export_id)
      } else if (res.status === 'ready' && !res.download_url) {
        // Resumed-ready response without download_url — fetch full status
        // so the download button has somewhere to go.
        try {
          const full = await getDataExportStatus(res.export_id)
          setExportStatus(full)
        } catch {
          // Non-fatal — user can refresh
        }
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        setEndpointMissing(true)
      } else {
        showToast({
          icon: 'x',
          title: 'Export request failed',
          description: err instanceof Error ? err.message : 'Please try again.',
          danger: true,
        })
      }
    } finally {
      setRequesting(false)
    }
  }, [pollStatus, showToast])

  const downloadExport = useCallback(async (url: string) => {
    const token = getToken()
    try {
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      if (!res.ok) {
        showToast({ icon: 'x', title: 'Download failed', danger: true })
        return
      }
      const blob = await res.blob()
      const objectUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = objectUrl
      a.download = `beebeeb-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(objectUrl)
    } catch {
      showToast({ icon: 'x', title: 'Download failed', danger: true })
    }
  }, [showToast])

  const status = exportStatus?.status

  return (
    <Card title="Your data">
      <ConfirmPasswordModal
        open={confirmOpen}
        title="Confirm data export"
        description="Re-enter your password to request a copy of your data."
        confirmLabel="Export my data"
        onConfirmed={(token) => void handleRequest(token)}
        onCancel={() => setConfirmOpen(false)}
      />
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-ink-2 leading-relaxed">
          Download a copy of everything Beebeeb holds about you: file metadata, share history, activity logs, and account settings. File contents are exported encrypted.
        </p>

        {/* Status states */}
        {status === 'pending' || status === 'processing' ? (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-md bg-paper-2 border border-line">
            <span className="w-3.5 h-3.5 border-2 border-amber border-t-transparent rounded-full animate-spin shrink-0" />
            <span className="text-[13px] text-ink-2">
              {status === 'pending' ? 'Queued — preparing your export…' : 'Building your export…'}
            </span>
          </div>
        ) : status === 'ready' && exportStatus ? (
          <div className="flex items-center gap-3 px-4 py-3 rounded-md bg-green/5 border border-green/20">
            <Icon name="check" size={14} className="text-green shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium text-ink">Export ready</div>
              <div className="text-[11px] text-ink-3 font-mono mt-0.5">
                {exportStatus.file_count != null && `${exportStatus.file_count} files · `}
                {exportStatus.total_bytes != null && `${formatBytes(exportStatus.total_bytes)} · `}
                {exportStatus.expires_at && `expires ${formatExpiry(exportStatus.expires_at)}`}
              </div>
            </div>
            {exportStatus.download_url && (
              <BBButton
                variant="default"
                size="sm"
                onClick={() => void downloadExport(exportStatus.download_url!)}
                className="shrink-0 gap-1.5"
              >
                <Icon name="download" size={12} />
                Download
              </BBButton>
            )}
          </div>
        ) : status === 'failed' ? (
          <div className="flex items-center gap-2.5 px-4 py-3 rounded-md bg-red/5 border border-red/20">
            <Icon name="x" size={13} className="text-red shrink-0" />
            <span className="text-[13px] text-ink-2">Export failed — please try again.</span>
          </div>
        ) : null}

        {/* Request button */}
        {!status && (
          <div>
            <BBButton
              variant="default"
              size="md"
              onClick={() => setConfirmOpen(true)}
              disabled={requesting}
              className="gap-1.5"
            >
              {requesting ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin shrink-0" />
                  Requesting…
                </>
              ) : (
                <>
                  <Icon name="download" size={13} />
                  Download my data
                </>
              )}
            </BBButton>
          </div>
        )}

        {/* Retry after failure */}
        {status === 'failed' && (
          <BBButton
            variant="ghost"
            size="sm"
            onClick={() => { setExportStatus(null) }}
          >
            Try again
          </BBButton>
        )}

        {endpointMissing && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-paper-2 border border-line">
            <Icon name="cloud" size={12} className="text-ink-4 shrink-0 mt-0.5" />
            <p className="text-[11.5px] text-ink-3 leading-relaxed">
              Data exports require the latest server update. Contact{' '}
              <a href="mailto:privacy@beebeeb.io" className="text-amber-deep hover:underline">
                privacy@beebeeb.io
              </a>{' '}
              in the meantime.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <p className="text-[11px] text-ink-4 leading-relaxed">
            Your files are exported encrypted. Use your recovery phrase or any logged-in device to decrypt them.
          </p>
          <p className="text-[11px] text-ink-4">
            You can request one export per day. GDPR Article 15.
          </p>
        </div>
      </div>
    </Card>
  )
}

// ── 2. Activity tracking cross-link ───────────────────────────────────────────

function ActivityTrackingCard() {
  return (
    <Card title="Activity tracking">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-ink-2 leading-relaxed">
            Control whether we log your sign-ins and file activity. Disabled by default. Disabling deletes all collected data within 30 days.
          </p>
          <p className="text-[11px] text-ink-4 mt-2">GDPR Article 7 — consent. Article 17 — right to erasure.</p>
        </div>
        <Link
          to="/settings/profile"
          className="shrink-0 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-amber-deep hover:underline whitespace-nowrap"
        >
          Manage
          <Icon name="chevron-right" size={11} />
        </Link>
      </div>
    </Card>
  )
}

// ── 3. Restrict processing card ───────────────────────────────────────────────

function RestrictProcessingCard() {
  const { showToast } = useToast()
  const { refreshUser } = useAuth()
  const { isFrozen } = useFrozen()
  const [loading, setLoading] = useState(false)
  const [endpointMissing, setEndpointMissing] = useState(false)

  const handleFreeze = useCallback(async () => {
    if (!confirm(
      'Freeze your account? You will not be able to access your files until you unfreeze. Your data stays stored.',
    )) return

    setLoading(true)
    try {
      await freezeAccount()
      await refreshUser()
      showToast({ icon: 'shield', title: 'Account frozen', description: 'Processing suspended. Unfreeze anytime.' })
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        setEndpointMissing(true)
      } else {
        showToast({ icon: 'x', title: 'Failed to freeze account', danger: true })
      }
    } finally {
      setLoading(false)
    }
  }, [refreshUser, showToast])

  const handleUnfreeze = useCallback(async () => {
    setLoading(true)
    try {
      await unfreezeAccount()
      await refreshUser()
      showToast({ icon: 'check', title: 'Account unfrozen', description: 'Processing resumed.' })
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 501)) {
        setEndpointMissing(true)
      } else {
        showToast({ icon: 'x', title: 'Failed to unfreeze account', danger: true })
      }
    } finally {
      setLoading(false)
    }
  }, [refreshUser, showToast])

  return (
    <Card title="Restrict processing">
      <div className="flex flex-col gap-3">
        {isFrozen ? (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-md bg-amber-bg border border-amber/20">
            <Icon name="shield" size={13} className="text-amber-deep shrink-0 mt-0.5" />
            <div>
              <div className="text-[13px] font-semibold text-ink">Account is frozen</div>
              <div className="text-[12px] text-ink-3 mt-0.5">
                All processing is suspended. Your files are stored but inaccessible.
              </div>
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-ink-2 leading-relaxed">
            Temporarily suspends all processing — sign-ins, shares, and uploads are paused. Your files remain stored but inaccessible until you unfreeze. GDPR Article 18.
          </p>
        )}

        {endpointMissing && (
          <div className="flex items-start gap-2 p-3 rounded-md bg-paper-2 border border-line">
            <Icon name="cloud" size={12} className="text-ink-4 shrink-0 mt-0.5" />
            <p className="text-[11.5px] text-ink-3 leading-relaxed">
              Account freeze requires the latest server update. Contact{' '}
              <a href="mailto:privacy@beebeeb.io" className="text-amber-deep hover:underline">
                privacy@beebeeb.io
              </a>{' '}
              to request restriction of processing manually.
            </p>
          </div>
        )}

        {isFrozen ? (
          <BBButton
            variant="default"
            size="md"
            onClick={() => void handleUnfreeze()}
            disabled={loading}
            className="gap-1.5 w-fit"
          >
            {loading ? 'Unfreezing…' : 'Unfreeze account'}
          </BBButton>
        ) : (
          <BBButton
            variant="ghost"
            size="md"
            onClick={() => void handleFreeze()}
            disabled={loading}
            className="gap-1.5 w-fit !text-ink-2 hover:!text-ink"
          >
            <Icon name="shield" size={13} />
            {loading ? 'Freezing…' : 'Freeze my account'}
          </BBButton>
        )}
      </div>
    </Card>
  )
}

// ── 4. Delete account card ────────────────────────────────────────────────────

function DeleteAccountCard() {
  return (
    <Card title="Delete account" danger>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] text-ink-2 leading-relaxed">
            Permanently destroys your encryption keys and all data. This cannot be undone — we do not have your encryption keys and cannot recover anything.
          </p>
          <p className="text-[11px] text-ink-4 mt-2">GDPR Article 17 — right to erasure.</p>
        </div>
        <Link
          to="/settings/delete-account"
          className="shrink-0 inline-flex items-center gap-1.5 text-[12.5px] font-medium text-red hover:underline whitespace-nowrap"
        >
          Delete account
          <Icon name="chevron-right" size={11} />
        </Link>
      </div>
    </Card>
  )
}

// ── 5. Your rights card ───────────────────────────────────────────────────────

function YourRightsCard() {
  const rights: { article: string; text: string }[] = [
    { article: 'Art. 15', text: 'Access — you can download a copy of everything we hold about you.' },
    { article: 'Art. 16', text: 'Correction — contact us to fix inaccurate data.' },
    { article: 'Art. 17', text: 'Erasure — delete your account and we cannot recover your data.' },
    { article: 'Art. 18', text: 'Restriction — freeze your account to suspend all processing.' },
    { article: 'Art. 20', text: 'Portability — data export is available in machine-readable JSON.' },
    { article: 'Art. 21', text: 'Objection — we do not use your data for marketing or automated decisions.' },
  ]

  return (
    <Card title="Your rights">
      <div className="flex flex-col gap-2.5">
        {rights.map(({ article, text }) => (
          <div key={article} className="flex items-start gap-3">
            <span className="shrink-0 font-mono text-[10.5px] text-ink-4 bg-paper-2 border border-line rounded px-1.5 py-0.5 mt-0.5 tabular-nums">
              {article}
            </span>
            <span className="text-[12.5px] text-ink-2 leading-relaxed">{text}</span>
          </div>
        ))}
        <div className="mt-2 pt-3 border-t border-line">
          <p className="text-[12px] text-ink-3 leading-relaxed">
            For any privacy request not covered above, contact{' '}
            <a href="mailto:privacy@beebeeb.io" className="text-amber-deep hover:underline font-medium">
              privacy@beebeeb.io
            </a>
            . We respond within 72 hours. Operated by Initlabs B.V. (KvK 95157565), Wijchen, Netherlands.
          </p>
        </div>
      </div>
    </Card>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SettingsPrivacy() {
  return (
    <SettingsShell activeSection="privacy">
      <SettingsHeader
        title="Privacy"
        subtitle="Manage your data, rights, and how we process your information."
      />

      <div className="flex flex-col gap-5 py-4">
        <DataExportCard />
        <ActivityTrackingCard />
        <RestrictProcessingCard />
        <DeleteAccountCard />
        <YourRightsCard />
      </div>
    </SettingsShell>
  )
}
