/**
 * Task 2237b — a folder's activity, as the owner sees it.
 *
 * The server groups events per (kind, share, actor, hour) and stores only
 * ciphertext for the share label and the actor's name, both sealed under the
 * folder key. Anything that will not decrypt falls back to "Someone" or to no
 * "via …" clause: the row must always say what happened.
 */
import { useEffect, useState } from 'react'
import { getSharedFolderActivity } from '../../lib/api'
import { decryptActorName } from '../../lib/guest-actor-name'
import { folderKeyForRoot } from '../../lib/owner-adoption'
import type { SharedFolderActivityRow } from '../../lib/folder-link-types'
import { useKeys } from '../../lib/key-context'

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * One activity row's sentence. `label` is the decrypted share label (null when
 * the link is gone or its name will not open); `actor` is null when the name
 * will not open, which renders "Someone" rather than an empty gap.
 */
export function describeActivity(
  row: Pick<SharedFolderActivityRow, 'kind' | 'item_count'>,
  label: string | null,
  actor: string | null,
): string {
  const who = actor && actor.trim() ? actor : 'Someone'
  const n = Math.max(1, row.item_count)
  switch (row.kind) {
    case 'files_added':
      return `${plural(n, 'file', 'files')} added${label ? ` via ${label}` : ''}`
    case 'items_renamed':
      return `${plural(n, 'item', 'items')} renamed by ${who}`
    case 'items_deleted':
      return `${plural(n, 'item', 'items')} deleted by ${who} — restorable from Trash for 30 days`
    case 'items_moved':
      return `Items moved by ${who}`
    default:
      return ''
  }
}

/** Decrypted label/actor for every row, keyed by row id. */
async function decryptRowNames(
  rows: SharedFolderActivityRow[],
  folderKey: Uint8Array | null,
): Promise<{ labels: Record<string, string | null>; actors: Record<string, string | null> }> {
  const labels: Record<string, string | null> = {}
  const actors: Record<string, string | null> = {}
  if (!folderKey) return { labels, actors }
  await Promise.all(
    rows.map(async (row) => {
      if (row.share_label_encrypted) {
        try {
          labels[row.id] = await decryptActorName(folderKey, row.share_label_encrypted)
        } catch {
          labels[row.id] = null
        }
      }
      if (row.actor_name_encrypted) {
        try {
          actors[row.id] = await decryptActorName(folderKey, row.actor_name_encrypted)
        } catch {
          actors[row.id] = null
        }
      }
    }),
  )
  return { labels, actors }
}

export interface FolderActivityListProps {
  rows: SharedFolderActivityRow[]
  labels?: Record<string, string | null>
  actors?: Record<string, string | null>
  loading?: boolean
  error?: string | null
}

/** The list itself, presentational so the copy can be asserted without a DOM. */
export function FolderActivityList({
  rows,
  labels = {},
  actors = {},
  loading,
  error,
}: FolderActivityListProps) {
  if (loading) {
    return <p className="px-1 py-3 text-xs text-ink-3">Loading activity…</p>
  }
  if (error) {
    return (
      <p role="alert" className="px-1 py-3 text-xs text-red">
        {error}
      </p>
    )
  }
  if (rows.length === 0) {
    return <p className="px-1 py-3 text-xs text-ink-3">No activity yet.</p>
  }
  return (
    <ul data-testid="folder-activity" className="divide-y divide-line">
      {rows.map((row) => (
        <li key={row.id} className="flex items-baseline gap-2 px-1 py-2">
          <span className="min-w-0 flex-1 text-xs text-ink">
            {describeActivity(row, labels[row.id] ?? null, actors[row.id] ?? null)}
          </span>
          <span className="shrink-0 font-mono text-[11px] text-ink-3">
            {new Date(row.last_at).toLocaleDateString()}
          </span>
        </li>
      ))}
    </ul>
  )
}

export interface FolderActivityTabProps {
  folderId: string
}

export function FolderActivityTab({ folderId }: FolderActivityTabProps) {
  const { getMasterKey, isUnlocked } = useKeys()
  const [rows, setRows] = useState<SharedFolderActivityRow[]>([])
  const [labels, setLabels] = useState<Record<string, string | null>>({})
  const [actors, setActors] = useState<Record<string, string | null>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await getSharedFolderActivity(folderId, 50)
        const folderKey = isUnlocked ? await folderKeyForRoot(getMasterKey(), folderId) : null
        const names = await decryptRowNames(res.activity, folderKey)
        if (cancelled) return
        setRows(res.activity)
        setLabels(names.labels)
        setActors(names.actors)
      } catch {
        if (!cancelled) setError("Couldn't load this folder's activity.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [folderId, getMasterKey, isUnlocked])

  return <FolderActivityList rows={rows} labels={labels} actors={actors} loading={loading} error={error} />
}
