import type { ComponentProps } from 'react'
import { ShortcutsCheatsheet } from '../../components/shortcuts-cheatsheet'
import { WelcomeTour } from '../../components/welcome-tour'
import { OnboardingTour } from '../../components/onboarding-tour'
import { UpgradeNudgeModal } from '../../components/upgrade-nudge-modal'
import type { StorageUsage, Subscription } from '../../lib/api'

type WelcomeOwn = ComponentProps<typeof WelcomeTour>

export interface DriveGuideOverlaysProps {
  tourOpen: boolean
  onCloseTour: () => void
  onUpload: () => void
  tourCompletedForDisplay: WelcomeOwn['completedSteps']
  markTourStepDone: (id: string, opts?: { hideBoard?: boolean }) => void
  showUpgradeNudge: boolean
  storageUsage: StorageUsage | null
  subscription: Subscription | null
  onCloseUpgrade: () => void
  previewOpen: boolean
  showShortcuts: boolean
  onToggleShortcuts: () => void
  onCloseShortcuts: () => void
}

export function DriveGuideOverlays({
  tourOpen,
  onCloseTour,
  onUpload,
  tourCompletedForDisplay,
  markTourStepDone,
  showUpgradeNudge,
  storageUsage,
  subscription,
  onCloseUpgrade,
  previewOpen,
  showShortcuts,
  onToggleShortcuts,
  onCloseShortcuts,
}: DriveGuideOverlaysProps) {
  return (
    <>
      <WelcomeTour
        open={tourOpen}
        // Task 1526: without this the tour's "Upload a file" step had no
        // handler (the step has no href) and the button did nothing.
        onUpload={onUpload}
        completedSteps={tourCompletedForDisplay}
        // Task 1527: used only by the 'share'/'device' steps now (no cheap
        // real-state signal exists for either) to hide the board while the
        // user acts on the destination page — never sets seen:true, so it
        // reappears on the next drive mount. The 'upload' step is marked
        // done from queueResolvedUploads instead; the 'security' step is
        // derived live from user.totp_enabled (tourCompletedForDisplay,
        // above) and never reaches here.
        onCompleteStep={(id) => markTourStepDone(id, { hideBoard: true })}
        onClose={onCloseTour}
      />

      {/* First-run spotlight tour — 3 steps: upload, share, mobile */}
      <OnboardingTour />

      {/* Upgrade nudge modal — shown at >= 80% quota, once per session */}
      {showUpgradeNudge && storageUsage && (
        <UpgradeNudgeModal
          usedBytes={storageUsage.used_bytes}
          quotaBytes={storageUsage.plan_limit_bytes}
          currentPlan={storageUsage.plan_name}
          subscription={subscription}
          onClose={onCloseUpgrade}
        />
      )}

      {/* Keyboard shortcuts help button — bottom-right FAB.
          Hidden while a file preview is open: it's `position: fixed`
          (viewport-relative, z-40) so it floats ABOVE the preview overlay
          (z-30) regardless of DOM nesting — inside the task-1563 editor,
          whose status bar spans the full width with no right rail to push
          it clear, this opaque circle visually painted over the status
          bar's rightmost text ("saved as version N · HH:MM" truncated to
          "versi…", task 1563 PR #103 review). The preview is already a
          full-screen surface with its own back control, so the global
          shortcuts FAB has nothing useful to float over here anyway. */}
      {!previewOpen && (
        <button
          type="button"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          onClick={onToggleShortcuts}
          className="hidden sm:flex fixed right-5 z-40 items-center justify-center w-8 h-8 rounded-full bg-paper border border-line-2 shadow-2 text-ink-3 hover:text-ink hover:border-line hover:shadow-3 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber"
          style={{ bottom: 'max(1.25rem, env(safe-area-inset-bottom, 1.25rem))' }}
        >
          <span className="text-sm font-mono font-semibold leading-none select-none">?</span>
        </button>
      )}

      {/* Shortcuts cheatsheet — also opens on '?' key via GlobalShortcuts in app.tsx */}
      <ShortcutsCheatsheet open={showShortcuts} onClose={onCloseShortcuts} />
    </>
  )
}
