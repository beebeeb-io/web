import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  choiceLabel,
  choiceSubline,
  fileStorageCity,
  groupChoices,
  locationLabel,
  parseChoices,
  preferenceUnavailable,
  selectedChoiceId,
  sidebarRegionLabel,
  type StorageRegionChoice,
} from '../src/lib/storage-regions'

/**
 * Task 1919 — the region choice is a LIST FROM THE API, never a client table.
 * Ruling (Guus 2026-10-17): "Europe" is the default (no country, any of our
 * European datacenters); below it the person picks one datacenter; a datacenter
 * that is not live yet is listed as coming soon and cannot be picked.
 *
 * Every function here derives from the payload (`GET /api/v1/storage-regions` /
 * `choices` of `GET /api/v1/me/region`). The last describe pins that no source
 * file keeps a static city or country table again.
 */

const RAW = [
  { id: 'europe', kind: 'region', name: 'Europe', city: null, country: null, country_code: null, status: 'live', selectable: true, is_default: true },
  { id: 'fsn1', kind: 'datacenter', name: 'Falkenstein', city: 'Falkenstein', country: 'Germany', country_code: 'DE', status: 'live', selectable: true, is_default: false },
  { id: 'hel1', kind: 'datacenter', name: 'Helsinki', city: 'Helsinki', country: 'Finland', country_code: 'FI', status: 'live', selectable: true, is_default: false },
  { id: 'nbg1', kind: 'datacenter', name: 'Nuremberg', city: 'Nuremberg', country: 'Germany', country_code: 'DE', status: 'live', selectable: true, is_default: false },
  { id: 'ede', kind: 'datacenter', name: 'Ede', city: 'Ede', country: 'Netherlands', country_code: 'NL', status: 'coming_soon', selectable: false, is_default: false },
]

function choices(): StorageRegionChoice[] {
  return parseChoices(RAW)
}

describe('parseChoices', () => {
  test('keeps the five entries of the contract in order', () => {
    expect(choices().map((c) => c.id)).toEqual(['europe', 'fsn1', 'hel1', 'nbg1', 'ede'])
  })

  test('drops malformed entries instead of rendering them', () => {
    const parsed = parseChoices([
      RAW[0],
      null,
      42,
      { id: 7, name: 'x', status: 'live' },
      { id: 'zzz', name: 'No status', kind: 'datacenter' },
      { id: 'zzz2', name: 'Odd status', kind: 'datacenter', status: 'open', selectable: true },
      RAW[2],
    ])
    expect(parsed.map((c) => c.id)).toEqual(['europe', 'hel1'])
  })

  test('anything that is not a list is an empty list (an old server has no `choices`)', () => {
    expect(parseChoices(undefined)).toEqual([])
    expect(parseChoices({ not: 'a list' })).toEqual([])
  })

  test('a coming-soon entry can never be selectable, whatever the payload says', () => {
    const [ede] = parseChoices([{ ...RAW[4], selectable: true }])
    expect(ede.status).toBe('coming_soon')
    expect(ede.selectable).toBe(false)
  })
})

