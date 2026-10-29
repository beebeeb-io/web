import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The vendored contract (src/contracts/onboarding), read from disk so a test never imports a stale copy. */
export const CONTRACT_DIR = join(import.meta.dir, '..', '..', 'src', 'contracts', 'onboarding')

export function fixtureFiles(): string[] {
  return readdirSync(join(CONTRACT_DIR, 'fixtures'))
    .filter((f) => f.endsWith('.json'))
    .sort()
}

export function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(CONTRACT_DIR, 'fixtures', name), 'utf8'))
}

export function readInvalid(name: string): unknown {
  return JSON.parse(readFileSync(join(CONTRACT_DIR, 'invalid', name), 'utf8'))
}

export function fixtureJson(name: string): Record<string, any> {
  return structuredClone(readFixture(name)) as Record<string, any>
}
