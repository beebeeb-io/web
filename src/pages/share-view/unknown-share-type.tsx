// The share-view card for an unrecognized share type.
import { BBLogo } from '@beebeeb/shared'
import { Icon } from '@beebeeb/shared'

// ─── Unknown share_type guard (forward-compat, task 0417 §5) ────────────────────

/**
 * Shown when the share carries a `share_type` this client release does not
 * implement (e.g. a future type added server-side after this build shipped).
 * Fails forward with an honest upgrade prompt instead of misrendering. This is
 * the "Update Beebeeb to open this share" card the spec requires BEFORE any
 * single-file rendering.
 */
export function UnknownShareTypeCard({ shareType }: { shareType: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-paper relative overflow-hidden">
      <div className="relative w-full max-w-[28rem] mx-4">
        <div className="text-center">
          <BBLogo size={16} />
          <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-amber/30 bg-amber-bg text-[11.5px] font-medium text-amber-deep">
            <Icon name="lock" size={11} className="shrink-0" />
            Beebeeb — End-to-end encrypted
          </div>
          <div className="mt-6 bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden">
            <div className="p-8 text-center">
              <div className="w-14 h-14 mx-auto mb-5 rounded-2xl bg-amber-bg flex items-center justify-center">
                <Icon name="download" size={26} className="text-amber-deep" />
              </div>
              <h2 className="text-[17px] font-semibold text-ink mb-2">Update Beebeeb to open this share</h2>
              <p className="text-[13px] text-ink-3 leading-relaxed">
                This link uses a newer share format
                {' '}<span className="font-mono text-[11.5px] text-ink-2">({shareType})</span>{' '}
                that this version of Beebeeb can’t open yet. Update to the latest version, then open the link again.
              </p>
              <a
                href="https://app.beebeeb.io/"
                className="mt-6 inline-flex items-center gap-2 px-5 py-2 bg-amber text-ink text-[13px] font-semibold rounded-lg hover:brightness-105 transition-all no-underline"
              >
                Open the latest Beebeeb
              </a>
            </div>
            <div className="px-8 py-3.5 bg-paper-2 border-t border-line">
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-ink-3">
                <Icon name="shield" size={11} className="text-amber-deep" />
                End-to-end encrypted · Stored in the EU
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
