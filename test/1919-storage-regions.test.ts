import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  choiceLabel,
  fileStorageCountry,
  groupChoices,
  parseChoices,
  preferenceUnavailable,
  selectedChoiceId,
  selectedCountry,
  sidebarRegionLabel,
  strictLabel,
  strictRefusalMessage,
  type StorageRegionChoice,
} from '../src/lib/storage-regions'

/**
 * Task 1919, by COUNTRY since task 2050 (Guus 2026-10-19). "Europe" is the
 * default (any of our European data centers); below it the person picks a
 * COUNTRY; a country that is not live yet is listed as coming soon and cannot
 * be picked. A city is never read, shown or sent.
 *
 * Every function here derives from the payload (`GET /api/v1/storage-regions` /
 * `choices` of `GET /api/v1/me/region`). The last describe pins that no source
 * file keeps a static city or country table again.
 */

// The server's contract (beebeeb-api routes/regions.rs `RegionChoice`, task 2050).
const RAW = [
  { id: 'europe', kind: 'region', name: 'Europe', country: null, country_code: null, status: 'live', selectable: true, is_default: true },
  { id: 'de', kind: 'country', name: 'Germany', country: 'Germany', country_code: 'DE', status: 'live', selectable: true, is_default: false },
  { id: 'fi', kind: 'country', name: 'Finland', country: 'Finland', country_code: 'FI', status: 'live', selectable: true, is_default: false },
  { id: 'nl', kind: 'country', name: 'Netherlands', country: 'Netherlands', country_code: 'NL', status: 'coming_soon', selectable: false, is_default: false },
]

// What a server older than 2050 (task 1919) sent: one entry per datacenter,
// named after its city and carrying `city`.
const OLD_RAW = [
  { id: 'europe', kind: 'region', name: 'Europe', city: null, country: null, country_code: null, status: 'live', selectable: true, is_default: true },
  { id: 'fsn1', kind: 'datacenter', name: 'Falkenstein', city: 'Falkenstein', country: 'Germany', country_code: 'DE', status: 'live', selectable: true, is_default: false },
  { id: 'hel1', kind: 'datacenter', name: 'Helsinki', city: 'Helsinki', country: 'Finland', country_code: 'FI', status: 'live', selectable: true, is_default: false },
  { id: 'nbg1', kind: 'datacenter', name: 'Nuremberg', city: 'Nuremberg', country: 'Germany', country_code: 'DE', status: 'live', selectable: true, is_default: false },
  { id: 'ede', kind: 'datacenter', name: 'Ede', city: 'Ede', country: 'Netherlands', country_code: 'NL', status: 'coming_soon', selectable: false, is_default: false },
]

function choices(): StorageRegionChoice[] {
  return parseChoices(RAW)
}

describe('parseChoices (country shape)', () => {
  test('keeps the four entries of the contract in order', () => {
    expect(choices().map((c) => c.id)).toEqual(['europe', 'de', 'fi', 'nl'])
    expect(choices().map((c) => c.kind)).toEqual(['region', 'country', 'country', 'country'])
  })

  test('drops malformed entries instead of rendering them', () => {
    const parsed = parseChoices([
      RAW[0],
      null,
      42,
      { id: 7, name: 'x', status: 'live' },
      { id: 'zzz', name: 'No status', kind: 'country', country: 'Nowhere' },
      { id: 'zzz2', name: 'Odd status', kind: 'country', country: 'Nowhere', status: 'open', selectable: true },
      { id: 'zzz3', name: 'No country', kind: 'country', status: 'live', selectable: true },
      RAW[2],
    ])
    expect(parsed.map((c) => c.id)).toEqual(['europe', 'fi'])
  })

  test('anything that is not a list is an empty list (an old server has no `choices`)', () => {
    expect(parseChoices(undefined)).toEqual([])
    expect(parseChoices({ not: 'a list' })).toEqual([])
  })

  test('a coming-soon entry can never be selectable, whatever the payload says', () => {
    const [nl] = parseChoices([{ ...RAW[3], selectable: true }])
    expect(nl.status).toBe('coming_soon')
    expect(nl.selectable).toBe(false)
  })

  test('a country row is named by the server\'s country, and carries no city field at all', () => {
    const [, de] = choices()
    expect(de.name).toBe('Germany')
    expect(Object.keys(de)).not.toContain('city')
    // Even a payload that still carries a deprecated `city` never reaches the model.
    const [x] = parseChoices([{ ...RAW[1], city: 'Falkenstein' }])
    expect(JSON.stringify(x)).not.toContain('Falkenstein')
  })
})

