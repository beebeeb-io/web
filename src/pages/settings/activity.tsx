import { useEffect, useState } from 'react'
import { SettingsShell, SettingsHeader } from '../../components/settings-shell'
import { Icon } from '../../components/icons'
import { getTrackingPreference } from '../../lib/api'

export function SettingsActivity() {
  const [optedIn, setOptedIn] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    getTrackingPreference()
      .then((res) => { if (!cancelled) setOptedIn(res.tracking_opted_in) })
      .catch(() => { if (!cancelled) setOptedIn(false) })
    return () => { cancelled = true }
  }, [])

  return (
    <SettingsShell activeSection="activity">
      <SettingsHeader
        title="Activity"
        subtitle="A timeline of file events on your account. Encrypted file contents are never logged."
      />

      <div className="px-7 py-6">
        {optedIn === null ? (
          <div className="h-8 flex items-center">
            <span className="w-3.5 h-3.5 border-2 border-line-2 border-t-ink-3 rounded-full animate-spin" />
          </div>
        ) : !optedIn ? (
          <div className="flex items-start gap-2.5 p-4 rounded-md bg-paper-2 border border-line max-w-[600px]">
            <Icon name="eye-off" size={14} className="text-ink-3 shrink-0 mt-0.5" />
            <p className="text-[13px] text-ink-2 leading-relaxed">
              Enable activity tracking in <a href="/settings/profile" className="text-amber-deep hover:underline">Settings &gt; Privacy</a> to see file activity here.
            </p>
          </div>
        ) : (
          <div className="border border-line rounded-md overflow-hidden max-w-[800px]">
            <table className="w-full text-[12.5px]">
              <thead className="bg-paper-2 border-b border-line">
                <tr className="text-left text-[11px] text-ink-3 uppercase tracking-wider">
                  <th className="px-3 py-2 font-medium">Time</th>
                  <th className="px-3 py-2 font-medium">Action</th>
                  <th className="px-3 py-2 font-medium">File</th>
                  <th className="px-3 py-2 font-medium">Details</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-ink-3">
                    No activity yet.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SettingsShell>
  )
}
