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
export const FEATURE_TEAMS = import.meta.env.VITE_FEATURE_TEAMS === 'true'

/**
 * FEATURE_OFFICE_EDITOR — the Word/Docs-grade office editor (task 1567), a
 * Beebeeb React chrome around our self-hosted LibreOffice-WASM fork. Off by
 * default: the engine bundle is ~55 MB (Brotli) and only exists on machines
 * that built it (see repos/office/evidence/artifacts/). Flip on with
 * VITE_FEATURE_OFFICE_EDITOR=true once the lead enables it for real users.
 */
export const FEATURE_OFFICE_EDITOR = import.meta.env.VITE_FEATURE_OFFICE_EDITOR === 'true';
