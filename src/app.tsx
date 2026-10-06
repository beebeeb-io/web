import React, { useState, useCallback, useRef, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { reportError } from '@beebeeb/shared'
import { AuthProvider, useAuth } from './lib/auth-context'
import { KeyProvider, useKeys } from './lib/key-context'
import { sanitizeRedirect } from './lib/safe-redirect'
import { readPlanIntent, guestRouteFallback } from './lib/plan-intent'
import { planGateRedirect } from './lib/account-state'
import { flushDeferredWelcomeFile } from './lib/welcome-file-upload'
import { WsProvider } from './lib/ws-context'
import { SyncProvider } from './lib/sync-context'
import { OnboardingProvider } from './lib/onboarding-context'
import { FEATURE_TEAMS, FEATURE_ONBOARDING_DOCUMENT } from './lib/flags'
import { isOfficeLabsEnabled, OFFICE_ROUTE_MARKER } from './lib/office/office-labs'
import { ToastProvider, useToast } from './components/toast'
import { ErrorBoundary } from './components/error-boundary'
import { WasmGuard } from './components/wasm-guard'
import { VaultUnlock } from './components/vault-unlock'
import { VaultLockedImpersonated } from './components/vault-locked-impersonated'
import { VaultLockedNoKey } from './components/vault-locked-no-key'
import {
  clearPostResetLock,
  isPostResetLockedDevice,
  resolveLockedVaultSurface,
} from './lib/post-reset-lock'
import { OfflineBanner } from './components/offline-banner'
import { ImpersonationProvider, isImpersonationSessionActive } from './lib/impersonation-context'
import { ImpersonationBanner } from './components/impersonation-banner'
import { DevAuthGate } from './components/dev-auth-gate'
import { registerAccountDeletedHandler, registerErrorNotifier, registerSessionExpiredHandler } from './lib/api'
import { formatAccountDeletedMessage } from './lib/user-friendly-error'
import { stashAccountDeletedNotice } from './lib/account-deleted-notice'
import { CommandPalette } from './components/command-palette'
import { ShortcutsCheatsheet } from './components/shortcuts-cheatsheet'
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts'
import { SessionTimeoutWarning } from './components/session-timeout-warning'
// ── Eager: needed on every first load ────────────────────────────────────────
import { Signup } from './pages/signup'
import { Login } from './pages/login'
import { Onboarding } from './pages/onboarding'
import { Coupon } from './pages/coupon'
import { heldCouponRedirect, readHeldCoupon } from './lib/coupon'

// ── Lazy: split into separate chunks, loaded on demand ───────────────────────
// Named-export helper: React.lazy requires a default export
function lazyNamed<T>(factory: () => Promise<{ [K in keyof T]: T[K] }>, name: keyof T) {
  return lazy(() => factory().then(m => ({ default: m[name] as React.ComponentType })))
}

const Drive          = lazyNamed(() => import('./pages/drive'),          'Drive')
const Starred        = lazyNamed(() => import('./pages/starred'),        'Starred')
const Recent         = lazyNamed(() => import('./pages/recent'),         'Recent')
const Shared         = lazyNamed(() => import('./pages/shared'),         'Shared')
const SharedFolder   = lazyNamed(() => import('./pages/shared-folder'),  'SharedFolder')
const Trash          = lazyNamed(() => import('./pages/trash'),          'Trash')
const Search         = lazyNamed(() => import('./pages/search'),         'Search')
const Photos         = lazyNamed(() => import('./pages/photos'),         'Photos')
const Pricing        = lazyNamed(() => import('./pages/pricing'),        'Pricing')
const Billing        = lazyNamed(() => import('./pages/billing'),        'Billing')
const ChoosePlan     = lazyNamed(() => import('./pages/choose-plan'),    'ChoosePlan')
const ReturnToApp    = lazyNamed(() => import('./pages/return-to-app'),  'ReturnToApp')
const ShareViewPage  = lazyNamed(() => import('./pages/share-view'),     'ShareViewPage')
const ForgotPassword = lazyNamed(() => import('./pages/forgot-password'),'ForgotPassword')
const ResetPassword  = lazyNamed(() => import('./pages/reset-password'), 'ResetPassword')
const SetPassword    = lazyNamed(() => import('./pages/set-password'),   'SetPassword')
const RecoverWithPhrase = lazyNamed(() => import('./pages/recover-with-phrase'), 'RecoverWithPhrase')
const VerifyEmail    = lazyNamed(() => import('./pages/verify-email'),   'VerifyEmail')
const OfficeEditorPage = lazyNamed(() => import('./pages/office-editor-page'), 'OfficeEditorPage')
const Unlock         = lazyNamed(() => import('./pages/unlock'),         'Unlock')
const Migration      = lazyNamed(() => import('./pages/migration'),      'Migration')
const Team           = lazyNamed(() => import('./pages/team'),           'Team')
const AcceptInvite   = lazyNamed(() => import('./pages/accept-invite'),  'AcceptInvite')
const PasskeySetup   = lazyNamed(() => import('./pages/passkey-setup'),  'PasskeySetup')
const DeleteAccount  = lazyNamed(() => import('./pages/delete-account'), 'DeleteAccount')
const Receive        = lazyNamed(() => import('./pages/receive'),        'Receive')
const CliAuth        = lazyNamed(() => import('./pages/cli-auth'),       'CliAuth')
const Cookies        = lazyNamed(() => import('./pages/cookies'),        'Cookies')
const ImpersonateRedeem = lazyNamed(
  () => import('./pages/auth/impersonate'),
  'ImpersonateRedeem',
)
const JoinPage       = lazyNamed(() => import('./pages/join'),            'JoinPage')
// Dev-only harness for the office loading skeleton (task 1567) — never
// imported, let alone routed to, in a production build (see the
// `import.meta.env.DEV`-gated Route below). Vite constant-folds that check
// and Rollup tree-shakes both the import and the chunk out of `bun run build`.
const DevOfficePreview = import.meta.env.DEV
  ? lazyNamed(() => import('./pages/dev-office-preview'), 'DevOfficePreview')
  : null
// Task 1745: document-driven signup + account view. Behind
// FEATURE_ONBOARDING_DOCUMENT (default off), so the flag-off build has no route
// to them and `/signup` is the legacy page unchanged. Both fall back to the
// legacy page on a 404 / network failure / malformed document (spec 5.8 rule 6).
const SignupFromDocument = FEATURE_ONBOARDING_DOCUMENT
  ? lazyNamed(() => import('./pages/onboarding-document'), 'SignupFromDocument')
  : null
const AccountStatusFromDocument = FEATURE_ONBOARDING_DOCUMENT
  ? lazyNamed(() => import('./pages/onboarding-document'), 'AccountStatusFromDocument')
  : null
// Dev-only fixture harness for the onboarding renderer (task 1745). Same
// `import.meta.env.DEV` gating as DevOfficePreview: absent from `bun run build`.
const DevOnboardingFixtures = import.meta.env.DEV
  ? lazyNamed(() => import('./pages/dev-onboarding-fixtures'), 'DevOnboardingFixtures')
  : null
const NotFound       = lazyNamed(() => import('./pages/errors/not-found'),   'NotFound')
const Logout         = lazyNamed(() => import('./pages/logout'),             'Logout')
const ServerError    = lazyNamed(() => import('./pages/errors/server-error'), 'ServerError')
const PublicProfilePage = lazyNamed(() => import('./pages/public-profile'), 'PublicProfilePage')

// Settings (grouped — lazy-loaded as a settings bundle)
const SettingsAccount       = lazyNamed(() => import('./pages/settings/account'),       'SettingsAccount')
const SettingsProfile       = lazyNamed(() => import('./pages/settings/profile'),       'SettingsProfile')
const SettingsSecurity      = lazyNamed(() => import('./pages/settings/security'),      'SettingsSecurity')
const SettingsActivity      = lazyNamed(() => import('./pages/settings/activity'),      'SettingsActivity')
const SettingsDataResidency = lazyNamed(() => import('./pages/settings/data-residency'), 'SettingsDataResidency')
const SettingsNotifications = lazyNamed(() => import('./pages/settings/notifications'), 'SettingsNotifications')
const SettingsPrivacy       = lazyNamed(() => import('./pages/settings/privacy'),       'SettingsPrivacy')
const SettingsAppearance    = lazyNamed(() => import('./pages/settings/appearance'),    'SettingsAppearance')
const SettingsDeveloper     = lazyNamed(() => import('./pages/settings/developer'),     'SettingsDeveloper')
const SettingsReferrals     = lazyNamed(() => import('./pages/settings/referrals'),     'SettingsReferrals')
const SettingsSupport       = lazyNamed(() => import('./pages/settings/support'),        'SettingsSupport')
const SettingsSupportTicket = lazyNamed(() => import('./pages/settings/support-ticket'), 'SettingsSupportTicket')
const SettingsImport        = lazyNamed(() => import('./pages/settings/import'),        'SettingsImport')
const DropboxCallback       = lazyNamed(() => import('./pages/settings/import/dropbox-callback'), 'DropboxCallback')
const GoogleCallback        = lazyNamed(() => import('./pages/settings/import/google-callback'),  'GoogleCallback')
const DevicesPage           = lazyNamed(() => import('./pages/devices'),                           'DevicesPage')
const ScanPage              = lazyNamed(() => import('./pages/scan'),                             'ScanPage')
const FileRequestPage       = lazyNamed(() => import('./pages/file-request'),                     'FileRequestPage')
const UploadRequestPage     = lazyNamed(() => import('./pages/upload-request'),                   'UploadRequestPage')

// Admin pages live at admin.beebeeb.io now (own repo, own subdomain) —
// see docs/superpowers/specs/2026-05-07-admin-portal-separation.md.
// The /admin/* catch-all below redirects any leftover deep links there.
import { ThemeProvider } from './lib/theme-context'
import { DisplayProvider } from './lib/display-context'
import { BillingBanner } from './components/billing-banner'
import { AccountNoticeBanner } from './components/account-notice-banner'
import { IncidentBanner } from './components/incident-banner'
import { BillingSuspendedOverlay } from './components/billing-suspended-overlay'
import { CookieBanner } from './components/cookie-banner'
import { DriveDataProvider, useDriveData } from './lib/drive-data-context'
import { SearchIndexProvider } from './lib/search-index-context'

/**
 * Task 1693 Part B renders this as the explicit, metadata-only "Vault
 * locked" state for an impersonated session (ruling D-2026-10-02, option A:
 * "net zoals in iOS dat er staat 'vault locked', de rest hetzelfde").
 * Exported for `bun test` (this repo has no jsdom/@testing-library; see
 * test/1693-impersonated-vault-locked.test.tsx for the render harness).
 * NOT exported from the app bundle elsewhere.
 */
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const { isUnlocked, vaultExists, vaultChecked } = useKeys()
  const location = useLocation()
  // Task 1704 SLICE 2 — the escape hatch out of the no-key surface: once the
  // user asks for the password form ("I remember my previous password"), this
  // instance renders VaultUnlock for the rest of its life. The marker itself
  // is cleared by the surface's handler, so sibling route instances agree.
  const [unlockFormRequested, setUnlockFormRequested] = useState(false)

  // Once the vault IS unlocked (e.g. the /recover-with-phrase ceremony
  // re-wrapped the key under the fresh password), the post-reset marker has
  // served its purpose — clear it so any LATER lock in this tab returns to
  // the normal password form, not the no-key surface.
  useEffect(() => {
    if (isUnlocked && isPostResetLockedDevice()) clearPostResetLock()
  }, [isUnlocked])

  if (loading || !vaultChecked) return null

  // Preserve the intended destination so the login flow can return here after
  // auth — notably the CLI device-auth round-trip to /cli-auth (the code is
  // typed on that page, never carried in the URL), which is bounced here before
  // login.tsx ever sees the URL. login.tsx validates
  // `next` against a strict allowlist (safe-redirect.ts), so a non-allowlisted
  // path simply falls back to "/" — safe to set for every protected route.
  const loginTo = `/login?next=${encodeURIComponent(location.pathname + location.search)}`

  if (!user) return <Navigate to={loginTo} replace />
  if (!isUnlocked) {
    if (!vaultExists) return <Navigate to={loginTo} replace />
    // Task 1693 (Part B, ruling D-2026-10-02 — option A, "net zoals in iOS
    // dat er staat vault locked, de rest hetzelfde"): an impersonated
    // session must NOT render the password form. VaultUnlock's submit calls
    // unlockVault(password, <target user_id>) — the admin would be typing
    // their own password against the TARGET account's vault entry (tagged
    // to a different user_id; after task 1531 it correctly refuses, so the
    // form is not just wrong, it can never succeed). Zero-knowledge means
    // no key material for the target exists in this session, period. Show
    // the explicit, metadata-only "Vault locked" state instead. Normal
    // (non-impersonated) users keep the existing VaultUnlock flow untouched.
    //
    // Task 1704 SLICE 2 (decision doc D-2026-10-02, Amendment + §4c): a
    // NON-impersonated user who just completed the email password reset
    // holds a FRESH account credential but no vault key — the device's
    // wrapped vault can never open under the new password, so VaultUnlock's
    // form is a dead end for them. The /set-password completion stamps a
    // marker (src/lib/post-reset-lock.ts — no key-context/crypto change);
    // with it present, render the honest locked-state surface instead:
    // re-entry via the 12-word phrase plus the self-service exits (cancel
    // billing, delete all data, delete account). The decision itself is
    // factored into resolveLockedVaultSurface() — impersonation keeps
    // priority exactly as 1693 shipped it, and users without the marker
    // (a normal lock, or a tab where the old password may still work) get
    // VaultUnlock byte-for-byte unchanged.
    const surface = resolveLockedVaultSurface({
      impersonating: isImpersonationSessionActive(),
      postResetMarker: isPostResetLockedDevice(),
      unlockFormRequested,
    })
    if (surface === 'impersonated') return <VaultLockedImpersonated />
    if (surface === 'no_key') {
      return (
        <VaultLockedNoKey onTryPreviousPassword={() => setUnlockFormRequested(true)} />
      )
    }
    return <VaultUnlock />
  }

  return (
    <PlanGate>
      <SessionTimeoutWarning />
      <WasmGuard>{children}</WasmGuard>
    </PlanGate>
  )
}

