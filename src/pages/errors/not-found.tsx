import { useNavigate } from 'react-router-dom'
import { BBLogo } from '../../components/bb-logo'
import { BBButton } from '../../components/bb-button'
import { Icon } from '../../components/icons'

export function NotFound() {
  const navigate = useNavigate()

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
          <Icon name="search" size={24} className="text-ink-3" />
        </div>

        <div className="font-mono text-[72px] leading-none font-bold text-ink-4 tracking-tight">
          404
        </div>

        <h1 className="mt-md text-base font-semibold text-ink">
          Page not found
        </h1>

        <p className="mt-sm text-sm text-ink-3 leading-relaxed">
          This page doesn&apos;t exist — or it&apos;s encrypted and you
          don&apos;t have the key.
        </p>

        <div className="mt-xl flex gap-sm justify-center">
          <BBButton
            variant="amber"
            size="lg"
            className="gap-1.5"
            onClick={() => navigate('/')}
          >
            <Icon name="folder" size={14} />
            Go to your vault
          </BBButton>
          <BBButton
            variant="ghost"
            size="lg"
            onClick={() => navigate(-1)}
          >
            Go back
          </BBButton>
        </div>
      </div>
    </div>
  )
}
