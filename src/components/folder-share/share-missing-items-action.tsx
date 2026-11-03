/**
 * 2275 T5.4 (L15 option A): the "Share N items with this folder" action.
 *
 * The owner sees every item in the shared root's tree by its decrypted name and
 * its server-reported path, ticks what to share (all by default), and confirms.
 * Rows that cannot be shared (a request row, a plaintext name, a row the
 * resolver cannot prove) stay visible with the reason, never silently dropped.
 * The count is computed here, on the client; there is no "+N more".
 */
import { useMemo, useState } from 'react'
import { BBButton, Icon } from '@beebeeb/shared'
import {
  cannotShareReason,
  type ShareCandidate,
  type ShareCandidatesResult,
} from '../../lib/share-missing-items'

export interface ShareMissingItemsActionProps {
  result: ShareCandidatesResult | null
  loading: boolean
  publishing: boolean
  rootLabel: string
  onConfirm: (confirmed: ShareCandidate[]) => void
}

export function ShareMissingItemsAction({
  result,
  loading,
  publishing,
  rootLabel,
  onConfirm,
}: ShareMissingItemsActionProps) {
  const [expanded, setExpanded] = useState(false)
  const [chosen, setChosen] = useState<Set<string> | null>(null)
  const shareable = result?.shareable ?? []
  const selected = useMemo(() => {
    if (!chosen) return new Set(shareable.map((candidate) => candidate.id))
    return new Set([...chosen].filter((id) => shareable.some((candidate) => candidate.id === id)))
  }, [chosen, shareable])

  const toggle = (id: string) => {
    setChosen(() => {
      const next = new Set(selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) {
    return <p className="px-1 py-3 text-xs text-ink-3">Looking for items not shared yet…</p>
  }
  if (!result) return null

  const count = shareable.length
  const confirmable = shareable.filter((candidate) => selected.has(candidate.id))

  if (count === 0) {
    return (
      <p data-testid="share-n-empty" className="px-1 py-3 text-xs text-ink-3">
        Everyone with access can open everything in this folder.
      </p>
    )
  }

  return (
    <div data-testid="share-n-action" className="mt-4 border-t border-line px-1 pt-3">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-left text-sm font-semibold text-ink"
      >
        <Icon name="share" size={14} />
        <span className="flex-1">Share {count} item{count === 1 ? '' : 's'} with this folder</span>
        <span aria-hidden="true" className={expanded ? 'rotate-180' : ''}>
          <Icon name="chevron-down" size={14} />
        </span>
      </button>
      <p className="mt-1 text-[11px] text-ink-3">
        Items added from the desktop or command line stay private until you share them here.
      </p>

      {expanded && (
        <div className="mt-2">
          <ul className="max-h-64 overflow-y-auto">
            {result.candidates.map((candidate) => {
              const reason = cannotShareReason(candidate.status)
              const isFolder = candidate.isFolder
              return (
                <li
                  key={candidate.id}
                  data-testid="share-n-row"
                  className="flex items-start gap-2 border-t border-line py-2"
                >
                  {candidate.status === 'shareable' ? (
                    <input
                      type="checkbox"
                      checked={selected.has(candidate.id)}
                      onChange={() => toggle(candidate.id)}
                      aria-label={`Share ${candidate.name}`}
                      className="mt-0.5"
                    />
                  ) : (
                    <span className="mt-0.5 w-3" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-ink">
                      {isFolder ? `${candidate.name}/` : candidate.name}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-ink-3">
                      {[rootLabel, ...candidate.path].join(' > ')}
                    </span>
                    {reason && <span className="block text-[11px] text-ink-3">{reason}</span>}
                  </span>
                </li>
              )
            })}
          </ul>
          {result.truncated && (
            <p className="mt-1 text-[11px] text-ink-3">
              Only the first 1,000 items are listed. Share these, then open this panel again for the rest.
            </p>
          )}
          <BBButton
            variant="amber"
            className="mt-3 w-full"
            disabled={publishing || confirmable.length === 0}
            onClick={() => onConfirm(confirmable)}
          >
            {publishing ? 'Sharing…' : `Share ${confirmable.length} item${confirmable.length === 1 ? '' : 's'}`}
          </BBButton>
        </div>
      )}
    </div>
  )
}