/**
 * Task 1037 — no free signups. A `needs_plan` account (never started a trial
 * or plan) is sent to /choose-plan from every protected route except the few
 * it still needs (the chooser, account settings/deletion, billing, logout —
 * see `planGateRedirect`). Waits for the first subscription fetch so a new
 * account never flashes the drive; the shared cache in DriveDataProvider is
 * refreshed on `billing_updated` / plan-changed, so the gate lifts itself the
 * moment the trial is live. A missing `account_state` (older server) is "ok".
 *
 * Task 1816: `accountState` is the onboarding document's when it is available
 * (an allowance account is `ok` and reaches the drive; only `needs_plan` WITHOUT
 * an allowance goes to the chooser), else the legacy subscription's.
 */
function PlanGate({ children }: { children: ReactNode }) {
  const { accountState, accountBlocking, subscriptionSettled, planDetails } = useDriveData()
  const location = useLocation()
  // A billing refresh re-opens `subscriptionSettled` while the document is
  // re-fetched (1816 round 2). Once the gate has decided for this account, keep
  // the app mounted through that window — never a spinner that remounts the
  // drive, never a redirect decided on the half-refreshed state.
  const decidedFor = useRef<string | null>(null)
  const { user } = useAuth()
  const { getMasterKey } = useKeys()
  // A welcome file onboarding deferred while the account had no plan is
  // uploaded once the account is entitled — here for every later page (another
  // tab, a later visit); /choose-plan's success path does it inline. Deduped +
  // "pending"-guarded in src/lib/welcome-file.ts, so this is one preference
  // GET per session for everyone else.
  const userId = user?.user_id
  useEffect(() => {
    if (!subscriptionSettled || accountState !== 'ok' || !userId) return
    let masterKey: Uint8Array
    try {
      masterKey = getMasterKey(userId)
    } catch {
      return
    }
    void flushDeferredWelcomeFile(userId, masterKey)
  }, [subscriptionSettled, accountState, userId, getMasterKey])
  if (subscriptionSettled) decidedFor.current = userId ?? null
  if (!subscriptionSettled && userId && decidedFor.current === userId) {
    return <>{children}</>
  }
  if (!subscriptionSettled) {
    return (
      <div className="flex items-center justify-center min-h-screen" aria-busy="true">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-amber" />
      </div>
    )
  }
  // Task 1814: an account that arrived through a coupon link and holds no plan claims it
  // before anything else (including the chooser, and including an allowance account, which
  // 1816 counts as `ok`). The hold ends on any final answer (see pages/coupon.tsx).
  // An unreadable subscription is "unknown", never "no plan": it redirects nobody.
  const sub = planDetails.subscription
  const couponTo = sub ? heldCouponRedirect(accountState, sub.plan, readHeldCoupon()) : null
  if (couponTo && location.pathname !== couponTo.split('?')[0]) return <Navigate to={couponTo} replace />
  const to = planGateRedirect(location.pathname, accountState, accountBlocking)
  if (to) return <Navigate to={to} replace />
  return <>{children}</>
}

