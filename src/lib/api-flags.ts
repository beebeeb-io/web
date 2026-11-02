// Fetches the server's feature-flag evaluation for the current user.
import { request } from '@beebeeb/shared'

/** Runtime feature flags for this session (cached by useFeatureFlag). */
export async function getEvaluateFlags(): Promise<{ flags: Record<string, boolean> }> {
  return request('/api/v1/feature-flags/evaluate')
}
