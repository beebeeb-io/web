import { useEffect, useMemo, useState } from 'react'
import { useFocusTrap } from '../hooks/use-focus-trap'
import { BBButton } from './bb-button'
import { BBChip } from './bb-chip'
import { Icon } from './icons'

export const FIRST_SHARE_FLAG = 'bb_first_share_completed'
export const FIRST_SHARE_NUDGE_DISMISSED = 'bb_first_share_nudge_dismissed'

type Stage = 'closed' | 'intro' | 'upload' | 'share' | 'verify' | 'done'
type OpenStage = Exclude<Stage, 'closed'>

interface OnboardingShareGuideProps {
  /** Whether the user has any files yet — used to decide if we still nudge. */
  hasFiles: boolean
  /** Called when the guide wants to start a file upload — opens the system browser. */
  onPickFile: () => void
  /** Called with the most-recently-uploaded file id once a fresh upload finishes during the guide. */
  uploadedFileId: string | null
  /** Called when the guide wants the host page to open the share dialog for `fileId`. */
  onOpenShare: (fileId: string) => void
  /** Becomes true once the host page has finished creating a share for our file. */
  shareCreated: boolean
  /** The full share URL (with #key=…) once a share exists. Used in the verify step. */
  shareUrl: string | null
}

/**
 * "First share moment" — guided 30-second exercise that shows the user
 * encryption + key-split happening live. Renders the dismissible nudge card
 * and the step-by-step overlay.
 */
export function OnboardingShareGuide({
  hasFiles,
  onPickFile,
  uploadedFileId,
  onOpenShare,
  shareCreated,
  shareUrl,
}: OnboardingShareGuideProps) {
  const [stage, setStage] = useState<Stage>('closed')
  const [completed, setCompleted] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(FIRST_SHARE_FLAG) === '1'
  })
  const [nudgeDismissed, setNudgeDismissed] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem(FIRST_SHARE_NUDGE_DISMISSED) === '1'
  })
  const [trackedFileId, setTrackedFileId] = useState<string | null>(null)

  const focusRef = useFocusTrap<HTMLDivElement>(stage !== 'closed' && stage !== 'intro')

  // While the upload step is open, capture the next uploaded file id so we
  // can hand it back to the share step. This keeps the guide tied to the file
  // the user just picked rather than any random file already in the drive.
  useEffect(() => {
    if (stage === 'upload' && uploadedFileId) {
      setTrackedFileId(uploadedFileId)
      setStage('share')
    }
  }, [stage, uploadedFileId])

  // Move from share → verify automatically once a share has been created.
  useEffect(() => {
    if (stage === 'share' && shareCreated && shareUrl) {
      setStage('verify')
    }
  }, [stage, shareCreated, shareUrl])

  function dismissNudge() {
    setNudgeDismissed(true)
    try {
      localStorage.setItem(FIRST_SHARE_NUDGE_DISMISSED, '1')
    } catch {
      /* localStorage may be unavailable (private mode etc.) — ignore */
    }
  }

  function startGuide() {
    setStage('intro')
  }

  function finish() {
    setCompleted(true)
    setStage('done')
    try {
      localStorage.setItem(FIRST_SHARE_FLAG, '1')
    } catch {
      /* ignore */
    }
  }

  function close() {
    setStage('closed')
  }

  // The nudge appears only for fresh accounts: no files yet AND not already
  // completed AND not previously dismissed. The flag/nudge keys are read
  // synchronously from localStorage so the card never flashes for returning users.
  const showNudge = !completed && !nudgeDismissed && !hasFiles && stage === 'closed'

  return (
    <>
      {showNudge && <NudgeCard onStart={startGuide} onDismiss={dismissNudge} />}

      {stage !== 'closed' && (
        <GuideOverlay
          stage={stage as OpenStage}
          focusRef={focusRef}
          shareUrl={shareUrl}
          onClose={close}
          onSkip={() => {
            // Skip = persist completion so the card never returns, then close.
            finish()
            // brief done state is enough — let the user click Done to dismiss.
          }}
          onStartUpload={() => {
            setStage('upload')
            onPickFile()
          }}
          onOpenShare={() => {
            if (trackedFileId) onOpenShare(trackedFileId)
          }}
          onFinish={finish}
        />
      )}
    </>
  )
}

// ─── Nudge card ─────────────────────────────────────────────────────────

