import { describe, expect, test } from 'bun:test'
import {
  allowOthersPayload,
  parseChoices,
  selectedChoiceId,
  strictUnavailable,
  type StorageRegionChoice,
} from '../src/lib/storage-regions'

/**
 * Task 2053. With "only store in <country>" on and that country gone from the
 * list (or listed but not selectable), the server refuses new uploads
 * (409 region_unavailable_strict). The page must say so, name the country,
 * keep the strict choice visible and offer a way to turn it off.
 */

const EUROPE = { id: 'europe', kind: 'region', name: 'Europe', country: null, country_code: null, status: 'live', selectable: true, is_default: true }
const DE = { id: 'de', kind: 'country', name: 'Germany', country: 'Germany', country_code: 'DE', status: 'live', selectable: true, is_default: false }
const FI_COMING = { id: 'fi', kind: 'country', name: 'Finland', country: 'Finland', country_code: 'FI', status: 'coming_soon', selectable: false, is_default: false }
const FI_LIVE_NOT_SELECTABLE = { ...FI_COMING, status: 'live' }

function list(...raw: unknown[]): StorageRegionChoice[] {
  return parseChoices(raw)
}

describe('strictUnavailable', () => {
  test('strict + country missing from the list: names the country from its code', () => {
    const r = strictUnavailable('fi', true, list(EUROPE, DE))
    expect(r).toEqual({ id: 'fi', name: 'Finland' })
  })

  test('strict + country listed but not selectable: uses the list name', () => {
    expect(strictUnavailable('fi', true, list(EUROPE, DE, FI_COMING))).toEqual({ id: 'fi', name: 'Finland' })
    expect(strictUnavailable('fi', true, list(EUROPE, DE, FI_LIVE_NOT_SELECTABLE))).toEqual({ id: 'fi', name: 'Finland' })
  })

  test('a stored value that is not a country code gets a generic name, never a guess', () => {
    expect(strictUnavailable('hel99', true, list(EUROPE, DE))).toEqual({ id: 'hel99', name: 'your chosen country' })
  })

  test('not strict: null (the server places the upload elsewhere, the old note is right)', () => {
    expect(strictUnavailable('fi', false, list(EUROPE, DE))).toBeNull()
  })

  test('available country, no preference, default row, empty list: null', () => {
    expect(strictUnavailable('de', true, list(EUROPE, DE))).toBeNull()
    expect(strictUnavailable(null, true, list(EUROPE, DE))).toBeNull()
    expect(strictUnavailable('europe', true, list(EUROPE, DE))).toBeNull()
    expect(strictUnavailable('fi', true, [])).toBeNull()
  })

  test('the unavailable pinned country is not shown as Europe selected', () => {
    // selectedChoiceId alone still falls back to the default row; the page
    // must not use it as the selection while strict is refusing uploads.
    expect(selectedChoiceId('fi', list(EUROPE, DE))).toBe('europe')
  })
})

describe('allowOthersPayload', () => {
  test('country listed but not selectable: keeps the stored id', () => {
    expect(allowOthersPayload('fi', list(EUROPE, DE, FI_COMING))).toEqual({ preferred: 'fi', strict: false, missing: false })
  })
  test('country missing from the list: any EU country (null), never the old id', () => {
    expect(allowOthersPayload('fi', list(EUROPE, DE))).toEqual({ preferred: null, strict: false, missing: true })
  })
})
