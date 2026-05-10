import { useState, useEffect, useRef } from 'react'
import { getFolderMembers } from '../lib/api'

// ─── Types ───────────────────────────────────────────────────────────────────

interface PresenceMember {
  user_id: string
  email: string
  public_key: string | null
  is_owner?: boolean
}

interface PresenceAvatarsProps {
  /** Folder ID to poll presence for. Pass null/undefined to hide. */
  folderId: string | null | undefined
  /** Current user's own ID — their avatar is excluded from the list. */
  currentUserId?: string | null
  /** How often to refresh, in milliseconds. Default: 30_000 (30 s). */
  intervalMs?: number
  /** Max avatars to show before the "+N more" overflow. Default: 5. */
  maxVisible?: number
}

// Props for the compact folder-row badge
interface FolderViewerBadgeProps {
  /** Number of collaborators who have access (excluding owner). */
  count: number
  /** Representative emails to colour-code the mini-avatars. */
  emails?: string[]
}

// ─── Colour palette for avatars ───────────────────────────────────────────────
// Six amber/neutral tones that stay on-brand. Colour is derived from the
// email string so it's stable across renders.

const AVATAR_COLOURS: [bg: string, text: string][] = [
  ['#FEF3C7', '#92400E'], // amber-100 / amber-800
  ['#FDE68A', '#78350F'], // amber-200 / amber-900
  ['#FCD34D', '#451A03'], // amber-300 / amber-950
  ['#F0F0F0', '#404040'], // neutral-100 / neutral-700
  ['#E5E7EB', '#374151'], // gray-200 / gray-700
  ['#D1FAE5', '#065F46'], // emerald-100 / emerald-800
]

function colourFor(email: string): [string, string] {
  let hash = 0
  for (let i = 0; i < email.length; i++) {
    hash = (hash * 31 + email.charCodeAt(i)) >>> 0
  }
  return AVATAR_COLOURS[hash % AVATAR_COLOURS.length]
}

function initials(email: string): string {
  const parts = email.split('@')[0].split(/[\._\-+]/)
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return email.slice(0, 2).toUpperCase()
}

// ─── Component ───────────────────────────────────────────────────────────────

export function PresenceAvatars({
  folderId,
  currentUserId,
  intervalMs = 30_000,
  maxVisible = 5,
}: PresenceAvatarsProps) {
  const [members, setMembers] = useState<PresenceMember[]>([])
  const [tooltipId, setTooltipId] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!folderId) {
      setMembers([])
      return
    }

    let cancelled = false

    async function poll() {
      if (cancelled) return
      try {
        const data = await getFolderMembers(folderId!)
        if (!cancelled) {
          // Exclude the current user; exclude owners (they always "own" it)
          const others = data.members.filter(
            (m) => m.user_id !== currentUserId,
          )
          setMembers(others)
        }
      } catch {
        // Silently fail — presence is non-critical; folder may not be shared
        if (!cancelled) setMembers([])
      }
    }

    poll()
    timerRef.current = setInterval(poll, intervalMs)

    return () => {
      cancelled = true
      if (timerRef.current !== null) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [folderId, currentUserId, intervalMs])

  if (members.length === 0) return null

  const visible = members.slice(0, maxVisible)
  const overflow = members.length - maxVisible

  return (
    <div
      className="flex items-center gap-1"
      role="group"
      aria-label={`${members.length} collaborator${members.length !== 1 ? 's' : ''} in this folder`}
    >
      {/* Stack the avatars with a slight overlap */}
      <div className="flex -space-x-1.5">
        {visible.map((m) => {
          const [bg, fg] = colourFor(m.email)
          const label = initials(m.email)
          return (
            <div
              key={m.user_id}
              className="relative"
              onMouseEnter={() => setTooltipId(m.user_id)}
              onMouseLeave={() => setTooltipId(null)}
            >
              <div
                title={m.email}
                aria-label={m.email}
                className="w-[26px] h-[26px] rounded-full ring-2 ring-paper flex items-center justify-center text-[10px] font-semibold font-mono shrink-0 select-none cursor-default"
                style={{ background: bg, color: fg }}
              >
                {label}
              </div>
              {/* Tooltip */}
              {tooltipId === m.user_id && (
                <div
                  role="tooltip"
                  className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md bg-ink text-paper text-[11px] whitespace-nowrap pointer-events-none z-50 shadow-2"
                >
                  {m.email}
                  {/* Arrow */}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-ink" />
                </div>
              )}
            </div>
          )
        })}

        {/* Overflow bubble: +N more */}
        {overflow > 0 && (
          <div
            title={`${overflow} more collaborator${overflow !== 1 ? 's' : ''}`}
            className="w-[26px] h-[26px] rounded-full ring-2 ring-paper bg-paper-3 flex items-center justify-center text-[10px] font-mono text-ink-2 shrink-0 select-none cursor-default"
          >
            +{overflow}
          </div>
        )}
      </div>

      {/* Subtle "shared" label */}
      <span className="text-[11px] text-ink-3 font-mono hidden sm:inline" aria-hidden="true">
        shared
      </span>
    </div>
  )
}

// ─── FolderViewerBadge ───────────────────────────────────────────────────────
// Compact badge used inside file-list rows for shared folders.
// Shows up to 3 stacked avatar dots + a count when > 3.

export function FolderViewerBadge({ count, emails = [] }: FolderViewerBadgeProps) {
  if (count <= 0) return null

  const MAX_DOTS = 3
  const visibleEmails = emails.slice(0, MAX_DOTS)
  const overflow = count - MAX_DOTS

  return (
    <span
      className="inline-flex items-center gap-0.5 ml-1"
      title={`${count} collaborator${count !== 1 ? 's' : ''} have access`}
      aria-label={`${count} collaborator${count !== 1 ? 's' : ''}`}
    >
      {/* Stacked mini-circles */}
      <span className="flex -space-x-0.5">
        {visibleEmails.map((email, i) => {
          const [bg, fg] = colourFor(email)
          return (
            <span
              key={i}
              className="w-[12px] h-[12px] rounded-full ring-1 ring-paper inline-block shrink-0"
              style={{ background: bg, color: fg }}
            />
          )
        })}
        {/* Fallback dot when no emails are provided */}
        {visibleEmails.length === 0 && (
          <span className="w-[12px] h-[12px] rounded-full ring-1 ring-paper bg-paper-3 inline-block shrink-0" />
        )}
      </span>
      {/* Count label */}
      <span className="font-mono text-[9px] text-ink-3 tabular-nums leading-none">
        {count > MAX_DOTS && overflow > 0 ? `+${overflow}` : ''}
      </span>
    </span>
  )
}

// ─── Hook: resolves folder presence from an API call ─────────────────────────

/** Imperative helper — returns member list for `folderId` (or [] if not shared). */
export async function getFolderPresence(
  folderId: string,
): Promise<PresenceMember[]> {
  try {
    const data = await getFolderMembers(folderId)
    return data.members
  } catch {
    return []
  }
}
