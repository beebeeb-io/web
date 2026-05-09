/**
 * AnnouncementBanner — admin-broadcast banner shown across the web client.
 *
 * Fetches `GET /api/v1/announcements` once on mount (no auth required) so the
 * banner renders on the login page as well as the authenticated drive shell.
 *
 * Severity drives the colour:
 *   • info     → amber on amber-bg (subtle, the same accent used for
 *                encryption signals — fine for non-urgent notices)
 *   • warning  → amber-deep on amber-bg with a stronger border
 *   • critical → red on red-bg
 *
 * Banners are dismissable per browser session via sessionStorage. The full
 * announcement list is short (admins post sparingly) so we render the most
 * recent active one.
 *
 * Wired into both AuthShell and DriveLayout — duplicated mounts are fine,
 * the dismiss key is shared so the user never sees the same banner twice
 * after dismissing it.
 */

import { useEffect, useState } from 'react'
import { Icon } from '@beebeeb/shared'
import { listAnnouncements, type Announcement } from '../lib/api'

const DISMISS_PREFIX = 'beebeeb_announcement_dismissed:'

function readDismissed(id: string): boolean {
  try {
    return sessionStorage.getItem(DISMISS_PREFIX + id) === '1'
  } catch {
    return false
  }
}

function writeDismissed(id: string): void {
  try {
    sessionStorage.setItem(DISMISS_PREFIX + id, '1')
  } catch {
    // sessionStorage may be unavailable in private mode — ignore
  }
}

function severityClasses(severity: Announcement['severity']): {
  bg: string
  text: string
  border: string
  iconClass: string
} {
  switch (severity) {
    case 'critical':
      return {
        bg: 'bg-red-bg',
        text: 'text-red',
        border: 'border-red/30',
        iconClass: 'text-red',
      }
    case 'warning':
      return {
        bg: 'bg-amber-bg',
        text: 'text-amber-deep',
        border: 'border-amber/40',
        iconClass: 'text-amber-deep',
      }
    default:
      return {
        bg: 'bg-paper-2',
        text: 'text-ink-2',
        border: 'border-line',
        iconClass: 'text-amber-deep',
      }
  }
}

export function AnnouncementBanner() {
  const [active, setActive] = useState<Announcement | null>(null)

  useEffect(() => {
    let cancelled = false
    listAnnouncements()
      .then((res) => {
        if (cancelled) return
        // Server returns most-recent first; pick the first one the user
        // hasn't dismissed in this session.
        const visible = res.announcements.find((a) => !readDismissed(a.id))
        setActive(visible ?? null)
      })
      .catch(() => {
        // Best-effort — a missing endpoint or network blip should never
        // break the rest of the page.
      })
    return () => { cancelled = true }
  }, [])

  if (!active) return null

  const tone = severityClasses(active.severity)
  const iconName = active.severity === 'critical' ? 'shield' : 'cloud'

  function handleDismiss() {
    if (!active) return
    writeDismissed(active.id)
    setActive(null)
  }

  return (
    <div
      role={active.severity === 'critical' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 px-4 py-2.5 border-b ${tone.bg} ${tone.border}`}
    >
      <Icon name={iconName} size={14} className={`shrink-0 mt-0.5 ${tone.iconClass}`} />
      <div className={`flex-1 text-[13px] leading-relaxed whitespace-pre-wrap ${tone.text}`}>
        {active.message}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        className={`shrink-0 p-1 rounded-md hover:bg-paper-3/40 transition-colors ${tone.text}`}
        aria-label="Dismiss announcement"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}
