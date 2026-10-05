/**
 * Upload / share entry points for an account without a plan (task 1037).
 *
 * `needs_plan` and `lapsed` accounts have a 0 quota by design. Instead of the
 * generic "Not enough storage" toast (or a vague conflict error from the
 * server's `409 plan_required` / `account_lapsed`), upload entry points:
 *
 *  - `blockUpload()`      — pre-flight: show the clear notice and stop, using
 *                           the account state already in the subscription cache.
 *  - `handlePlanError(e)` — after a refused call: show the same notice, refresh
 *                           the cached subscription (so the lapsed banner / the
 *                           needs_plan gate catch up) and, for `plan_required`,
 *                           go to the plan chooser.
 */

import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../components/toast'
import { useDriveData } from '../lib/drive-data-context'
import {
  CHOOSE_PLAN_PATH,
  accountStateFromError,
  uploadBlockedNotice,
  uploadRefusalNotice,
  type UploadBlockedNotice,
} from '../lib/account-state'

export function usePlanBlock() {
  const { accountState, refreshPlanDetails } = useDriveData()
  const { showToast } = useToast()
  const navigate = useNavigate()

  const show = useCallback(
    (n: UploadBlockedNotice) => {
      // Not `danger`: a danger toast never auto-dismisses, and this one would
      // then sit over the (persistent) lapsed banner's Subscribe button. The
      // banner already carries the state; the toast just explains the refusal.
      showToast({ icon: 'lock', title: n.title, description: n.description, href: n.href })
    },
    [showToast],
  )

  const blockUpload = useCallback((): boolean => {
    const n = uploadBlockedNotice(accountState)
    if (!n) return false
    show(n)
    return true
  }, [accountState, show])

  const handlePlanError = useCallback(
    (err: unknown): boolean => {
      const state = accountStateFromError(err)
      if (state) {
        const n = uploadBlockedNotice(state)
        if (n) show(n)
        refreshPlanDetails()
        if (state === 'needs_plan') navigate(CHOOSE_PLAN_PATH, { replace: true })
        return true
      }
      // Task 1605 — trial_cancelled_read_only (409) / the 25 GB trial-cap
      // quota_exceeded (413). Neither is an `account_state` value, so this
      // is a separate branch, but the same "notice + refresh, no crash into
      // the generic Upload failed toast" contract.
      const refusal = uploadRefusalNotice(err)
      if (refusal) {
        show(refusal)
        refreshPlanDetails()
        return true
      }
      return false
    },
    [show, refreshPlanDetails, navigate],
  )

  return { accountState, blockUpload, handlePlanError }
}
