/**
 * Whether to show the "upgrade for longer version history" upsell nudge in
 * VersionHistory (task 1542, finding 4).
 *
 * Before this fix, the nudge unconditionally rendered "Free keeps the
 * current version only." / "Basic keeps 30 days of version history per
 * file." whenever the account had no subscription row or plan === 'free'.
 * The server applies NO plan gate to version retention anywhere:
 * `version_cleanup.rs`'s `apply_default_retention()` applies the same
 * `DEFAULT_RETENTION_DAYS` / `DEFAULT_MAX_VERSIONS` (30 days / 10 versions,
 * env-overridable) to every account with no `version_settings` row — grep
 * confirms zero plan/subscription checks in that file — and
 * `routes/versions.rs`'s `list_versions` checks only file ownership. So a
 * free/lapsed account got a real, restorable prior version back from the
 * API while this nudge simultaneously claimed it wouldn't, directly above
 * that same version list.
 *
 * This is the single decision point VersionHistory now calls before
 * rendering the nudge. It returns false unconditionally — removing the
 * false claim — until the server actually implements plan-based retention
 * gating (a product/pricing decision outside a copy fix's scope; see task
 * 1542 finding 4 notes). Kept as a named function, not inlined `false`, so
 * that a future real gate has one obvious call site to update.
 */
export function shouldShowVersionHistoryUpsell(_planSlug: string | undefined): boolean {
  return false
}
