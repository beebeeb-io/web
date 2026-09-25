/**
 * Task 1520 — the /signup pilot-key decision.
 *
 * Before this fix, signup.tsx hard-coded a mandatory "Pilot access key"
 * field, notice copy, and client-side validation — even after the server's
 * pilot gate went OFF at launch (BB_REQUIRE_PILOT_KEY=0 on both prod nodes,
 * phase 2). Nobody could sign up through the web client even though the API
 * itself accepted keyless registrations.
 *
 * The server stays the single source of truth. By default /signup shows NO
 * pilot-key field, no pilot copy, and requires no key. The field (required,
 * with its notice) appears ONLY when the page was reached with
 * `navState.pilotKeyError` — i.e. onboarding.tsx's register-start catch
 * handler caught a 403 `pilot_key_required` and routed back here. So if prod
 * ever rolls back to `BB_REQUIRE_PILOT_KEY=1`, the field reappears
 * automatically after the first real refusal; while the gate is open, nobody
 * sees it.
 *
 * These are the pure decision functions signup.tsx calls — extracted so they
 * can be unit tested directly. This repo's `bun test` harness has no
 * @testing-library/react / jsdom (see
 * test/1471-isloggedin-auth-context.test.ts's header comment), so no
 * rendering here, same pattern as src/lib/trial-eligibility.ts (task 1517).
 */

export interface SignupNavState {
  email?: string
  pilotKey?: string
  pilotKeyError?: string
}

/**
 * Whether /signup should render the pilot-key field + its notice. True only
 * when router state carries a `pilotKeyError` — which only onboarding.tsx's
 * 403 `pilot_key_required` catch handler ever sets. A fresh visit to
 * /signup (no state, or state from some other flow) never shows it.
 */
export function shouldShowPilotKeyField(navState: SignupNavState | null | undefined): boolean {
  return Boolean(navState?.pilotKeyError)
}

export interface SignupOnboardingState {
  email: string
  pilotKey?: string
}

/**
 * The router state signup.tsx hands to /onboarding on a valid submit. A
 * pilot key is included ONLY when one was actually entered —
 * opaqueRegisterStart/opaqueRegisterFinish only attach the
 * X-Beebeeb-Pilot-Key header when a key is present, so the vast majority of
 * signups (gate off) carry no key at all, not even an empty string.
 */
export function buildOnboardingState(email: string, pilotKey: string): SignupOnboardingState {
  const trimmedKey = pilotKey.trim()
  return trimmedKey ? { email, pilotKey: trimmedKey } : { email }
}

export interface PilotKeySubmitCheck {
  showPilotKeyField: boolean
  pilotKey: string
}

/**
 * Whether the pilot-key field itself blocks submit right now. False whenever
 * the field isn't shown at all (the default, gate-off case) — only relevant
 * once a real server refusal has surfaced the field, matching the field's
 * `required` attribute and the Continue button's `disabled` condition.
 */
export function pilotKeyBlocksSubmit({ showPilotKeyField, pilotKey }: PilotKeySubmitCheck): boolean {
  return showPilotKeyField && !pilotKey.trim()
}
