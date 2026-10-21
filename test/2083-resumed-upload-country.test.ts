// Task 2083 — a RESUMED upload keeps naming the country the server chose at
// init. The resume record stores it (next to `region`); old records (region
// only) still load and read as "no country" so the card says "Europe".
import { describe, expect, test } from 'bun:test'
import { recordedCountry, type UploadState } from '../src/lib/upload-resume'
import { uploadPlaceLabel } from '../src/components/upload-progress-card'

// IndexedDB stores a structured clone; the real IDB round trip is covered by
// e2e/2083-resumed-upload-country.spec.ts (the test fake has no index support).
const reload = (r: UploadState): UploadState => structuredClone(r)

const base: UploadState = {
  fingerprint: 'fp', fileId: 'f1', fileName: 'a.pdf', fileSize: 10, totalChunks: 1,
  region: 'europe', parentId: null, createdAt: 1,
}

describe('resume record country (task 2083)', () => {
  test('a stored country survives a reload and the card names it, not Europe', () => {
    const rec = reload({ ...base, country: 'Finland' })
    expect(rec.country).toBe('Finland')
    const country = recordedCountry(rec)
    expect(country).toBe('Finland')
    expect(uploadPlaceLabel({ storageRegion: rec.region, storageCountry: country ?? undefined })).toBe('Finland')
  })

  test('old-shape record (region only) loads, no crash, falls back to Europe', () => {
    const rec = reload(base)
    expect(rec.region).toBe('europe')
    const country = recordedCountry(rec)
    expect(country).toBeNull()
    expect(uploadPlaceLabel({ storageRegion: rec.region, storageCountry: country ?? undefined })).toBe('Europe')
  })

  test('garbage and Unknown are no country', () => {
    expect(recordedCountry({ country: 7 })).toBeNull()
    expect(recordedCountry({ country: 'Unknown' })).toBeNull()
    expect(recordedCountry({ country: '  ' })).toBeNull()
    expect(recordedCountry(null)).toBeNull()
  })
})
