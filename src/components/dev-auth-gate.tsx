/**
 * DevAuthGate — wraps the authenticated app and injects dev credentials
 * before AuthProvider + KeyProvider mount.
 *
 * In production (`import.meta.env.DEV === false`) this is a no-op passthrough;
 * Vite constant-folds the check and Rollup tree-shakes the dev logic.
 *
 * Why a gate (not a useEffect in the app)?
 * AuthProvider reads localStorage on mount. KeyProvider reads sessionStorage
 * via restoreCachedKey() after initCrypto resolves. Both need the credentials
 * in place BEFORE they first render. A gate component that delays child mount
 * until the credentials are written ensures the timing is correct.
 */

import { useState, useEffect, type ReactNode } from 'react'
import { devAutoAuth, getDevAuthInfo } from '../lib/dev-auth'

// ─── Dev banner ───────────────────────────────────────────────────────────────

function DevBanner() {
  const [dismissed, setDismissed] = useState(false)
  const info = getDevAuthInfo()

  if (!info || dismissed) return null

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[9999] flex items-center justify-between gap-3 px-4 py-1.5 text-xs font-mono"
      style={{
        background: 'oklch(0.30 0.10 280)',
        color: 'oklch(0.92 0.04 280)',
        borderBottom: '1px solid oklch(0.45 0.12 280)',
      }}
    >
      <span>
        <span style={{ color: 'oklch(0.78 0.15 280)' }}>⚡ DEV</span>
        {' — auto-logged in as '}
        <span className="font-semibold">{info.email}</span>
        {' ('}
        <span style={{ color: 'oklch(0.82 0.17 84)' }}>{info.role}</span>
        {')'}
      </span>
      <button
        onClick={() => setDismissed(true)}
        className="opacity-60 hover:opacity-100 transition-opacity px-1"
        aria-label="Dismiss dev banner"
      >
        ✕
      </button>
    </div>
  )
}

// ─── Gate ─────────────────────────────────────────────────────────────────────

interface DevAuthGateProps {
  children: ReactNode
}

export function DevAuthGate({ children }: DevAuthGateProps) {
  // In production: constant-folded to `return <>{children}</>` by Vite/Rollup.
  if (!import.meta.env.DEV) return <>{children}</>

  // In dev: the hook below is safe — this branch is always reached in dev.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return <DevAuthGateInner>{children}</DevAuthGateInner>
}

function DevAuthGateInner({ children }: { children: ReactNode }) {
  // Start ready if BOTH a session token and a session-cached master key exist.
  // If the cache is missing (e.g. after a page reload) we need to re-inject it
  // via devAutoAuth even if a session token is already present.
  const [ready, setReady] = useState(() => {
    const hasToken = !!localStorage.getItem('bb_session')
    const hasCachedKey =
      !!sessionStorage.getItem('bb_sk') &&
      !!sessionStorage.getItem('bb_iv') &&
      !!sessionStorage.getItem('bb_mk')
    return hasToken && hasCachedKey
  })
  const [devAuthed, setDevAuthed] = useState(false)

  useEffect(() => {
    if (ready) return
    devAutoAuth().then((authed) => {
      setDevAuthed(authed)
      setReady(true)
    })
  }, [ready])

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-paper">
        <div className="flex items-center gap-2 text-sm text-ink-3 font-mono">
          <div className="w-3.5 h-3.5 border-2 border-ink-3 border-t-transparent rounded-full animate-spin" />
          dev auth…
        </div>
      </div>
    )
  }

  return (
    <>
      {devAuthed && <DevBanner />}
      {children}
    </>
  )
}
