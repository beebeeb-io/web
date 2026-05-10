/**
 * OnboardingTour — first-run 3-step spotlight overlay.
 *
 * Shows once per user after they land on the drive for the first time.
 * Highlights the upload button, share nav link, and iOS app banner in turn.
 *
 * Persistence: localStorage key 'beebeeb.onboarding.done' — never shown again
 * once set. Integrates with OnboardingContext: only shown when the user is in
 * the 'first_upload' step (i.e. no files uploaded yet, so the drive is empty).
 *
 * Usage:
 *   <OnboardingTour />   — rendered inside <WasmGuard> inside the Drive page.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useOnboarding } from '../lib/onboarding-context'

// ── Types ─────────────────────────────────────────────────────────────────────

interface TourStep {
  targetSelector: string
  title: string
  body: string
  position: 'bottom' | 'right' | 'top'
}

// ── Steps ─────────────────────────────────────────────────────────────────────

const STEPS: TourStep[] = [
  {
    targetSelector: '[data-tour="upload"]',
    title: 'Upload your first file',
    body: 'Everything is encrypted before it leaves your device.',
    position: 'bottom',
  },
  {
    targetSelector: '[data-tour="share"]',
    title: 'Share securely',
    body: 'Generate a time-limited link — no password required from recipients.',
    position: 'right',
  },
  {
    targetSelector: '[data-tour="mobile"]',
    title: 'Get the iOS app',
    body: 'Automatic camera roll backup keeps your photos safe.',
    position: 'top',
  },
]

// ── localStorage helpers ──────────────────────────────────────────────────────

const DONE_KEY = 'beebeeb.onboarding.done'

function isDone(): boolean {
  try {
    return localStorage.getItem(DONE_KEY) === 'true'
  } catch {
    return false
  }
}

function markDone(): void {
  try {
    localStorage.setItem(DONE_KEY, 'true')
  } catch {
    // localStorage unavailable — ignore
  }
}

// ── Tooltip positioning ───────────────────────────────────────────────────────

interface TooltipRect {
  top: number
  left: number
  arrowOffsetX: number
  arrowOffsetY: number
  arrowSide: 'top' | 'bottom' | 'left' | 'right'
}

const TOOLTIP_W = 280
const TOOLTIP_H_ESTIMATE = 120
const ARROW_SIZE = 8
const GAP = 12

function computeTooltipRect(
  target: DOMRect,
  position: TourStep['position'],
): TooltipRect {
  const vw = window.innerWidth
  const vh = window.innerHeight

  let top = 0
  let left = 0
  let arrowOffsetX = 0
  let arrowOffsetY = 0
  let arrowSide: TooltipRect['arrowSide'] = 'top'

  switch (position) {
    case 'bottom': {
      top = target.bottom + GAP
      left = target.left + target.width / 2 - TOOLTIP_W / 2
      arrowSide = 'top'
      arrowOffsetX = TOOLTIP_W / 2
      arrowOffsetY = 0
      break
    }
    case 'top': {
      top = target.top - TOOLTIP_H_ESTIMATE - GAP
      left = target.left + target.width / 2 - TOOLTIP_W / 2
      arrowSide = 'bottom'
      arrowOffsetX = TOOLTIP_W / 2
      arrowOffsetY = TOOLTIP_H_ESTIMATE
      break
    }
    case 'right': {
      top = target.top + target.height / 2 - TOOLTIP_H_ESTIMATE / 2
      left = target.right + GAP
      arrowSide = 'left'
      arrowOffsetX = 0
      arrowOffsetY = TOOLTIP_H_ESTIMATE / 2
      break
    }
  }

  // Clamp within viewport with a bit of margin
  const margin = 12
  left = Math.max(margin, Math.min(left, vw - TOOLTIP_W - margin))
  top = Math.max(margin, Math.min(top, vh - TOOLTIP_H_ESTIMATE - margin))

  return { top, left, arrowOffsetX, arrowOffsetY, arrowSide }
}

// ── Spotlight SVG (backdrop with hole) ───────────────────────────────────────

function Spotlight({ rect, padding = 6 }: { rect: DOMRect; padding?: number }) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const r = 8 // border-radius of the highlight hole
  const x = rect.left - padding
  const y = rect.top - padding
  const w = rect.width + padding * 2
  const h = rect.height + padding * 2

  return (
    <svg
      className="pointer-events-none fixed inset-0 z-[60]"
      width={vw}
      height={vh}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <defs>
        <mask id="tour-mask">
          {/* White = visible (full backdrop) */}
          <rect x={0} y={0} width={vw} height={vh} fill="white" />
          {/* Black cutout = transparent (the highlight hole) */}
          <rect x={x} y={y} width={w} height={h} rx={r} ry={r} fill="black" />
        </mask>
      </defs>
      <rect
        x={0}
        y={0}
        width={vw}
        height={vh}
        fill="rgba(0,0,0,0.55)"
        mask="url(#tour-mask)"
      />
      {/* Amber ring around the target */}
      <rect
        x={x - 1}
        y={y - 1}
        width={w + 2}
        height={h + 2}
        rx={r + 1}
        ry={r + 1}
        fill="none"
        stroke="oklch(0.82 0.17 84)"
        strokeWidth={2}
      />
    </svg>
  )
}

