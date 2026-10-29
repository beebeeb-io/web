/**
 * Task 2237b — who added a drive row, for rows that arrive over sync.
 *
 * A file a guest or member adds to a shared folder is sealed under a key the
 * owner cannot derive from the master key; the owner opens it through the
 * shared-folder path, chosen by the row's attribution (`acted_via_share_id`,
 * `uploaded_by`) or by an owner wrap. The API listing and `GET /files/:id`
 * carry those fields; the sync snapshot and the `file_create` sync op do not.
 * Without them a guest's file pushed over the stream into an open folder is
 * keyed from the master key and shows as unreadable until a reload.
 *
 * So the drive remembers each row's attribution from API rows, overlays it on
 * sync-derived rows, and looks a row up (bounded) when the API never
 * described it. None of this is key material: an owner wrap is ciphertext.
 *
 * TODO(2237b, server lane C0 / Task 0): the server is adding
 * `acted_via_share_id`, `uploaded_by` and `owner_wrapped_file_key` (base64) to
 * `/files/index` and `/sync/snapshot`. Once that ships, read them from the sync
 * node (sync-client payloadToNode / drive syncNodeToDriveFile) and retire the
 * lookup below; keep the overlay until every supported server sends them.
 */
import type { DriveFile } from './api'

export type RowAttribution = Pick<
  DriveFile,
  'owner_wrapped_file_key' | 'acted_via_share_id' | 'actor_name_encrypted' | 'uploaded_by'
>

const FIELDS = ['owner_wrapped_file_key', 'acted_via_share_id', 'actor_name_encrypted', 'uploaded_by'] as const

/** The attribution an API row carries (absent fields stay absent). */
export function attributionOf(row: DriveFile): RowAttribution {
  const out: RowAttribution = {}
  for (const field of FIELDS) {
    if (row[field] !== undefined) (out as Record<string, unknown>)[field] = row[field]
  }
  return out
}

/** A sync-derived row with whatever the API said about the same id. */
export function withAttribution(row: DriveFile, known: ReadonlyMap<string, RowAttribution>): DriveFile {
  const meta = known.get(row.id)
  if (!meta) return row
  const merged: DriveFile = { ...row }
  for (const field of FIELDS) {
    if (merged[field] == null && meta[field] != null) (merged as unknown as Record<string, unknown>)[field] = meta[field]
  }
  return merged
}

/** Remember every API row's attribution, including "nobody else" (an empty record). */
export function learnAttribution(known: Map<string, RowAttribution>, rows: DriveFile[]): void {
  for (const row of rows) known.set(row.id, attributionOf(row))
}

/** Ids the API has never described. */
export function rowsMissingAttribution(rows: DriveFile[], known: ReadonlyMap<string, RowAttribution>): string[] {
  return rows.filter((row) => !known.has(row.id)).map((row) => row.id)
}

/** Above this many unknown rows in one burst, one folder listing beats N lookups. */
export const MAX_ATTRIBUTION_LOOKUPS = 25
/** Wait this long after a sync burst so a folder upload is looked up once. */
export const ATTRIBUTION_DEBOUNCE_MS = 300

export interface AttributionRefresherPorts {
  known: Map<string, RowAttribution>
  getFile: (id: string) => Promise<DriveFile>
  /** The current folder's full listing (the bound for a large burst). */
  listFolder: () => Promise<DriveFile[]>
  /** Something new was learned: re-derive the visible rows. */
  onLearned: () => void
  /** True while the page's own listing is in flight; it will learn these rows. */
  listingInFlight?: () => boolean
  delayMs?: number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

/**
 * Collects unknown ids across a burst, then looks them up once: each id at
 * most once while a lookup is in flight, a large burst as one listing, and a
 * failed lookup forgotten so the next burst may retry it.
 */
export function createAttributionRefresher(ports: AttributionRefresherPorts) {
  const delay = ports.delayMs ?? ATTRIBUTION_DEBOUNCE_MS
  const setTimer = ports.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = ports.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const wanted = new Set<string>()
  const inFlight = new Set<string>()
  let timer: unknown = null

  async function flush(): Promise<void> {
    timer = null
    if (ports.listingInFlight?.()) {
      schedule()
      return
    }
    const ids = [...wanted].filter((id) => !ports.known.has(id) && !inFlight.has(id))
    wanted.clear()
    if (ids.length === 0) return
    for (const id of ids) inFlight.add(id)
    let learned = false
    try {
      if (ids.length > MAX_ATTRIBUTION_LOOKUPS) {
        const rows = await ports.listFolder()
        learnAttribution(ports.known, rows)
        learned = rows.length > 0
      } else {
        const rows = await Promise.all(ids.map((id) => ports.getFile(id).catch(() => null)))
        for (const row of rows) {
          if (!row) continue
          ports.known.set(row.id, attributionOf(row))
          learned = true
        }
      }
    } catch {
      /* the next burst retries; nothing is cached for a failure */
    } finally {
      for (const id of ids) inFlight.delete(id)
    }
    if (learned) ports.onLearned()
  }

  function schedule(): void {
    if (timer !== null) return
    timer = setTimer(() => { void flush() }, delay)
  }

  return {
    request(ids: string[]): void {
      let added = false
      for (const id of ids) {
        if (ports.known.has(id) || inFlight.has(id)) continue
        wanted.add(id)
        added = true
      }
      if (added) schedule()
    },
    /** Folder change / lock: drop pending work. */
    reset(): void {
      if (timer !== null) clearTimer(timer)
      timer = null
      wanted.clear()
    },
    /** Test hook: run the pending lookup now. */
    flushNow: () => flush(),
  }
}
