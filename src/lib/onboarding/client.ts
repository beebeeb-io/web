/**
 * Fetching the onboarding document (task 1745, spec 5.2 and 5.8 rule 6).
 *
 * `GET /api/v1/onboarding`. Web sends no onboarding-specific headers (spec 5.9:
 * "web never sends the new headers"); the shared `request()` client already
 * carries `X-Beebeeb-Client: web`. A schema major above ours is still handled
 * by the parser (rule 5), so a server that ignores the missing header cannot
 * strand the page.
 *
 * Every outcome is a value, never a throw, because the caller's job is to pick
 * a screen: a 404 (old server), a network failure and a document we cannot draw
 * all mean the same thing, "use the legacy path" (rule 6), and only a document
 * newer than we understand means "update".
 */

import { ApiError, request } from '@beebeeb/shared'
import { parseOnboardingDocument } from './parse'
import type { OnboardingDocument } from './types'

export type FetchOutcome =
  | { kind: 'document'; doc: OnboardingDocument }
  | { kind: 'unsupported_schema' }
  | { kind: 'legacy'; reason: 'not_found' | 'unauthorized' | 'network' | 'malformed' }

export async function fetchOnboardingDocument(): Promise<FetchOutcome> {
  let raw: unknown
  try {
    raw = await request<unknown>('/api/v1/onboarding')
  } catch (err) {
    if (err instanceof ApiError) {
      if (err.status === 404 || err.status === 405) return { kind: 'legacy', reason: 'not_found' }
      if (err.status === 401) return { kind: 'legacy', reason: 'unauthorized' }
    }
    return { kind: 'legacy', reason: 'network' }
  }
  return outcomeFromRaw(raw)
}

/** Split out so the 404 / garbage / newer-major cases are unit-testable without a network. */
export function outcomeFromRaw(raw: unknown): FetchOutcome {
  const parsed = parseOnboardingDocument(raw)
  if (parsed.ok) return { kind: 'document', doc: parsed.doc }
  if (parsed.reason === 'unsupported_schema') return { kind: 'unsupported_schema' }
  return { kind: 'legacy', reason: 'malformed' }
}
