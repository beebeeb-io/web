// Unauthenticated API calls: announcements and public profile shares.
import { ApiError, request } from '@beebeeb/shared'
import { API_URL, STATUS_URL } from './api-session'

// (moved to ./api-google-import)
// ─── System announcements (task 0158) ─────────────────────────────────

export type AnnouncementSeverity = 'info' | 'warning' | 'critical'

export interface Announcement {
  id: string
  message: string
  severity: AnnouncementSeverity
  created_at: string
  expires_at: string | null
}

/** GET /api/v1/announcements — public; safe to call before login. */
export async function listAnnouncements(): Promise<{ announcements: Announcement[] }> {
  return request<{ announcements: Announcement[] }>('/api/v1/announcements')
}

// ─── Public profile ────────────────────────────────────────────────────────

export interface PublicProfileShare {
  // Task 1545, finding 2: the server deliberately never sends this — a
  // share token is a secret that grants unauthenticated download access
  // (see repos/server profile.rs's PublicShare struct comment) — so it must
  // be treated as absent, not assumed present. Kept only so a future,
  // deliberate server change to include it needs no client type change.
  token?: string
  file_size: number | null
  created_at: string
  expires_at: string | null
}

export interface PublicProfile {
  username: string
  display_name: string | null
  shares: PublicProfileShare[]
}

/**
 * GET /api/v1/me/profile — current user's username + display_name (auth required).
 */
export async function getMyProfile(): Promise<{ username: string | null; display_name: string | null }> {
  return request<{ username: string | null; display_name: string | null }>('/api/v1/me/profile')
}

/**
 * GET /api/v1/p/:username — public, no auth required.
 * Returns the user's public profile and their active, non-revoked share links.
 */
export async function getPublicProfile(username: string): Promise<PublicProfile> {
  const res = await fetch(`${API_URL}/api/v1/p/${encodeURIComponent(username)}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: 'Profile not found' })) as Record<string, unknown>
    throw new ApiError(
      (body.message ?? body.error ?? res.statusText) as string,
      res.status,
    )
  }
  return res.json() as Promise<PublicProfile>
}

/**
 * PUT /api/v1/me/profile — update username and display_name (auth required).
 */
export async function updatePublicProfile(params: {
  username?: string
  display_name?: string
}): Promise<{ message: string }> {
  return request<{ message: string }>('/api/v1/me/profile', {
    method: 'PUT',
    body: JSON.stringify(params),
  })
}

// (moved to ./api-file-requests)
// ─── Incident types & status API ──────────────────

export interface IncidentUpdate {
  id: string
  message: string
  status: string | null
  created_at: string
}

export interface ActiveIncident {
  id: string
  title: string
  message: string
  status: string
  severity: string
  started_at: string
  published_at?: string | null
  resolved_at?: string | null
  updates: IncidentUpdate[]
}

/**
 * Fetch active incidents from the public status API.
 * No auth needed — works on login page and unauthenticated contexts.
 * Uses a direct fetch to the status service (different origin from the main API).
 */
export async function getActiveIncidents(): Promise<ActiveIncident[]> {
  const res = await fetch(`${STATUS_URL}/api/v1/status/incidents`)
  if (!res.ok) return []
  const body = (await res.json()) as { incidents: ActiveIncident[] }
  // Resolved, completed and draft incidents are history; the banner is current status only.
  return (body.incidents ?? []).filter(
    (i) => i.status !== 'resolved' && i.status !== 'completed' && i.status !== 'draft',
  )
}
