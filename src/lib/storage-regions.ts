/**
 * Storage region choice (task 1919) — pure model.
 *
 * Product model (Guus, 2026-10-17): "Europe" is the DEFAULT: no specific
 * country, any of our European datacenters, the server places the data. Below
 * it the person can pin new uploads to one datacenter. A datacenter that is
 * not live yet is listed as coming soon and cannot be picked.
 *
 * Everything here derives from the server's list (`GET /api/v1/storage-regions`,
 * also carried as `choices` by `GET /api/v1/me/region`). The client keeps NO
 * table of ids, cities or countries: a datacenter that turns live, or goes
 * away, changes the screen without a client release. `test/1919-storage-regions.test.ts`
 * pins that no source file brings such a table back.
 */

export type StorageRegionStatus = 'live' | 'coming_soon'

/** One entry of the server's list. Never carries a provider, endpoint or pool id. */
export interface StorageRegionChoice {
  /** Send this verbatim to `PUT /me/region`. */
  id: string
  /** `region` is the default "any" entry; `datacenter` is one specific place. */
  kind: 'region' | 'datacenter'
  name: string
  city: string | null
  country: string | null
  country_code: string | null
  status: StorageRegionStatus
  selectable: boolean
  is_default: boolean
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/**
 * Validate the wire list. Malformed entries are dropped rather than rendered,
 * and a coming-soon entry is never selectable whatever the payload claims.
 * Anything that is not a list (an older server has no `choices`) is empty.
 */
export function parseChoices(raw: unknown): StorageRegionChoice[] {
  if (!Array.isArray(raw)) return []
  const out: StorageRegionChoice[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = text(r.id)
    const name = text(r.name)
    if (!id || !name) continue
    if (r.status !== 'live' && r.status !== 'coming_soon') continue
    const status: StorageRegionStatus = r.status
    out.push({
      id,
      kind: r.kind === 'region' ? 'region' : 'datacenter',
      name,
      city: text(r.city),
      country: text(r.country),
      country_code: text(r.country_code),
      status,
      selectable: status === 'live' && r.selectable === true,
      is_default: r.is_default === true,
    })
  }
  return out
}

export interface GroupedChoices {
  /** The "Europe" row: the default, any datacenter. Null when the list is empty. */
  defaultChoice: StorageRegionChoice | null
  /** Specific datacenters a person can pin uploads to. */
  live: StorageRegionChoice[]
  /** Listed but not selectable. */
  comingSoon: StorageRegionChoice[]
}

export function groupChoices(choices: StorageRegionChoice[]): GroupedChoices {
  return {
    defaultChoice: choices.find((c) => c.is_default) ?? null,
    live: choices.filter((c) => !c.is_default && c.status === 'live' && c.selectable),
    comingSoon: choices.filter((c) => !c.is_default && c.status === 'coming_soon'),
  }
}

/**
 * Which row is selected for the stored preference. No preference is the
 * default row. A stored id the list does not offer as selectable (a datacenter
 * that went away, a stale value) also reads as the default row, because the
 * server places such uploads like no preference.
 */
export function selectedChoiceId(
  preferred: string | null | undefined,
  choices: StorageRegionChoice[],
): string | null {
  const wanted = (preferred ?? '').trim().toLowerCase()
  if (wanted) {
    const hit = choices.find((c) => c.selectable && c.id.toLowerCase() === wanted)
    if (hit) return hit.id
  }
  return groupChoices(choices).defaultChoice?.id ?? null
}

/** True when a datacenter is stored as the preference but the list does not offer it as live. */
export function preferenceUnavailable(
  preferred: string | null | undefined,
  choices: StorageRegionChoice[],
): boolean {
  const wanted = (preferred ?? '').trim().toLowerCase()
  if (!wanted || choices.length === 0) return false
  const hit = choices.find((c) => c.id.toLowerCase() === wanted)
  if (hit?.is_default) return false
  return !hit || !hit.selectable
}

/** "City, Country" from the entry's own fields; empty for the default row. */
export function locationLabel(choice: StorageRegionChoice): string {
  if (choice.city && choice.country) return `${choice.city}, ${choice.country}`
  return choice.city ?? ''
}

/**
 * The line under a row's name. A datacenter named after its city says the
 * country; otherwise the full "city, country". The default row has none (the page words it).
 */
export function choiceSubline(choice: StorageRegionChoice): string {
  if (choice.city && choice.name.trim().toLowerCase() === choice.city.toLowerCase()) {
    return choice.country ?? ''
  }
  return locationLabel(choice)
}

/** One-line name: the entry's name for the default row, the location for a datacenter. */
export function choiceLabel(choice: StorageRegionChoice): string {
  return locationLabel(choice) || choice.name
}

/** Sidebar label for the stored preference. Before the list loads, or for a stale choice: the default name. */
export function sidebarRegionLabel(
  preferred: string | null | undefined,
  choices: StorageRegionChoice[],
): string {
  const id = selectedChoiceId(preferred, choices)
  const choice = choices.find((c) => c.id === id)
  return choice ? choiceLabel(choice) : 'Europe'
}

/**
 * Where a file REALLY is: the city of the server's `storage_location` on a file
 * response. Absent, malformed or "Unknown" is no city: we never guess one.
 */
export function fileStorageCity(file: unknown): string | null {
  if (!file || typeof file !== 'object') return null
  const loc = (file as { storage_location?: unknown }).storage_location
  if (!loc || typeof loc !== 'object') return null
  const city = (loc as { city?: unknown }).city
  if (typeof city !== 'string') return null
  const trimmed = city.trim()
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return null
  return trimmed
}