// ── Arrow ─────────────────────────────────────────────────────────────────────

function Arrow({ side }: { side: TooltipRect['arrowSide'] }) {
  const size = ARROW_SIZE
  // The arrow sits on the edge of the tooltip, pointing toward the target.
  const style: React.CSSProperties = {}

  switch (side) {
    case 'top': // tooltip is below target → arrow points up (sits on top edge)
      style.top = -size
      style.left = '50%'
      style.transform = 'translateX(-50%)'
      style.borderLeft = `${size}px solid transparent`
      style.borderRight = `${size}px solid transparent`
      style.borderBottom = `${size}px solid var(--color-ink)`
      break
    case 'bottom': // tooltip is above target → arrow points down
      style.bottom = -size
      style.left = '50%'
      style.transform = 'translateX(-50%)'
      style.borderLeft = `${size}px solid transparent`
      style.borderRight = `${size}px solid transparent`
      style.borderTop = `${size}px solid var(--color-ink)`
      break
    case 'left': // tooltip is to the right → arrow points left
      style.left = -size
      style.top = '50%'
      style.transform = 'translateY(-50%)'
      style.borderTop = `${size}px solid transparent`
      style.borderBottom = `${size}px solid transparent`
      style.borderRight = `${size}px solid var(--color-ink)`
      break
    case 'right': // tooltip is to the left → arrow points right
      style.right = -size
      style.top = '50%'
      style.transform = 'translateY(-50%)'
      style.borderTop = `${size}px solid transparent`
      style.borderBottom = `${size}px solid transparent`
      style.borderLeft = `${size}px solid var(--color-ink)`
      break
  }

  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        width: 0,
        height: 0,
        ...style,
      }}
    />
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function OnboardingTour() {
  const { step: onboardingStep } = useOnboarding()
  const [stepIndex, setStepIndex] = useState(0)
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null)
  const [active, setActive] = useState(false)
  const tooltipRef = useRef<HTMLDivElement>(null)

  // Only show on first_upload or welcome_file — i.e. fresh account.
  // Skip if the user already completed the tour.
  useEffect(() => {
    if (onboardingStep === 'loading') return
    if (onboardingStep === 'done') return
    if (isDone()) return
    // Slight delay so the drive UI has time to paint before we start measuring
    const t = setTimeout(() => setActive(true), 600)
    return () => clearTimeout(t)
  }, [onboardingStep])

  // Advance to the next non-empty step, skipping those with no visible target.
  const findStepFrom = useCallback((from: number): number | null => {
    for (let i = from; i < STEPS.length; i++) {
      const el = document.querySelector(STEPS[i].targetSelector)
      if (el) return i
    }
    return null
  }, [])

  // Measure the target element and (re-)position the tooltip.
  const measureStep = useCallback((index: number) => {
    const el = document.querySelector(STEPS[index].targetSelector)
    if (!el) return null
    return el.getBoundingClientRect()
  }, [])

  // Keep tooltip position in sync with window resize / scroll.
  useEffect(() => {
    if (!active) return

    function update() {
      const rect = measureStep(stepIndex)
      setTargetRect(rect)
    }

    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [active, stepIndex, measureStep])

  const handleNext = useCallback(() => {
    const next = findStepFrom(stepIndex + 1)
    if (next === null) {
      markDone()
      setActive(false)
    } else {
      setStepIndex(next)
    }
  }, [stepIndex, findStepFrom])

  const handleSkip = useCallback(() => {
    markDone()
    setActive(false)
  }, [])

  // Trap focus inside tooltip while tour is open.
  useEffect(() => {
    if (!active || !tooltipRef.current) return
    tooltipRef.current.focus()
  }, [active, stepIndex])

  // Dismiss on Escape.
  useEffect(() => {
    if (!active) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') handleSkip()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [active, handleSkip])

  // Resolve the first available step on mount.
  useEffect(() => {
    if (!active) return
    const idx = findStepFrom(0)
    if (idx === null) {
      markDone()
      setActive(false)
    } else {
      setStepIndex(idx)
    }
  }, [active, findStepFrom])

  if (!active || !targetRect) return null

  const step = STEPS[stepIndex]
  const isLast = findStepFrom(stepIndex + 1) === null
  const { top, left } = computeTooltipRect(targetRect, step.position)
  const arrowSide = step.position === 'bottom' ? 'top'
    : step.position === 'top' ? 'bottom'
    : step.position === 'right' ? 'left'
    : 'right'
  const totalVisible = STEPS.filter((_, i) => !!document.querySelector(STEPS[i].targetSelector)).length
  const currentVisible = STEPS.slice(0, stepIndex + 1).filter((_, i) => !!document.querySelector(STEPS[i].targetSelector)).length

  return (
    <>
      {/* Semi-transparent backdrop with spotlight hole */}
      <Spotlight rect={targetRect} />

      {/* Tooltip */}
      <div
        ref={tooltipRef}
        role="dialog"
        aria-modal="true"
        aria-label={step.title}
        tabIndex={-1}
        style={{
          position: 'fixed',
          top,
          left,
          width: TOOLTIP_W,
          zIndex: 61,
          outline: 'none',
        }}
        className="bg-ink text-paper rounded-xl shadow-3 overflow-hidden border border-ink-2/20"
      >
        {/* Arrow */}
        <Arrow side={arrowSide} />

        <div className="px-4 pt-4 pb-3">
          {/* Step counter */}
          <p className="text-[10px] font-mono text-paper/40 mb-2 uppercase tracking-wider">
            {currentVisible} / {totalVisible}
          </p>

          {/* Title */}
          <p className="text-[14px] font-semibold text-paper leading-snug mb-1">
            {step.title}
          </p>

          {/* Body */}
          <p className="text-[12.5px] text-paper/70 leading-relaxed">
            {step.body}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between px-4 pb-3 -mt-1">
          <button
            type="button"
            onClick={handleSkip}
            className="text-[11.5px] text-paper/40 hover:text-paper/70 transition-colors"
          >
            Skip tour
          </button>

          <button
            type="button"
            onClick={isLast ? handleSkip : handleNext}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber text-ink text-[12.5px] font-semibold hover:bg-amber/90 transition-colors"
          >
            {isLast ? 'Get started' : 'Next'}
            {!isLast && (
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                <path d="M3 1.5L6.5 5L3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </>
  )
}
