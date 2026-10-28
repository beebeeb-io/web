/**
 * Task 2237b — the one-time "what should we call you?" prompt.
 *
 * It appears before the first upload on a link that allows adding, only when no
 * name is stored for this folder in this browser. Skipping is remembered for
 * the session, so the guest is never asked twice.
 */
import { useState } from 'react'

export const ACTOR_NAME_MAX_LENGTH = 40

export function ActorNamePrompt(props: {
  open: boolean
  onSubmit: (name: string) => void
  onSkip: () => void
}) {
  const [name, setName] = useState('')
  if (!props.open) return null
  const trimmed = name.trim()

  const submit = () => {
    if (trimmed === '') props.onSkip()
    else props.onSubmit(trimmed.slice(0, ACTOR_NAME_MAX_LENGTH))
  }

  return (
    <div className="mb-4 rounded-lg border border-line bg-paper-2 p-4">
      <h2 className="text-sm font-semibold">What should we call you?</h2>
      <p className="mt-1 text-sm text-ink-3">
        Only people with this link see this. It&apos;s stored encrypted with the folder.
      </p>
      <form
        className="mt-3 flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label className="sr-only" htmlFor="folder-link-actor-name">
          Your name
        </label>
        <input
          id="folder-link-actor-name"
          type="text"
          value={name}
          maxLength={ACTOR_NAME_MAX_LENGTH}
          onChange={(event) => setName(event.target.value)}
          className="w-full max-w-xs min-h-11 rounded-lg border border-line bg-paper px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg bg-amber px-3 py-2 text-sm font-semibold text-ink"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={props.onSkip}
          className="min-h-11 rounded-lg border border-line px-3 py-2 text-sm font-medium"
        >
          Skip
        </button>
      </form>
    </div>
  )
}
