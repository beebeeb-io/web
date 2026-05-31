/**
 * Build-time feature flags (set via VITE_* env vars at build).
 *
 * Default OFF so unfinished or unannounced features stay unreachable in
 * production until they're ready — the marketing site can then honestly say
 * the feature is "coming" without it being silently live.
 *
 * FEATURE_TEAMS — Workspaces/Teams (the /team route). The page is a placeholder
 * today; marketing positions teams as Phase 4 (Business). Keep this off until
 * teams actually ships, then flip it on with VITE_FEATURE_TEAMS=true.
 */
export const FEATURE_TEAMS = import.meta.env.VITE_FEATURE_TEAMS === 'true';