function NudgeCard({ onStart, onDismiss }: { onStart: () => void; onDismiss: () => void }) {
  return (
    <div className="px-5 py-3 border-b border-amber/30 border-l-4 border-l-amber bg-amber-bg flex items-start gap-3 text-sm">
      <div className="w-7 h-7 rounded-full bg-paper border border-amber/40 flex items-center justify-center shrink-0 mt-0.5">
        <Icon name="lock" size={13} className="text-amber-deep" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13.5px] font-semibold text-ink leading-snug">
          See your encryption in action
        </div>
        <div className="text-[12.5px] text-ink-2 mt-0.5 leading-relaxed">
          Upload a file and share it — watch the key split happen live. Takes 30 seconds.
        </div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <BBButton size="sm" variant="amber" onClick={onStart}>
          Try it
        </BBButton>
        <BBButton size="sm" variant="ghost" onClick={onDismiss}>
          Maybe later
        </BBButton>
      </div>
    </div>
  )
}

// ─── Step overlay ───────────────────────────────────────────────────────

interface GuideOverlayProps {
  stage: OpenStage
  focusRef: React.RefObject<HTMLDivElement | null>
  shareUrl: string | null
  onClose: () => void
  onSkip: () => void
  onStartUpload: () => void
  onOpenShare: () => void
  onFinish: () => void
}

const STEP_ORDER: OpenStage[] = ['intro', 'upload', 'share', 'verify', 'done']

function GuideOverlay({
  stage,
  focusRef,
  shareUrl,
  onClose,
  onSkip,
  onStartUpload,
  onOpenShare,
  onFinish,
}: GuideOverlayProps) {
  const stepIndex = STEP_ORDER.indexOf(stage)
  const isFirst = stage === 'intro'
  const isDone = stage === 'done'

  // Highlight the #key=… fragment in the share URL so users can see what
  // never leaves their browser.
  const splitUrl = useMemo(() => splitShareUrl(shareUrl), [shareUrl])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-ink/40" onClick={onClose} />
      <div
        ref={focusRef}
        role="dialog"
        aria-modal="true"
        aria-label="See your encryption in action"
        className="relative w-full max-w-[520px] bg-paper border border-line-2 rounded-xl shadow-3 overflow-hidden"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-line flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-full bg-amber-bg border border-amber/40 flex items-center justify-center">
            <Icon name="lock" size={11} className="text-amber-deep" />
          </div>
          <span className="text-sm font-semibold text-ink">
            See your encryption in action
          </span>
          {!isDone && (
            <BBChip variant="amber" className="ml-auto">
              Step {Math.max(1, stepIndex)} of 4
            </BBChip>
          )}
          {isDone && (
            <BBChip variant="green" className="ml-auto">
              Complete
            </BBChip>
          )}
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-ink-3 hover:text-ink transition-colors cursor-pointer"
          >
            <Icon name="x" size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          {stage === 'intro' && <IntroStep onStart={onStartUpload} />}
          {stage === 'upload' && <UploadStep />}
          {stage === 'share' && <ShareStep onOpenShare={onOpenShare} />}
          {stage === 'verify' && <VerifyStep splitUrl={splitUrl} onFinish={onFinish} />}
          {stage === 'done' && <DoneStep onClose={onClose} />}
        </div>

        {/* Footer */}
        {!isDone && (
          <div className="flex items-center gap-2.5 px-5 py-3 border-t border-line bg-paper-2">
            <span className="text-[11px] text-ink-3">
              {isFirst
                ? 'You can stop at any step'
                : 'You can skip the rest of this tour'}
            </span>
            <BBButton size="sm" variant="ghost" className="ml-auto" onClick={onSkip}>
              Skip
            </BBButton>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Step contents ──────────────────────────────────────────────────────

function IntroStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="text-[13.5px] text-ink leading-relaxed">
        Trust isn't built by reading "zero-knowledge" fourteen times. It's built by
        watching the bytes do what the copy promises. This takes about thirty seconds.
      </div>
      <ul className="text-[13px] text-ink-2 leading-relaxed space-y-1 my-1">
        <li>1. Upload any file — encryption happens on this device.</li>
        <li>2. Create a share link — see where the key actually lives.</li>
        <li>3. Open the link to compare what the server sees vs what you see.</li>
      </ul>
      <BBButton size="md" variant="amber" onClick={onStart} className="mt-1 gap-1.5">
        <Icon name="upload" size={13} />
        Pick a file
      </BBButton>
    </div>
  )
}

function UploadStep() {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-2">
      <EncryptingPulse />
      <div className="text-[13.5px] font-semibold text-ink mt-1">
        Pick any file — a photo, a PDF, anything.
      </div>
      <div className="text-[12.5px] text-ink-2 leading-relaxed max-w-[380px]">
        We just opened the file picker. Once you choose a file, the AES-256-GCM
        cipher runs in this tab. The plaintext never leaves your laptop.
      </div>
      <div className="flex items-center gap-1.5 mt-1 text-[11.5px] text-ink-3">
        <Icon name="shield" size={11} className="text-amber-deep" />
        Waiting for your upload to finish…
      </div>
    </div>
  )
}

