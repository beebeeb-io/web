import React, { useState, useCallback, useEffect, lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './lib/auth-context'
import { KeyProvider, useKeys } from './lib/key-context'
import { WsProvider } from './lib/ws-context'
import { SyncProvider } from './lib/sync-context'
import { OnboardingProvider } from './lib/onboarding-context'
import { ToastProvider, useToast } from './components/toast'
import { ErrorBoundary } from './components/error-boundary'
import { WasmGuard } from './components/wasm-guard'
import { VaultUnlock } from './components/vault-unlock'
import { OfflineBanner } from './components/offline-banner'
import { ImpersonationProvider } from './lib/impersonation-context'
import { ImpersonationBanner } from './components/impersonation-banner'
import { DevAuthGate } from './components/dev-auth-gate'
import { registerErrorNotifier, registerSessionExpiredHandler } from './lib/api'
import { CommandPalette } from './components/command-palette'
import { ShortcutsCheatsheet } from './components/shortcuts-cheatsheet'
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts'
// ── Eager: needed on every first load ────────────────────────────────────────
import { Signup } from './pages/signup'
import { Login } from './pages/login'
import { Onboarding } from './pages/onboarding'
import { Drive } from './pages/drive'

// ── Lazy: split into separate chunks, loaded on demand ───────────────────────
// Named-export helper: React.lazy requires a default export
function lazyNamed<T>(factory: () => Promise<{ [K in keyof T]: T[K] }>, name: keyof T) {
  return lazy(() => factory().then(m => ({ default: m[name] as React.ComponentType })))
}

const Starred        = lazyNamed(() => import('./pages/starred'),        'Starred')
const Recent         = lazyNamed(() => import('./pages/recent'),         'Recent')
const Shared         = lazyNamed(() => import('./pages/shared'),         'Shared')
const SharedFolder   = lazyNamed(() => import('./pages/shared-folder'),  'SharedFolder')
const Trash          = lazyNamed(() => import('./pages/trash'),          'Trash')
const Search         = lazyNamed(() => import('./pages/search'),         'Search')
const Photos         = lazyNamed(() => import('./pages/photos'),         'Photos')
const Pricing        = lazyNamed(() => import('./pages/pricing'),        'Pricing')
const Billing        = lazyNamed(() => import('./pages/billing'),        'Billing')
const ShareViewPage  = lazyNamed(() => import('./pages/share-view'),     'ShareViewPage')
const ForgotPassword = lazyNamed(() => import('./pages/forgot-password'),'ForgotPassword')
const ResetPassword  = lazyNamed(() => import('./pages/reset-password'), 'ResetPassword')
const RecoverWithPhrase = lazyNamed(() => import('./pages/recover-with-phrase'), 'RecoverWithPhrase')
const VerifyEmail    = lazyNamed(() => import('./pages/verify-email'),   'VerifyEmail')
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
const NotFound       = lazyNamed(() => import('./pages/errors/not-found'),   'NotFound')
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
const SettingsImport        = lazyNamed(() => import('./pages/settings/import'),        'SettingsImport')
const DropboxCallback       = lazyNamed(() => import('./pages/settings/import/dropbox-callback'), 'DropboxCallback')
const GoogleCallback        = lazyNamed(() => import('./pages/settings/import/google-callback'),  'GoogleCallback')
const ScanPage              = lazyNamed(() => import('./pages/scan'),                             'ScanPage')
const FileRequestPage       = lazyNamed(() => import('./pages/file-request'),                     'FileRequestPage')
const UploadRequestPage     = lazyNamed(() => import('./pages/upload-request'),                   'UploadRequestPage')

// Admin pages live at admin.beebeeb.io now (own repo, own subdomain) —
// see docs/superpowers/specs/2026-05-07-admin-portal-separation.md.
// The /admin/* catch-all below redirects any leftover deep links there.
import { ThemeProvider } from './lib/theme-context'
import { DisplayProvider } from './lib/display-context'
import { CookieBanner } from './components/cookie-banner'

function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const { isUnlocked, vaultExists, vaultChecked } = useKeys()

  if (loading || !vaultChecked) return null
  if (!user) return <Navigate to="/login" replace />

  if (!isUnlocked) {
    if (vaultExists) {
      return <VaultUnlock />
    }
    return <Navigate to="/login" replace />
  }

  return <WasmGuard>{children}</WasmGuard>
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

function GuestRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const { isUnlocked } = useKeys()

  if (loading) return null
  // Only redirect to app if user is fully authenticated AND vault is unlocked.
  // An authenticated user with a locked vault needs to stay on login to
  // unlock or provision their device.
  if (user && isUnlocked) return <Navigate to="/" replace />
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

/** Wire API error hooks into the toast + routing system. */
function ApiErrorWiring() {
  const { showToast } = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    registerErrorNotifier((message) => {
      showToast({ icon: 'cloud', title: 'Connection error', description: message, danger: true })
    })
    registerSessionExpiredHandler(() => {
      navigate('/login', { replace: true })
    })
    return () => {
      registerErrorNotifier(null as unknown as (m: string) => void)
      registerSessionExpiredHandler(null as unknown as () => void)
    }
  }, [showToast, navigate])

  // Global handler for unhandled promise rejections (useEffect async errors,
  // fire-and-forget fetches, etc.). These do NOT trigger the React ErrorBoundary
  // — class component boundaries only catch render-phase errors. This handler
  // logs them in dev and provides a hook for Sentry in production.
  useEffect(() => {
    function handleUnhandledRejection(ev: PromiseRejectionEvent) {
      console.error('[unhandledRejection] Unhandled promise rejection:', ev.reason)
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
        <DisplayProvider>
        {/* Skip link — first focusable element; visible only on keyboard focus */}
        <a href="#main-content" className="skip-to-content">
          Skip to main content
        </a>
        <ApiErrorWiring />
        <OnboardingResetHandler />
        <ImpersonationBanner />
        <OfflineBanner />
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
                <Signup />
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
          <Route path="/settings/import" element={<ProtectedRoute><SettingsImport /></ProtectedRoute>} />
          <Route path="/settings/import/dropbox/callback" element={<ProtectedRoute><DropboxCallback /></ProtectedRoute>} />
          <Route path="/settings/import/google/callback" element={<ProtectedRoute><GoogleCallback /></ProtectedRoute>} />

          {/* Redirects for old routes */}
          <Route path="/settings/storage" element={<Navigate to="/settings/billing" replace />} />
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
            path="/search"
            element={
              <ProtectedRoute>
                <Search />
              </ProtectedRoute>
            }
          />
          <Route path="/pricing" element={<Pricing />} />
          <Route path="/billing" element={<Navigate to="/settings/billing" replace />} />
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
              <ProtectedRoute>
                <Team />
              </ProtectedRoute>
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
          <Route path="/cookies" element={<Cookies />} />
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
          <Route path="/500" element={<ServerError />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        </DisplayProvider>
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
