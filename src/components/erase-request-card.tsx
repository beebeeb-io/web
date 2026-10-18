import { BBButton, BBInput, Icon } from '@beebeeb/shared'
import { formatDue, itemsLabel, typedCountMatches, type EraseCard } from '../lib/erase-request'

/**
 * Task 1918 — the "Erase all files" exit of the locked screen, drawn from server state only.
 *
 * What it says is what happens (Guus, 2026-10-17: "Files should NEVER go missing"): nothing is
 * deleted here. A request waits `cooldownHours` (72), the account address gets an email with a
 * cancel link at once, then every file and folder moves to the trash, where it stays for
 * `retentionDays` before it is deleted for good. The person types the number of items the
 * server counted, then confirms with their password (the parent opens the step-up).
 *
 * Pure presentation: `vault-locked-no-key.tsx` owns the state and the calls.
 */
export interface EraseRequestCardProps {
  /** `null` while the status loads. */
  card: EraseCard | null
  loadError: string
  email: string | null
  cooldownHours: number
  retentionDays: number
  typed: string
  onTypedChange: (value: string) => void
  onRequest: () => void
  onCancel: () => void
  onRetryLoad: () => void
  busy: boolean
  /** A plain note after an action ("Cancelled. Nothing will move."). */
  note: string
  error: string
  /** The last action's outcome is unknown: offer "Check again" (calls `onRetryLoad`). */
  checkAgain?: boolean
}

export function EraseRequestCard(props: EraseRequestCardProps) {
  const { card, email, cooldownHours, retentionDays } = props
  const address = email ? <span className="text-ink-2">{email}</span> : 'the account address'

  return (
    <div className="rounded-lg border border-line bg-paper-2 px-3.5 py-3 mb-2.5" data-testid="erase-request-card">
      <div className="flex items-center gap-2 mb-1">
        <Icon name="trash" size={13} className="text-ink-3 shrink-0" />
        <span className="text-[13px] font-medium text-ink">Erase all files</span>
      </div>

      {card === null && !props.loadError && <p className="text-[12px] text-ink-3">Checking what this account holds…</p>}

      {card === null && props.loadError && (
        <div>
          <p className="text-[12px] text-red mb-2">{props.loadError}</p>
          <BBButton type="button" variant="default" size="sm" onClick={props.onRetryLoad}>
            Try again
          </BBButton>
        </div>
      )}

      {card?.kind === 'empty' && (
        <p className="text-[12px] text-ink-3 leading-relaxed">This account holds no files, so there is nothing to erase.</p>
      )}

      {card?.kind === 'ask' && (
        <>
          <p className="text-[12px] text-ink-3 leading-relaxed mb-2">
            Every file and folder moves to the trash after a {cooldownHours}-hour wait. We email {address}{' '}
            right away, with a link to cancel. The files then stay in the trash for {retentionDays} days, where
            they can still be restored, before they are deleted for good.
          </p>
          <p className="text-[12px] text-ink-2 leading-relaxed mb-2">
            This account holds <span className="font-mono">{card.liveItems}</span>{' '}
            {card.liveItems === 1 ? 'item' : 'items'}, files and folders together.
          </p>
          <div className="mb-2.5">
            <BBInput
              value={props.typed}
              onChange={(e) => props.onTypedChange(e.currentTarget.value)}
              placeholder={String(card.liveItems)}
              inputMode="numeric"
              autoComplete="off"
              aria-label={`Type ${card.liveItems} to confirm`}
              className="font-mono font-semibold"
              data-testid="erase-count-input"
            />
            <p className="text-[11px] text-ink-4 mt-1">
              Type <span className="font-mono">{card.liveItems}</span> to confirm
            </p>
          </div>
          <BBButton
            type="button"
            variant="danger"
            size="sm"
            onClick={props.onRequest}
            disabled={!typedCountMatches(props.typed, card.liveItems) || props.busy}
            data-testid="erase-request-button"
          >
            {props.busy ? 'Requesting…' : 'Request erase'}
          </BBButton>
        </>
      )}

      {card?.kind === 'pending' && (
        <div data-testid="erase-pending">
          <p className="text-[12px] text-ink-2 leading-relaxed mb-1">
            Erase requested. On <span className="text-ink">{formatDue(card.request.due_at)}</span> every file and
            folder ({itemsLabel(card.request.item_count)}) moves to the trash.
          </p>
          <p className="text-[12px] text-ink-3 leading-relaxed mb-2.5">
            We emailed {address} a link to cancel. You can also cancel here, or from any device where you are
            signed in, until then.
          </p>
          <BBButton
            type="button"
            variant="default"
            size="sm"
            onClick={props.onCancel}
            disabled={props.busy}
            data-testid="erase-cancel-button"
          >
            {props.busy ? 'Cancelling…' : 'Cancel the erase'}
          </BBButton>
        </div>
      )}

      {card?.kind === 'moving' && (
        <p className="text-[12px] text-ink-2 leading-relaxed" data-testid="erase-moving">
          The wait is over: the files are moving to the trash now. They stay there for {retentionDays} days, where
          they can still be restored, before they are deleted for good.
        </p>
      )}

      {card?.kind === 'done' && (
        <p className="text-[12px] text-ink-2 leading-relaxed" data-testid="erase-done">
          {itemsLabel(card.executed.items_trashed)} moved to the trash on {formatDue(card.executed.executed_at)}. They
          are deleted for good {retentionDays} days after that, unless they are restored.
        </p>
      )}

      {props.note && <p className="text-[12px] text-ink-2 mt-2" data-testid="erase-note">{props.note}</p>}
      {props.error && <p className="text-[12px] text-red mt-2" data-testid="erase-error">{props.error}</p>}

      {/* A failed refresh is shown next to the last known state, never hidden behind it. */}
      {card !== null && props.loadError && (
        <div className="mt-2" data-testid="erase-refresh-error">
          <p className="text-[12px] text-red mb-2">
            We could not refresh this, so what you see may be out of date.
          </p>
          <BBButton type="button" variant="default" size="sm" onClick={props.onRetryLoad}>
            Try again
          </BBButton>
        </div>
      )}
      {card !== null && !props.loadError && props.checkAgain && (
        <BBButton
          type="button"
          variant="default"
          size="sm"
          className="mt-2"
          onClick={props.onRetryLoad}
          data-testid="erase-check-again"
        >
          Check again
        </BBButton>
      )}
    </div>
  )
}
