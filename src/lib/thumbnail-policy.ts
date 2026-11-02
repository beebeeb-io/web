// Thumbnail policy comes from core; this file only shapes it for the browser.
//
// The ladder (which longest side to try, at which quality), the two byte
// budgets per variant (target and hard maximum), the per-platform encoder
// choice and the budget verdict all live in core's `thumbnail.rs`. What stays
// here is the browser half: resize a bitmap, draw it, encode it. Core does not
// export its resize rule (`resize_for_thumbnail` is platform-native), so the
// same rule is kept in `fitWithin` below and pinned by the resize cases of the
// thumbnail vector.
import init, { thumbnailBudget, thumbnailFormat, thumbnailPolicy } from 'beebeeb-wasm'

export type ThumbnailVariant = 'small' | 'medium' | 'large'
export type ThumbnailPlatform =
  | 'ios'
  | 'macos'
  | 'android'
  | 'windows'
  | 'linux'
  | 'web'
  | 'unknown'
export type ThumbnailVerdict = 'target' | 'fallback' | 'rejected'
export type ThumbnailFormat = 'heic' | 'webp'

/** One ladder step: the longest side to try and the encoder quality, in percent. */
export interface ThumbnailStep {
  maxDimension: number
  quality: number
}

/** One variant's policy, as core reports it. */
export interface ThumbnailPolicy {
  variant: ThumbnailVariant
  targetPx: number
  targetBytes: number
  maxBytes: number
  steps: ThumbnailStep[]
}

let wasmReady = false
let wasmInitPromise: Promise<void> | null = null

/** Initialise the wasm module once. Never rejects; retries on the next call. */
export function ensureThumbnailWasm(): Promise<void> {
  if (wasmReady) return Promise.resolve()
  wasmInitPromise ??= init().then(
    () => {
      wasmReady = true
    },
    (error: unknown) => {
      wasmInitPromise = null
      throw error
    },
  )
  return wasmInitPromise
}

export function isThumbnailWasmReady(): boolean {
  return wasmReady
}

void ensureThumbnailWasm().catch(() => {})

interface RawPolicy {
  variant: string
  target_px?: number
  targetPx?: number
  target_bytes?: number
  targetBytes?: number
  max_bytes?: number
  maxBytes?: number
  steps: Array<{ max_dimension?: number; maxDimension?: number; quality: number }>
}

/** The policy core holds for `variant`, in the names this client uses. */
export function thumbnailPolicyFor(variant: ThumbnailVariant): ThumbnailPolicy {
  const raw = thumbnailPolicy(variant) as RawPolicy
  return {
    variant: raw.variant as ThumbnailVariant,
    targetPx: raw.target_px ?? raw.targetPx ?? 0,
    targetBytes: raw.target_bytes ?? raw.targetBytes ?? 0,
    maxBytes: raw.max_bytes ?? raw.maxBytes ?? 0,
    steps: raw.steps.map((step) => ({
      maxDimension: step.max_dimension ?? step.maxDimension ?? 0,
      quality: step.quality,
    })),
  }
}

/** Where `bytes` falls against `variant`'s budgets. */
export function thumbnailBudgetFor(variant: ThumbnailVariant, bytes: number): ThumbnailVerdict {
  return thumbnailBudget(variant, bytes) as ThumbnailVerdict
}

/** The encoder `variant` asks for on `platform`. */
export function thumbnailFormatFor(
  variant: ThumbnailVariant,
  platform: ThumbnailPlatform,
): ThumbnailFormat {
  return thumbnailFormat(variant, platform) as ThumbnailFormat
}

/** The MIME type to hand the browser encoder for `format`. */
export function thumbnailMime(format: ThumbnailFormat): string {
  return format === 'heic' ? 'image/heic' : 'image/webp'
}

/**
 * The target size for a `width`×`height` source inside a square of
 * `maxDimension`: never upscaled, never zero on either side. `null` when the
 * source or the target has no area, which core's resize rule refuses.
 */
export function fitWithin(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } | null {
  if (!(width > 0) || !(height > 0) || !(maxDimension > 0)) return null
  const scale = Math.min(maxDimension / width, maxDimension / height, 1)
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}