describe('groupChoices', () => {
  test('Europe is the default row, live datacenters are pickable, coming soon is apart', () => {
    const g = groupChoices(choices())
    expect(g.defaultChoice?.id).toBe('europe')
    expect(g.live.map((c) => c.id)).toEqual(['fsn1', 'hel1', 'nbg1'])
    expect(g.comingSoon.map((c) => c.id)).toEqual(['ede'])
  })

  test('the UI follows the data: a datacenter that turns live moves up, no client change', () => {
    const next = parseChoices(RAW.map((r) => (r.id === 'ede' ? { ...r, status: 'live', selectable: true } : r)))
    const g = groupChoices(next)
    expect(g.live.map((c) => c.id)).toEqual(['fsn1', 'hel1', 'nbg1', 'ede'])
    expect(g.comingSoon).toEqual([])
  })

  test('a datacenter that goes away is simply gone (the server omits it)', () => {
    const g = groupChoices(parseChoices(RAW.filter((r) => r.id !== 'hel1')))
    expect(g.live.map((c) => c.id)).toEqual(['fsn1', 'nbg1'])
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

  test('"europe" and a live datacenter id select their own row', () => {
    expect(selectedChoiceId('europe', choices())).toBe('europe')
    expect(selectedChoiceId('hel1', choices())).toBe('hel1')
    expect(selectedChoiceId('HEL1', choices())).toBe('hel1')
  })

  test('a stored id the list no longer offers falls back to the default row', () => {
    expect(selectedChoiceId('hel1', parseChoices(RAW.filter((r) => r.id !== 'hel1')))).toBe('europe')
    expect(selectedChoiceId('ede', choices())).toBe('europe')
    expect(selectedChoiceId('mars', choices())).toBe('europe')
  })

  test('with no list yet nothing is selected', () => {
    expect(selectedChoiceId('hel1', [])).toBeNull()
  })
})

describe('preferenceUnavailable', () => {
  test('true only for a stored datacenter the list does not offer as live', () => {
    const noHelsinki = parseChoices(RAW.filter((r) => r.id !== 'hel1'))
    expect(preferenceUnavailable('hel1', noHelsinki)).toBe(true)
    expect(preferenceUnavailable('ede', choices())).toBe(true)
    expect(preferenceUnavailable('hel1', choices())).toBe(false)
    expect(preferenceUnavailable('europe', choices())).toBe(false)
    expect(preferenceUnavailable(null, choices())).toBe(false)
    expect(preferenceUnavailable('hel1', [])).toBe(false)
  })
})

describe('labels come from the payload', () => {
  test('locationLabel: city, country from the entry; Europe has neither', () => {
    const c = choices()
    expect(locationLabel(c[0])).toBe('')
    expect(locationLabel(c[2])).toBe('Helsinki, Finland')
    expect(locationLabel(c[3])).toBe('Nuremberg, Germany')
    expect(locationLabel({ ...c[2], country: null })).toBe('Helsinki')
  })

  test('choiceSubline: a datacenter named after its city says the country, the default row says nothing', () => {
    const c = choices()
    expect(choiceSubline(c[0])).toBe('')
    expect(choiceSubline(c[2])).toBe('Finland')
    expect(choiceSubline({ ...c[2], name: 'Helsinki 1' })).toBe('Helsinki, Finland')
    expect(choiceSubline({ ...c[2], country: null })).toBe('')
  })

  test('a city nobody has heard of renders from the data too (no client map)', () => {
    const [x] = parseChoices([{ id: 'xyz9', kind: 'datacenter', name: 'Tallinn', city: 'Tallinn', country: 'Estonia', country_code: 'EE', status: 'live', selectable: true, is_default: false }])
    expect(locationLabel(x)).toBe('Tallinn, Estonia')
  })

  test('choiceLabel is the one-line name (sidebar): Europe, or city and country', () => {
    expect(choiceLabel(choices()[0])).toBe('Europe')
    expect(choiceLabel(choices()[2])).toBe('Helsinki, Finland')
  })

  test('sidebarRegionLabel follows the stored preference', () => {
    expect(sidebarRegionLabel(null, choices())).toBe('Europe')
    expect(sidebarRegionLabel('europe', choices())).toBe('Europe')
    expect(sidebarRegionLabel('hel1', choices())).toBe('Helsinki, Finland')
    expect(sidebarRegionLabel('nbg1', choices())).toBe('Nuremberg, Germany')
  })

  test('sidebarRegionLabel before the list has loaded, or for a stale choice, says Europe', () => {
    expect(sidebarRegionLabel('hel1', [])).toBe('Europe')
    expect(sidebarRegionLabel('ede', choices())).toBe('Europe')
  })
})

describe('fileStorageCity (where a file REALLY is: the server\'s storage_location)', () => {
  test('reads the city and nothing else', () => {
    expect(fileStorageCity({ storage_location: { region: 'hel1', city: 'Helsinki', provider: 'x' } })).toBe('Helsinki')
  })

  test('absent, malformed or "Unknown" is no city, never a guess', () => {
    expect(fileStorageCity({})).toBeNull()
    expect(fileStorageCity(null)).toBeNull()
    expect(fileStorageCity({ storage_location: null })).toBeNull()
    expect(fileStorageCity({ storage_location: { city: 7 } })).toBeNull()
    expect(fileStorageCity({ storage_location: { city: '  ' } })).toBeNull()
    expect(fileStorageCity({ storage_location: { city: 'Unknown' } })).toBeNull()
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
