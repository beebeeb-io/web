import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import {
  partialBannerText,
  searchGuestFolder,
} from '../src/lib/guest-search'
import { GuestSearch, GuestSearchNoResults } from '../src/components/folder-link/guest-search'

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#x2F;/g, '/')
    .replace(/&amp;/g, '&')
}

const folderKey = new Uint8Array(32)

describe('searchGuestFolder — index mode', () => {
  test('returns the ids the shared index holds and is not partial under the bound', async () => {
    const result = await searchGuestFolder({
      term: 'holiday',
      index: { query: async () => ['f1', 'f2'] },
      folderKey,
      listAll: async () => {
        throw new Error('listing must not be walked when the index answers')
      },
      entryCount: 12,
    })
    expect(result).toEqual({ mode: 'index', ids: ['f1', 'f2'], partial: false })
  })

  test('reports partial when the folder is larger than the index bound', async () => {
    const result = await searchGuestFolder({
      term: 'holiday',
      index: { query: async () => ['f1'] },
      folderKey,
      listAll: async () => [],
      entryCount: 20_001,
    })
    expect(result).toEqual({ mode: 'index', ids: ['f1'], partial: true })
  })
})

describe('searchGuestFolder — listing fallback', () => {
  test('walks the listing when the index is missing and returns the name matches', async () => {
    const rows = [
      { fileId: 'f1', name: 'holiday.jpg' },
      { fileId: 'f2', name: 'notes.txt' },
      { fileId: 'f3', name: 'summer-holiday-clip.mp4' },
      { fileId: 'f4', name: 'Holiday list.txt' },
    ]
    const result = await searchGuestFolder({
      term: 'holiday',
      index: null,
      folderKey,
      listAll: async () => rows,
      entryCount: rows.length,
    })
    expect(result).toEqual({
      mode: 'listing',
      names: [
        { fileId: 'f1', name: 'holiday.jpg' },
        { fileId: 'f3', name: 'summer-holiday-clip.mp4' },
        { fileId: 'f4', name: 'Holiday list.txt' },
      ],
      partial: false,
    })
  })

  test('matches case-insensitively', async () => {
    const result = await searchGuestFolder({
      term: 'HOLIDAY',
      index: null,
      folderKey,
      listAll: async () => [{ fileId: 'f1', name: 'holiday.jpg' }],
      entryCount: 1,
    })
    expect(result.mode).toBe('listing')
    if (result.mode !== 'listing') throw new Error('expected listing')
    expect(result.names).toEqual([{ fileId: 'f1', name: 'holiday.jpg' }])
  })

  test('never walks past 20,001 entries and marks the result over_limit', async () => {
    const rows: { fileId: string; name: string }[] = []
    for (let index = 0; index < 20_000; index += 1) {
      rows.push({ fileId: `f${index}`, name: `file-${index}.txt` })
    }
    // The 20,001st row matches; a bounded walk must never reach it.
    rows.push({ fileId: 'late', name: 'holiday.jpg' })

    const result = await searchGuestFolder({
      term: 'holiday',
      index: null,
      folderKey,
      listAll: async () => rows,
      entryCount: rows.length,
    })

    expect(result.mode).toBe('listing')
    if (result.mode !== 'listing') throw new Error('expected listing')
    expect(result.partial).toBe(true)
    expect(result.note).toBe('over_limit')
    expect(result.names).toEqual([])
  })

  test('falls back when the index throws', async () => {
    const result = await searchGuestFolder({
      term: 'trip',
      index: {
        query: async () => {
          throw new Error('garbage shard')
        },
      },
      folderKey,
      listAll: async () => [{ fileId: 'f9', name: 'trip.pdf' }],
      entryCount: 1,
    })
    expect(result).toEqual({
      mode: 'listing',
      names: [{ fileId: 'f9', name: 'trip.pdf' }],
      partial: false,
    })
  })
})

describe('GuestSearch markup', () => {
  const props = { onQuery: () => undefined, busy: false }

  test('renders the partial banner only when partial', () => {
    const partial = plain(
      renderToStaticMarkup(createElement(GuestSearch, { ...props, partial: true })),
    )
    expect(partial).toContain(partialBannerText())
    expect(partialBannerText()).toBe(
      'Search may be incomplete — this folder has more items than we index in your browser.',
    )

    const complete = plain(
      renderToStaticMarkup(createElement(GuestSearch, { ...props, partial: false })),
    )
    expect(complete).not.toContain(partialBannerText())
  })

  test('exposes a labelled search input', () => {
    const html = plain(renderToStaticMarkup(createElement(GuestSearch, { ...props, partial: false })))
    expect(html).toContain('Search this folder')
  })

  test('renders the no-results copy with the term', () => {
    const html = plain(
      renderToStaticMarkup(createElement(GuestSearchNoResults, { term: 'holiday' })),
    )
    expect(html).toContain('Nothing matches “holiday”.')
  })
})
