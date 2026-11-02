// The drive's notice banners: dedup warning and folder suggestion.
import { BBButton, Icon } from '@beebeeb/shared'
import type { StorageUsage, Subscription } from '../../lib/api'
import { StorageFullBanner } from '../../components/upgrade-nudge-modal'
import type { UploadState } from '../../lib/upload-resume'

export interface DedupWarning {
  /** The file that looks like a duplicate */
  file: File
  /** Hash used to look it up */
  hash: string
  /** Name of the previously uploaded file */
  existingName: string
  /** Remaining files that are not duplicates — queued if the user skips */
  otherFiles: File[]
}

export type FolderSuggestion = { type: 'images'; count: number } | { type: 'pdfs'; count: number }

export interface DriveBannersProps {
  pausedUploads: UploadState[]
  onResumeSelect: () => void
  onDismissPaused: () => void
  loadError: string | null
  onRetryLoad: () => void
  dedupWarning: DedupWarning | null
  onDedupUpload: () => void
  onDedupSkip: () => void
  storageUsage: StorageUsage | null
  accountState: string | undefined
  subscription: Subscription | null | undefined
  onUpgrade: () => void
  incomingInviteCount: number
  pendingApprovalCount: number
  pendingSharesDismissed: boolean
  onDismissPendingShares: () => void
  onViewPendingShares: () => void
  folderSuggestion: FolderSuggestion | null
  suggestionCreating: boolean
  isRoot: boolean
  onAcceptSuggestion: () => void
  onDismissSuggestion: () => void
}

