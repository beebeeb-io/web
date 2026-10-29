// Task 2062 — the in-progress upload card names the COUNTRY the server chose at
// init ("Stored in Finland") instead of "Europe" until the transfer is done.
// Renders the real component; the positive control proves the data line renders.
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { UploadCard, uploadPlaceLabel } from '../src/components/upload-progress-card'
import type { UploadItem } from '../src/components/upload-progress'

const base: UploadItem = {
  id: 'u1',
  name: 'a.pdf',
  size: 10_000_000,
  progress: 40,
  stage: 'Uploading',
  bytesUploaded: 4_000_000,
  chunkSizeBytes: 4_194_304,
  startedAt: Date.now() - 4000,
  storageRegion: 'europe',
}

function html(upload: UploadItem): string {
  return renderToStaticMarkup(<UploadCard upload={upload} onCancel={() => {}} onRetry={() => {}} />)
}

describe('upload card place (task 2062)', () => {
  test('the init country wins over the region while uploading', () => {
    const out = html({ ...base, storageCountry: 'Finland' })
    expect(out).toContain('Stored in Finland')
    expect(out).not.toContain('Stored in Europe')
  })

  test('without a country (older server) it falls back to Europe, and still renders the line', () => {
    expect(html(base)).toContain('Stored in Europe')
  })

  test('uploadPlaceLabel: country, else region, else nothing', () => {
    expect(uploadPlaceLabel({ storageCountry: 'Germany', storageRegion: 'europe' })).toBe('Germany')
    expect(uploadPlaceLabel({ storageRegion: 'europe' })).toBe('Europe')
    expect(uploadPlaceLabel({})).toBeNull()
  })
})
