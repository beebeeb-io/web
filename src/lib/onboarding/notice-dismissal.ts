/**
 * Task 1822 (Codex P2): dismissing the "unsupported step" notice is scoped to the
 * ACCOUNT that dismissed it. The sessionStorage key carries the user id, and every
 * dismissal is cleared on logout, so a second account in the same tab never
 * inherits the first one's dismissal.
 */
export const DISMISS_PREFIX = 'bb_unsupported_step_notice_dismissed'

export function dismissKey(userId: string): string {
  return `${DISMISS_PREFIX}:${userId}`
}

export function readDismissed(userId: string, storage: Pick<Storage, 'getItem'> | null = safeStorage()): string {
  try {
    return storage?.getItem(dismissKey(userId)) ?? ''
  } catch {
    return ''
  }
}

export function writeDismissed(userId: string, value: string, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  try {
    storage?.setItem(dismissKey(userId), value)
  } catch {
    /* storage blocked: the dismissal lasts until the banner unmounts */
  }
}

export function clearAllDismissed(storage: Storage | null = safeStorage()): void {
  try {
    if (!storage) return
    const doomed: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k && k.startsWith(DISMISS_PREFIX)) doomed.push(k)
    }
    for (const k of doomed) storage.removeItem(k)
  } catch {
    /* nothing to clear */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}
