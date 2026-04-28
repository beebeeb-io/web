import { useNavigate } from 'react-router-dom'
import { BBLogo } from '../../components/bb-logo'
import { BBButton } from '../../components/bb-button'
import { Icon } from '../../components/icons'

const honeycombBg = `url("data:image/svg+xml,%3Csvg width='28' height='49' viewBox='0 0 28 49' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill-rule='evenodd'%3E%3Cg fill='%23f5b800' fill-opacity='1'%3E%3Cpath d='M13.99 9.25l13 7.5v15l-13 7.5L1 31.75v-15l12.99-7.5zM3 17.9v12.7l10.99 6.34 11-6.35V17.9l-11-6.34L3 17.9z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`

export function NotFound() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-paper p-6 relative">
      {/* Honeycomb background */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{ backgroundImage: honeycombBg }}
      />

      <div className="relative text-center max-w-[28rem]">
        <BBLogo size={16} />

        <div className="mt-8 font-mono text-[80px] leading-none font-bold text-ink-4 tracking-tight">
          404
        </div>

        <p className="mt-4 text-[14px] text-ink-3 leading-relaxed">
          This page doesn&apos;t exist — or it&apos;s encrypted and you
          don&apos;t have the key.
        </p>

        <BBButton
          variant="amber"
          size="lg"
          className="mt-6 gap-1.5"
          onClick={() => navigate('/')}
        >
          <Icon name="folder" size={14} /> Go to your vault
        </BBButton>
      </div>
    </div>
  )
}