/**
 * External redirect to the standalone admin portal. Used by the legacy
 * /admin/* routes — the user app no longer hosts admin pages, so we
 * bounce any deep link to admin.beebeeb.io. The admin app's login page
 * handles unauthenticated visitors.
 *
 * `useEffect` runs the navigation as a side-effect so the browser does a
 * real cross-origin GET (react-router's `<Navigate>` only manipulates
 * the in-app history stack — it can't leave the origin).
 */
function AdminRedirect() {
  useEffect(() => {
    window.location.href = 'https://admin.beebeeb.io/'
  }, [])
  return null
}

/**
 * Redirect that preserves the query string. A plain `<Navigate to="/path" />`
 * with a static string `to` drops the current `?search` (react-router v7), so a
 * checkout return like `/billing?upgraded=true` would land on `/settings/billing`
 * with the param stripped — and the billing page's `?upgraded` finalize/poll flow
 * (and the legacy Stripe `?success`/`?session_id` returns) would never fire.
 * Carrying `location.search` through the hop keeps the return params intact (0865).
 *
 * `state={location.state}` (task 1518 part C): `<Navigate>` does NOT forward
 * router state on its own, so a `navigate('/billing', { state: {...} })` call
 * (e.g. upgrade-nudge-modal.tsx carrying a billing-reset explanation across
 * the nav) would silently lose it at this hop without this — the receiving
 * `/settings/billing` page would read `useLocation().state` as `null`.
 */
