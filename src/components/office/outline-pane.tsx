/**
 * OutlinePane (task 1567, Writer only) — reads `bbOffice.getOutline()`,
 * clicking an entry calls `bbOffice.goToHeading(index)`. Reuses the visual
 * language of design/office-editor.html's outline pane (the mockup notes it
 * as "reused from editor-1563" in spirit — a left rail list, not a new
 * pattern).
 */

import { useState } from 'react'
import type { OutlineHeading } from '../../lib/office/bb-office-bridge'
import { IconCollapse } from './office-icons'

export interface OutlinePaneProps {
  headings: OutlineHeading[]
  onSelect: (index: number) => void
}

export function OutlinePane({ headings, onSelect }: OutlinePaneProps) {
  const [collapsed, setCollapsed] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  if (collapsed) {
    return (
      <div className="flex w-8 shrink-0 flex-col items-center border-r border-line bg-paper-2 pt-3">
        <button
          type="button"
          aria-label="Show outline"
          onClick={() => setCollapsed(false)}
          className="grid h-6 w-6 place-items-center rounded-md text-ink-3 hover:bg-paper-3"
        >
          <IconCollapse size={13} />
        </button>
      </div>
    )
  }

  return (
    <div className="flex w-[216px] shrink-0 flex-col border-r border-line bg-paper-2" data-testid="office-outline-pane">
      <div className="flex items-center justify-between px-3.5 pb-2 pt-3.5">
        <span className="text-[10.5px] font-semibold uppercase tracking-wider text-ink-3">Outline</span>
        <button
          type="button"
          aria-label="Collapse outline"
          onClick={() => setCollapsed(true)}
          className="grid h-[22px] w-[22px] place-items-center rounded-md text-ink-3 hover:bg-paper-3"
        >
          <IconCollapse size={13} />
        </button>
      </div>
      <div className="flex flex-col gap-px overflow-auto px-2 pb-3.5">
        {headings.length === 0 && (
          <div className="px-2.5 py-1.5 text-[12px] text-ink-4">No headings yet</div>
        )}
        {headings.map((h, i) => (
          <button
            key={`${i}-${h.text}`}
            type="button"
            data-testid={`outline-item-${i}`}
            onClick={() => {
              setActiveIndex(i)
              onSelect(i)
            }}
            className={`rounded-md px-2.5 py-1.5 text-left text-[12.5px] ${
              h.level >= 2 ? 'pl-[22px] text-[12px]' : ''
            } ${activeIndex === i ? 'bg-paper-3 font-medium text-ink' : 'text-ink-3 hover:bg-paper-3'}`}
          >
            {h.text}
          </button>
        ))}
      </div>
    </div>
  )
}
