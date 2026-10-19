/**
 * Storage region choice (task 1919, by COUNTRY since task 2050) — pure model.
 *
 * Product model (Guus, 2026-10-19): "Europe" is the DEFAULT: any of our
 * European data centers, the server places the data. Below it the person can
 * pin new uploads to one COUNTRY (Germany, Finland). A country that is not live
 * yet is listed as coming soon and cannot be picked. A city is never shown or
 * chosen: cities together identify the hosting provider
 * (docs/canon/data-residency.md).
 *
 * Everything here derives from the server's list (`GET /api/v1/storage-regions`,
 * also carried as `choices` by `GET /api/v1/me/region`). The client keeps NO
 * table of ids or countries: a country that turns live, or goes away, changes
 * the screen without a client release. `test/1919-storage-regions.test.ts`
 * pins that no source file brings such a table back, and
 * `test/2050-no-city-in-copy.test.ts` that no city name appears in `src/`.
 */

export type StorageRegionStatus = 'live' | 'coming_soon'

/** One entry of the server's list. Never carries a city, provider, endpoint or pool id. */
export interface StorageRegionChoice {
  /** Send this verbatim to `PUT /me/region`: `europe`, or a lower-case country code. */
  id: string
  /** `region` is the default "any" entry; `country` is one specific country. */
  kind: 'region' | 'country'
  /** `Europe`, or the country's name (`Germany`). Never a city. */
  name: string
  country: string | null
  country_code: string | null
  status: StorageRegionStatus
  selectable: boolean
  is_default: boolean
  /**
   * Other stored values that mean this same row (lower case). Empty for a
   * server that speaks countries; an older server (task 1919, one row per
   * datacenter) is folded into countries and keeps its datacenter ids here so a
   * stored `fsn1` still selects the Germany row.
   */
  aliases: string[]
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}

function statusOf(v: unknown): StorageRegionStatus | null {
  return v === 'live' || v === 'coming_soon' ? v : null
}

/**
 * Validate the wire list. Malformed entries are dropped rather than rendered,
 * and a coming-soon entry is never selectable whatever the payload claims.
 * Anything that is not a list (an older server has no `choices`) is empty.
 *
 * An OLDER server (task 1919) sends one `kind: 'datacenter'` entry per
 * datacenter, named after its city. Those are folded into one row per country
 * (named by the country, never the city); an entry with no country cannot be
 * shown without naming a city and is dropped. The row's id is the first
 * selectable datacenter's id, which that server accepts on PUT.
 */
export function parseChoices(raw: unknown): StorageRegionChoice[] {
  if (!Array.isArray(raw)) return []
  const out: StorageRegionChoice[] = []
  const byCountry = new Map<string, StorageRegionChoice>()
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const id = text(r.id)
    const status = statusOf(r.status)
    if (!id || !status) continue
    const selectable = status === 'live' && r.selectable === true

    if (r.kind === 'region') {
      const name = text(r.name)
      if (!name) continue
      out.push({
        id,
        kind: 'region',
        name,
        country: null,
        country_code: null,
        status,
        selectable,
        is_default: r.is_default === true,
        aliases: [],
      })
      continue
    }

    const country = text(r.country)
    if (!country) continue // an older server's datacenter with no country: not showable without a city

    if (r.kind === 'country') {
      out.push({
        id,
        kind: 'country',
        name: text(r.name) ?? country,
        country,
        country_code: text(r.country_code),
        status,
        selectable,
        is_default: false,
        aliases: [],
      })
      continue
    }

    // Older server: a datacenter. Fold into its country.
    const key = (text(r.country_code) ?? country).toLowerCase()
    const existing = byCountry.get(key)
    if (!existing) {
      const row: StorageRegionChoice = {
        id,
        kind: 'country',
        name: country,
        country,
        country_code: text(r.country_code),
        status,
        selectable,
        is_default: false,
        aliases: [id.toLowerCase()],
      }
      byCountry.set(key, row)
      out.push(row)
    } else {
      existing.aliases.push(id.toLowerCase())
      // The row is live as soon as one of its datacenters is, and is sent by that one's id.
      if (selectable && !existing.selectable) {
        existing.id = id
        existing.status = 'live'
        existing.selectable = true
      }
    }
  }
  return out
}

