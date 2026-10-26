import { useState, useEffect, useCallback } from 'react'
import { BBButton, BBToggle, Icon } from '@beebeeb/shared'
import { SettingsRow } from '../settings-shell'
import { useToast } from '../toast'
import { getTrackingPreference, setTrackingPreference } from '../../lib/api'

/** Account-level activity consent lives in Privacy & data. */
export function ActivityTrackingSettings() {
  const { showToast } = useToast()
  const [trackingOptedIn, setTrackingOptedIn] = useState(false)
  const [trackingLoading, setTrackingLoading] = useState(true)
  const [trackingConfirmOff, setTrackingConfirmOff] = useState(false)
  const [trackingExplainerOn, setTrackingExplainerOn] = useState(false)
  const [trackingSaving, setTrackingSaving] = useState(false)
  const [trackingError, setTrackingError] = useState(false)
  const [loadAttempt, setLoadAttempt] = useState(0)

  useEffect(() => {
    let active = true
    setTrackingLoading(true)
    setTrackingError(false)
    getTrackingPreference()
      .then((preference) => { if (active) setTrackingOptedIn(preference.tracking_opted_in) })
      .catch(() => { if (active) setTrackingError(true) })
      .finally(() => { if (active) setTrackingLoading(false) })
    return () => { active = false }
  }, [loadAttempt])

  const handleTrackingToggle = useCallback((newValue: boolean) => {
    if (!newValue) {
      setTrackingConfirmOff(true)
    } else {
      setTrackingExplainerOn(true)
      setTrackingOptedIn(true)
      setTrackingSaving(true)
      setTrackingPreference(true)
        .then(() => { /* saved */ })
        .catch(() => {
          setTrackingOptedIn(false)
          showToast({ icon: 'x', title: 'Failed to save tracking preference', danger: true })
        })
        .finally(() => setTrackingSaving(false))
    }
  }, [showToast])

  const handleTrackingConfirmOff = useCallback(() => {
    setTrackingConfirmOff(false)
    setTrackingOptedIn(false)
    setTrackingSaving(true)
    setTrackingPreference(false)
      .catch(() => {
        setTrackingOptedIn(true)
        showToast({ icon: 'x', title: 'Failed to save tracking preference', danger: true })
      })
      .finally(() => setTrackingSaving(false))
  }, [showToast])

  return (
    <>
      {trackingConfirmOff && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30"
          onClick={(e) => { if (e.target === e.currentTarget) setTrackingConfirmOff(false) }}
        >
          <div className="w-full max-w-[440px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden mx-4">
            <div className="px-5 py-4 border-b border-line">
              <h3 className="text-[15px] font-semibold text-ink">Disable activity tracking?</h3>
            </div>
            <div className="px-5 py-4">
              <p className="text-[13px] text-ink-2 leading-relaxed mb-4">
                We will stop collecting sign-in and activity data immediately. All data already collected will be deleted within 30 days.
              </p>
              <div className="flex items-center gap-2 p-3 rounded-md bg-paper-2 border border-line mb-5">
                <Icon name="shield" size={13} className="text-ink-3 shrink-0" />
                <p className="text-[11.5px] text-ink-3 leading-relaxed">
                  Deletion is irreversible. This is your right under GDPR Article 17.
                </p>
              </div>
              <div className="flex gap-2">
                <BBButton
                  variant="danger"
                  size="md"
                  onClick={handleTrackingConfirmOff}
                  className="flex-1 justify-center"
                >
                  Disable and delete data
                </BBButton>
                <BBButton
                  variant="ghost"
                  size="md"
                  onClick={() => setTrackingConfirmOff(false)}
                >
                  Cancel
                </BBButton>
              </div>
            </div>
          </div>
        </div>
      )}

      <SettingsRow
        label="Activity tracking"
        hint="Sign-ins and file activity. Helps us provide support and detect suspicious access. Default: off."
      >
        <div className="flex flex-col gap-3 max-w-[460px]">
          {trackingError ? (
            <div role="alert" className="flex flex-col items-start gap-2">
              <p className="text-[13px] text-ink-2">Could not load activity tracking.</p>
              <BBButton variant="ghost" size="sm" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>Try again</BBButton>
            </div>
          ) : trackingLoading ? (
            <div className="h-8 flex items-center">
              <span className="w-3.5 h-3.5 border-2 border-line-2 border-t-ink-3 rounded-full animate-spin" />
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2.5">
                <BBToggle aria-label="Activity tracking" on={trackingOptedIn} onChange={handleTrackingToggle} disabled={trackingSaving} />
                <span className="text-[12.5px] text-ink-3">
                  {trackingOptedIn ? 'Enabled — sign-ins and activity are being logged' : 'Disabled — no activity data is collected'}
                </span>
              </div>

              {trackingExplainerOn && (
                <div className="flex items-start gap-2.5 p-3 rounded-md bg-amber-bg border border-amber/20">
                  <Icon name="shield" size={13} className="text-amber-deep shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="text-[12px] text-ink-2 leading-relaxed">
                      We will log sign-ins (anonymized IP, device, country) and file activity (uploads, shares, deletes). You can disable this at any time.
                    </p>
                    <button
                      className="text-[11px] text-amber-deep hover:underline mt-1"
                      onClick={() => setTrackingExplainerOn(false)}
                    >
                      Got it
                    </button>
                  </div>
                </div>
              )}

              <p className="text-[11px] text-ink-4 leading-relaxed">
                When enabled: we log which devices signed in, and high-level file actions (not file contents — we cannot read them).
                Disabling deletes all collected data within 30 days.

              </p>
            </>
          )}
        </div>
      </SettingsRow>

    </>
  )
}
