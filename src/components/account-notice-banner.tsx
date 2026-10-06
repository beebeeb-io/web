import { useRef, useState } from 'react'
import { Icon } from '@beebeeb/shared'
import { useAuth } from '../lib/auth-context'
import { useDriveData } from '../lib/drive-data-context'
import { unsupportedAccountSteps } from '../lib/onboarding/plan'
import { readDismissed, writeDismissed } from '../lib/onboarding/notice-dismissal'
import { unsupportedStepNotice } from '../lib/onboarding/terms-copy'

/**
 * Task 1822 — the account document lists a required step this build cannot draw.
 * It never blocks the drive (it used to: P0 2026-10-06); the person is told once,
 * honestly, and can dismiss it for the session. Keyed by the step ids, so a NEW
 * unsupported step shows again.
 */
export function AccountNoticeBanner() {
  const { user } = useAuth()
  const { accountDocument } = useDriveData()
  const uid = user?.user_id ?? null
  // Dismissal belongs to the account (key carries the user id): re-read when the account changes.
  const [dismissed, setDismissed] = useState<{ uid: string | null; value: string }>(() => ({
    uid,
    value: uid ? readDismissed(uid) : '',
  }))
  const dismissedValue = dismissed.uid === uid ? dismissed.value : uid ? readDismissed(uid) : ''
  // The shared document is dropped while every billing refresh re-fetches it: keep
  // the last answer through that window so the notice does not flicker on and off.
  const lastIds = useRef<string[]>([])
  if (!user) {
    lastIds.current = [] // another account must never inherit this one's notice
    return null
  }
  if (accountDocument) lastIds.current = unsupportedAccountSteps(accountDocument)
  const ids = lastIds.current
  if (ids.length === 0) return null
  const key = ids.join(',')
  if (dismissedValue === key) return null
  return (
    <div
      role="status"
      data-testid="unsupported-step-banner"
      className="flex items-center gap-3 px-4 py-2.5 bg-paper-2 border-b border-line text-[12.5px]"
    >
      <Icon name="info" size={13} className="text-ink-3 shrink-0" />
      <span className="flex-1 text-ink-2">{unsupportedStepNotice(ids)}</span>
      <button
        type="button"
        data-testid="unsupported-step-dismiss"
        className="text-ink-3 hover:text-ink underline underline-offset-2"
        onClick={() => {
          if (user) writeDismissed(user.user_id, key)
          setDismissed({ uid, value: key })
        }}
      >
        Dismiss
      </button>
    </div>
  )
}
