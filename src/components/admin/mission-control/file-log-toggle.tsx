/**
 * Two-button toggle that swaps between the streaming terminal log (default
 * during an active migration) and the structured table view (default for
 * post-migration review). The parent owns the `mode` state and event/file
 * arrays — this component is purely presentational + dispatch.
 */

import { ComponentProps } from 'react'
import { FileLogStream } from './file-log-stream'
import { FileLogTable } from './file-log-table'

export type FileLogMode = 'stream' | 'table'

interface FileLogToggleProps {
  mode: FileLogMode
  onModeChange: (mode: FileLogMode) => void
  streamProps: ComponentProps<typeof FileLogStream>
  tableProps: ComponentProps<typeof FileLogTable>
}

const TABS: { value: FileLogMode; label: string; hint: string }[] = [
  { value: 'stream', label: 'Stream', hint: 'Live event log' },
  { value: 'table', label: 'Table', hint: 'Structured review' },
]

export function FileLogToggle({
  mode,
  onModeChange,
  streamProps,
  tableProps,
}: FileLogToggleProps) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-2">
        <p className="text-xs font-medium text-ink-3 uppercase tracking-wider">
          File log
        </p>
        <div
          role="tablist"
          aria-label="File log view"
          className="ml-auto inline-flex items-center rounded-md border border-line bg-paper p-0.5"
        >
          {TABS.map((tab) => {
            const active = mode === tab.value
            return (
              <button
                key={tab.value}
                role="tab"
                aria-selected={active}
                onClick={() => onModeChange(tab.value)}
                title={tab.hint}
                className={`px-2.5 py-1 text-[11px] font-medium rounded-sm transition-all ${
                  active
                    ? 'bg-amber text-[oklch(0.22_0.01_70)] shadow-1'
                    : 'text-ink-3 hover:text-ink hover:bg-paper-2'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      </div>

      <div key={mode} className="transition-opacity duration-200">
        {mode === 'stream' ? (
          <FileLogStream {...streamProps} />
        ) : (
          <FileLogTable {...tableProps} />
        )}
      </div>
    </div>
  )
}
