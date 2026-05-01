import { useState, useCallback, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { AuthProvider, useAuth } from './lib/auth-context'
import { KeyProvider, useKeys } from './lib/key-context'
import { ToastProvider, useToast } from './components/toast'
import { ErrorBoundary } from './components/error-boundary'
import { WasmGuard } from './components/wasm-guard'
import { VaultUnlock } from './components/vault-unlock'
import { OfflineBanner } from './components/offline-banner'
import { registerErrorNotifier, registerSessionExpiredHandler } from './lib/api'
import { CommandPalette } from './components/command-palette'
import { ShortcutsCheatsheet } from './components/shortcuts-cheatsheet'
import { useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts'
import { Signup } from './pages/signup'
import { Login } from './pages/login'
import { Onboarding } from './pages/onboarding'
import { Drive } from './pages/drive'
import { SettingsProfile } from './pages/settings/profile'
import { SettingsDevices } from './pages/settings/devices'
import { SettingsNotifications } from './pages/settings/notifications'
import { SettingsLanguage } from './pages/settings/language'
import { SettingsStorage } from './pages/settings/storage'
import { Security } from './pages/security'
import { Trash } from './pages/trash'
import { Search } from './pages/search'
import { Pricing } from './pages/pricing'
import { Billing } from './pages/billing'
import { Photos } from './pages/photos'
import { ShareViewPage } from './pages/share-view'
import { AuditLog } from './pages/admin/audit-log'
import { SsoSetup } from './pages/admin/sso'
import { DataExport } from './pages/admin/data-export'
import { ApiTokens } from './pages/admin/api-tokens'
import { Compliance } from './pages/admin/compliance'
import { AdminUsers } from './pages/admin/users'
import { AdminBilling } from './pages/admin/billing-overview'
import { StoragePools } from './pages/admin/storage-pools'
import { Monitoring } from './pages/admin/monitoring'
import { AdminMigrations } from './pages/admin/migrations'
import { TwoFactorSetup } from './pages/two-factor-setup'
import { VerifyEmail } from './pages/verify-email'
import { Migration } from './pages/migration'
import { Team } from './pages/team'
import { AcceptInvite } from './pages/accept-invite'
import { Shared } from './pages/shared'
import { SharedFolder } from './pages/shared-folder'
import { PasskeySetup } from './pages/passkey-setup'
import { DeleteAccount } from './pages/delete-account'
import { NotFound } from './pages/errors/not-found'

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
    <BrowserRouter>
      <AuthProvider>
        <KeyProvider>
        <ToastProvider>
        <ApiErrorWiring />
        <OfflineBanner />
        <GlobalShortcuts />
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
                <Drive />
              </ProtectedRoute>
            }
          />
          <Route
            path="/recent"
            element={
              <ProtectedRoute>
                <Drive />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Navigate to="/settings/profile" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/profile"
            element={
              <ProtectedRoute>
                <SettingsProfile />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/devices"
            element={
              <ProtectedRoute>
                <SettingsDevices />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/notifications"
            element={
              <ProtectedRoute>
                <SettingsNotifications />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/language"
            element={
              <ProtectedRoute>
                <SettingsLanguage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/storage"
            element={
              <ProtectedRoute>
                <SettingsStorage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings/2fa"
            element={
              <ProtectedRoute>
                <TwoFactorSetup />
              </ProtectedRoute>
            }
          />
          <Route
            path="/security"
            element={
              <ProtectedRoute>
                <Security />
              </ProtectedRoute>
            }
          />
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
          <Route
            path="/billing"
            element={
              <ProtectedRoute>
                <Billing />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute>
                <Navigate to="/admin/monitoring" replace />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/monitoring"
            element={
              <ProtectedRoute>
                <Monitoring />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/audit-log"
            element={
              <ProtectedRoute>
                <AuditLog />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/sso"
            element={
              <ProtectedRoute>
                <SsoSetup />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/data-export"
            element={
              <ProtectedRoute>
                <DataExport />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/api-tokens"
            element={
              <ProtectedRoute>
                <ApiTokens />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/users"
            element={
              <ProtectedRoute>
                <AdminUsers />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/billing"
            element={
              <ProtectedRoute>
                <AdminBilling />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/storage-pools"
            element={
              <ProtectedRoute>
                <StoragePools />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/migrations"
            element={
              <ProtectedRoute>
                <AdminMigrations />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/compliance"
            element={
              <ProtectedRoute>
                <Compliance />
              </ProtectedRoute>
            }
          />
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
          <Route path="*" element={<NotFound />} />
        </Routes>
        </ToastProvider>
        </KeyProvider>
      </AuthProvider>
    </BrowserRouter>
    </ErrorBoundary>
  )
}
