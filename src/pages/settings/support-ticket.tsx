/**
 * Settings — Support ticket detail / thread
 *
 * Task 1068. Shows the full inbound/outbound message thread for one of the
 * caller's own tickets, in order, plus a reply box. A reply reopens a
 * resolved/pending_user ticket automatically (server-side).
 *
 * No SLA copy here either — a resolved ticket just says "Resolved", not
 * "closed within X hours" or similar promises we don't make in v1.
 */
import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { BBButton, BBChip, Icon } from '@beebeeb/shared'
import { ApiError } from '@beebeeb/shared'
import {
  getSupportTicket,
  replyToSupportTicket,
  type SupportTicketDetail,
  type SupportTicketMessage,
  type SupportTicketStatus,
} from '../../lib/api'

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

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function MessageBubble({ message }: { message: SupportTicketMessage }) {
  const fromUser = message.direction === 'inbound'
  return (
    <div className={`flex ${fromUser ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-xl px-4 py-3 ${
        fromUser
          ? 'bg-amber-bg border border-amber/25'
          : 'bg-paper-2 border border-line'
      }`}
      >
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[11px] font-semibold text-ink-2">
            {fromUser ? 'You' : 'Beebeeb support'}
          </span>
          <span className="text-[10.5px] font-mono text-ink-4">
            {formatTimestamp(message.created_at)}
          </span>
        </div>
        <p className="text-[13px] text-ink whitespace-pre-wrap leading-relaxed">{message.body}</p>
        {!fromUser && message.email_event_id && (
          <div className="mt-1.5 text-[10.5px] font-mono text-ink-4">
            {message.delivery_confirmable === false
              ? 'Emailed — delivery unavailable'
              : message.email_status
                ? `Emailed — ${message.email_status}`
                : 'Emailed'}
          </div>
        )}
      </div>
    </div>
  )
}

export function SettingsSupportTicket() {
  const { id } = useParams<{ id: string }>()

  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [replyError, setReplyError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!id) return
    setLoading(true)
    try {
      const detail = await getSupportTicket(id)
      setTicket(detail)
      setNotFound(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setNotFound(true)
      } else {
        console.error('[support] get ticket failed', err)
      }
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void refresh() }, [refresh])

  const handleReply = useCallback(async () => {
    if (!id) return
    const trimmed = reply.trim()
    if (trimmed.length === 0) {
      setReplyError('Write a message before sending.')
      return
    }
    if (trimmed.length > BODY_MAX) {
      setReplyError(`Message must be ${BODY_MAX} characters or fewer.`)
      return
    }
    setSending(true)
    setReplyError(null)
    try {
      await replyToSupportTicket(id, trimmed)
      setReply('')
      await refresh()
    } catch (err) {
      setReplyError(err instanceof ApiError ? err.message : 'Could not send your reply. Please try again.')
    } finally {
      setSending(false)
    }
  }, [id, reply, refresh])

  return (
    <SettingsShell activeSection="support">
      <SettingsHeader
        title={ticket ? ticket.subject : 'Ticket'}
        subtitle="We'll reply by email as well as here."
      />

      <div className="px-4 md:px-7 py-6 max-w-[720px]">
        <Link
          to="/settings/support"
          className="inline-flex items-center gap-1.5 text-[12px] text-ink-3 hover:text-ink mb-4 no-underline"
        >
          <Icon name="chevron-right" size={11} className="rotate-180" />
          All tickets
        </Link>

        {loading ? (
          <div className="rounded-xl border border-line bg-paper-2 py-8 flex items-center justify-center">
            <span className="w-4 h-4 border-2 border-line-2 border-t-ink-3 rounded-full animate-spin" />
          </div>
        ) : notFound || !ticket ? (
          <div className="rounded-xl border border-dashed border-line-2 bg-paper-2 p-10 text-center">
            <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-paper-3 flex items-center justify-center">
              <Icon name="mail" size={20} className="text-ink-3" />
            </div>
            <p className="text-[14px] font-medium text-ink">Ticket not found</p>
            <p className="text-[12px] text-ink-3 mt-1">
              It may have been removed, or it belongs to a different account.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 mb-4">
              <StatusChip status={ticket.status} />
              <span className="text-[11px] font-mono text-ink-4">
                Opened {formatTimestamp(ticket.created_at)}
              </span>
            </div>

            <div className="space-y-3 mb-6">
              {ticket.messages.map((m) => (
                <MessageBubble key={m.id} message={m} />
              ))}
            </div>

            <div className="rounded-xl border border-line-2 bg-paper p-4">
              <label className="block mb-2">
                <span className="text-[12px] font-medium text-ink-2">Reply</span>
                <textarea
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Add more detail or answer a question from support…"
                  maxLength={BODY_MAX}
                  rows={4}
                  className="mt-1 w-full rounded-md border border-line bg-paper px-3 py-2 text-[13px] text-ink outline-none resize-none focus:ring-2 focus:ring-amber/30 focus:border-amber-deep"
                />
                <span className="block text-right text-[10.5px] font-mono text-ink-4 mt-1">
                  {reply.length}/{BODY_MAX}
                </span>
              </label>

              {replyError && (
                <div className="mb-3 rounded-lg bg-red/5 border border-red/20 px-3 py-2 text-[12px] text-red">
                  {replyError}
                </div>
              )}

              <div className="flex items-center justify-end">
                <BBButton variant="amber" onClick={() => void handleReply()} disabled={sending}>
                  {sending ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Sending…
                    </span>
                  ) : 'Send reply'}
                </BBButton>
              </div>
            </div>
          </>
        )}
      </div>
    </SettingsShell>
  )
}
