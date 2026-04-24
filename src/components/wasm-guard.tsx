import type { ReactNode } from 'react'
import { useKeys } from '../lib/key-context'
import { BBLogo } from './bb-logo'

export function WasmGuard({ children }: { children: ReactNode }) {
  const { cryptoReady, cryptoLoading, cryptoError } = useKeys()

  if (cryptoLoading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-xl">
        <div className="text-center">
          <div className="mb-lg">
            <BBLogo size={24} />
          </div>
          <div className="flex items-center justify-center gap-sm mb-sm">
            <svg
              className="animate-spin h-4 w-4 text-amber"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="3"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            <span className="text-sm text-ink-3">
              Initializing encryption engine...
            </span>
          </div>
        </div>
      </div>
    )
  }

  if (cryptoError) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center p-xl">
        <div className="max-w-[440px] w-full text-center">
          <div className="mb-xl">
            <BBLogo size={28} />
          </div>

          <h1 className="text-lg font-semibold text-ink mb-sm">
            Your browser doesn't support the encryption engine
          </h1>

          <p className="text-sm text-ink-3 mb-lg">
            Beebeeb requires WebAssembly and Web Workers to encrypt your files
            locally. Please use a supported browser:
          </p>

          <div className="bg-paper-2 border border-line rounded-lg p-md mb-lg">
            <ul className="text-sm text-ink-2 space-y-1.5 text-left">
              <li>Chrome 90+</li>
              <li>Firefox 90+</li>
              <li>Safari 15+</li>
              <li>Edge 90+</li>
            </ul>
          </div>

          {import.meta.env.DEV && (
            <div className="text-left bg-paper-2 border border-line rounded-md p-md">
              <p className="text-[11px] font-mono text-red break-all leading-relaxed">
                {cryptoError}
              </p>
            </div>
          )}
        </div>
      </div>
    )
  }

  if (!cryptoReady) {
    return null
  }

  return <>{children}</>
}
