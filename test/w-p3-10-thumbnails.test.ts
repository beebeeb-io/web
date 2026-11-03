import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { thumbnailBudget, thumbnailFormat, thumbnailPolicy } from 'beebeeb-wasm'
import { loadWasm } from './helpers/wasm-crypto-mirror'
import {
  ensureThumbnailWasm,
  fitWithin,
  thumbnailBudgetFor,
  thumbnailFormatFor,
  thumbnailPolicyFor,
  type ThumbnailPlatform,
  type ThumbnailVariant,
} from '../src/lib/thumbnail-policy'

/**
 * The thumbnail vector (`test-vectors/consolidation/thumbnail.json`, core
 * 8b6446c), case for case, plus the browser encoder that consumes it.
 *
 * The vector's `ladder`, `format` and `budget` cases are core's; the `resize`
 * cases belong to `resize_for_thumbnail`, which core keeps platform-native and
 * does not export, so the browser keeps the same rule in `fitWithin` and it is
 * pinned here against the vector too.
 *
 * The plan's proof: every ladder step and every budget boundary comes from
 * core, and the browser encodes WebP at each step.
 */

interface LadderCase {
  id: string
  kind: 'ladder'
  variant: ThumbnailVariant
  steps: Array<{ max_dimension: number; quality: number }>
  target_bytes: number
  max_bytes: number
  target_px: number
}

interface FormatCase {
  id: string
  kind: 'format'
  variant: ThumbnailVariant
  platform: ThumbnailPlatform
  expected: 'heic' | 'webp'
}

interface BudgetCase {
  id: string
  kind: 'budget'
  variant: ThumbnailVariant
  bytes: number
  expected: 'target' | 'fallback' | 'rejected'
}

interface ResizeCase {
  id: string
  kind: 'resize'
  width: number
  height: number
  max_dimension: number
  expected_width?: number
  expected_height?: number
  expect?: 'reject'
}

const LADDERS: LadderCase[] = [
  {
    id: 'thumb_ladder_small',
    kind: 'ladder',
    variant: 'small',
    target_bytes: 24576,
    max_bytes: 32740,
    target_px: 384,
    steps: [
      { max_dimension: 384, quality: 78 },
      { max_dimension: 384, quality: 66 },
      { max_dimension: 384, quality: 54 },
      { max_dimension: 320, quality: 50 },
      { max_dimension: 256, quality: 48 },
    ],
  },
  {
    id: 'thumb_ladder_medium',
    kind: 'ladder',
    variant: 'medium',
    target_bytes: 102400,
    max_bytes: 131044,
    target_px: 768,
    steps: [
      { max_dimension: 768, quality: 82 },
      { max_dimension: 768, quality: 74 },
      { max_dimension: 768, quality: 66 },
      { max_dimension: 768, quality: 58 },
      { max_dimension: 768, quality: 50 },
      { max_dimension: 640, quality: 58 },
      { max_dimension: 512, quality: 56 },
      { max_dimension: 384, quality: 54 },
    ],
  },
  {
    id: 'thumb_ladder_large',
    kind: 'ladder',
    variant: 'large',
    target_bytes: 409600,
    max_bytes: 491520,
    target_px: 1600,
    steps: [
      { max_dimension: 1600, quality: 90 },
      { max_dimension: 1600, quality: 82 },
      { max_dimension: 1600, quality: 74 },
      { max_dimension: 1600, quality: 66 },
      { max_dimension: 1600, quality: 58 },
      { max_dimension: 1600, quality: 50 },
    ],
  },
]

const FORMATS: FormatCase[] = [
  { id: 'thumb_format_ios', kind: 'format', variant: 'medium', platform: 'ios', expected: 'heic' },
  { id: 'thumb_format_macos', kind: 'format', variant: 'medium', platform: 'macos', expected: 'heic' },
  { id: 'thumb_format_android', kind: 'format', variant: 'medium', platform: 'android', expected: 'webp' },
  { id: 'thumb_format_windows', kind: 'format', variant: 'medium', platform: 'windows', expected: 'webp' },
  { id: 'thumb_format_linux', kind: 'format', variant: 'medium', platform: 'linux', expected: 'webp' },
  { id: 'thumb_format_web', kind: 'format', variant: 'medium', platform: 'web', expected: 'webp' },
  { id: 'thumb_format_unknown', kind: 'format', variant: 'medium', platform: 'unknown', expected: 'webp' },
]