export interface GroupedChoices {
  /** The "Europe" row: the default, any data center. Null when the list is empty. */
  defaultChoice: StorageRegionChoice | null
  /** Countries a person can pin uploads to. */
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

function matches(choice: StorageRegionChoice, wanted: string): boolean {
  return choice.id.toLowerCase() === wanted || choice.aliases.includes(wanted)
}

/**
 * Which row is selected for the stored preference. No preference is the
 * default row. A stored id the list does not offer as selectable (a country
 * that went away, a stale value) also reads as the default row, because the
 * server places such uploads like no preference.
 */
export function selectedChoiceId(
  preferred: string | null | undefined,
  choices: StorageRegionChoice[],
): string | null {
  const wanted = (preferred ?? '').trim().toLowerCase()
  if (wanted) {
    const hit = choices.find((c) => c.selectable && matches(c, wanted))
    if (hit) return hit.id
  }
  return groupChoices(choices).defaultChoice?.id ?? null
}

/** True when a country is stored as the preference but the list does not offer it as live. */
export function preferenceUnavailable(
  preferred: string | null | undefined,
  choices: StorageRegionChoice[],
): boolean {
  const wanted = (preferred ?? '').trim().toLowerCase()
  if (!wanted || choices.length === 0) return false
  const hit = choices.find((c) => matches(c, wanted))
  if (hit?.is_default) return false
  return !hit || !hit.selectable
}

/** The row for the stored preference when it is a country the person pinned, else null. */
export function selectedCountry(
  preferred: string | null | undefined,
  choices: StorageRegionChoice[],
): StorageRegionChoice | null {
  const id = selectedChoiceId(preferred, choices)
  const hit = choices.find((c) => c.id === id)
  return hit && hit.kind === 'country' ? hit : null
}

/** One-line name: "Europe" or the country's name. Never a city. */
export function choiceLabel(choice: StorageRegionChoice): string {
  return choice.country ?? choice.name
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
 * The strict toggle's label for a country: "Only store in Germany". The name is
 * the server's; the client keeps no country table.
 */
export function strictLabel(choice: StorageRegionChoice): string {
  return `Only store in ${choiceLabel(choice)}`
}

/**
 * Where a file REALLY is: the country of the server's `storage_location` on a
 * file response. Absent, malformed or "Unknown" is no country: we never guess
 * one, and we never read the (deprecated) `city` the server may still send.
 */
export function fileStorageCountry(file: unknown): string | null {
  if (!file || typeof file !== 'object') return null
  const loc = (file as { storage_location?: unknown }).storage_location
  if (!loc || typeof loc !== 'object') return null
  const country = (loc as { country?: unknown }).country
  if (typeof country !== 'string') return null
  const trimmed = country.trim()
  if (!trimmed || trimmed.toLowerCase() === 'unknown') return null
  return trimmed
}

/**
 * The 409 `region_unavailable_strict` refusal (task 1952, by country since task
 * 2050) in words: names the COUNTRY the server sent (`country`, never the
 * deprecated `city` alias) and says what to do. Null when the error is not that
 * refusal.
 */
export function strictRefusalMessage(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const e = err as { code?: unknown; details?: unknown }
  if (e.code !== 'region_unavailable_strict') return null
  const d = (e.details && typeof e.details === 'object' ? e.details : {}) as Record<string, unknown>
  const country = text(d.country)
  const where = country ?? 'Your chosen country'
  return `${where} can't take new files right now, so this upload stopped. Your choice is set to only ${country ?? 'that country'}. Try again later, or allow other EU countries in Settings.`
}
