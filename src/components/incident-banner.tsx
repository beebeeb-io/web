/**
 * Incident notification banner.
 *
 * Shows a persistent banner at the top of the app when Beebeeb is experiencing
 * a major or critical incident. Also listens for WebSocket broadcast events
 * to show toast notifications for new/resolved incidents.
 *
 * - Fetches from the public status API on mount (no auth needed)
 * - Dismissible per-session (sessionStorage keyed by incident ID)
 * - Listens for incident:published, incident:updated, incident:resolved WS events
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Icon } from '@beebeeb/shared'
import { useToast } from './toast'
import { useWsEvent } from '../lib/ws-context'
import { getActiveIncidents } from '../lib/api'
import type { ActiveIncident } from '../lib/api'

const DISMISSED_PREFIX = 'bb_incident_dismissed_'

function isDismissed(incidentId: string): boolean {
  try {
    return sessionStorage.getItem(`${DISMISSED_PREFIX}${incidentId}`) === '1'
  } catch {
    return false
  }
}

function dismissIncident(incidentId: string): void {
  try {
    sessionStorage.setItem(`${DISMISSED_PREFIX}${incidentId}`, '1')
  } catch {
    // sessionStorage may be unavailable
  }
}

/** Only show banner for major or critical severity. */
function isBannerWorthy(severity: string): boolean {
  return severity === 'major' || severity === 'critical'
}

/** Only show banner for non-resolved incidents. */
function isActive(status: string): boolean {
  return status !== 'resolved' && status !== 'completed'
}

export function IncidentBanner() {
  const { showToast } = useToast()
  const [incidents, setIncidents] = useState<ActiveIncident[]>([])
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const fetchedRef = useRef(false)

  // Fetch active incidents on mount
  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true

    getActiveIncidents()
      .then((result) => {
        setIncidents(result)
      })
      .catch(() => {
        // Silently ignore — the status API being down should not break the app
      })
  }, [])

  // Listen for incident:published — add/update incident + show toast
  useWsEvent(['incident:published'], useCallback((event) => {
    const data = event.data as {
      id: string
      title: string
      severity: string
      message: string
    }

    setIncidents((prev) => {
      const existing = prev.findIndex((i) => i.id === data.id)
      const updated: ActiveIncident = {
        id: data.id,
        title: data.title,
        severity: data.severity,
        message: data.message,
        status: 'investigating',
        started_at: event.timestamp,
        updates: [],
      }
      if (existing >= 0) {
        const next = [...prev]
        next[existing] = updated
        return next
      }
      return [updated, ...prev]
    })

    showToast({
      icon: 'bell',
      title: `Incident: ${data.title}`,
      description: data.message || undefined,
      danger: data.severity === 'critical',
    })
  }, [showToast]))

  // Listen for incident:updated — update the message in the banner
  useWsEvent(['incident:updated'], useCallback((event) => {
    const data = event.data as {
      id: string
      message: string
      status: string
    }

    setIncidents((prev) =>
      prev.map((i) =>
        i.id === data.id
          ? { ...i, message: data.message, status: data.status || i.status }
          : i,
      ),
    )
  }, []))

  // Listen for incident:resolved — remove from banner + show resolved toast
  useWsEvent(['incident:resolved'], useCallback((event) => {
    const data = event.data as {
      id: string
      title: string
    }

    setIncidents((prev) => prev.filter((i) => i.id !== data.id))

    showToast({
      icon: 'check',
      title: `Resolved: ${data.title}`,
      description: 'The incident has been resolved.',
    })
  }, [showToast]))

  // Also handle incident:reopened like a new publish
  useWsEvent(['incident:reopened'], useCallback((event) => {
    const data = event.data as {
      id: string
      title: string
      severity: string
      message: string
    }

    setIncidents((prev) => {
      const existing = prev.findIndex((i) => i.id === data.id)
      const updated: ActiveIncident = {
        id: data.id,
        title: data.title,
        severity: data.severity,
        message: data.message || '',
        status: 'investigating',
        started_at: event.timestamp,
        updates: [],
      }
      if (existing >= 0) {
        const next = [...prev]
        next[existing] = updated
        return next
      }
      return [updated, ...prev]
    })

    // Clear any prior dismissal for this incident
    setDismissedIds((prev) => {
      const next = new Set(prev)
      next.delete(data.id)
      return next
    })

    showToast({
      icon: 'bell',
      title: `Reopened: ${data.title}`,
      description: data.message || undefined,
      danger: data.severity === 'critical',
    })
  }, [showToast]))

  const handleDismiss = useCallback((id: string) => {
    dismissIncident(id)
    setDismissedIds((prev) => new Set(prev).add(id))
  }, [])

  // Filter to banner-worthy incidents that haven't been dismissed
  const visible = incidents.filter(
    (i) =>
      isBannerWorthy(i.severity) &&
      isActive(i.status) &&
      !isDismissed(i.id) &&
      !dismissedIds.has(i.id),
  )

  if (visible.length === 0) return null

  // Show the most severe incident (critical > major)
  const incident =
    visible.find((i) => i.severity === 'critical') ?? visible[0]

  const isCritical = incident.severity === 'critical'
  const latestMessage =
    incident.updates?.length
      ? incident.updates[incident.updates.length - 1].message
      : incident.message

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={`flex items-center gap-3 px-4 py-2.5 border-b text-[12.5px] ${
        isCritical
          ? 'bg-red/10 border-red/30'
          : 'bg-amber-bg border-amber/30'
      }`}
    >
      <Icon
        name="shield"
        size={12}
        className={`shrink-0 ${isCritical ? 'text-red' : 'text-amber-deep'}`}
      />

      <span className="flex-1 text-ink-2">
        <span className="font-semibold">{incident.title}</span>
        {latestMessage ? ` — ${latestMessage}` : ''}
      </span>

      <a
        href="https://status.beebeeb.io"
        target="_blank"
        rel="noopener noreferrer"
        className={`shrink-0 px-2.5 py-1 rounded text-[12px] font-medium transition-all hover:brightness-105 ${
          isCritical
            ? 'bg-red/15 text-red border border-red/30'
            : 'bg-amber/15 text-amber-deep border border-amber/30'
        }`}
      >
        View status
      </a>

      <button
        type="button"
        onClick={() => handleDismiss(incident.id)}
        aria-label="Dismiss incident banner"
        className="shrink-0 p-0.5 text-ink-3 hover:text-ink transition-colors cursor-pointer"
      >
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}