function RedirectPreservingSearch({ to }: { to: string }) {
  const location = useLocation()
  return <Navigate to={{ pathname: to, search: location.search }} state={location.state} replace />
}

function GuestRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const { isUnlocked } = useKeys()
  const [searchParams] = useSearchParams()
  const location = useLocation()

  if (loading) return null
  // Only redirect to app if user is fully authenticated AND vault is unlocked.
  // An authenticated user with a locked vault needs to stay on login to
  // unlock or provision their device.
  if (user && isUnlocked) {
    // Task 1437 — this branch can fire a STALE render after login.tsx's
    // navigateAfterLogin() has ALREADY navigated the user to their real
    // `?next=` destination (notably the CLI device-auth round-trip,
    // /cli-auth): `isUnlocked` flipping true (inside setMasterKey /
    // unlockVault, on the OPAQUE-login or device-provision success path)
    // and the router committing the new location land in separate React
    // render passes, so GuestRoute — still matched against its own
    // (by-then-stale) `/login?next=…` location — can render ONE MORE TIME
    // after the URL has already moved on. Hard-coding "/" here would let
    // that stale render win the race with its own `replace` navigation,
    // silently bouncing the user off the CLI-authorize prompt onto the
    // drive (the exact bug: reaches /cli-auth correctly, then ~1s
    // later re-navigates to "/"). Honouring the SAME allowlisted `next`
    // login.tsx itself would follow (safe-redirect.ts) makes both
    // navigations agree on the destination, so whichever one the render
    // race lands on, the user still ends up where they were headed —
    // eliminating the race as a user-visible symptom rather than trying to
    // win a timing contest against React's scheduling.
    const fromQuery = sanitizeRedirect(searchParams.get('next'))
    // Same race for a brand-new account leaving /onboarding: its final
    // refreshUser() re-renders this guard before onboarding's own navigate()
    // to the plan chooser (plan picked on the site, src/lib/plan-intent.ts).
    // Compute the same destination so neither navigation can undo the other.
    return <Navigate to={fromQuery ?? guestRouteFallback(location.pathname, readPlanIntent())} replace />
  }
  return <>{children}</>
}

