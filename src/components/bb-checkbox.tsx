import { useId } from 'react'
import { Icon } from './icons'

interface BBCheckboxProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  id?: string
}

export function BBCheckbox({
  checked,
  onChange,
  label,
  id: externalId,
}: BBCheckboxProps) {
  const autoId = useId()
  const id = externalId ?? autoId

  return (
    <label htmlFor={id} className="flex items-start gap-2 cursor-pointer">
      <button
        id={id}
        type="button"
        role="checkbox"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 flex shrink-0 items-center justify-center w-4 h-4 rounded-sm border transition-all ${
          checked
            ? 'bg-amber border-amber-deep'
            : 'bg-paper border-line-2'
        }`}
      >
        {checked && <Icon name="check" size={12} className="text-white" strokeWidth={2.5} />}
      </button>
      {label && (
        <span className="text-xs text-ink-2 leading-relaxed select-none">
          {label}
        </span>
      )}
    </label>
  )
}
