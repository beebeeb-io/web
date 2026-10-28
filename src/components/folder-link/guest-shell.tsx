import type { ReactNode } from 'react'

/**
 * Task 2237b — the anonymous guest chrome.
 *
 * Deliberately narrower than the Drive: a title bar, a content area and the
 * encryption status line. No sidebar, no account menu, no "save to my drive".
 */
export function GuestShell(props: {
  children: ReactNode
  title: string
  subtitle?: string
  status?: string
  toolbar?: ReactNode
}): ReactNode {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          <span className="h-2.5 w-2.5 rounded-full bg-amber" aria-hidden="true" />
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold">{props.title}</h1>
          {props.toolbar ? <div className="flex items-center gap-2">{props.toolbar}</div> : null}
        </div>
        {props.subtitle ? (
          <p className="mx-auto w-full max-w-5xl px-4 pb-3 text-sm text-ink-3">{props.subtitle}</p>
        ) : null}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{props.children}</main>
      <footer className="border-t border-line">
        <p className="mx-auto w-full max-w-5xl px-4 py-3 font-mono text-xs text-ink-3">
          {props.status ?? 'Decrypted in your browser · AES-256-GCM'}
        </p>
      </footer>
    </div>
  )
}