export function DriveBanners({
  pausedUploads,
  onResumeSelect,
  onDismissPaused,
  loadError,
  onRetryLoad,
  dedupWarning,
  onDedupUpload,
  onDedupSkip,
  storageUsage,
  accountState,
  subscription,
  onUpgrade,
  incomingInviteCount,
  pendingApprovalCount,
  pendingSharesDismissed,
  onDismissPendingShares,
  onViewPendingShares,
  folderSuggestion,
  suggestionCreating,
  isRoot,
  onAcceptSuggestion,
  onDismissSuggestion,
}: DriveBannersProps) {
  return (
    <>
        {/* Resume banner */}
        {pausedUploads.length > 0 && (
          <div className="px-5 py-2.5 border-b border-amber/30 bg-amber-bg/40 flex items-center gap-3 text-sm">
            <Icon name="upload" size={14} className="text-amber-deep shrink-0" />
            <span className="text-ink">
              {pausedUploads.length === 1
                ? `1 upload paused`
                : `${pausedUploads.length} uploads paused`}
              {' -- '}
              <span className="text-ink-3">
                {pausedUploads.map((u) => u.fileName).join(', ')}
              </span>
            </span>
            <BBButton
              size="sm"
              variant="amber"
              className="ml-auto gap-1.5"
              onClick={onResumeSelect}
            >
              Select file to resume
            </BBButton>
            <BBButton
              size="sm"
              variant="ghost"
              onClick={onDismissPaused}
            >
              Dismiss
            </BBButton>
          </div>
        )}

        {/* Offline banner now rendered by DriveLayout via useDriveData().isOffline. */}

        {/* Inline failure + retry — the toast alone left the page empty. */}
        {loadError && (
          <div className="px-5 py-2 border-b border-red/30 bg-red/5 flex items-center justify-between gap-3 text-[12px] text-red">
            <div className="flex items-center gap-2 min-w-0">
              <Icon name="x" size={13} className="shrink-0" />
              <span className="truncate">Couldn't load files. {loadError}</span>
            </div>
            <BBButton size="sm" variant="default" onClick={onRetryLoad}>
              Try again
            </BBButton>
          </div>
        )}

        {/* Duplicate file warning banner */}
        {dedupWarning && (
          <div className="px-5 py-2.5 border-b border-amber/40 bg-amber-bg/50 flex items-start gap-3 text-sm">
            <Icon name="shield" size={14} className="text-amber-deep shrink-0 mt-0.5" />
            <span className="flex-1 text-ink">
              <span className="font-medium">
                &apos;{dedupWarning.file.name}&apos;
              </span>{' '}
              looks like a file you already uploaded
              {dedupWarning.existingName !== dedupWarning.file.name && (
                <> (as &apos;{dedupWarning.existingName}&apos;)</>
              )}
              . Upload anyway?
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <BBButton
                size="sm"
                variant="amber"
                onClick={onDedupUpload}
              >
                Upload
              </BBButton>
              <BBButton
                size="sm"
                variant="ghost"
                onClick={onDedupSkip}
              >
                Skip
              </BBButton>
            </div>
          </div>
        )}

        {/* Storage-full banner — always visible when quota is hit */}
        {/* Task 1757: not after a trial that ended over the allowance: the account banner at the top
            already says what is read-only, until when, and how to trim; "Storage full, upgrade"
            beside it would be a second, vaguer answer to the same question. */}
        {storageUsage &&
          storageUsage.plan_limit_bytes > 0 &&
          storageUsage.used_bytes >= storageUsage.plan_limit_bytes &&
          accountState !== 'trial_ended' && (
          <StorageFullBanner
            currentPlan={storageUsage.plan_name}
            onUpgrade={onUpgrade}
            subscription={subscription}
          />
        )}

        {/* Pending shares banner */}
        {!pendingSharesDismissed && (incomingInviteCount > 0 || pendingApprovalCount > 0) && (
          <div className="px-5 py-2.5 border-b border-amber/30 border-l-4 border-l-amber bg-amber-bg flex flex-col gap-1.5 text-sm">
            {incomingInviteCount > 0 && (
              <div className="flex items-center gap-3">
                <Icon name="share" size={14} className="text-amber-deep shrink-0" />
                <span className="text-ink">
                  You have {incomingInviteCount} file share{incomingInviteCount !== 1 ? 's' : ''} waiting
                </span>
                <BBButton
                  size="sm"
                  variant="amber"
                  className="ml-auto gap-1.5"
                  onClick={onViewPendingShares}
                >
                  View
                </BBButton>
                {pendingApprovalCount === 0 && (
                  <button
                    onClick={onDismissPendingShares} aria-label="Dismiss notification" type="button"
                    className="p-1 text-ink-3 hover:text-ink transition-colors cursor-pointer"
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            )}
            {pendingApprovalCount > 0 && (
              <div className="flex items-center gap-3">
                <Icon name="shield" size={14} className="text-amber-deep shrink-0" />
                <span className="text-ink">
                  {pendingApprovalCount} share{pendingApprovalCount !== 1 ? 's' : ''} waiting for your approval
                </span>
                <BBButton
                  size="sm"
                  variant="amber"
                  className="ml-auto gap-1.5"
                  onClick={onViewPendingShares}
                >
                  Review
                </BBButton>
                {incomingInviteCount === 0 && (
                  <button
                    onClick={onDismissPendingShares} aria-label="Dismiss notification" type="button"
                    className="p-1 text-ink-3 hover:text-ink transition-colors cursor-pointer"
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            )}
            {incomingInviteCount > 0 && pendingApprovalCount > 0 && (
              <div className="flex justify-end -mt-1">
                <button
                  onClick={onDismissPendingShares} aria-label="Dismiss notification" type="button"
                  className="p-1 text-ink-3 hover:text-ink transition-colors cursor-pointer"
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Smart folder suggestion banner */}
        {folderSuggestion && isRoot && (
          <div className="px-5 py-3 border-b border-amber/30 border-l-4 border-l-amber bg-paper-2 flex items-center gap-3 text-sm">
            <Icon name="folder" size={14} className="text-amber-deep shrink-0" />
            <span className="flex-1 text-ink">
              {folderSuggestion.type === 'images'
                ? `You have ${folderSuggestion.count} images in your root folder. Create a Photos folder and move them there?`
                : `You have ${folderSuggestion.count} PDFs in your root folder. Create a Documents folder and move them there?`}
            </span>
            <div className="flex items-center gap-1.5 shrink-0">
              <BBButton
                size="sm"
                variant="amber"
                disabled={suggestionCreating}
                onClick={onAcceptSuggestion}
              >
                {suggestionCreating
                  ? 'Creating…'
                  : folderSuggestion.type === 'images'
                    ? 'Create Photos folder'
                    : 'Create Documents folder'}
              </BBButton>
              <BBButton
                size="sm"
                variant="ghost"
                disabled={suggestionCreating}
                onClick={onDismissSuggestion}
              >
                Dismiss
              </BBButton>
            </div>
          </div>
        )}
    </>
  )
}