const BUDGETS: BudgetCase[] = [
  { id: 'thumb_budget_0', kind: 'budget', variant: 'small', bytes: 24575, expected: 'target' },
  { id: 'thumb_budget_1', kind: 'budget', variant: 'small', bytes: 24576, expected: 'target' },
  { id: 'thumb_budget_2', kind: 'budget', variant: 'small', bytes: 24577, expected: 'fallback' },
  { id: 'thumb_budget_3', kind: 'budget', variant: 'small', bytes: 32740, expected: 'fallback' },
  { id: 'thumb_budget_4', kind: 'budget', variant: 'small', bytes: 32741, expected: 'rejected' },
  { id: 'thumb_budget_5', kind: 'budget', variant: 'medium', bytes: 102400, expected: 'target' },
  { id: 'thumb_budget_6', kind: 'budget', variant: 'medium', bytes: 102401, expected: 'fallback' },
  { id: 'thumb_budget_7', kind: 'budget', variant: 'large', bytes: 409600, expected: 'target' },
  { id: 'thumb_budget_8', kind: 'budget', variant: 'large', bytes: 491521, expected: 'rejected' },
]

const RESIZES: ResizeCase[] = [
  {
    id: 'thumb_resize_source_smaller',
    kind: 'resize',
    width: 100,
    height: 50,
    max_dimension: 768,
    expected_width: 100,
    expected_height: 50,
  },
  {
    id: 'thumb_resize_landscape',
    kind: 'resize',
    width: 1536,
    height: 768,
    max_dimension: 768,
    expected_width: 768,
    expected_height: 384,
  },
  {
    id: 'thumb_zero_dimension',
    kind: 'resize',
    width: 0,
    height: 0,
    max_dimension: 768,
    expect: 'reject',
  },
  {
    id: 'thumb_resize_tiny_target',
    kind: 'resize',
    width: 1600,
    height: 100,
    max_dimension: 1,
    expected_width: 1,
    expected_height: 1,
  },
]

describe('thumbnail vector', () => {
  beforeAll(async () => {
    loadWasm()
    await ensureThumbnailWasm()
  })

  it('reports every ladder step and both budgets per variant', () => {
    for (const testCase of LADDERS) {
      const raw = thumbnailPolicy(testCase.variant) as {
        variant: string
        target_px: number
        target_bytes: number
        max_bytes: number
        steps: Array<{ max_dimension: number; quality: number }>
      }
      expect({ id: testCase.id, variant: raw.variant }).toEqual({
        id: testCase.id,
        variant: testCase.variant,
      })
      expect(raw.target_px).toBe(testCase.target_px)
      expect(raw.target_bytes).toBe(testCase.target_bytes)
      expect(raw.max_bytes).toBe(testCase.max_bytes)
      expect(raw.steps).toEqual(testCase.steps)

      const view = thumbnailPolicyFor(testCase.variant)
      expect(view.targetPx).toBe(testCase.target_px)
      expect(view.targetBytes).toBe(testCase.target_bytes)
      expect(view.maxBytes).toBe(testCase.max_bytes)
      expect(view.steps).toEqual(
        testCase.steps.map((step) => ({ maxDimension: step.max_dimension, quality: step.quality })),
      )
    }
  })

  it('chooses the encoder per platform: HEIC on iOS/macOS, WebP elsewhere', () => {
    for (const testCase of FORMATS) {
      expect({ id: testCase.id, format: thumbnailFormat(testCase.variant, testCase.platform) }).toEqual({
        id: testCase.id,
        format: testCase.expected,
      })
      expect(thumbnailFormatFor(testCase.variant, testCase.platform)).toBe(testCase.expected)
    }
  })

  it('classifies every budget boundary, inclusive at target and max', () => {
    for (const testCase of BUDGETS) {
      expect({
        id: testCase.id,
        verdict: thumbnailBudget(testCase.variant, testCase.bytes),
      }).toEqual({ id: testCase.id, verdict: testCase.expected })
      expect(thumbnailBudgetFor(testCase.variant, testCase.bytes)).toBe(testCase.expected)
    }
    expect(() => thumbnailBudget('medium', -1)).toThrow()
    expect(() => thumbnailBudget('medium', Number.NaN)).toThrow()
    expect(() => thumbnailPolicyFor('thumbnail' as ThumbnailVariant)).toThrow()
  })

  it('fits sources inside the step without upscaling or collapsing to zero', () => {
    for (const testCase of RESIZES) {
      const fitted = fitWithin(testCase.width, testCase.height, testCase.max_dimension)
      if (testCase.expect === 'reject') {
        expect({ id: testCase.id, fitted }).toEqual({ id: testCase.id, fitted: null })
        continue
      }
      expect({ id: testCase.id, fitted }).toEqual({
        id: testCase.id,
        fitted: { width: testCase.expected_width!, height: testCase.expected_height! },
      })
    }
  })
})

