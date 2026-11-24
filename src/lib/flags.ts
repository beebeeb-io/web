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

/**
 * FEATURE_ONBOARDING_DOCUMENT — render signup and the account-state screens from
 * the server's onboarding document (`GET /api/v1/onboarding`, contract v1, task
 * 1745, epic 1725). ON by default (master-key-naming 05): `/signup` goes through
 * the document flow; set VITE_FEATURE_ONBOARDING_DOCUMENT=false to get the legacy
 * page back, byte for byte. With it on, a 404 / network failure / malformed
 * document still falls back to the legacy page (spec 5.8 rule 6).
 */
export const FEATURE_ONBOARDING_DOCUMENT = import.meta.env.VITE_FEATURE_ONBOARDING_DOCUMENT !== 'false';

/**
 * SHARED_FOLDERS_FLAG — the *name* of a runtime flag, not a build-time value.
 * The server decides it in `GET /api/v1/feature-flags/evaluate` (task 2237b);
 * read it with `useFeatureFlag(SHARED_FOLDERS_FLAG)`, never from import.meta.
 */
export const SHARED_FOLDERS_FLAG = 'shared_folders_v1';
