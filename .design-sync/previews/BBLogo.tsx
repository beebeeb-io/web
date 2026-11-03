// Design-sync preview of BBLogo for the Claude Design project.
import { BBLogo } from '@beebeeb/shared'

export const Sizes = () => (
  <div className="flex items-end gap-6 bg-paper p-4">
    <BBLogo size={14} />
    <BBLogo size={20} />
    <BBLogo size={32} />
  </div>
)

export const OnDark = () => (
  <div className="bg-ink p-4">
    <BBLogo size={20} light />
  </div>
)

export const InAppChrome = () => (
  <div className="flex w-72 items-center justify-between border-b border-line bg-paper px-4 py-3">
    <BBLogo size={14} />
    <span className="font-mono text-xs text-ink-3">Drive</span>
  </div>
)
