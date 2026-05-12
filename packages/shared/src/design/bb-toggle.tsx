interface BBToggleProps {
  on?: boolean
  onChange?: (on: boolean) => void
  disabled?: boolean
  'aria-label'?: string
}

export function BBToggle({ on = false, onChange, disabled = false, 'aria-label': ariaLabel }: BBToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange?.(!on)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
        on
          ? 'bg-amber border-amber-deep'
          : 'bg-paper-3 border-line-2'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span
        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-1 transition-transform ${
          on ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
