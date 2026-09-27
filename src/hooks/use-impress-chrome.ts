/**
 * useImpressChrome (task 1567, Impress lane) — owns every piece of state the
 * Impress ribbon/filmstrip/present-overlay need that OfficeEditor doesn't
 * already track generically: slide count/position (`.uno:PageStatus`), the
 * extra `.uno:CenterPara` toggle state Writer's own `STATE_COMMANDS` slice
 * doesn't track for non-Writer apps, slide-mutation busy-guarding, and
 * present/exit.
 *
 * Deliberately does NOT reuse OfficeEditor's own `bridgeRef`/`unsubscribersRef`
 * — it keeps a fully independent subscription set (its own effect, its own
 * cleanup) so this lane's code never has to edit OfficeEditor's existing
 * `handleReady`/`STATE_COMMANDS` tracking loop. The one cost, accepted
 * deliberately: Bold/Italic/Underline get a SECOND, separate
 * `addStatusListener` subscription alongside OfficeEditor's own (harmless —
 * `bbOffice.onState` supports any number of independent listeners per
 * command; see bb-office-api.js).
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { OfficeBridge } from '../lib/office/bb-office-bridge'
import type { UnoStateMap } from '../lib/office/ribbon-commands'
import { IMPRESS_SLIDE_COMMANDS, parseSlideStatus, planNavigation, layoutDispatchArgs, type LayoutDef, type SlideOp } from '../lib/office/impress-commands'

const TRACKED_COMMANDS = ['.uno:Bold', '.uno:Italic', '.uno:Underline', '.uno:CenterPara']

export interface ImpressChrome {
  states: UnoStateMap
  slideStatus: { index: number; count: number } | null
  busy: boolean
  presenting: boolean
  runSlideOp: (op: SlideOp) => Promise<void>
  applyLayout: (layout: LayoutDef) => Promise<void>
  goToSlide: (target: number) => Promise<void>
  startPresent: () => Promise<void>
  exitPresent: () => void
}

export function useImpressChrome(active: boolean, getBridge: () => OfficeBridge | null): ImpressChrome {
  const [states, setStates] = useState<UnoStateMap>({})
  const [slideStatus, setSlideStatus] = useState<{ index: number; count: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [presenting, setPresenting] = useState(false)
  const slideStatusRef = useRef(slideStatus)
  slideStatusRef.current = slideStatus

  useEffect(() => {
    if (!active) return
    const bridge = getBridge()
    if (!bridge) return
    let cancelled = false
    const unsubs: Array<() => void> = []

    ;(async () => {
      for (const command of TRACKED_COMMANDS) {
        try {
          const unsub = await bridge.onState(command, (s) => {
            if (cancelled) return
            setStates((prev) => ({ ...prev, [command]: s }))
          })
          if (cancelled) {
            unsub()
          } else {
            unsubs.push(unsub)
          }
        } catch {
          // Command not supported on this document — the ribbon button for
          // it just stays at its default enabled/unpressed render state.
        }
      }
      try {
        const unsub = await bridge.onState('.uno:PageStatus', (s) => {
          if (cancelled) return
          setSlideStatus(parseSlideStatus(s.state))
        })
        if (cancelled) {
          unsub()
        } else {
          unsubs.push(unsub)
        }
      } catch {
        // No PageStatus for this document — filmstrip/status bar show
        // nothing rather than a fabricated count.
      }
    })()

    return () => {
      cancelled = true
      unsubs.forEach((u) => {
        try {
          u()
        } catch {
          // engine already torn down with the iframe
        }
      })
    }
  }, [active, getBridge])

  const runSlideOp = useCallback(
    async (op: SlideOp) => {
      const bridge = getBridge()
      if (!bridge) return
      setBusy(true)
      try {
        await bridge.dispatch(IMPRESS_SLIDE_COMMANDS[op].command)
      } catch {
        // best-effort — .uno:PageStatus's own next event is the source of
        // truth for whether this actually changed anything.
      } finally {
        setBusy(false)
      }
    },
    [getBridge],
  )

  const applyLayout = useCallback(
    async (layout: LayoutDef) => {
      const bridge = getBridge()
      if (!bridge) return
      try {
        await bridge.dispatch('.uno:AssignLayout', layoutDispatchArgs(layout))
      } catch {
        // best-effort — no bridge call exists to read back which layout is
        // applied, so there is nothing further to reconcile against.
      }
    },
    [getBridge],
  )

  const goToSlide = useCallback(
    async (target: number) => {
      const bridge = getBridge()
      const current = slideStatusRef.current
      if (!bridge || !current) return
      const steps = planNavigation(current.index, target)
      if (steps.length === 0) return
      setBusy(true)
      try {
        // Awaited one at a time (impress-commands.ts's own note): this
        // engine's .uno:PageStatus events lag one dispatch cycle behind the
        // promise that triggered them, so firing every step without
        // awaiting risks the final step landing on a stale current-position
        // read on the engine's own side.
        for (const cmd of steps) {
          // eslint-disable-next-line no-await-in-loop
          await bridge.dispatch(cmd)
        }
      } catch {
        // best-effort
      } finally {
        setBusy(false)
      }
    },
    [getBridge],
  )

  const startPresent = useCallback(async () => {
    const bridge = getBridge()
    setPresenting(true)
    try {
      await bridge?.dispatch('.uno:Presentation')
    } catch {
      // best-effort — see ImpressPresentOverlay's header comment; our own
      // full-screen chrome takeover does not depend on this succeeding.
    }
  }, [getBridge])

  const exitPresent = useCallback(() => {
    setPresenting(false)
    // Best-effort: probed directly against the real engine, .uno:Escape has
    // no dispatch handler outside of an actually-focused running slideshow
    // (see impress-commands.ts's header) — this call is not what restores
    // our chrome; setPresenting(false) above already did that unconditionally.
    getBridge()?.dispatch('.uno:Escape').catch(() => {})
  }, [getBridge])

  return { states, slideStatus, busy, presenting, runSlideOp, applyLayout, goToSlide, startPresent, exitPresent }
}