/**
 * Handles ?onboarding=force (spec 024 §3.1) and ?reset-onboarding=true.
 * Both reset the onboarding localStorage state to 'welcome_file' so the flow
 * can be re-triggered without a fresh signup. Production-safe (local UX only).
 */
function OnboardingResetHandler() {
  const navigate = useNavigate()
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const forceOnboarding = params.get('onboarding') === 'force' || params.get('reset-onboarding') === 'true'
    if (forceOnboarding) {
      try {
        localStorage.setItem('beebeeb_onboarding_state', JSON.stringify({ step: 'welcome_file' }))
      } catch {
        // localStorage may be unavailable — ignore
      }
      // Strip the query param and reload
      params.delete('onboarding')
      params.delete('reset-onboarding')
      const newSearch = params.toString()
      navigate({ search: newSearch ? `?${newSearch}` : '' }, { replace: true })
    }
  }, [navigate])
  return null
}

// Public routes an anonymous visitor must be able to use — a 401 (e.g. the boot
// getMe() with no session) must NEVER bounce them off these to /login. Defense
// in depth with request.ts's anonymous-401 gate (task 0741).
const PUBLIC_ROUTE_PATTERNS: RegExp[] = [
  /^\/s\//, // share recipient view
  /^\/r\//, // file-request upload
  /^\/receive(\/|$)/,
  /^\/p\//, // public profile
  /^\/join\//,
  /^\/invite\//,
  /^\/auth\/impersonate(\/|$)/,
  /^\/cookies(\/|$)/,
  /^\/return-to-app(\/|$)/, // checkout return page for native apps (task 1743)
]
function isPublicPath(pathname: string): boolean {
  return PUBLIC_ROUTE_PATTERNS.some((re) => re.test(pathname))
}