function ShareStep({ onOpenShare }: { onOpenShare: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-full bg-green/15 flex items-center justify-center">
          <Icon name="check" size={13} className="text-green" />
        </div>
        <div className="text-[13.5px] font-semibold text-ink">
          Encrypted and uploaded.
        </div>
      </div>
      <div className="text-[13px] text-ink-2 leading-relaxed">
        Now create a share link for it. Watch the URL — there's a{' '}
        <code className="font-mono text-amber-deep bg-amber-bg px-1 py-0.5 rounded text-[12px]">
          #key=…
        </code>{' '}
        fragment at the end. That part is the file key. Browsers never send URL
        fragments to the server, so we couldn't see it even if we wanted to.
      </div>
      <BBButton size="md" variant="amber" onClick={onOpenShare} className="mt-1 gap-1.5">
        <Icon name="share" size={13} />
        Open share dialog
      </BBButton>
    </div>
  )
}

function VerifyStep({
  splitUrl,
  onFinish,
}: {
  splitUrl: { base: string; key: string } | null
  onFinish: () => void
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <div className="text-[13.5px] font-semibold text-ink">
        That's your share link.
      </div>
      <div className="text-[13px] text-ink-2 leading-relaxed">
        The amber part is the file key. It lives in the URL fragment, decrypted
        in the recipient's browser, and never reaches our servers.
      </div>

      {splitUrl && (
        <div className="w-full border border-line rounded-md bg-paper-2 px-3 py-2 font-mono text-[11.5px] break-all leading-relaxed">
          <span className="text-ink-3">{splitUrl.base}</span>
          <span className="text-amber-deep font-semibold">{splitUrl.key}</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 w-full mt-1">
        <div className="border border-line rounded-md bg-paper-2 p-3">
          <div className="text-[11px] uppercase tracking-wide text-ink-3 font-semibold mb-1">
            What we see
          </div>
          <div className="font-mono text-[11.5px] text-ink-2 leading-relaxed">
            <span className="text-ink-4">[encrypted blob]</span>
            <br />
            <span className="text-ink-4">name: ciphertext</span>
            <br />
            <span className="text-ink-4">key: —</span>
          </div>
        </div>
        <div className="border border-amber/40 rounded-md bg-amber-bg p-3">
          <div className="text-[11px] uppercase tracking-wide text-amber-deep font-semibold mb-1">
            What you see
          </div>
          <div className="font-mono text-[11.5px] text-ink-2 leading-relaxed">
            <span className="text-ink">your file</span>
            <br />
            <span className="text-ink">name: readable</span>
            <br />
            <span className="text-ink">key: in your URL</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mt-2 w-full">
        {splitUrl && (
          <BBButton
            size="md"
            variant="default"
            onClick={() => window.open(`${splitUrl.base}${splitUrl.key}`, '_blank', 'noopener,noreferrer')}
            className="gap-1.5"
          >
            <Icon name="link" size={13} />
            Open in new tab
          </BBButton>
        )}
        <BBButton size="md" variant="amber" onClick={onFinish} className="ml-auto gap-1.5">
          <Icon name="check" size={13} />
          I see it
        </BBButton>
      </div>
    </div>
  )
}

function DoneStep({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center text-center gap-3 py-2">
      <div className="w-12 h-12 rounded-full bg-green/15 flex items-center justify-center">
        <Icon name="check" size={22} className="text-green" />
      </div>
      <div className="text-[15px] font-semibold text-ink">
        That's zero-knowledge encryption.
      </div>
      <div className="text-[13px] text-ink-2 leading-relaxed max-w-[380px]">
        Your files. Your keys. Always. We can't decrypt them, recover them, or
        hand them over — because we never have them.
      </div>
      <BBButton size="md" variant="amber" onClick={onClose} className="mt-2">
        Back to my files
      </BBButton>
    </div>
  )
}

// ─── Encrypting pulse — reuse the decrypt-pulse keyframes ──────────────

function EncryptingPulse() {
  return (
    <div className="relative w-16 h-16 flex items-center justify-center">
      <div className="absolute inset-0 rounded-full bg-amber-bg" />
      <div
        className="absolute inset-0 rounded-full"
        style={{
          animation: 'decrypt-pulse 1.4s cubic-bezier(0.22, 1, 0.36, 1) infinite',
        }}
      />
      <Icon name="lock" size={22} className="relative text-amber-deep" />
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────

function splitShareUrl(url: string | null): { base: string; key: string } | null {
  if (!url) return null
  const hashIdx = url.indexOf('#')
  if (hashIdx === -1) return { base: url, key: '' }
  return { base: url.slice(0, hashIdx), key: url.slice(hashIdx) }
}
