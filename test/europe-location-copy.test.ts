import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PRICING_PAGE_PLANS } from '../src/lib/plan-constants'

/**
 * Marketing / static copy names "the EU" / "Europe", not "Falkenstein"
 * (Guus, 2026-09-29). Storage starts in Falkenstein, but more EU locations
 * are rolling out, so a fixed city in static copy goes stale. This replaces
 * task 1545#5's opposite rule ("name the city") for these surfaces.
 *
 * Deliberately NOT covered (they show where a file or pool ACTUALLY is, from
 * storage-pool data, with 'Falkenstein' only as the fallback): the trust
 * details panel, upload progress, file-list encryption city, drive-layout's
 * region map, upload-error region and settings/data-residency's pool list —
 * though data-residency's static note is a transparency surface and says
 * "the EU (currently Falkenstein, Germany)". The
 * settings/privacy error-report disclosure also keeps its specific location:
 * it states where one server processes crash reports, not where files live.
 *
 * Honesty guard: no unlaunched regions (the claims guard's PHANTOM_REGIONS)
 * and no choose-your-region claims in this copy.
 */

function read(relPath: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relPath}`, import.meta.url)), 'utf-8')
}

const STATIC_COPY_FILES = [
  'src/lib/plan-constants.ts',
  'src/pages/onboarding.tsx',
  'src/pages/join.tsx',
  'src/pages/share-view.tsx',
  'src/pages/public-profile.tsx',
  'src/pages/billing.tsx',
  'src/pages/pricing.tsx',
  'src/pages/receive.tsx',
  'src/components/empty-states/empty-drive.tsx',
]

describe('static location copy says the EU / Europe, not Falkenstein', () => {
  for (const f of STATIC_COPY_FILES) {
    test(`${f} does not name Falkenstein, an unlaunched region, or a region choice`, () => {
      const src = read(f)
      expect(src).not.toMatch(/falkenstein/i)
      expect(src).not.toMatch(/helsinki|nuremberg|[^a-z]ede[^a-z]/i)
      expect(src).not.toMatch(/choose your region|region of your choice|jurisdiction of choice/i)
    })
  }

  test('share-recipient footers (unknown type + expired/revoked) say "Stored in the EU"', () => {
    const src = read('src/pages/share-view.tsx')
    expect((src.match(/End-to-end encrypted · Stored in the EU/g) ?? []).length).toBe(2)
    expect(src).not.toContain('Stored in Europe')
  })

  test('public profile footer', () => {
    expect(read('src/pages/public-profile.tsx')).toContain('End-to-end encrypted · Stored in the EU · Zero-knowledge')
  })

  test('onboarding + join say "Stored in the EU. Under EU jurisdiction."', () => {
    expect(read('src/pages/onboarding.tsx')).toContain('Stored in the EU. Under EU jurisdiction.')
    const join = read('src/pages/join.tsx')
    expect(join).toContain('Stored in the EU. Under EU jurisdiction and GDPR.')
    expect(join).toContain('Stored in the EU. Under EU jurisdiction.')
  })

  test('pricing: plan features, trust strip and the FAQ ("More EU locations are coming", no named regions)', () => {
    const labels = PRICING_PAGE_PLANS.flatMap((p) => p.features.map((f) => f.label))
    expect(labels.filter((l) => l === 'Stored in the EU').length).toBe(2)
    const pricing = read('src/pages/pricing.tsx')
    expect(pricing).toContain("'Stored in the EU, under EU jurisdiction'")
    expect(pricing).toContain('All data is stored in the EU, under EU jurisdiction and GDPR. More EU locations are coming.')
  })

  test('data-residency (a transparency surface): the EU first, the current location named as current', () => {
    const src = read('src/pages/settings/data-residency.tsx')
    expect(src).toContain('All data is stored in the EU (currently Falkenstein, Germany), under EU law.')
    expect(src).not.toContain('All data is stored in Falkenstein, Germany, under EU law.')
  })

  test('receive relay + empty drive', () => {
    expect(read('src/pages/receive.tsx')).toContain('Encrypted relay in the EU. File deleted after pickup.')
    expect(read('src/components/empty-states/empty-drive.tsx')).toContain("'Europe · more locations soon'")
  })
})