describe('browser encoder', () => {
  const calls: Array<{ width: number; height: number; type: string; quality: number }> = []
  let scriptedSizes: number[] = []
  let source = { width: 1536, height: 768 }
  const globals = globalThis as unknown as Record<string, unknown>
  const savedBitmap = globals.createImageBitmap
  const savedCanvas = globals.OffscreenCanvas

  beforeAll(async () => {
    loadWasm()
    await ensureThumbnailWasm()

    globals.createImageBitmap = async () => ({
      width: source.width,
      height: source.height,
      close() {},
    })
    globals.OffscreenCanvas = class {
      private readonly width: number
      private readonly height: number
      constructor(width: number, height: number) {
        this.width = width
        this.height = height
      }
      getContext() {
        return { drawImage() {} }
      }
      async convertToBlob(options: { type: string; quality: number }) {
        calls.push({
          width: this.width,
          height: this.height,
          type: options.type,
          quality: options.quality,
        })
        const size = scriptedSizes.shift() ?? 1024
        return new Blob([new Uint8Array(size)])
      }
    }
  })

  afterAll(() => {
    globals.createImageBitmap = savedBitmap
    globals.OffscreenCanvas = savedCanvas
  })

  function reset() {
    calls.length = 0
    scriptedSizes = []
    source = { width: 1536, height: 768 }
  }

  it('walks the medium ladder from core and stops at the target', async () => {
    const { generateThumbnail } = await import('../src/lib/thumbnail')
    reset()
    scriptedSizes = [200000, 150000, 140000, 130000, 120000, 110000, 100000]

    const blob = await generateThumbnail(new File([new Uint8Array(1)], 'photo.jpg', { type: 'image/jpeg' }))

    expect(calls.map((call) => [call.width, call.height])).toEqual([
      [768, 384],
      [768, 384],
      [768, 384],
      [768, 384],
      [768, 384],
      [640, 320],
      [512, 256],
    ])
    expect(calls.map((call) => call.type)).toEqual([
      'image/webp',
      'image/webp',
      'image/webp',
      'image/webp',
      'image/webp',
      'image/webp',
      'image/webp',
    ])
    expect(calls.map((call) => call.quality)).toEqual([0.82, 0.74, 0.66, 0.58, 0.5, 0.58, 0.56])
    expect(blob?.size).toBe(100000)
  })

  it('keeps the smallest attempt when every step is over the max', async () => {
    const { generateThumbnail } = await import('../src/lib/thumbnail')
    reset()
    scriptedSizes = [400000, 300000, 250000, 200000, 190000, 180000, 170000, 160000]

    const blob = await generateThumbnail(new File([new Uint8Array(1)], 'photo.jpg', { type: 'image/jpeg' }))

    expect(calls).toHaveLength(8)
    expect(calls.at(-1)).toMatchObject({ width: 384, height: 192 })
    expect(blob?.size).toBe(160000)
  })

  it('walks the large ladder to the large target', async () => {
    const { generateLargeThumbnail } = await import('../src/lib/thumbnail')
    reset()
    source = { width: 3000, height: 2000 }
    scriptedSizes = [500000, 409600]

    const blob = await generateLargeThumbnail(new File([new Uint8Array(1)], 'photo.jpg', { type: 'image/jpeg' }))

    expect(calls.map((call) => [call.width, call.height])).toEqual([
      [1600, 1067],
      [1600, 1067],
    ])
    expect(calls.map((call) => call.quality)).toEqual([0.9, 0.82])
    expect(blob?.size).toBe(409600)
  })

  it('returns null for non-images and for sources with no area', async () => {
    const { generateThumbnail } = await import('../src/lib/thumbnail')
    reset()

    expect(await generateThumbnail(new File([new Uint8Array(1)], 'note.txt', { type: 'text/plain' }))).toBeNull()
    expect(calls).toHaveLength(0)

    source = { width: 0, height: 0 }
    expect(
      await generateThumbnail(new File([new Uint8Array(1)], 'empty.png', { type: 'image/png' })),
    ).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it('keeps no ladder or budget of its own', () => {
    const source = readFileSync(new URL('../src/lib/thumbnail.ts', import.meta.url), 'utf8')
    expect(source).not.toContain('THUMB_VARIANTS')
    expect(source).not.toContain('50 * 1024')
    expect(source).not.toContain('480 * 1024')
    expect(source).not.toContain('0.82')
    expect(source).toContain('thumbnailPolicyFor')
    expect(source).toContain('thumbnailBudgetFor')
    expect(source).toContain('fitWithin')
  })
})
