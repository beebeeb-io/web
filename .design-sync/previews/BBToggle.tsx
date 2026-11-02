import { useState } from 'react'
import { BBToggle } from '@beebeeb/shared'

export const States = () => (
  <div className="flex items-center gap-6 bg-paper p-4">
    <BBToggle aria-label="Off" on={false} />
    <BBToggle aria-label="On" on />
    <BBToggle aria-label="Off, disabled" on={false} disabled />
    <BBToggle aria-label="On, disabled" on disabled />
  </div>
)

export const Sizes = () => (
  <div className="flex items-center gap-8 bg-paper p-4">
    <div className="flex items-center gap-3 text-sm text-ink-2">
      <BBToggle aria-label="md" on size="md" /> md
    </div>
    <div className="flex items-center gap-3 text-sm text-ink-2">
      <BBToggle aria-label="touch" on size="touch" /> touch
    </div>
  </div>
)

export const SettingRow = () => {
  const [on, setOn] = useState(false)
  return (
    <div className="flex items-center gap-2.5 bg-paper p-4">
      <BBToggle aria-label="Activity tracking" on={on} onChange={setOn} />
      <span className="text-[12.5px] text-ink-3">
        {on ? 'Enabled — sign-ins and activity are being logged' : 'Disabled — no activity data is collected'}
      </span>
    </div>
  )
}

export const Dark = () => (
  <div className="dark flex items-center gap-6 bg-paper p-4">
    <BBToggle aria-label="Off" on={false} />
    <BBToggle aria-label="On" on />
    <BBToggle aria-label="On, disabled" on disabled />
  </div>
)