/** Wire API error hooks into the toast + routing system. */
function ApiErrorWiring() {
  const { showToast } = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    registerErrorNotifier((message) => {
      showToast({ icon: 'cloud', title: 'Connection error', description: message, danger: true })
    })
    registerSessionExpiredHandler(() => {
      // Never redirect off a public route — an anonymous share/file-request
      // recipient (and even a logged-in user viewing a public share) must not
      // be yanked to /login by a 401 (task 0741).
      if (isPublicPath(window.location.pathname)) return
      navigate('/login', { replace: true })
    })
    // Task 1404 — the CENTRAL account_deleted handler. `request()` (shared)
    // fires this on ANY authenticated call that gets the account_deleted 403
    // — not just login.tsx's own login-finish calls — so a tab that was
    // already open when the account got deleted elsewhere (another device,
    // or the delete-account flow in a second tab) also gets signed out with
    // the exact copy, not a generic error. The token is already cleared by
    // request() itself before this fires. Stash the formatted message
    // (login.tsx reads it on mount) then redirect, same public-route guard
    // as session-expiry above — account_deleted can only ever originate from
    // an authenticated call, but stay consistent regardless.
    registerAccountDeletedHandler((body) => {
      const msg = formatAccountDeletedMessage(body.deleted_at, body.shred_after)
      if (msg) stashAccountDeletedNotice(msg)
      if (isPublicPath(window.location.pathname)) return
      navigate('/login', { replace: true })
    })
    return () => {
      registerErrorNotifier(null as unknown as (m: string) => void)
      registerSessionExpiredHandler(null as unknown as () => void)
      registerAccountDeletedHandler(null as unknown as (b: Record<string, unknown>) => void)
    }
  }, [showToast, navigate])

  // Global handler for unhandled promise rejections (useEffect async errors,
  // fire-and-forget fetches, etc.). These do NOT trigger the React ErrorBoundary
  // — class component boundaries only catch render-phase errors. This handler
  // logs them in dev and reports to our own GlitchTip in Falkenstein when the
  // user has opted in.
  useEffect(() => {
    function handleUnhandledRejection(ev: PromiseRejectionEvent) {
      console.error('[unhandledRejection] Unhandled promise rejection:', ev.reason)
      reportError(ev.reason, { boundary: 'unhandledrejection' })
      // Do NOT call ev.preventDefault() — keep the browser's native
      // "Uncaught (in promise)" warning visible in DevTools.
    }
    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    return () => window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  }, [])

  return null
}

function GlobalShortcuts() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  const closePalette = useCallback(() => setPaletteOpen(false), [])
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), [])

  useKeyboardShortcuts({
    onCommandPalette: () => setPaletteOpen((v) => !v),
    onShortcuts: () => setShortcutsOpen((v) => !v),
    onEscape: () => {
      if (paletteOpen) setPaletteOpen(false)
      else if (shortcutsOpen) setShortcutsOpen(false)
    },
  })

  // Let any surface (e.g. the drive toolbar search field) open the palette
  // without prop-drilling the setter through the route tree (task 0842).
  useEffect(() => {
    function onOpen() { setPaletteOpen(true) }
    window.addEventListener('beebeeb:open-command-palette', onOpen)
    return () => window.removeEventListener('beebeeb:open-command-palette', onOpen)
  }, [])

  return (
    <>
      <CommandPalette open={paletteOpen} onClose={closePalette} />
      <ShortcutsCheatsheet open={shortcutsOpen} onClose={closeShortcuts} />
    </>
  )
}

