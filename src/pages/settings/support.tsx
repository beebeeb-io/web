/**
 * Settings — Support
 *
 * Task 1068, spec 2026-07-01-admin-support-ticketing.md. The only
 * "Contact support" surface in the app: open a new ticket (subject + body)
 * and see your own open/past tickets. Each ticket links through to
 * `/settings/support/:id` for the full thread + reply.
 *
 * No SLA is promised anywhere here (none exists in v1) — copy says "We'll
 * reply by email", never implies live chat or a guaranteed response time.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { BBButton, BBChip, Icon } from '@beebeeb/shared'
import { useToast } from '../../components/toast'
import {
  createSupportTicket,
  listSupportTickets,
  type SupportTicket,
  type SupportTicketStatus,
} from '../../lib/api'
import { ApiError } from '@beebeeb/shared'

const SUBJECT_MAX = 100
const BODY_MAX = 4000

function StatusChip({ status }: { status: SupportTicketStatus }) {
  const map: Record<SupportTicketStatus, { label: string; variant: 'amber' | 'green' | 'default' }> = {
    open: { label: 'Open', variant: 'amber' },
    pending_user: { label: 'Waiting on you', variant: 'amber' },
    resolved: { label: 'Resolved', variant: 'default' },
  }
  const { label, variant } = map[status]
  return <BBChip variant={variant}>{label}</BBChip>
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function SettingsSupport() {
  const { showToast } = useToast()

  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const { tickets: list } = await listSupportTickets()
      setTickets(list)
    } catch (err) {
      console.error('[support] list failed', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  function validate(): string | null {
    const trimmedSubject = subject.trim()
    const trimmedBody = body.trim()
    if (trimmedSubject.length === 0) return 'Give your ticket a subject.'
    if (trimmedSubject.length > SUBJECT_MAX) return `Subject must be ${SUBJECT_MAX} characters or fewer.`
    if (trimmedBody.length === 0) return 'Tell us what’s going on.'
    if (trimmedBody.length > BODY_MAX) return `Message must be ${BODY_MAX} characters or fewer.`
    return null
  }

  const handleSubmit = useCallback(async () => {
    const validationError = validate()
    if (validationError) {
      setFormError(validationError)
      return
    }
    setSubmitting(true)
    setFormError(null)
    try {
      await createSupportTicket({ subject: subject.trim(), body: body.trim() })
      showToast({ icon: 'mail', title: 'Ticket sent', description: 'We’ll reply by email.' })
      setSubject('')
      setBody('')
      setShowForm(false)
      await refresh()
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not send your message. Please try again.')
    } finally {
      setSubmitting(false)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }
  }, [subject, body, showToast, refresh])

  return (
    <SettingsShell activeSection="support">
      <SettingsHeader
        title="Support"
        subtitle="Contact us about your account, billing, or anything that isn’t working. We’ll reply by email."
      />

      <div className="px-4 md:px-7 py-6 space-y-6">
        {!showForm ? (
          <BBButton variant="amber" onClick={() => { setShowForm(true); setFormError(null) }}>
            <Icon name="mail" size={13} className="mr-1.5" />
            New ticket
          </BBButton>
        ) : (
          <div className="rounded-xl border border-line-2 bg-paper shadow-2 p-5 max-w-[560px]">
            <h2 className="text-[15px] font-semibold text-ink mb-4">New ticket</h2>

            <label className="block mb-3">
              <span className="text-[12px] font-medium text-ink-2">Subject</span>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="e.g. Can't restore a file from Trash"
                maxLength={SUBJECT_MAX}
                className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none focus:ring-2 focus:ring-amber/30 focus:border-amber-deep"
              />
              <span className="block text-right text-[10.5px] font-mono text-ink-4 mt-1">
                {subject.length}/{SUBJECT_MAX}
              </span>
            </label>

            <label className="block mb-2">
              <span className="text-[12px] font-medium text-ink-2">Message</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Tell us what's going on — the more detail, the faster we can help."
                maxLength={BODY_MAX}
                rows={6}
                className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none resize-none focus:ring-2 focus:ring-amber/30 focus:border-amber-deep"
              />
              <span className="block text-right text-[10.5px] font-mono text-ink-4 mt-1">
                {body.length}/{BODY_MAX}
              </span>
            </label>

            {formError && (
              <div className="mb-3 rounded-lg bg-red/5 border border-red/20 px-3 py-2 text-[12px] text-red">
                {formError}
              </div>
            )}

            <p className="text-[11px] text-ink-3 mb-4 leading-relaxed">
              We’ll reply by email — there’s no live chat and no guaranteed response time yet.
            </p>

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); setSubject(''); setBody(''); setFormError(null) }}
                className="text-[12px] text-ink-3 hover:text-ink px-3 py-2 transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <BBButton variant="amber" onClick={() => void handleSubmit()} disabled={submitting}>
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Sending…
                  </span>
                ) : 'Send'}
              </BBButton>
            </div>
          </div>
        )}

        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-ink-4 mb-2">
            Your tickets
          </div>

          {loading ? (
            <div className="rounded-xl border border-line bg-paper-2 py-8 flex items-center justify-center">
              <span className="w-4 h-4 border-2 border-line-2 border-t-ink-3 rounded-full animate-spin" />
            </div>
          ) : tickets.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line-2 bg-paper-2 p-10 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-paper-3 flex items-center justify-center">
                <Icon name="mail" size={20} className="text-ink-3" />
              </div>
              <p className="text-[14px] font-medium text-ink">No tickets yet</p>
              <p className="text-[12px] text-ink-3 mt-1">
                Open one above and we’ll get back to you by email.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border border-line-2 overflow-hidden">
              {tickets.map((t) => (
                <Link
                  key={t.id}
                  to={`/settings/support/${t.id}`}
                  className="flex items-center gap-3 px-4 py-3 border-b border-line last:border-b-0 bg-paper hover:bg-paper-2/60 transition-colors no-underline"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-medium text-ink truncate">{t.subject}</div>
                    <div className="text-[11px] font-mono text-ink-4 mt-0.5">
                      Last activity {formatDate(t.last_message_at)}
                    </div>
                  </div>
                  <StatusChip status={t.status} />
                  <Icon name="chevron-right" size={13} className="text-ink-4 shrink-0" />
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </SettingsShell>
  )
}
