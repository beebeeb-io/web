import { describe, expect, test } from 'bun:test'
import { getVideoFrameFit } from '../src/components/preview/video-preview'

describe('video preview sizing', () => {
  test('fits portrait video by height and preserves native aspect ratio', () => {
    const fit = getVideoFrameFit({
      containerWidth: 900,
      containerHeight: 500,
      videoWidth: 1080,
      videoHeight: 1920,
    })

    expect(fit.width).toBe(281.25)
    expect(fit.height).toBe(500)
    expect(fit.aspectRatio).toBe('1080 / 1920')
  })

  test('fits landscape video by the limiting container side', () => {
    const fit = getVideoFrameFit({
      containerWidth: 900,
      containerHeight: 500,
      videoWidth: 1920,
      videoHeight: 1080,
    })

    expect(fit.width).toBeCloseTo(888.89, 2)
    expect(fit.height).toBe(500)
    expect(fit.aspectRatio).toBe('1920 / 1080')
  })
})