export function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
    <BrowserRouter>
      <ImpersonationProvider>
      <DevAuthGate>
      <AuthProvider>
        <OnboardingProvider>
        <KeyProvider>
        <WsProvider>
        <SyncProvider>
        <ToastProvider>
        <DriveDataProvider>
        <SearchIndexProvider>
        <DisplayProvider>
        {/* Skip link — first focusable element; visible only on keyboard focus */}
        <a href="#main-content" className="skip-to-content">
          Skip to main content
        </a>
        <ApiErrorWiring />
        <OnboardingResetHandler />
        <IncidentBanner />
        <ImpersonationBanner />
        <OfflineBanner />
        <BillingBanner />
        <AccountNoticeBanner />
        <BillingSuspendedOverlay />
        <GlobalShortcuts />
        <CookieBanner />
        <Suspense fallback={
          <div className="flex items-center justify-center min-h-screen">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-amber" />
          </div>
        }>
        <Routes>
          <Route
            path="/signup"
            element={
              <GuestRoute>
                {SignupFromDocument ? <SignupFromDocument /> : <Signup />}
              </GuestRoute>
            }
          />
          <Route
            path="/login"
            element={
              <GuestRoute>
                <Login />
              </GuestRoute>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <GuestRoute>
                <ForgotPassword />
              </GuestRoute>
            }
          />
          <Route
            path="/reset/:token"
            element={
              <GuestRoute>
                <ResetPassword />
              </GuestRoute>
            }
          />
          {/* Task 1704 — one-time set-password page. The emailed link is the
              entry proof; the token rides in the PATH (preview-safe). A user
              finishing here is logging OUT everywhere else and IN on this
              device, so no auth guard beyond GuestRoute's own semantics. */}
          <Route
            path="/set-password/:token"
            element={
              <GuestRoute>
                <SetPassword />
              </GuestRoute>
            }
          />
          {/* A link opened without its token → the page renders its own
              "incomplete link" state; route without param kept explicit. */}
          <Route
            path="/set-password"
            element={
              <GuestRoute>
                <SetPassword />
              </GuestRoute>
            }
          />
          {/* Public — a locked-out user can't authenticate, so no guard (0764A). */}
          <Route path="/unlock/:token" element={<Unlock />} />
          <Route
            path="/recover-with-phrase"
            element={
              <GuestRoute>
                <RecoverWithPhrase />
              </GuestRoute>
            }
          />
          <Route
            path="/verify-email"
            element={
              <ProtectedRoute>
                <VerifyEmail />
              </ProtectedRoute>
            }
          />
          {/* Office editor (task 1567) — its OWN top-level route, opened via
              window.open() from file-preview.tsx, never nested in the Drive
              page. See office-editor-page.tsx's header comment for why this
              must be a real navigation and not an in-app overlay. Path is
              `/office/:fileId` (not e.g. `/office-editor`) specifically to
              reuse nginx.conf's PRE-EXISTING `location /office/` block,
              which the task 1567 delivery-groundwork phase already wrote for
              exactly this — "office page route itself (e.g. /office/<fileId>)
              is client-rendered — SPA fallback... carrying the SAME
              isolation headers" — rather than inventing a second one. */}
          <Route
            path="/office/:fileId"
            element={
              // Task 1567: the build flag (FEATURE_OFFICE_EDITOR, via
              // isOfficeLabsEnabled() — a pure alias since Guus dropped the
              // Labs opt-in, see office-labs.ts) is the only gate. The key
              // is the prod image gate's bundle marker (OFFICE_ROUTE_MARKER).
              isOfficeLabsEnabled() ? (
                <ProtectedRoute key={OFFICE_ROUTE_MARKER}>
                  <OfficeEditorPage />
                </ProtectedRoute>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route
            path="/onboarding"
            element={
              <GuestRoute>
                <Onboarding />
              </GuestRoute>
            }
          />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Drive />
              </ProtectedRoute>
            }
          />
          <Route
            path="/scan"
            element={
              <ProtectedRoute>
                <ScanPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/starred"
            element={
              <ProtectedRoute>
                <Starred />
              </ProtectedRoute>
            }
          />
          <Route
            path="/recent"
            element={
              <ProtectedRoute>
                <Recent />
              </ProtectedRoute>
            }
          />
          {/* Settings — all under /settings/* */}
          <Route path="/settings" element={<ProtectedRoute><Navigate to="/settings/profile" replace /></ProtectedRoute>} />
          <Route path="/settings/profile" element={<ProtectedRoute><SettingsProfile /></ProtectedRoute>} />
          <Route path="/settings/security" element={<ProtectedRoute><SettingsSecurity /></ProtectedRoute>} />
          <Route path="/settings/activity" element={<ProtectedRoute><SettingsActivity /></ProtectedRoute>} />
          <Route path="/settings/account" element={<ProtectedRoute><SettingsAccount /></ProtectedRoute>} />
          <Route path="/settings/data-residency" element={<ProtectedRoute><SettingsDataResidency /></ProtectedRoute>} />
          <Route path="/settings/privacy" element={<ProtectedRoute><SettingsPrivacy /></ProtectedRoute>} />
          <Route path="/settings/notifications" element={<ProtectedRoute><SettingsNotifications /></ProtectedRoute>} />
          <Route path="/settings/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
          <Route path="/settings/appearance" element={<ProtectedRoute><SettingsAppearance /></ProtectedRoute>} />
          <Route path="/settings/developer" element={<ProtectedRoute><SettingsDeveloper /></ProtectedRoute>} />
          <Route path="/settings/referrals" element={<ProtectedRoute><SettingsReferrals /></ProtectedRoute>} />
          <Route path="/settings/support" element={<ProtectedRoute><SettingsSupport /></ProtectedRoute>} />
          <Route path="/settings/support/:id" element={<ProtectedRoute><SettingsSupportTicket /></ProtectedRoute>} />
          <Route path="/settings/import" element={<ProtectedRoute><SettingsImport /></ProtectedRoute>} />
          <Route path="/settings/import/dropbox/callback" element={<ProtectedRoute><DropboxCallback /></ProtectedRoute>} />
          <Route path="/settings/import/google/callback" element={<ProtectedRoute><GoogleCallback /></ProtectedRoute>} />

          {/* Redirects for old routes */}
          <Route path="/settings/storage" element={<RedirectPreservingSearch to="/settings/billing" />} />
          <Route path="/settings/devices" element={<Navigate to="/settings/security" replace />} />
          <Route path="/settings/language" element={<Navigate to="/settings/appearance" replace />} />
          <Route path="/settings/2fa" element={<Navigate to="/settings/security" replace />} />
          <Route path="/security" element={<Navigate to="/settings/security" replace />} />
          <Route
            path="/photos"
            element={
              <ProtectedRoute>
                <Photos />
              </ProtectedRoute>
            }
          />
          <Route
            path="/trash"
            element={
              <ProtectedRoute>
                <Trash />
              </ProtectedRoute>
            }
          />
          <Route
            path="/devices"
            element={
              <ProtectedRoute>
                <DevicesPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/search"
            element={
              <ProtectedRoute>
                <Search />
              </ProtectedRoute>
            }
          />
          {/* Task 1037 — trial with a payment mandate. Every new account lands
              here after onboarding; Mollie returns here (?returned=1). */}
          <Route
            path="/choose-plan"
            element={
              <ProtectedRoute>
                <ChoosePlan />
              </ProtectedRoute>
            }
          />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/billing" element={<RedirectPreservingSearch to="/settings/billing" />} />
          {/* Admin moved to admin.beebeeb.io. Redirect any /admin/* URL
              there so old bookmarks keep working. The admin app's login
              page handles unauthenticated visitors. See
              docs/superpowers/specs/2026-05-07-admin-portal-separation.md. */}
          <Route path="/admin" element={<AdminRedirect />} />
          <Route path="/admin/*" element={<AdminRedirect />} />
          {/* CLI web auth — `bb login --browser` */}
          <Route path="/cli-auth" element={<ProtectedRoute><CliAuth /></ProtectedRoute>} />
          <Route
            path="/migration"
            element={
              <ProtectedRoute>
                <Migration />
              </ProtectedRoute>
            }
          />
          <Route
            path="/team"
            element={
              FEATURE_TEAMS ? (
                <ProtectedRoute>
                  <Team />
                </ProtectedRoute>
              ) : (
                <Navigate to="/" replace />
              )
            }
          />
          <Route path="/invite/:token" element={<AcceptInvite />} />
          <Route
            path="/shared"
            element={
              <ProtectedRoute>
                <Shared />
              </ProtectedRoute>
            }
          />
          <Route
            path="/shared-folder/:folderId"
            element={
              <ProtectedRoute>
                <SharedFolder />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/passkeys"
            element={
              <ProtectedRoute>
                <PasskeySetup />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/delete-account"
            element={
              <ProtectedRoute>
                <DeleteAccount />
              </ProtectedRoute>
            }
          />
          {/* Admin impersonation redemption — public; the token in the
              query string is the credential. See task 0161. */}
          <Route path="/auth/impersonate" element={<ImpersonateRedeem />} />
          <Route path="/s/:token" element={<ShareViewPage />} />
          {/* Public user profile — no auth required */}
          <Route path="/p/:username" element={<PublicProfilePage />} />
          <Route path="/join/:code" element={<JoinPage />} />
          {/* Task 1814: coupon links. Public; the page routes to signup / login / claim. */}
          <Route path="/c/:code" element={<Coupon />} />
          <Route path="/cookies" element={<Cookies />} />
          {/* Task 1743: where a native app's Mollie checkout returns the system browser. Public;
              the path is fixed server-side (checkout_return::APP_RETURN_PATH). */}
          <Route path="/return-to-app" element={<ReturnToApp />} />
          <Route path="/receive" element={<Receive />} />
          {/* E2EE File Requests — creation page (auth required) */}
          <Route
            path="/file-requests"
            element={
              <ProtectedRoute>
                <FileRequestPage />
              </ProtectedRoute>
            }
          />
          {/* E2EE File Requests — public upload page (no auth) */}
          <Route path="/r/:token" element={<UploadRequestPage />} />
          <Route path="/logout" element={<Logout />} />
          <Route path="/500" element={<ServerError />} />
          {/* Dev-only: task 1567 office loading-skeleton harness. Not present in prod. */}
          {DevOfficePreview && <Route path="/dev/office-preview" element={<DevOfficePreview />} />}
          {/* Dev-only: task 1745 onboarding fixture harness. Not present in prod. */}
          {DevOnboardingFixtures && <Route path="/dev/onboarding/:fixture" element={<DevOnboardingFixtures />} />}
          {AccountStatusFromDocument && (
            <Route
              path="/account-status"
              element={
                <ProtectedRoute>
                  <AccountStatusFromDocument />
                </ProtectedRoute>
              }
            />
          )}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        </DisplayProvider>
        </SearchIndexProvider>
        </DriveDataProvider>
        </ToastProvider>
        </SyncProvider>
        </WsProvider>
        </KeyProvider>
        </OnboardingProvider>
      </AuthProvider>
      </DevAuthGate>
      </ImpersonationProvider>
    </BrowserRouter>
    </ThemeProvider>
    </ErrorBoundary>
  )
}
