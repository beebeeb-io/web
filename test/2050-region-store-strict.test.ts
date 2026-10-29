import { beforeEach, describe, expect, test } from 'bun:test'
import { mockModuleScoped } from './helpers/scoped-module-mock'

/**
 * Task 2050 (with 1952's strict flag): the region store keeps "Only store in
 * <country>" next to the preference, and PUT always carries both (the server
 * replaces the whole choice; an omitted flag means false).
 */

const CHOICES = [
  { id: 'europe', kind: 'region', name: 'Europe', country: null, country_code: null, status: 'live', selectable: true, is_default: true },
  { id: 'de', kind: 'country', name: 'Germany', country: 'Germany', country_code: 'DE', status: 'live', selectable: true, is_default: false },
]

let serverPreferred: string | null = 'de'
let serverStrict = true
let puts: Array<{ id: string | null; strict: boolean | undefined }> = []
let failNext = false

await mockModuleScoped('../src/lib/api', import.meta.dir, {
  getUserRegion: async () => ({
    preferred_region: serverPreferred,
    region_strict: serverStrict,
    available_regions: [],
    choices: CHOICES,
  }),
  setUserRegion: async (id: string | null, strict?: boolean) => {
    puts.push({ id, strict })
    if (failNext) throw new Error('refused')
    return { preferred_region: id, region_strict: strict }
  },
})

const { loadRegionChoices, regionStoreSnapshot, resetRegionStore, saveRegionChoice } = await import(
  '../src/lib/use-region-choices'
)

beforeEach(() => {
  resetRegionStore()
  serverPreferred = 'de'
  serverStrict = true
  puts = []
  failNext = false
})

describe('the store reports what the server stored', () => {
  test('a stored country with strict on loads as strict', async () => {
    await loadRegionChoices('u-1')
    expect(regionStoreSnapshot()).toMatchObject({ status: 'ready', preferred: 'de', strict: true })
  })

  test('a server that sends no region_strict (older than 1952) loads as not strict', async () => {
    await loadRegionChoices('u-1')
    resetRegionStore()
    serverStrict = undefined as unknown as boolean
    await loadRegionChoices('u-1')
    expect(regionStoreSnapshot().strict).toBe(false)
  })

  test('strict with no stored preference is not strict', async () => {
    serverPreferred = null
    await loadRegionChoices('u-1')
    expect(regionStoreSnapshot().strict).toBe(false)
  })
})

describe('strict travels with the choice', () => {
  test('a country with strict is sent as region_strict: true and shown', async () => {
    serverStrict = false
    await loadRegionChoices('u-1')
    await saveRegionChoice('de', true)
    expect(puts).toEqual([{ id: 'de', strict: true }])
    expect(regionStoreSnapshot()).toMatchObject({ preferred: 'de', strict: true })
  })

  test('an omitted flag is sent as false, never left out', async () => {
    await loadRegionChoices('u-1')
    await saveRegionChoice('de')
    expect(puts).toEqual([{ id: 'de', strict: false }])
    expect(regionStoreSnapshot().strict).toBe(false)
  })

  test('clearing the preference can never be strict, whatever the caller asks', async () => {
    await loadRegionChoices('u-1')
    await saveRegionChoice(null, true)
    expect(puts).toEqual([{ id: null, strict: false }])
    expect(regionStoreSnapshot()).toMatchObject({ preferred: null, strict: false })
  })

  test('a refused save rolls the preference AND the flag back, and throws', async () => {
    await loadRegionChoices('u-1')
    failNext = true
    await expect(saveRegionChoice('europe', false)).rejects.toThrow('refused')
    expect(regionStoreSnapshot()).toMatchObject({ preferred: 'de', strict: true })
  })
})
