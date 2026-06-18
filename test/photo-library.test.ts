import { describe, expect, test } from 'bun:test'

import { isLikelyAlbumArtOrIcon } from '../src/lib/photo-library'

const MB = 1024 * 1024

describe('isLikelyAlbumArtOrIcon — excludes obvious album art / icons', () => {
  test.each([
    ['cover.jpg'],
    ['Cover.JPG'],
    ['COVER.jpeg'],
    ['folder.jpg'],
    ['Folder.jpg'],
    ['front.png'],
    ['back.jpg'],
    ['poster.jpg'],
    ['thumb.png'],
    ['albumart.jpg'],
    ['AlbumArtSmall.jpg'],
    ['AlbumArt_{ABC-123}_Large.jpg'],
    ['fanart.jpg'],
    ['disc.png'],
    ['clearlogo.png'],
  ])('%s (artwork sentinel, normal size) is excluded', (name) => {
    expect(isLikelyAlbumArtOrIcon(name, 2 * MB, 'image/jpeg')).toBe(true)
  })

  test('hidden sidecar art (.thumb) is excluded', () => {
    expect(isLikelyAlbumArtOrIcon('.thumb', 5 * MB, undefined)).toBe(true)
  })

  test('a tiny image (under 20 KB) is excluded as a likely icon', () => {
    expect(isLikelyAlbumArtOrIcon('icon-32.png', 2 * 1024, 'image/png')).toBe(true)
    expect(isLikelyAlbumArtOrIcon('vacation.jpg', 19 * 1024, 'image/jpeg')).toBe(true)
  })

  test('basename is used even when a path is present', () => {
    expect(isLikelyAlbumArtOrIcon('Music/Album/cover.jpg', 2 * MB, 'image/jpeg')).toBe(true)
    expect(isLikelyAlbumArtOrIcon('Music\\Album\\Folder.jpg', 2 * MB, 'image/jpeg')).toBe(true)
  })

  test('size heuristic catches art with no/unknown MIME but image extension', () => {
    expect(isLikelyAlbumArtOrIcon('weird.png', 1024, null)).toBe(true)
  })
})

describe('isLikelyAlbumArtOrIcon — KEEPS real photos (no false positives)', () => {
  test.each([
    ['vacation.jpg'],
    ['IMG_4823.jpg'],
    ['DSC00192.jpeg'],
    ['family-portrait.png'],
    ['front-door.jpg'],   // contains "front" but stem is "front-door", not "front"
    ['coverage-map.png'], // contains "cover" but stem is not exactly "cover"
    ['poster-session-2024.jpg'],
    ['my-album-2024.jpg'],
  ])('%s (real photo, normal size) is kept', (name) => {
    expect(isLikelyAlbumArtOrIcon(name, 2 * MB, 'image/jpeg')).toBe(false)
  })

  test('a normal-sized photo at exactly the threshold is kept', () => {
    // 20 KB is the boundary; only strictly-below is excluded.
    expect(isLikelyAlbumArtOrIcon('snap.jpg', 20 * 1024, 'image/jpeg')).toBe(false)
  })

  test('a video named cover.mp4 is never treated as album art', () => {
    expect(isLikelyAlbumArtOrIcon('cover.mp4', 2 * 1024, 'video/mp4')).toBe(false)
    // Even a tiny video is kept — size heuristic is image-only.
    expect(isLikelyAlbumArtOrIcon('clip.mp4', 1024, 'video/mp4')).toBe(false)
  })

  test('size 0 (unknown) does not trigger the tiny-image exclusion', () => {
    expect(isLikelyAlbumArtOrIcon('photo.jpg', 0, 'image/jpeg')).toBe(false)
  })

  test('empty name is kept (cannot judge)', () => {
    expect(isLikelyAlbumArtOrIcon('', 2 * MB, 'image/jpeg')).toBe(false)
  })
})
