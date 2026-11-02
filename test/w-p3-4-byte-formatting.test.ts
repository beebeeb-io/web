// W-P3-4: byte formatting has one implementation, core's
// `beebeeb_types::format` (W-P3-4). The 11 local ladders (receive, devices,
// the dropbox pair, onboarding, format-size, format.ts, plan-pricing and the
// two preview components) are gone; every surface imports `lib/format.ts`,
// which holds only the wasm handle and each surface's presentation guard.
//
// The vector is core's `test-vectors/consolidation/format.json`, case for
// case: the canonical SI form (`storage_format_si`, byte-identical to what
// billing showed), the binary/IEC form and the explicit-decimals compact form,
// at the 1000/1024 boundaries, 1 MiB/GiB/TiB, the TB decimal, negatives and
// i64::MAX. The web wrappers must agree with the wasm exports on every case
// their guard does not cover (a negative SI count is the one place the web
// wrapper keeps `—` for billing).
import { beforeAll, describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as wasm from 'beebeeb-wasm'
import {
  ensureWasm,
  formatBinarySize,
  formatCompactBytes,
  formatSize,
  formatStorageSI,
} from '../src/lib/format'
import { formatSize as previewFormatSize } from '../src/lib/format-size'

const ONE_MIB = 1_048_576
const ONE_GIB = 1_073_741_824
const ONE_TIB = 1_099_511_627_776
const ONE_TB = 1_000_000_000_000

beforeAll(async () => {
  wasm.initSync({
    module: readFileSync(fileURLToPath(new URL('../packages/beebeeb-wasm/beebeeb_wasm_bg.wasm', import.meta.url))),
  })
  await ensureWasm()
})

describe('W-P3-4 byte formatting from core', () => {
  it('core format vector: SI, binary and compact agree with every web surface', () => {
    // kind: si — the canonical storage form, unchanged for billing.
    // (i64::MAX is pinned as a BigInt: a JS number cannot hold it exactly.)
    const si: Array<[bigint, string]> = [
      [0n, '0 B'],
      [1n, '1 B'],
      [999n, '999 B'],
      [1_000n, '1 KB'],
      [1_024n, '1 KB'],
      [BigInt(ONE_MIB), '1 MB'],
      [BigInt(ONE_GIB), '1 GB'],
      [BigInt(ONE_TB), '1.0 TB'],
      [1_500_000_000n, '1 GB'],
      [5_000_000_000n, '5 GB'],
      [9_223_372_036_854_775_807n, '9223372.0 TB'],
    ]
    for (const [bytes, expected] of si) {
      expect(wasm.storage_format_si(bytes), String(bytes)).toBe(expected)
      if (bytes <= BigInt(Number.MAX_SAFE_INTEGER)) {
        expect(formatStorageSI(Number(bytes)), String(bytes)).toBe(expected)
      }
    }

    // kind: binary — the preview / transfer form, IEC labels.
    const binary: Array<[number, string]> = [
      [0, '0 B'],
      [1_000, '1000 B'],
      [1_024, '1 KiB'],
      [ONE_MIB, '1 MiB'],
      [ONE_GIB, '1 GiB'],
      [ONE_TIB, '1.0 TiB'],
      [1_536, '1 KiB'],
      [-5, '-5 B'],
      [-1_500, '-1500 B'],
    ]
    for (const [bytes, expected] of binary) {
      expect(wasm.formatBinary(BigInt(bytes)), String(bytes)).toBe(expected)
      expect(formatBinarySize(bytes), String(bytes)).toBe(expected)
      // The preview surfaces' name for it must be the same function.
      expect(previewFormatSize(bytes), String(bytes)).toBe(expected)
    }

    // kind: compact — explicit decimals, carrying into the next unit.
    const compact: Array<[number, 0 | 1 | 2, string]> = [
      [1_600, 0, '2 KB'],
      [1_600, 1, '1.6 KB'],
      [1_234_567, 2, '1.23 MB'],
      [999_960, 1, '1.0 MB'],
      [999_600, 0, '1 MB'],
      [-5, 2, '-5 B'],
      [0, 1, '0 B'],
      [6_300_000_000, 1, '6.3 GB'],
    ]
    for (const [bytes, decimals, expected] of compact) {
      expect(wasm.formatCompact(BigInt(bytes), decimals), `${bytes}/${decimals}`).toBe(expected)
      expect(formatCompactBytes(bytes, decimals), `${bytes}/${decimals}`).toBe(expected)
    }
  })

  it('the presentation guards stay in one place, not in a second ladder', () => {
    // Billing keeps `—` for a non-finite or negative count (its old contract),
    // onboarding says `0 B`, and both are one line over core's output.
    expect(formatStorageSI(-5)).toBe('—')
    expect(formatStorageSI(Number.NaN)).toBe('—')
    expect(formatSize(-1)).toBe('0 B')
    expect(formatSize(Number.NaN)).toBe('0 B')
    expect(formatSize(2_000_000_000)).toBe('2 GB')
    expect(formatSize(6_300_000_000)).toBe('6.3 GB')
    expect(formatSize(10_000_000_000)).toBe('10 GB')
    expect(formatSize(500_000_000)).toBe('500 MB')
    expect(formatSize(1_500_000_000_000)).toBe('1.5 TB')
  })
})