describe('parseChoices (older server shape: one datacenter entry per city)', () => {
  const old = () => parseChoices(OLD_RAW)

  test('does not throw and folds the datacenters into one row per country', () => {
    expect(old().map((c) => c.name)).toEqual(['Europe', 'Germany', 'Finland', 'Netherlands'])
  })

  test('never carries a city anywhere in the parsed model', () => {
    const json = JSON.stringify(old())
    for (const city of ['Falkenstein', 'Helsinki', 'Nuremberg', 'Ede']) expect(json).not.toContain(city)
  })

  test('a row is sent by a live datacenter id that server accepts, and every id of the country selects it', () => {
    const [, de, fi, nl] = old()
    expect(de.id).toBe('fsn1')
    expect(de.aliases).toEqual(['fsn1', 'nbg1'])
    expect(fi.id).toBe('hel1')
    expect(nl.selectable).toBe(false)
    expect(selectedChoiceId('nbg1', old())).toBe('fsn1')
    expect(selectedChoiceId('hel1', old())).toBe('hel1')
  })

  test('a country with one live and one coming-soon datacenter is live, sent by the live one', () => {
    const mixed = parseChoices([
      { ...OLD_RAW[1], status: 'coming_soon', selectable: false },
      OLD_RAW[3],
    ])
    expect(mixed).toHaveLength(1)
    expect(mixed[0]).toMatchObject({ id: 'nbg1', status: 'live', selectable: true, name: 'Germany' })
  })

  test('a datacenter with no country cannot be shown without its city, so it is dropped', () => {
    const parsed = parseChoices([OLD_RAW[0], { ...OLD_RAW[1], country: null, country_code: null }])
    expect(parsed.map((c) => c.id)).toEqual(['europe'])
  })

  test('the sidebar label on the old shape is the country', () => {
    expect(sidebarRegionLabel('hel1', old())).toBe('Finland')
  })
})

describe('groupChoices', () => {
  test('Europe is the default row, live countries are pickable, coming soon is apart', () => {
    const g = groupChoices(choices())
    expect(g.defaultChoice?.id).toBe('europe')
    expect(g.live.map((c) => c.id)).toEqual(['de', 'fi'])
    expect(g.comingSoon.map((c) => c.id)).toEqual(['nl'])
  })

  test('the UI follows the data: a country that turns live moves up, no client change', () => {
    const next = parseChoices(RAW.map((r) => (r.id === 'nl' ? { ...r, status: 'live', selectable: true } : r)))
    const g = groupChoices(next)
    expect(g.live.map((c) => c.id)).toEqual(['de', 'fi', 'nl'])
    expect(g.comingSoon).toEqual([])
  })

  test('a country that goes away is simply gone (the server omits it)', () => {
    const g = groupChoices(parseChoices(RAW.filter((r) => r.id !== 'fi')))
    expect(g.live.map((c) => c.id)).toEqual(['de'])
  })

  test('an empty list has no default row', () => {
    expect(groupChoices([]).defaultChoice).toBeNull()
  })
})

describe('selectedChoiceId', () => {
  test('no preference means the default row (Europe)', () => {
    expect(selectedChoiceId(null, choices())).toBe('europe')
    expect(selectedChoiceId('', choices())).toBe('europe')
  })

  test('"europe" and a live country id select their own row', () => {
    expect(selectedChoiceId('europe', choices())).toBe('europe')
    expect(selectedChoiceId('fi', choices())).toBe('fi')
    expect(selectedChoiceId('FI', choices())).toBe('fi')
  })

  test('a stored id the list no longer offers falls back to the default row', () => {
    expect(selectedChoiceId('fi', parseChoices(RAW.filter((r) => r.id !== 'fi')))).toBe('europe')
    expect(selectedChoiceId('nl', choices())).toBe('europe')
    expect(selectedChoiceId('mars', choices())).toBe('europe')
  })

  test('with no list yet nothing is selected', () => {
    expect(selectedChoiceId('fi', [])).toBeNull()
  })
})

describe('selectedCountry', () => {
  test('the pinned country row, null for Europe, nothing or a stale choice', () => {
    expect(selectedCountry('de', choices())?.id).toBe('de')
    expect(selectedCountry('europe', choices())).toBeNull()
    expect(selectedCountry(null, choices())).toBeNull()
    expect(selectedCountry('nl', choices())).toBeNull()
  })
})

describe('preferenceUnavailable', () => {
  test('true only for a stored country the list does not offer as live', () => {
    const noFinland = parseChoices(RAW.filter((r) => r.id !== 'fi'))
    expect(preferenceUnavailable('fi', noFinland)).toBe(true)
    expect(preferenceUnavailable('nl', choices())).toBe(true)
    expect(preferenceUnavailable('fi', choices())).toBe(false)
    expect(preferenceUnavailable('europe', choices())).toBe(false)
    expect(preferenceUnavailable(null, choices())).toBe(false)
    expect(preferenceUnavailable('fi', [])).toBe(false)
  })
})

