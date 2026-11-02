// ─── API: Support tickets ───
// SECTION_MARKER_END
import { request } from '@beebeeb/shared'

// ─── Support tickets (customer-facing) ──────────────────────────────────────
//
// Task 1068, spec 2026-07-01-admin-support-ticketing.md. In-app-only ticket
// creation — no email-reply ingestion in v1. A user opens a ticket, an admin
// replies via email (delivery tracked server-side through email_events), and
// either side can keep the thread going with a plain in-app reply.

export type SupportTicketStatus = 'open' | 'pending_user' | 'resolved'

/** One message in a ticket thread, in either direction. */
export interface SupportTicketMessage {
  id: string
  direction: 'inbound' | 'outbound'
  author_user_id: string | null
  author_admin_id: string | null
  body: string
  created_at: string
  email_event_id: string | null
  /** Present only on outbound (admin) messages that were emailed. */
  email_status: string | null
  /** Whether delivery can be confirmed for the email provider used — mirrors
   *  the admin-side honesty pattern (task 1063 WP-E): some providers can't
   *  report delivery, and we say so rather than imply certainty we don't have. */
  delivery_confirmable: boolean | null
}

/** A support ticket as returned by the list endpoint (no messages). */
export interface SupportTicket {
  id: string
  user_id: string
  subject: string
  status: SupportTicketStatus
  source: string
  assigned_admin_id: string | null
  created_at: string
  updated_at: string
  last_message_at: string
}

/** A ticket with its full message thread, as returned by the detail endpoint. */
export interface SupportTicketDetail extends SupportTicket {
  messages: SupportTicketMessage[]
}

/**
 * POST /api/v1/support/tickets — open a new ticket (auth required).
 * subject: 1-100 chars. body: 1-4000 chars. Server trims and re-validates.
 */
export async function createSupportTicket(params: {
  subject: string
  body: string
}): Promise<{ id: string; status: SupportTicketStatus }> {
  return request(`/api/v1/support/tickets`, {
    method: 'POST',
    body: JSON.stringify(params),
  })
}

/**
 * GET /api/v1/support/tickets — the caller's own tickets, newest activity first.
 */
export async function listSupportTickets(): Promise<{ tickets: SupportTicket[] }> {
  return request(`/api/v1/support/tickets`)
}

/**
 * GET /api/v1/support/tickets/:id — ticket + full thread (auth required).
 * 404 (not 403) if the ticket exists but isn't the caller's own.
 */
export async function getSupportTicket(id: string): Promise<SupportTicketDetail> {
  return request(`/api/v1/support/tickets/${encodeURIComponent(id)}`)
}

/**
 * POST /api/v1/support/tickets/:id/reply — add a message to the thread.
 * body: 1-4000 chars. Reopens a resolved/pending_user ticket to "open".
 */
export async function replyToSupportTicket(
  id: string,
  body: string,
): Promise<{ id: string }> {
  return request(`/api/v1/support/tickets/${encodeURIComponent(id)}/reply`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}
