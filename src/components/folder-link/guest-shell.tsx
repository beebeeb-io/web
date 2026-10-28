import type { ReactNode } from 'react'
import { Icon } from '@beebeeb/shared'
import { BBLogo } from '../bb-logo'

/**
 * Task 2237b — the anonymous guest chrome.
 *
 * Guus, 2026-10-28: a shared folder "has an alike folder and file overview as
 * files has right now". So this is Files without the owner: a slim Beebeeb bar
 * (no sidebar, no account menu, and never the owner's identity), the folder
 * title on its own line so it is never clipped under the top edge, and the
 * content area where the Files-style browser card sits.
 */
export function GuestShell(props: {
  children: ReactNode
  title: string
  subtitle?: string
  /** Right side of the title row (the upload actions on add/edit links). */
  toolbar?: ReactNode
}): ReactNode {
  return (
    <div className="flex min-h-screen flex-col bg-paper text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/95 backdrop-blur-sm">
        <div className="mx-auto flex h-12 w-full max-w-6xl items-center justify-between gap-3 px-4 md:px-6">
          <BBLogo size={17} />
          <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <Icon name="lock" size={11} className="text-amber-deep" />
            End-to-end encrypted
          </span>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 pb-8 pt-5 md:px-6 md:pt-7">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 max-w-full">
            <h1 className="break-words text-[22px] font-semibold leading-tight tracking-tight md:text-2xl">
              {props.title}
            </h1>
            {props.subtitle ? <p className="mt-1 text-[13px] text-ink-3">{props.subtitle}</p> : null}
          </div>
          {props.toolbar ? <div className="flex shrink-0 items-center gap-2">{props.toolbar}</div> : null}
        </div>
        {props.children}
      </main>
      <footer className="border-t border-line">
        <p className="mx-auto w-full max-w-6xl px-4 py-3 text-[11px] text-ink-3 md:px-6">
          Files are decrypted in this browser. Beebeeb can&apos;t read their names or contents.
        </p>
      </footer>
    </div>
  )
}
