// ─── API: Google Drive import proxy ───
// SECTION_MARKER_END
import type { DataExportRequest, DataExportStatus, MyActivityResponse, MySignInsResponse, NotificationPreferences, OnboardingState, TrackingPreference, UserRegionResponse } from './api'
import { request, getApiUrl } from '@beebeeb/shared'

// ─── Google Drive import proxy ────────────────────────────────────────────────

/** Exchange a Google OAuth code for tokens via our server proxy. */
export async function googleTokenExchange(
  code: string,
  codeVerifier: string,
  redirectUri: string,
): Promise<{ access_token: string; refresh_token: string; email?: string }> {
  return request('/api/v1/import/google/token-exchange', {
    method: 'POST',
    body: JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: redirectUri }),
  })
}

/** Refresh a Google access token via our server proxy. */
export async function googleTokenRefresh(
  refreshToken: string,
): Promise<{ access_token: string }> {
  return request('/api/v1/import/google/refresh', {
    method: 'POST',
    body: JSON.stringify({ refresh_token: refreshToken }),
  })
}

/** GET /api/v1/account/onboarding-state */
export async function getOnboardingState(): Promise<OnboardingState> {
  return request<OnboardingState>('/api/v1/account/onboarding-state')
}

/** POST /api/v1/account/onboarding/mark-welcome-file — registers the welcome file ID */
export async function markWelcomeFile(fileId: string): Promise<void> {
  await request<void>('/api/v1/account/onboarding/mark-welcome-file', {
    method: 'POST',
    body: JSON.stringify({ file_id: fileId }),
  })
}

/**
 * POST /dev/reset-onboarding — dev/test only.
 * Resets a user's onboarding state server-side for Playwright re-runs.
 */
export async function devResetOnboarding(email: string): Promise<void> {
  await request<void>('/dev/reset-onboarding', {
    method: 'POST',
    body: JSON.stringify({ email }),
  })
}

/** GET /api/v1/me/tracking */
export async function getTrackingPreference(): Promise<TrackingPreference> {
  return request<TrackingPreference>('/api/v1/me/tracking')
}

/** PUT /api/v1/me/tracking — { opted_in: boolean } */
export async function setTrackingPreference(optedIn: boolean): Promise<TrackingPreference> {
  return request<TrackingPreference>('/api/v1/me/tracking', {
    method: 'PUT',
    body: JSON.stringify({ opted_in: optedIn }),
  })
}

/** GET /api/v1/me/sign-ins — recent sign-ins for the authenticated user (GDPR opt-in). */
export async function getMySignIns(): Promise<MySignInsResponse> {
  return request<MySignInsResponse>('/api/v1/me/sign-ins')
}


/** GET /api/v1/me/activity — file activity events for the authenticated user (GDPR opt-in). */
export async function getMyActivity(opts?: {
  limit?: number
  offset?: number
  type?: string
}): Promise<MyActivityResponse> {
  const params = new URLSearchParams()
  if (opts?.limit) params.set('limit', String(opts.limit))
  if (opts?.offset) params.set('offset', String(opts.offset))
  if (opts?.type) params.set('type', opts.type)
  const qs = params.toString()
  return request<MyActivityResponse>(`/api/v1/me/activity${qs ? `?${qs}` : ''}`)
}

/** GET /api/v1/notifications/preferences */
export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const res = await request<{ preferences: NotificationPreferences }>('/api/v1/notifications/preferences')
  return res.preferences
}

/** PUT /api/v1/notifications/preferences */
export async function setNotificationPreferences(
  prefs: NotificationPreferences,
): Promise<NotificationPreferences> {
  const res = await request<{ preferences: NotificationPreferences }>('/api/v1/notifications/preferences', {
    method: 'PUT',
    body: JSON.stringify(prefs),
  })
  return res.preferences
}


/**
 * Normalize a server-returned download_url. The API returns a relative path
 * like "/api/v1/auth/account/export/:id/download"; the web app is served from
 * a different origin (app.beebeeb.io vs api.beebeeb.io), so a bare relative
 * path resolves to the wrong host. Make it absolute by prefixing API_URL.
 */
function normalizeExportUrl<T extends { download_url?: string }>(data: T): T {
  if (data.download_url && !data.download_url.startsWith('http')) {
    data.download_url = `${getApiUrl()}${data.download_url}`
  }
  return data
}

/** POST /api/v1/me/data-export — request a new data export */
export async function requestDataExport(confirmToken?: string): Promise<DataExportRequest> {
  const data = await request<DataExportRequest>('/api/v1/me/data-export', {
    method: 'POST',
    headers: confirmToken ? { 'X-Confirm-Token': confirmToken } : undefined,
  })
  return normalizeExportUrl(data)
}

/** GET /api/v1/me/data-export/:id — poll export status */
export async function getDataExportStatus(exportId: string): Promise<DataExportStatus> {
  const data = await request<DataExportStatus>(`/api/v1/me/data-export/${exportId}`)
  return normalizeExportUrl(data)
}

/** POST /api/v1/me/freeze — suspend all processing */
export async function freezeAccount(): Promise<{ frozen: boolean }> {
  return request<{ frozen: boolean }>('/api/v1/me/freeze', { method: 'POST' })
}

/** POST /api/v1/me/unfreeze — re-enable processing */
export async function unfreezeAccount(): Promise<{ frozen: boolean }> {
  return request<{ frozen: boolean }>('/api/v1/me/unfreeze', { method: 'POST' })
}

/**
 * GET /api/v1/me/region — the stored preference plus the server's list of
 * choices (task 1919). `choices` is the same array as the public
 * `GET /api/v1/storage-regions`; it is absent on a server older than 1919, so
 * it is typed `unknown` and validated by `parseChoices()`.
 */
export type UserRegionData = UserRegionResponse & { choices?: unknown }

export async function getUserRegion(): Promise<UserRegionData> {
  return request<UserRegionData>('/api/v1/me/region')
}

/** PUT /api/v1/me/region — set where new uploads go.
 * Send the `id` of a choice from the list verbatim (the default row's id, or a
 * live country's id), or `null` to clear the preference. The server answers
 * 400 `region_unavailable` for anything it does not offer as live (coming soon,
 * unknown), and the stored value stays unchanged. PUT replaces the whole
 * choice: an omitted `region_strict` means false, and strict needs a country
 * (400 `region_strict_requires_datacenter` otherwise; the code predates 2050).
 * Server (regions.rs `SetRegionBody`) deserializes ONLY `preferred_region` and
 * `region_strict`; sending `{continent}` silently dropped the value and cleared
 * the preference. */
export async function setUserRegion(
  id: string | null,
  strict = false,
): Promise<{ preferred_region: string | null; region_strict?: boolean }> {
  return request<{ preferred_region: string | null; region_strict?: boolean }>('/api/v1/me/region', {
    method: 'PUT',
    body: JSON.stringify({ preferred_region: id, region_strict: strict }),
  })
}
