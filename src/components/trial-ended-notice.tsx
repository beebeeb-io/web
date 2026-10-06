/**
 * "Your trial has ended. Your 2 GB stays." (task 1757, spec 4b.4 case 1 and 4b.7).
 *
 * A trial that ends with the files within the allowance leaves an ordinary allowance
 * account; the document then says nothing about the trial. The person still deserves
 * one plain sentence, once: nothing was charged, nothing is lost. It is dismissible, and
 * the dismissal is a per-browser convenience (storage may be unavailable: the notice then
 * simply shows again, which is the safe direction).
 */

import { useState } from 'react'
import { Icon } from '@beebeeb/shared'
import { useAuth } from '../lib/auth-context'
import { useDriveData } from '../lib/drive-data-context'
import { trialEndedAllowanceNotice } from '../lib/no-card-trial'

const KEY_PREFIX = 'bb_trial_ended_notice_dismissed:'

function readDismissed(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return false
  }
}

export function TrialEndedAllowanceNotice() {
  const { user } = useAuth()
  const { accountDocument, planDetails } = useDriveData()
  const key = `${KEY_PREFIX}${user?.user_id ?? ''}`
  const [dismissed, setDismissed] = useState(() => readDismissed(key))

  const notice = trialEndedAllowanceNotice(accountDocument, planDetails.subscription?.has_used_trial)
  if (!user || !notice || dismissed) return null

  return (
    <div
      role="status"
      data-testid="trial-ended-allowance-notice"
      className="flex items-center gap-3 px-4 py-2.5 bg-paper-2 border-b border-line text-[12.5px]"
    >
      <Icon name="info" size={13} className="text-ink-3 shrink-0" />
      <span className="flex-1 text-ink-2 leading-relaxed">
        <span className="font-semibold text-ink">{notice.title}.</span> {notice.body}
      </span>
      <button
        type="button"
        className="shrink-0 text-[12px] text-ink-3 hover:text-ink underline underline-offset-2 transition-colors cursor-pointer"
        data-testid="trial-ended-allowance-dismiss"
        onClick={() => {
          try {
            localStorage.setItem(key, '1')
          } catch {
            /* storage blocked: it shows again next time */
          }
          setDismissed(true)
        }}
      >
        Dismiss
      </button>
    </div>
  )
}
