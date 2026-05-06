import { BBLogo } from '@beebeeb/shared'
import { BBButton } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'

interface ServerErrorProps {
  error?: Error | null
  statusUrl?: string
}

export function ServerError({
  error,
  statusUrl = 'https://status.beebeeb.io',
}: ServerErrorProps) {
  const isDev = import.meta.env.DEV

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-paper p-xl">
      <div className="text-center max-w-[28rem]">
        <div className="mb-xl">
          <BBLogo size={16} />
        </div>

        {/* Icon badge */}
        <div
          className="mx-auto mb-lg flex items-center justify-center rounded-xl"
          style={{
            width: 56,
            height: 56,
            background: 'var(--color-paper-2)',
            border: '1px solid var(--color-line)',
          }}
        >
          <Icon name="cloud" size={24} className="text-ink-3" />
        </div>

        <div className="font-mono text-[72px] leading-none font-bold text-ink-4 tracking-tight">
          500
        </div>

        <h1 className="mt-md text-base font-semibold text-ink">
          Something went wrong
        </h1>

        <p className="mt-sm text-sm text-ink-3 leading-relaxed">
          Something broke on our end. Your files are safe — they&apos;re
          encrypted and we can&apos;t touch them anyway.
        </p>

        {isDev && error && (
          <div className="mt-lg text-left bg-paper-2 border border-line rounded-md p-md">
            <p className="text-[11px] font-mono text-red break-all leading-relaxed">
              {error.message}
            </p>
          </div>
        )}

        <div className="mt-xl flex flex-wrap gap-sm justify-center">
          <BBButton
            variant="amber"
            size="lg"
            onClick={() => window.location.reload()}
          >
            Try again
          </BBButton>
          <BBButton
            size="lg"
            onClick={() => { window.location.href = '/' }}
          >
            Go home
          </BBButton>
          <a
            href={statusUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center font-medium transition-all cursor-pointer px-lg py-md text-base rounded-lg bg-transparent text-ink-2 hover:bg-paper-2 active:bg-paper-3 gap-1.5"
          >
            <Icon name="link" size={13} />
            Status page
          </a>
        </div>
      </div>
    </div>
  )
}
