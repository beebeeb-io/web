import { useAuth } from '../lib/auth-context'

export function useFrozen() {
  const { user } = useAuth()
  return {
    isFrozen: !!(user?.frozen_at),
    frozenAt: user?.frozen_at ?? null,
  }
}
