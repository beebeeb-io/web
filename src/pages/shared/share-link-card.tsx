import { BBButton, BBChip } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'
import type { MyShare } from '../../lib/api'
import { bundleChipLabel, formatExpiry, formatExpiryDate, isExpired, timeAgo } from './format'

/**
 * One share-link row of the Shared page's "By me" tab, plus its expanded
 * insights panel (W-P2-4). Copy and revoke stay in the page: this component
 * only draws the row and reports the clicks.
 */
export interface SharedLinkCardProps {
  share: MyShare
  /** Decrypted file name for the share's file. */
  name: string
  isExpanded: boolean
  /** A working link can be rebuilt (owner-wrapped key present, vault unlocked). */
  canCopy: boolean
  isRevoking: boolean
  onToggleExpanded(): void
  onCopy(): void
  onRevoke(): void
}

export function SharedLinkCard({
  share,
  name,
  isExpanded,
  canCopy,
  isRevoking,
  onToggleExpanded,
  onCopy,
  onRevoke,
}: SharedLinkCardProps) {
  return (
    <div className="border-b border-line last:border-b-0">
      {/* Link row */}
      <div className="group flex items-center gap-3 px-5 py-3 hover:bg-paper-2 transition-colors">
        <button
          type="button"
          onClick={onToggleExpanded}
          className="flex items-center gap-3 flex-1 min-w-0 text-left"
        >
          <div className="w-7 h-7 rounded-lg bg-amber-bg border border-amber/20 flex items-center justify-center shrink-0">
            <Icon name="link" size={12} className="text-amber-deep" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[13px] font-medium text-ink truncate">{name}</span>
              {/* Task 1545, finding 4: a bundle share used to render
                  as if it were a single file, hiding how many files
                  (and thus how much content) the link actually
                  exposes. */}
              {bundleChipLabel(share) && (
                <BBChip variant="default" className="text-[9.5px] shrink-0">
                  {bundleChipLabel(share)}
                </BBChip>
              )}
            </div>
            <div className="flex items-center gap-2 text-[11px] mt-0.5">
              {(share.open_count ?? 0) > 0 ? (
                <>
                  <span className="font-mono text-ink-2">{share.open_count}</span>
                  <span className="text-ink-2">{share.open_count === 1 ? 'view' : 'views'}</span>
                  {share.last_opened_at && (
                    <><span className="text-ink-4">·</span><span className="text-ink-3">last {timeAgo(share.last_opened_at)}</span></>
                  )}
                </>
              ) : (
                <span className="text-ink-4">Not yet opened</span>
              )}
              {share.max_opens && <><span className="text-ink-4">·</span><span className="font-mono text-ink-3">/ {share.max_opens} max</span></>}
              {share.has_passphrase && <><span className="text-ink-4">·</span><span className="text-amber-deep">Passphrase</span></>}
              <span className="text-ink-4">·</span>
              <span className="text-ink-3">Created {timeAgo(share.created_at)}</span>
            </div>
          </div>
          {/* Expiry badge */}
          <span
            className={`shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10.5px] font-medium ${
              isExpired(share.expires_at)
                ? 'bg-red/10 text-red border border-red/20'
                : share.expires_at
                  ? 'bg-amber-bg text-amber-deep border border-amber/30'
                  : 'bg-paper-2 text-ink-3 border border-line'
            }`}
          >
            <Icon name="clock" size={9} />
            {formatExpiryDate(share.expires_at)}
          </span>
          <Icon
            name="chevron-down"
            size={13}
            className={`shrink-0 text-ink-3 transition-transform duration-150 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>
        {/* Quick copy — only when a working link can be rebuilt. */}
        {canCopy && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCopy() }}
            title="Copy link"
            className="shrink-0 p-1.5 rounded-md text-ink-3 hover:text-ink hover:bg-paper-3 transition-colors cursor-pointer md:opacity-0 md:group-hover:opacity-100"
          >
            <Icon name="copy" size={13} />
          </button>
        )}
      </div>

      {/* Insights panel */}
      {isExpanded && (
        <div className="px-5 pb-4 pt-2 bg-paper-2 border-t border-line">
          {/* Re-copy row — a working link when the owner-wrapped key
              is present + vault unlocked; otherwise the honest "not
              stored" note (never the keyless/wrong-key share.url). */}
          {canCopy ? (
            <div className="flex items-center justify-end mb-3">
              <button
                type="button"
                onClick={onCopy}
                className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-paper border border-line text-[12px] font-medium text-ink hover:bg-paper-3 transition-colors cursor-pointer"
              >
                <Icon name="copy" size={12} />
                Copy link
              </button>
            </div>
          ) : (
            <div className="flex items-start gap-1.5 mb-3 text-[11.5px] text-ink-4 leading-snug">
              <Icon name="lock" size={11} className="text-ink-4 shrink-0 mt-0.5" />
              <span>
                The key for this link isn&apos;t stored here. Use the full link from
                when you created it, or revoke and create a new one.
              </span>
            </div>
          )}

          {/* KPI row */}
          <div className="grid grid-cols-4 gap-2 mb-3">
            <div className="rounded-lg bg-paper border border-line p-2.5">
              <div className="text-[10px] text-ink-4 mb-0.5">Views</div>
              <div className="font-mono text-[13px] font-semibold">
                {share.open_count ?? 0}
                {share.max_opens ? ` / ${share.max_opens}` : ''}
              </div>
            </div>
            <div className="rounded-lg bg-paper border border-line p-2.5">
              <div className="text-[10px] text-ink-4 mb-0.5">Last viewed</div>
              <div className="text-[12px]">
                {share.last_opened_at ? timeAgo(share.last_opened_at) : '—'}
              </div>
            </div>
            <div className="rounded-lg bg-paper border border-line p-2.5">
              <div className="text-[10px] text-ink-4 mb-0.5">Expiry</div>
              <div className="text-[12px] font-medium">{formatExpiry(share.expires_at)}</div>
            </div>
            <div className="rounded-lg bg-paper border border-line p-2.5">
              <div className="text-[10px] text-ink-4 mb-0.5">Created</div>
              <div className="text-[12px]">{timeAgo(share.created_at)}</div>
            </div>
          </div>

          {/* Revoke */}
          <div className="flex justify-end">
            <BBButton
              size="sm"
              variant="ghost"
              className="text-red hover:text-red border-red/20 hover:border-red/40"
              onClick={onRevoke}
              disabled={isRevoking}
            >
              {isRevoking ? 'Revoking…' : 'Revoke link'}
            </BBButton>
          </div>
        </div>
      )}
    </div>
  )
}
