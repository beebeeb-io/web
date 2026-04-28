import { BBLogo } from '../../components/bb-logo'
import { BBButton } from '../../components/bb-button'

interface ServerErrorProps {
  statusUrl?: string
}

export function ServerError({ statusUrl = 'https://status.beebeeb.io' }: ServerErrorProps) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-paper p-6">
      <div className="text-center max-w-[28rem]">
        <BBLogo size={16} />

        <div className="mt-8 font-mono text-[80px] leading-none font-bold text-ink-4 tracking-tight">
          500
        </div>

        <p className="mt-4 text-[14px] text-ink-3 leading-relaxed">
          Something went wrong on our end. Your files are safe — they&apos;re
          encrypted and we can&apos;t touch them anyway.
        </p>

        <div className="mt-6 flex gap-2 justify-center">
          <BBButton
            variant="amber"
            size="lg"
            onClick={() => window.location.reload()}
          >
            Try again
          </BBButton>
          <BBButton
            size="lg"
            variant="ghost"
            onClick={() => window.open(statusUrl, '_blank', 'noopener')}
          >
            Status page
          </BBButton>
        </div>
      </div>
    </div>
  )
}
