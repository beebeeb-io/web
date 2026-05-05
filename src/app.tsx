import { useState, useCallback, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './lib/auth-context'
import { KeyProvider, useKeys } from './lib/key-context'
import { WsProvider } from './lib/ws-context'
import { SyncProvider } from './lib/sync-context'
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
import { Signup } from './pages/signup'
import { Login } from './pages/login'
import { Onboarding } from './pages/onboarding'
import { Drive } from './pages/drive'
import { Starred } from './pages/starred'
import { Recent } from './pages/recent'
import { SettingsAccount } from './pages/settings/account'
import { SettingsNotifications } from './pages/settings/notifications'
import { SettingsAppearance } from './pages/settings/appearance'
import { SettingsDeveloper } from './pages/settings/developer'
import { SettingsReferrals } from './pages/settings/referrals'
import { SettingsImport } from './pages/settings/import'
import { DropboxCallback } from './pages/settings/import/dropbox-callback'
import { Security } from './pages/security'
import { Trash } from './pages/trash'
import { Search } from './pages/search'
import { Pricing } from './pages/pricing'
import { Billing } from './pages/billing'
import { Photos } from './pages/photos'
import { ShareViewPage } from './pages/share-view'
import { ForgotPassword } from './pages/forgot-password'
import { ResetPassword } from './pages/reset-password'
import { RecoverWithPhrase } from './pages/recover-with-phrase'
import { Compliance } from './pages/admin/compliance'
import { AdminUsers } from './pages/admin/users'
import { AdminBilling } from './pages/admin/billing-overview'
import { Dashboard } from './pages/admin/dashboard'
import { Infrastructure } from './pages/admin/infrastructure'
import { Security as AdminSecurity } from './pages/admin/security'
import { CliAuth } from './pages/cli-auth'
import { PoolLifecycle } from './pages/admin/pool-lifecycle'
import { MissionControl } from './pages/admin/mission-control'
import { AdminSettings } from './pages/admin/settings'
import { VerifyEmail } from './pages/verify-email'
import { Migration } from './pages/migration'
import { Team } from './pages/team'
import { AcceptInvite } from './pages/accept-invite'
import { Shared } from './pages/shared'
import { SharedFolder } from './pages/shared-folder'
import { PasskeySetup } from './pages/passkey-setup'
import { DeleteAccount } from './pages/delete-account'
import { Receive } from './pages/receive'
import { NotFound } from './pages/errors/not-found'
import { ServerError } from './pages/errors/server-error'
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
        <KeyProvider>
        <WsProvider>
        <SyncProvider>
        <ToastProvider>
        <DisplayProvider>
        <ApiErrorWiring />
        <ImpersonationBanner />
        <OfflineBanner />
        <GlobalShortcuts />
        <CookieBanner />
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
          <Route path="/settings" element={<ProtectedRoute><Navigate to="/settings/account" replace /></ProtectedRoute>} />
          <Route path="/settings/account" element={<ProtectedRoute><SettingsAccount /></ProtectedRoute>} />
          <Route path="/settings/security" element={<ProtectedRoute><Security /></ProtectedRoute>} />
          <Route path="/settings/notifications" element={<ProtectedRoute><SettingsNotifications /></ProtectedRoute>} />
          <Route path="/settings/billing" element={<ProtectedRoute><Billing /></ProtectedRoute>} />
          <Route path="/settings/appearance" element={<ProtectedRoute><SettingsAppearance /></ProtectedRoute>} />
          <Route path="/settings/developer" element={<ProtectedRoute><SettingsDeveloper /></ProtectedRoute>} />
          <Route path="/settings/referrals" element={<ProtectedRoute><SettingsReferrals /></ProtectedRoute>} />
          <Route path="/settings/import" element={<ProtectedRoute><SettingsImport /></ProtectedRoute>} />
          <Route path="/settings/import/dropbox/callback" element={<ProtectedRoute><DropboxCallback /></ProtectedRoute>} />

          {/* Redirects for old routes */}
          <Route path="/settings/profile" element={<Navigate to="/settings/account" replace />} />
          <Route path="/settings/storage" element={<Navigate to="/settings/account" replace />} />
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
          <Route path="/admin" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/admin/users" element={<ProtectedRoute><AdminUsers /></ProtectedRoute>} />
          <Route path="/admin/infrastructure" element={<ProtectedRoute><Infrastructure /></ProtectedRoute>} />
          <Route path="/admin/infrastructure/pools/:poolId" element={<ProtectedRoute><PoolLifecycle /></ProtectedRoute>} />
          <Route path="/admin/infrastructure/pools/:poolId/runs/:runId/monitor" element={<ProtectedRoute><MissionControl /></ProtectedRoute>} />
          <Route path="/admin/security" element={<ProtectedRoute><AdminSecurity /></ProtectedRoute>} />
          <Route path="/admin/billing" element={<ProtectedRoute><AdminBilling /></ProtectedRoute>} />
          <Route path="/admin/compliance" element={<ProtectedRoute><Compliance /></ProtectedRoute>} />
          <Route path="/admin/settings" element={<ProtectedRoute><AdminSettings /></ProtectedRoute>} />
          {/* CLI web auth — `bb login --browser` */}
          <Route path="/cli-auth" element={<ProtectedRoute><CliAuth /></ProtectedRoute>} />

          <Route path="/admin/monitoring" element={<Navigate to="/admin" replace />} />
          <Route path="/admin/audit-log" element={<Navigate to="/admin/security" replace />} />
          <Route path="/admin/storage-pools" element={<Navigate to="/admin/infrastructure" replace />} />
          <Route path="/admin/migrations" element={<Navigate to="/admin/infrastructure" replace />} />
          <Route path="/admin/abuse-reports" element={<Navigate to="/admin/security" replace />} />
          <Route path="/admin/waitlist" element={<Navigate to="/admin/users" replace />} />
          <Route path="/admin/sso" element={<Navigate to="/admin" replace />} />
          <Route path="/admin/data-export" element={<Navigate to="/admin" replace />} />
          <Route path="/admin/api-tokens" element={<Navigate to="/admin" replace />} />
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
          <Route path="/s/:token" element={<ShareViewPage />} />
          <Route path="/receive" element={<Receive />} />
          <Route path="/500" element={<ServerError />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </DisplayProvider>
        </ToastProvider>
        </SyncProvider>
        </WsProvider>
        </KeyProvider>
      </AuthProvider>
      </DevAuthGate>
      </ImpersonationProvider>
    </BrowserRouter>
    </ThemeProvider>
    </ErrorBoundary>
  )
}