describe('labels come from the payload and are countries', () => {
  test('choiceLabel is the one-line name: Europe, or the country', () => {
    expect(choiceLabel(choices()[0])).toBe('Europe')
    expect(choiceLabel(choices()[2])).toBe('Finland')
  })

  test('a country nobody has heard of renders from the data too (no client map)', () => {
    const [x] = parseChoices([{ id: 'ee', kind: 'country', name: 'Estonia', country: 'Estonia', country_code: 'EE', status: 'live', selectable: true, is_default: false }])
    expect(choiceLabel(x)).toBe('Estonia')
    expect(strictLabel(x)).toBe('Only store in Estonia')
  })

  test('strictLabel names the chosen country', () => {
    expect(strictLabel(choices()[1])).toBe('Only store in Germany')
  })

  test('sidebarRegionLabel follows the stored preference', () => {
    expect(sidebarRegionLabel(null, choices())).toBe('Europe')
    expect(sidebarRegionLabel('europe', choices())).toBe('Europe')
    expect(sidebarRegionLabel('fi', choices())).toBe('Finland')
    expect(sidebarRegionLabel('de', choices())).toBe('Germany')
  })

  test('sidebarRegionLabel before the list has loaded, or for a stale choice, says Europe', () => {
    expect(sidebarRegionLabel('fi', [])).toBe('Europe')
    expect(sidebarRegionLabel('nl', choices())).toBe('Europe')
  })
})

describe('fileStorageCountry (where a file REALLY is: the server\'s storage_location)', () => {
  test('reads the country and nothing else', () => {
    expect(fileStorageCountry({ storage_location: { region: 'hel1', country: 'Finland', country_code: 'FI', city: 'Helsinki' } })).toBe('Finland')
  })

  test('never falls back to the deprecated city: an older server\'s file shows no location', () => {
    expect(fileStorageCountry({ storage_location: { region: 'fsn1', city: 'Falkenstein' } })).toBeNull()
    expect(fileStorageCountry({ storage_location: { city: 'Falkenstein', country: null } })).toBeNull()
  })

  test('absent, malformed or "Unknown" is no country, never a guess', () => {
    expect(fileStorageCountry({})).toBeNull()
    expect(fileStorageCountry(null)).toBeNull()
    expect(fileStorageCountry({ storage_location: null })).toBeNull()
    expect(fileStorageCountry({ storage_location: { country: 7 } })).toBeNull()
    expect(fileStorageCountry({ storage_location: { country: '  ' } })).toBeNull()
    expect(fileStorageCountry({ storage_location: { country: 'Unknown' } })).toBeNull()
  })
})

describe('strictRefusalMessage (409 region_unavailable_strict)', () => {
  const body = { country: 'Germany', country_code: 'DE', city: 'Germany', datacenter: 'de', reason: 'full' }

  test('names the country, says what to do, and is not the generic error', () => {
    const msg = strictRefusalMessage({ code: 'region_unavailable_strict', details: body })
    expect(msg).toBe(
      "Germany can't take new files right now, so this upload stopped. Your choice is set to only Germany. Try again later, or allow other EU countries in Settings.",
    )
  })

  test('reads `country`, never the deprecated `city` alias', () => {
    const msg = strictRefusalMessage({ code: 'region_unavailable_strict', details: { ...body, country: 'Finland', city: 'Falkenstein' } })
    expect(msg).toContain('Finland')
    expect(msg).not.toContain('Falkenstein')
    expect(msg).not.toContain('Germany')
  })

  test('without a country in the body it still says something honest and names no city', () => {
    const msg = strictRefusalMessage({ code: 'region_unavailable_strict', details: { city: 'Falkenstein' } })
    expect(msg).toContain('Your chosen country')
    expect(msg).not.toContain('Falkenstein')
  })

  test('any other error is not this refusal', () => {
    expect(strictRefusalMessage({ code: 'quota_exceeded' })).toBeNull()
    expect(strictRefusalMessage(new Error('x'))).toBeNull()
    expect(strictRefusalMessage(null)).toBeNull()
  })
})

describe('no static region table anywhere in the web client', () => {
  function read(relPath: string): string {
    return readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf-8')
  }

  const SURFACES = [
    'src/pages/settings/data-residency.tsx',
    'src/components/sidebar-storage-footer.tsx',
    'src/components/trust-details-panel.tsx',
    'src/components/upload-progress-card.tsx',
    'src/lib/storage-regions.ts',
    'src/lib/use-region-choices.ts',
  ]

  for (const f of SURFACES) {
    test(`${f} names no city, no country and no provider`, () => {
      const src = read(f)
      // Comments may explain the rule; only code is checked.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(code).not.toMatch(/falkenstein|helsinki|nuremberg|nürnberg|[^a-z]ede[^a-z]|hetzner/i)
      expect(code).not.toMatch(/germany|finland|netherlands/i)
    })
  }

  test('the old continent-level static fallback is gone from the page', () => {
    const src = read('src/pages/settings/data-residency.tsx')
    expect(src).not.toContain('FALLBACK_REGIONS')
    expect(src).not.toContain('countryFromCity')
    expect(read('src/components/sidebar-storage-footer.tsx')).not.toContain('REGION_META')
  })
})
