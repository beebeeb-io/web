// ─── Share link options ────────────────────────────
// The expiry and max-opens rows the share dialog offers (moved out of
// share-dialog.tsx unchanged).

export type ExpiryOption = { label: string; hours: number | null }
export type MaxOpensOption = { label: string; value: number | null }

export const EXPIRY_OPTIONS: ExpiryOption[] = [
  { label: '1 hour', hours: 1 },
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
  { label: 'Never', hours: null },
]

export const MAX_OPENS_OPTIONS: MaxOpensOption[] = [
  { label: '1', value: 1 },
  { label: '3', value: 3 },
  { label: '5', value: 5 },
  { label: '10', value: 10 },
  { label: 'Unlimited', value: null },
]


