/**
 * Office editor availability (task 1567).
 *
 * History: ship prep (2026-09-27) added a per-browser "Labs" opt-in here
 * (`?labs=office` → a localStorage flag) ANDed with the build flag. Guus
 * ruled the same day to drop it — "Instead of the ?lab=office, just add it
 * in. No real users yet" — so the build-time `FEATURE_OFFICE_EDITOR` flag
 * (../flags.ts, `VITE_FEATURE_OFFICE_EDITOR=true`, set by
 * `make prod-build-web OFFICE=1`) is now the ONLY switch. A build that
 * carries the office bundle shows the editor to every signed-in user; a
 * build without it has the route and the "Edit" entry compiled out.
 *
 * `isOfficeLabsEnabled()` keeps its name and signature so the existing
 * callers (src/app.tsx's `/office/:fileId` route, file-preview.tsx's "Edit"
 * entry, and in-flight lanes) keep compiling; it is a pure alias for the
 * build flag, so Rollup still folds it to a constant and drops the office
 * branches entirely from a flag-off build.
 */
import { FEATURE_OFFICE_EDITOR } from '../flags'

/**
 * React key on the `/office/:fileId` route's element (src/app.tsx). It sits
 * only in the flag-on branch, so this string is present in the entry bundle
 * (dist/assets/index-*.js) exactly when the office route is live and is
 * tree-shaken away otherwise. The workspace Makefile's `prod-build-web`
 * image gate (OFFICE_ROUTE_MARKER) greps for it — keep the two in sync.
 */
export const OFFICE_ROUTE_MARKER = 'bb-office-route-live'

/** True when this build carries the office editor (the build flag). */
export function isOfficeLabsEnabled(): boolean {
  return FEATURE_OFFICE_EDITOR
}
