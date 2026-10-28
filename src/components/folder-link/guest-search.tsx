import { useEffect, useRef, useState } from 'react'
import { Icon } from '../icons'
import { noResultsText, partialBannerText } from '../../lib/guest-search'

/**
 * Task 2237b — the guest search box.
 *
 * Typing is debounced at 300 ms so a search never walks the listing on every
 * keystroke. The box owns its own term and reports through `onQuery`; clearing
 * is immediate.
 */
export const GUEST_SEARCH_DEBOUNCE_MS = 300

export function GuestSearch(props: {
  onQuery: (term: string) => void
  partial: boolean
  busy: boolean
}) {
  const [term, setTerm] = useState('')
  const onQuery = useRef(props.onQuery)
  onQuery.current = props.onQuery
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const update = (next: string) => {
    setTerm(next)
    if (timer.current) clearTimeout(timer.current)
    if (next.trim() === '') {
      props.onQuery('')
      return
    }
    timer.current = setTimeout(() => onQuery.current(next), GUEST_SEARCH_DEBOUNCE_MS)
  }

  const clear = () => {
    if (timer.current) clearTimeout(timer.current)
    setTerm('')
    props.onQuery('')
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="relative flex min-w-0 flex-1 items-center">
          <span className="sr-only">Search this folder</span>
          <Icon
            name="search"
            size={14}
            className="pointer-events-none absolute left-2.5 text-ink-3"
          />
          <input
            type="search"
            value={term}
            onChange={(event) => update(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') clear()
            }}
            placeholder="Search this folder"
            className="w-full rounded-lg border border-line bg-paper py-1.5 pl-8 pr-2 text-sm"
          />
        </label>
        {props.busy ? <span className="text-xs text-ink-3">Searching…</span> : null}
        {term.trim() !== '' ? (
          <button
            type="button"
            onClick={clear}
            className="rounded-lg border border-line px-2.5 py-1.5 text-sm"
          >
            Clear
          </button>
        ) : null}
      </div>
      {props.partial ? (
        <p role="status" className="text-xs text-ink-3">
          {partialBannerText()}
        </p>
      ) : null}
    </div>
  )
}

/** Shown in the grid body when a search term matches nothing. */
export function GuestSearchNoResults(props: { term: string }) {
  return (
    <div className="rounded-lg border border-line bg-paper-2 p-6 text-center text-sm text-ink-3">
      {noResultsText(props.term)}
    </div>
  )
}
