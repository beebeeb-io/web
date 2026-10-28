import { Icon } from '@beebeeb/shared'
import { GuestShell } from './guest-shell'

/**
 * One dead-end surface for every way a link can fail, so the page never tells
 * a visitor whether a token ever existed.
 */
export function Unavailable(props: { reason: 'not_available' | 'update_required' }) {
  const update = props.reason === 'update_required'
  return (
    <GuestShell title={update ? 'Update Beebeeb' : "This link isn't available."}>
      <div className="mx-auto mt-4 w-full max-w-md rounded-lg border border-line bg-paper p-6 text-center shadow-1">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-paper-2">
          <Icon name={update ? 'info' : 'link'} size={20} className="text-ink-3" />
        </div>
        <h2 className="text-[17px] font-semibold">
          {update ? 'Update Beebeeb' : "This link isn't available."}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-ink-3">
          {update
            ? 'This link needs a newer version of Beebeeb. Update, then open the link again.'
            : 'It may have been turned off, expired, or the folder was removed. Ask the owner for a new link.'}
        </p>
      </div>
    </GuestShell>
  )
}
