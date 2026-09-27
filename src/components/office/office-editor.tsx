/**
 * OfficeEditor (task 1567) — the full Beebeeb chrome around the LibreOffice-
 * WASM canvas: OfficeHeader, Ribbon, OutlinePane (Writer), the engine iframe,
 * FloatingSelectionToolbar, ZoomControl, OfficeStatusBar, CommandPalette, and
 * the save/conflict/unsaved-changes flow reusing the SAME save-as-a-new-
 * version path the text editor (task 1563) uses — see `handleSave` below.
 *
 * A full-viewport takeover (`position: fixed; inset: 0`) — the approved
 * mockup (design/office-editor.html) is itself a self-contained frame, not a
 * panel inside another one. Mounted by `office-editor-page.tsx`, the office
 * editor's OWN top-level route (`/office/:fileId`) — NOT embedded
 * inside the Drive page's PreviewChrome. That route exists specifically so
 * the engine iframe's `crossOriginIsolated` requirement (SharedArrayBuffer
 * for its pthread build) can be satisfied: a nested iframe only becomes
 * cross-origin isolated when its ENTIRE ancestor chain, including the
 * top-level document, also carries COOP+COEP (verified empirically while
 * building this) — see office-editor-page.tsx's header comment for the full
 * reasoning and why an in-app overlay on the ordinary Drive route cannot
 * work.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DriveFile } from '../../lib/api'
import { abandonUpload, listVersions } from '../../lib/api'
import { discardInFlightUpload } from '../../lib/upload-discard'
import { encryptedUpload } from '../../lib/encrypted-upload'
import { useKeys } from '../../lib/key-context'
import { useTheme } from '../../lib/theme-context'
import type { OfficeApp } from '../../lib/office/office-file-kind'
import { officeAppLabel } from '../../lib/office/office-file-kind'
import { hasVersionConflict, insertBeforeExtension, resolveOfficeConflictAction, type OfficeConflictAction } from '../../lib/office/office-conflict'
import { WRITER_HOME_COMMANDS, WRITER_PALETTE_ENTRIES, type PaletteEntry, type RibbonCommandDef, type UnoStateMap } from '../../lib/office/ribbon-commands'
import { CALC_STATE_COMMANDS, CALC_PALETTE_ENTRIES, type CalcCommandDef } from '../../lib/office/calc-commands'
import { useCalcSelectionStats } from '../../lib/office/use-calc-selection-stats'
import type { OfficeBridge, OutlineHeading, DocStats } from '../../lib/office/bb-office-bridge'
import { useOfficeEngine, OfficeEngineFrame, DAMAGED_HOST_MESSAGE } from './office-engine-host'
import { OfficeOpenError, toOfficeOpenError } from '../../lib/office/office-open-error'
import { OfficeHeader } from './office-header'
import { Ribbon } from './ribbon'
import { CalcRibbon } from './calc-ribbon'
import { CalcFormulaBar } from './calc-formula-bar'
import { CalcSheetTabs } from './calc-sheet-tabs'
import { CalcStatusExtra } from './calc-status-extra'
import { OutlinePane } from './outline-pane'
import { FloatingSelectionToolbar } from './floating-selection-toolbar'
import type { CharFormattingState } from './char-formatting-controls'
import { ZoomControl } from './zoom-control'
import { OfficeStatusBar } from './office-status-bar'
import { OfficeAbout } from './office-about'
import { CommandPalette } from './command-palette'
import { OfficeConflictDialog } from './office-conflict-dialog'
import { UnsavedChangesDialog } from '../editor/unsaved-changes-dialog'
import { ImpressFilmstrip } from './impress-filmstrip'
import { ImpressPresentOverlay } from './impress-present-overlay'
import { useImpressChrome } from '../../hooks/use-impress-chrome'
import { useImpressFitZoom } from '../../hooks/use-impress-fit-zoom'

// CRITIQUE.md finding #4 (task 1567): these four aren't ribbon buttons with a
// fixed command/args pair (the user picks the value), so they're not entries
// in WRITER_HOME_COMMANDS — appended directly so the SAME onState subscribe
// loop below (handleReady) tracks them like every other command.
const CHAR_FORMAT_COMMANDS = ['.uno:CharFontName', '.uno:FontHeight', '.uno:Color', '.uno:CharBackColor']

// Fix pass item 1 (task 1567): the color LO itself paints AROUND the
// document (bridge.setWorkspaceColor, applies live — see that method's own
// doc comment for why it's unlike setTheme()). Values are design/
// office-editor.html's OWN `--bg` / `--canvas-dark` tokens verbatim (the
// accepted mockup, not a re-derivation from this app's OKLCH theme tokens —
// CLAUDE.md's own "design wins" rule: a mismatch here is a design decision
// to flag, not a color to freehand). Impress stays dark in BOTH app themes,
// matching Word/Keynote's own convention and this codebase's existing
// `bg-canvas-dark` class already used for the SAME reason one level up (the
// outer container CSS, still applied regardless — this is the engine's OWN
// internal canvas paint, a separate layer).
const WORKSPACE_COLOR_BG = { light: 0xf7f3ea, dark: 0x0e0e0d } as const
const WORKSPACE_COLOR_CANVAS_DARK = { light: 0x242320, dark: 0x070706 } as const

function resolveWorkspaceColorRgb(officeApp: OfficeApp, appTheme: 'light' | 'dark'): number {
  const table = officeApp === 'impress' ? WORKSPACE_COLOR_CANVAS_DARK : WORKSPACE_COLOR_BG
  return table[appTheme]
}

/** Renders a BCP-47 locale code (e.g. "en-US", from getDocStats()'s CharLocale
 *  read) as a human label ("American English") via the built-in
 *  `Intl.DisplayNames` — zero dependency, real i18n data, not a hand-rolled
 *  lookup table. Falls back to the raw code if the runtime can't resolve it
 *  (never throws into the render). */
function formatLanguageLabel(code: string): string {
  try {
    const dn = new Intl.DisplayNames(['en'], { type: 'language' })
    return dn.of(code) ?? code
  } catch {
    return code
  }
}

const STATE_COMMANDS = WRITER_HOME_COMMANDS.filter((d) =>
  ['bold', 'italic', 'underline', 'strikethrough', 'align-left', 'align-center', 'align-right', 'align-justify', 'bullet-list', 'numbered-list'].includes(d.id),
)
  .map((d) => d.command)
  .concat(CHAR_FORMAT_COMMANDS)

const GENERIC_PALETTE: PaletteEntry[] = WRITER_HOME_COMMANDS.filter((d) => ['bold', 'italic', 'underline', 'undo', 'redo'].includes(d.id)).map((d) => ({
  id: d.id,
  label: d.label,
  group: d.group,
  command: d.command,
  args: d.args,
  shortcut: d.shortcut,
}))

/** Upper bound on how long "Discard" waits for an in-flight save to settle
 *  and the server abandon to land before the tab exits (see onDiscard). */
const DISCARD_EXIT_CAP_MS = 15_000

const EXT_MIME: Record<string, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  odt: 'application/vnd.oasis.opendocument.text',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
  ods: 'application/vnd.oasis.opendocument.spreadsheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ppt: 'application/vnd.ms-powerpoint',
  odp: 'application/vnd.oasis.opendocument.presentation',
}

interface ConflictState {
  latestVersionNumber: number
}

export interface OfficeEditorProps {
  file: DriveFile
  decryptedName: string
  initialBytes: Uint8Array
  officeApp: OfficeApp
  openedVersionNumber: number
  breadcrumb: string[]
  onDirtyChange: (dirty: boolean) => void
  onSaved: (updatedFile: DriveFile, savedBytes: Uint8Array) => void
  /** `plaintextName` is the sibling's own decrypted name (Keep Both always
   *  appends office-conflict.ts's ' (edited on web)' suffix) — passed
   *  alongside the raw DriveFile so a standalone-route caller (no Drive
   *  listing of its own to re-derive it from) can retarget its session to
   *  the sibling without a redundant decrypt. */
  onSiblingCreated: (newFile: DriveFile, plaintextName: string) => void
  onExit: () => void
  /** CRITIQUE.md finding #3 (task 1567): optional so a caller with no share
   *  flow wired yet (e.g. a future embed) still gets a header, just without
   *  the button — `OfficeHeader` itself only renders Share when this is set
   *  (`{onShare && (...)}`), matching the rest of this app's own share entry
   *  points (file-details-panel.tsx, preview-chrome.tsx). */
  onShare?: () => void
  /** CRITIQUE.md finding #5 (task 1567): the decrypted preview thumbnail
   *  (same pipeline `preview.tsx` uses — `fetchAndDecryptThumbnail`), shown
   *  as the floating "document" while the engine boots, matching the
   *  approved "firstload" mockup screen. Optional/nullable: a brand-new
   *  document has none, and the loading state degrades to a plain card
   *  rather than failing. */
  thumbnailUrl?: string | null
}

export function OfficeEditor({
  file,
  decryptedName,
  initialBytes,
  officeApp,
  openedVersionNumber,
  breadcrumb,
  onDirtyChange,
  onSaved,
  onSiblingCreated,
  onExit,
  onShare,
  thumbnailUrl = null,
}: OfficeEditorProps) {
  const { getFileKey, getMasterKey } = useKeys()
  const { resolved: appTheme } = useTheme()

  const [activeTab, setActiveTab] = useState('Home')
  const [docReady, setDocReady] = useState(false)
  // Task 1585 item 4: true once handleReady has registered EVERY engine
  // subscription (modified, the ribbon's onState set, selection). docReady
  // flips earlier, mid-way through ~14 sequential round trips; input that
  // lands in that window competes with them. Exposed as the root's
  // `data-engine-settled` — a real ready signal for e2e (and anything else)
  // to wait on instead of a proxy element or a timeout.
  const [engineSettled, setEngineSettled] = useState(false)
  // Task 1585 item 2: a host-realm OfficeOpenError with a real `kind`, never
  // an iframe-realm Error (which `instanceof Error` cannot see — see
  // lib/office/office-open-error.ts).
  const [openError, setOpenError] = useState<OfficeOpenError | null>(null)
  const [states, setStates] = useState<UnoStateMap>({})
  const [dirty, setDirty] = useState(false)
  const [outline, setOutline] = useState<OutlineHeading[]>([])
  const [zoom, setZoom] = useState(100)
  const [selection, setSelection] = useState<{ text: string } | null>(null)
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [imageInsertError, setImageInsertError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [confirmExit, setConfirmExit] = useState(false)
  const [versionNumber, setVersionNumber] = useState(openedVersionNumber)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  const bridgeRef = useRef<OfficeBridge | null>(null)
  const unsubscribersRef = useRef<Array<() => void>>([])
  const inFlightUploadRef = useRef<AbortController | null>(null)
  // Ship-prep Codex review (PR #113, P1): "Discard" during an in-flight save
  // must tell the server to abandon the upload (task 1571's own fix for the
  // text editor, PR #106) — calling `abandonUpload` while the save's own
  // promise might still be mid-`initUpload` can see `is_uploading = false`,
  // no-op, and then have the late init response wedge the file right after.
  // These two refs mirror file-editor.tsx's OWN identical pair exactly (same
  // fix, same race) — set together with `inFlightUploadRef` above, before
  // the same first `await`, cleared together in the same `finally` blocks.
  const inFlightFileIdRef = useRef<string | null>(null)
  const inFlightUploadPromiseRef = useRef<Promise<unknown> | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const canvasAreaRef = useRef<HTMLDivElement>(null)

  const reportDirty = useCallback(
    (v: boolean) => {
      setDirty(v)
      onDirtyChange(v)
    },
    [onDirtyChange],
  )

  const refreshOutline = useCallback(() => {
    if (officeApp !== 'writer') return
    bridgeRef.current
      ?.getOutline()
      .then(setOutline)
      .catch(() => {})
  }, [officeApp])

  // CRITIQUE.md finding #8 (task 1567): word count/language, refreshed at the
  // same points as the outline (open, style-apply, palette run) PLUS every
  // modified-change event (below) so the count tracks live typing the way
  // Word's/Docs' own status bars do — Writer only, matching getDocStats()'s
  // own all-null convention for Calc/Impress (docStats stays at its initial
  // all-null value there, which OfficeStatusBar already renders as an
  // honestly-omitted field).
  const [docStats, setDocStats] = useState<DocStats>({ words: null, characters: null, language: null })
  const refreshDocStats = useCallback(() => {
    if (officeApp !== 'writer') return
    bridgeRef.current
      ?.getDocStats()
      .then(setDocStats)
      .catch(() => {})
  }, [officeApp])

  const handleReady = useCallback(
    async (bridge: OfficeBridge) => {
      bridgeRef.current = bridge
      try {
        await bridge.open(initialBytes, decryptedName)
      } catch (err) {
        const openErr = toOfficeOpenError(err)
        console.error(`[office] open failed (${openErr.kind}): ${openErr.detail}`)
        setOpenError(openErr)
        return
      }
      // The dirty listener goes FIRST, straight after open(), ahead of the
      // workspace colour and the ~14 sequential onState round trips below.
      // Observed in e2e (PR #113 Keep Both spec, two engines booting at
      // once): text typed into a freshly opened document never produced the
      // unsaved dot, so Save stayed disabled on a genuinely edited document.
      // Working hypothesis, not proven: the modify broadcast fires on the
      // modified-state transition, so a keystroke landing before this
      // listener exists is never reported — and the old order registered it
      // only after ~14 sequential round trips. Registering it first shrinks
      // that window to one round trip; it does not close it completely.
      try {
        const unsubMod = await bridge.onModifiedChange((modified) => {
          reportDirty(modified)
          refreshDocStats()
        })
        unsubscribersRef.current.push(unsubMod)
      } catch {
        // best-effort
      }
      // Fix pass item 1 (task 1567): AFTER open(), not before/at boot —
      // found empirically that Application::SetSettings()'s own
      // DataChangedEvent broadcast (the mechanism that makes this apply
      // live, unlike setTheme()) only reaches windows that already exist.
      // Calling this before a document/window exists silently no-ops
      // visually even though the bridge call itself resolves `applied:
      // true` (office-engine-host.tsx's own comment has the two-way probe
      // that found this). Never blocks opening a document over a cosmetic
      // color.
      try {
        await bridge.setWorkspaceColor(resolveWorkspaceColorRgb(officeApp, appTheme === 'dark' ? 'dark' : 'light'))
      } catch {
        // best-effort
      }
      setDocReady(true)

      const commandsToTrack = officeApp === 'writer' ? STATE_COMMANDS : officeApp === 'calc' ? CALC_STATE_COMMANDS : STATE_COMMANDS.slice(0, 4)
      for (const command of commandsToTrack) {
        try {
          const unsub = await bridge.onState(command, (s) => {
            setStates((prev) => ({ ...prev, [command]: s }))
          })
          unsubscribersRef.current.push(unsub)
        } catch {
          // A command this app doesn't support (e.g. Calc has no bullet
          // list) — the ribbon button for it just stays at its default
          // enabled/unpressed render state.
        }
      }
      try {
        const unsubSel = await bridge.onSelectionChange((sel) => setSelection(sel.text ? sel : null))
        unsubscribersRef.current.push(unsubSel)
      } catch {
        // best-effort
      }
      refreshOutline()
      refreshDocStats()
      setEngineSettled(true)
    },
    [initialBytes, decryptedName, officeApp, appTheme, reportDirty, refreshOutline, refreshDocStats],
  )

  const resolvedAppTheme = appTheme === 'dark' ? 'dark' : 'light'
  const { error: engineError, iframeSrc, iframeRef, handleIframeLoad, noticesUrl } = useOfficeEngine({
    initialTheme: resolvedAppTheme,
    onReady: handleReady,
  })
  // Everything the engine host reports (manifest fetch, damaged host page,
  // boot timeout) happens BEFORE a document is involved, so it is shown as
  // "the editor didn't load" — except the damaged-host case, whose own
  // message already says exactly that, in more detail.
  const shownError: { kind: string; message: string; detail: string } | null = openError
    ? openError
    : engineError
      ? engineError === DAMAGED_HOST_MESSAGE
        ? { kind: 'engine-damaged', message: engineError, detail: '' }
        : new OfficeOpenError('engine-not-loaded', engineError)
      : null

  // Impress lane (task 1567): slide count/position, the ribbon's extra
  // .uno:CenterPara state, and present/exit — a fully separate subscription
  // set from this component's own STATE_COMMANDS loop above (see
  // use-impress-chrome.ts's header for why), so no-op for Writer/Calc.
  const getBridge = useCallback(() => bridgeRef.current, [])
  const impress = useImpressChrome(officeApp === 'impress' && docReady, getBridge)
  // Fix pass round 2 (task 1567, 2026-09-27, Impress zoom-to-fit): see the
  // hook's own header comment for why `active` must match ImpressFilmstrip's
  // own docReady gate exactly, and why the engine-side ENTIRE_PAGE dispatch
  // this replaces was removed rather than kept alongside this.
  useImpressFitZoom(officeApp === 'impress' && docReady, canvasAreaRef, getBridge, setZoom)

  // Cleanup all engine subscriptions on unmount.
  useEffect(() => {
    return () => {
      unsubscribersRef.current.forEach((unsub) => {
        try {
          unsub()
        } catch {
          // engine already torn down with the iframe
        }
      })
      unsubscribersRef.current = []
    }
  }, [])

  // Selection-rect gap (lead decision 3): position the floating toolbar at
  // the pointer-up point on the canvas, in the HOST page's coordinate space.
  // Same-origin iframe → we can attach directly to its own document.
  useEffect(() => {
    if (!docReady) return
    const win = iframeRef.current?.contentWindow
    const doc = win?.document
    if (!doc) return

    function toHostCoords(clientX: number, clientY: number) {
      const rect = iframeRef.current?.getBoundingClientRect()
      if (!rect) return null
      return { x: rect.left + clientX, y: rect.top + clientY - 44 }
    }

    function onPointerUp(e: PointerEvent) {
      const pos = toHostCoords(e.clientX, e.clientY)
      if (pos) setSelectionPos(pos)
    }
    function onDblClick(e: MouseEvent) {
      const pos = toHostCoords(e.clientX, e.clientY)
      if (pos) setSelectionPos(pos)
    }
    function hideOnActivity() {
      setSelectionPos(null)
    }

    doc.addEventListener('pointerup', onPointerUp)
    doc.addEventListener('dblclick', onDblClick)
    doc.addEventListener('keydown', hideOnActivity)
    doc.addEventListener('scroll', hideOnActivity, true)
    return () => {
      doc.removeEventListener('pointerup', onPointerUp)
      doc.removeEventListener('dblclick', onDblClick)
      doc.removeEventListener('keydown', hideOnActivity)
      doc.removeEventListener('scroll', hideOnActivity, true)
    }
  }, [docReady, iframeRef])

  // ⌘K / ⌘S — both need to work whether focus is on the host chrome or
  // inside the engine iframe's own document (same-origin, so we can attach
  // to both).
  const handleSaveRef = useRef<() => void>(() => {})
  // Impress lane (task 1567): a real Escape keypress reliably exits our own
  // full-screen chrome takeover regardless of whether the engine's own
  // .uno:Escape dispatch does anything (it does not, outside of an
  // actually-focused running slideshow — see ImpressPresentOverlay's header).
  // Read via a ref, not a dependency, so this effect's own deps below (kept
  // unchanged) don't need to know about presenting/exitPresent.
  const impressPresentingRef = useRef(false)
  const impressExitRef = useRef<() => void>(() => {})
  impressPresentingRef.current = impress.presenting
  impressExitRef.current = impress.exitPresent
  useEffect(() => {
    // CRITIQUE.md finding #10 (task 1567): ⌘B/⌘I/⌘Z(/⌘⇧Z) had no chrome-level
    // handler at all -- only ⌘K/⌘S did -- so they only ever worked if focus
    // happened to be inside the LibreOffice-WASM canvas itself (the engine's
    // own Qt input layer mapping the OS accelerator natively). Fixed by
    // handling them here too, but ONLY on the `chromeOnly` path (the
    // `window`-level listener, i.e. focus is somewhere in OUR chrome --
    // ribbon, header, outline pane -- not the canvas): dispatching
    // `.uno:Bold` etc from THIS handler AS WELL when focus is already inside
    // the canvas risks a double-toggle race against Qt's own native
    // handling of the identical accelerator, which this pass has no way to
    // verify is idempotent. Restricting to the chrome-only path closes
    // exactly the gap the critique named (no keyboard fallback once focus
    // leaves the canvas) without touching the in-canvas behavior that
    // already works.
    function onKey(e: KeyboardEvent, chromeOnly: boolean) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSaveRef.current()
      } else if (chromeOnly && meta && !e.altKey && e.key.toLowerCase() === 'b') {
        e.preventDefault()
        bridgeRef.current?.dispatch('.uno:Bold').catch(() => {})
      } else if (chromeOnly && meta && !e.altKey && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        bridgeRef.current?.dispatch('.uno:Italic').catch(() => {})
      } else if (chromeOnly && meta && !e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        bridgeRef.current?.dispatch(e.shiftKey ? '.uno:Redo' : '.uno:Undo').catch(() => {})
      } else if (e.key === 'Escape') {
        if (impressPresentingRef.current) {
          impressExitRef.current()
        } else {
          setSelectionPos(null)
        }
      }
    }
    const onWindowKey = (e: KeyboardEvent) => onKey(e, true)
    const onIframeKey = (e: KeyboardEvent) => onKey(e, false)
    window.addEventListener('keydown', onWindowKey)
    const iframeDoc = iframeRef.current?.contentWindow?.document
    iframeDoc?.addEventListener('keydown', onIframeKey)
    return () => {
      window.removeEventListener('keydown', onWindowKey)
      iframeDoc?.removeEventListener('keydown', onIframeKey)
    }
  }, [docReady, iframeRef])

  const runCommand = useCallback(
    // Accepts either app's own command-def shape (RibbonCommandDef for
    // Writer/Impress, CalcCommandDef for Calc) -- both are pure {command,
    // args, group, id} tables, structurally compatible here since this
    // function only ever reads those four fields.
    (def: RibbonCommandDef | CalcCommandDef) => {
      bridgeRef.current
        ?.dispatch(def.command, def.args)
        .then(() => {
          if (def.group === 'Format' && def.id.startsWith('style-')) refreshOutline()
        })
        .catch(() => {})
    },
    [refreshOutline],
  )

  // CRITIQUE.md finding #4 (task 1567): font family/size/color/highlight —
  // dynamic-value dispatches (the user picks the value), so unlike
  // WRITER_HOME_COMMANDS' fixed-arg buttons these build their PropertyValue
  // args at call time. Argument names/types verified empirically against the
  // real engine (2026-09-27, see char-formatting-controls.tsx's header
  // comment) — not guessed.
  const handleFontName = useCallback((name: string) => {
    bridgeRef.current?.dispatch('.uno:CharFontName', [{ name: 'CharFontName.FamilyName', value: name }]).catch(() => {})
  }, [])
  const handleFontHeight = useCallback((points: number) => {
    bridgeRef.current?.dispatch('.uno:FontHeight', [{ name: 'FontHeight.Height', value: points }]).catch(() => {})
  }, [])
  const handleTextColor = useCallback((unoColor: number) => {
    bridgeRef.current?.dispatch('.uno:Color', [{ name: 'Color', value: unoColor }]).catch(() => {})
  }, [])
  const handleHighlightColor = useCallback((unoColor: number) => {
    bridgeRef.current?.dispatch('.uno:CharBackColor', [{ name: 'CharBackColor', value: unoColor }]).catch(() => {})
  }, [])

  // Derived, render-ready shape for CharFormattingControls — reads the SAME
  // `states` map onState() already populates for Bold/Italic/etc (see
  // CHAR_FORMAT_COMMANDS above), so no separate polling/fetch path exists to
  // go stale. FontDescriptor's `.Name` / FontHeight's `.Height` are the
  // FeatureStateEvent shapes confirmed by the same empirical probe.
  const charFormatState: CharFormattingState = {
    fontName: (states['.uno:CharFontName']?.state as { Name?: string } | undefined)?.Name ?? '',
    fontHeight: (states['.uno:FontHeight']?.state as { Height?: number } | undefined)?.Height ?? null,
    textColor: typeof states['.uno:Color']?.state === 'number' ? (states['.uno:Color']!.state as number) : -1,
    highlightColor: typeof states['.uno:CharBackColor']?.state === 'number' ? (states['.uno:CharBackColor']!.state as number) : -1,
  }

  const calcSelectionStats = useCalcSelectionStats({
    bridge: bridgeRef.current,
    iframeWindow: docReady ? iframeRef.current?.contentWindow : null,
    enabled: officeApp === 'calc' && docReady,
  })

  const runPaletteEntry = useCallback(
    (entry: PaletteEntry) => {
      setPaletteOpen(false)
      bridgeRef.current
        ?.dispatch(entry.command, entry.args)
        .then(() => refreshOutline())
        .catch(() => {})
    },
    [refreshOutline],
  )

  const handleInsertLink = useCallback(() => {
    const text = window.prompt('Link text')
    if (!text) return
    const url = window.prompt('Link URL (https://…)')
    if (!url) return
    bridgeRef.current?.insertHyperlink(text, url).catch(() => {})
  }, [])

  const handleInsertImage = useCallback(() => {
    imageInputRef.current?.click()
  }, [])

  const handleImageChosen = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0]
      e.target.value = ''
      if (!f) return
      setImageInsertError(null)
      const bytes = new Uint8Array(await f.arrayBuffer())
      try {
        await bridgeRef.current?.insertImage(bytes, f.type || 'image/png')
      } catch (err) {
        // Impress lane (task 1567): bbOffice.insertImage() unconditionally
        // throws for a non-Writer document today (see impress-commands.ts's
        // header for the confirmed root cause) — surfaced honestly rather
        // than silently swallowed, since the previous unconditional
        // `.catch(() => {})` here made a real engine limitation invisible.
        setImageInsertError(
          officeApp === 'writer'
            ? err instanceof Error
              ? err.message
              : 'Failed to insert image'
            : `Image insert isn't available for ${officeAppLabel(officeApp)} documents yet.`,
        )
      }
    },
    [officeApp],
  )

  async function performUpload(uploadFileId: string, conflictCreated: boolean, signal: AbortSignal, savedBytes: Uint8Array, nameOverride?: string): Promise<DriveFile> {
    const fileKey = await getFileKey(uploadFileId)
    const name = nameOverride ?? decryptedName
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase()
    const mimeType = EXT_MIME[ext] ?? 'application/octet-stream'
    const uploadFile = new File([savedBytes as BlobPart], name, { type: mimeType })
    const masterKey = getMasterKey()
    return encryptedUpload(uploadFile, uploadFileId, fileKey, masterKey, file.parent_id ?? undefined, undefined, undefined, undefined, signal, getFileKey, { conflictCreated })
  }

  const handleSave = useCallback(async () => {
    if (saving || !dirty || !bridgeRef.current) return
    setSaving(true)
    setSaveError(null)
    // Registered BEFORE the first await (the write-ahead listVersions()
    // call) — not just before the actual upload — so a "Discard changes"
    // landing at ANY point during this save has a real controller/promise
    // to abort/await (same convention as file-editor.tsx's own handleSave).
    const controller = new AbortController()
    inFlightUploadRef.current = controller
    inFlightFileIdRef.current = file.id
    const runSave = (async () => {
      try {
        const { current_version: serverVersion } = await listVersions(file.id)
        if (controller.signal.aborted) return
        if (hasVersionConflict({ openedVersion: versionNumber, serverVersion })) {
          setConflict({ latestVersionNumber: serverVersion })
          return
        }
        const savedBytes = await bridgeRef.current!.save()
        const updated = await performUpload(file.id, false, controller.signal, savedBytes)
        reportDirty(false)
        setVersionNumber(updated.version_number ?? versionNumber + 1)
        setLastSavedAt(new Date())
        onSaved(updated, savedBytes)
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setSaveError(err instanceof Error ? err.message : 'Save failed. Try again.')
        }
      } finally {
        setSaving(false)
        if (inFlightUploadRef.current === controller) {
          inFlightUploadRef.current = null
          inFlightFileIdRef.current = null
        }
      }
    })()
    inFlightUploadPromiseRef.current = runSave
    await runSave
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, dirty, file, versionNumber, reportDirty, onSaved])

  handleSaveRef.current = handleSave

  const handleConflictAction = useCallback(
    async (action: OfficeConflictAction) => {
      if (!conflict || !bridgeRef.current) return
      if (action === 'discard') {
        // Throws away this session's local edit. Reopening with the
        // server's current bytes is FilePreview's own normal load path (the
        // same one that runs on first open) — this component only needs to
        // clear its own dirty state and exit; onExit unmounts OfficeEditor,
        // and FilePreview re-decrypts+re-renders the live version on its
        // next mount of this file.
        setConflict(null)
        reportDirty(false)
        onExit()
        return
      }
      const resolution = resolveOfficeConflictAction(action, file.id)
      if (!resolution) return
      if (saving) return
      setSaving(true)
      setSaveError(null)
      // Keep Both's `resolution.fileId` is undefined (a brand-new sibling) —
      // resolve the real target id HERE, before the first await, so it's
      // the same id `discardInFlightUpload` can call `abandonUpload` on if
      // "Discard" lands while this is still in flight (same fix/race as
      // handleSave above).
      const uploadFileId = resolution.fileId ?? crypto.randomUUID()
      const controller = new AbortController()
      inFlightUploadRef.current = controller
      inFlightFileIdRef.current = uploadFileId
      const runSave = (async () => {
        try {
          const savedBytes = await bridgeRef.current!.save()
          const nameOverride = resolution.nameSuffix ? insertBeforeExtension(decryptedName, resolution.nameSuffix) : undefined
          const updated = await performUpload(uploadFileId, resolution.conflictCreated, controller.signal, savedBytes, nameOverride)
          reportDirty(false)
          setConflict(null)
          if (updated.id === file.id) {
            setVersionNumber(updated.version_number ?? conflict.latestVersionNumber + 1)
            setLastSavedAt(new Date())
            onSaved(updated, savedBytes)
          } else {
            // The session now belongs to the sibling (the parent retargets
            // `file`/`decryptedName` via onSiblingCreated). The conflict
            // baseline must move with it: `versionNumber` was the ORIGINAL
            // file's opened version, and leaving it there disables the
            // write-ahead conflict check on the sibling until the sibling's
            // own version climbs past the original's (hasVersionConflict is
            // `server > opened`), so a concurrent edit to the sibling in that
            // window would be silently overwritten.
            setVersionNumber(updated.version_number ?? 1)
            setLastSavedAt(new Date())
            onSiblingCreated(updated, nameOverride ?? decryptedName)
          }
        } catch (err) {
          if (!(err instanceof DOMException && err.name === 'AbortError')) {
            setSaveError(err instanceof Error ? err.message : 'Save failed. Try again.')
          }
        } finally {
          setSaving(false)
          if (inFlightUploadRef.current === controller) {
            inFlightUploadRef.current = null
            inFlightFileIdRef.current = null
          }
        }
      })()
      inFlightUploadPromiseRef.current = runSave
      await runSave
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conflict, saving, file, decryptedName, onSaved, onSiblingCreated, onExit, reportDirty],
  )

  const requestExit = useCallback(() => {
    if (dirty) {
      setConfirmExit(true)
    } else {
      onExit()
    }
  }, [dirty, onExit])

  // CRITIQUE.md finding #8: was hardcoded null with a comment saying the
  // bridge couldn't expose it — bbOffice.getDocStats() (added for this fix)
  // now does, for Writer; docStats stays all-null for Calc/Impress, so this
  // still renders exactly the same honest omission there.
  const wordCount = docStats.words

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-paper"
      data-testid="office-editor"
      data-doc-ready={docReady ? 'true' : 'false'}
      data-engine-settled={engineSettled ? 'true' : 'false'}
    >
      {!impress.presenting && (
        <OfficeHeader
          breadcrumb={breadcrumb}
          filename={decryptedName}
          dirty={dirty}
          saving={saving}
          onBack={requestExit}
          onOpenPalette={() => setPaletteOpen(true)}
          onShare={onShare}
          onSave={handleSave}
        />
      )}
      {/* CRITIQUE.md finding #5: the ribbon was already rendered
          unconditionally before this fix (never actually hidden behind the
          separate, dead `OfficeLoadingSkeleton` component the critique
          checked — see this task's dated notes) — what it lacked was any
          VISUAL sign that it isn't interactive yet. `pointer-events-none`
          matches that: nothing here dispatches successfully before
          `docReady` anyway (bridgeRef.current is set once `open()`
          resolves), so this also closes a real, if minor, "looks clickable,
          does nothing" gap. */}
      <div className={docReady ? undefined : 'pointer-events-none opacity-40 saturate-50'}>
      {!impress.presenting && (
        officeApp === 'calc' ? (
          <CalcRibbon activeTab={activeTab} onTabChange={setActiveTab} states={states} onCommand={runCommand} />
        ) : (
          <Ribbon
            app={officeApp}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            states={states}
            onCommand={runCommand}
            onInsertLink={handleInsertLink}
            onInsertImage={handleInsertImage}
            charFormatting={
              officeApp === 'writer'
                ? {
                    state: charFormatState,
                    onFontName: handleFontName,
                    onFontHeight: handleFontHeight,
                    onTextColor: handleTextColor,
                    onHighlightColor: handleHighlightColor,
                  }
                : undefined
            }
            impress={
              officeApp === 'impress'
                ? {
                    states: impress.states,
                    busy: impress.busy,
                    slideCount: impress.slideStatus?.count ?? 0,
                    onSlideOp: impress.runSlideOp,
                    onApplyLayout: impress.applyLayout,
                    onPresent: impress.startPresent,
                  }
                : undefined
            }
          />
        )
      )}
      </div>
      {officeApp === 'calc' && docReady && (
        <CalcFormulaBar
          bridge={bridgeRef.current}
          onNavigated={() => {
            try {
              iframeRef.current?.contentWindow?.document.getElementById('qtcanvas')?.focus()
            } catch {
              // Cross-origin or not-yet-ready -- never fatal for navigation itself.
            }
          }}
        />
      )}
      {saveError && (
        <div className="shrink-0 border-b border-red-border bg-red-bg px-3 py-1.5 text-[11.5px] text-red" data-testid="office-save-error">
          {saveError}
        </div>
      )}
      {imageInsertError && (
        <div className="shrink-0 border-b border-red-border bg-red-bg px-3 py-1.5 text-[11.5px] text-red" data-testid="office-insert-error">
          {imageInsertError}
        </div>
      )}
      {/* `relative`: the phone-width outline floats over the canvas (task 1585). */}
      <div className="relative flex min-h-0 flex-1">
        {officeApp === 'writer' && !shownError && (
          <OutlinePane headings={outline} onSelect={(i) => bridgeRef.current?.goToHeading(i).catch(() => {})} loading={!docReady} />
        )}
        {officeApp === 'impress' && docReady && !impress.presenting && (
          <ImpressFilmstrip
            status={impress.slideStatus}
            busy={impress.busy}
            onSelect={impress.goToSlide}
            onInsert={() => impress.runSlideOp('insert')}
            onDuplicate={() => impress.runSlideOp('duplicate')}
            onDelete={() => impress.runSlideOp('delete')}
            onMoveUp={() => impress.runSlideOp('moveUp')}
            onMoveDown={() => impress.runSlideOp('moveDown')}
          />
        )}
        {/* Impress lane (task 1567): the canvas stays dark in BOTH app
            themes (design/office-editor.html's own explicit decision, same
            convention as Word/Keynote) — every other app keeps the shared
            theme-following bg-paper-3. */}
        <div ref={canvasAreaRef} className={`relative min-h-0 flex-1 ${officeApp === 'impress' ? 'bg-canvas-dark' : 'bg-paper-3'}`}>
          {shownError ? (
            <div
              className="flex h-full w-full flex-col items-center justify-center gap-2 px-6 text-center"
              data-testid="office-open-error"
              data-kind={shownError.kind}
            >
              <p className="max-w-[440px] text-[13px] text-ink-2" data-testid="office-open-error-message">
                {shownError.message}
              </p>
              {shownError.detail && (
                <p className="max-w-[520px] break-words font-mono text-[11px] text-ink-4" data-testid="office-open-error-detail">
                  {shownError.detail}
                </p>
              )}
            </div>
          ) : (
            <>
              {/* Task 1584: covers the engine iframe until the document is
                  OPEN (docReady), not just until the bridge exists. Before,
                  this sat UNDER the iframe (earlier sibling, no z-index) and
                  went away at status 'ready', so whatever the iframe showed
                  while the editor still said "Preparing the editor…" was on
                  screen, including, on iPhone Safari, the engine document's
                  own undecoded bytes as text. Opaque and on top now; the
                  iframe stays laid out underneath so the engine boots and
                  sizes its canvas exactly as before. */}
              {!docReady && (
                // CRITIQUE.md finding #5: replaces the old opaque spinner
                // card (which hid the whole canvas behind flat bg-paper-2)
                // with the approved "firstload" mockup's own treatment — the
                // real decrypted thumbnail shown as a floating, slightly
                // muted page on the SAME tinted canvas the live document
                // will occupy (PLAN.md's "floats on a tinted canvas with a
                // soft shadow"), so there's no jarring swap in background
                // once the real engine paints in. Falls back to a plain
                // card only when no thumbnail exists (e.g. a brand-new
                // document has none yet). "Preparing…" copy moved to the
                // status bar below (loadingLabel) per the mockup, which
                // puts it there, not overlapping the document.
                <div
                  className={`absolute inset-0 z-10 flex items-center justify-center overflow-hidden p-8 ${officeApp === 'impress' ? 'bg-canvas-dark' : 'bg-paper-3'}`}
                  data-testid="office-loading-thumbnail"
                >
                  {thumbnailUrl ? (
                    <img
                      src={thumbnailUrl}
                      alt=""
                      className="max-h-full max-w-full rounded-sm border border-line object-contain shadow-2"
                      style={{ filter: 'saturate(0.85) brightness(0.98)' }}
                    />
                  ) : (
                    <div className="flex h-[70%] w-[54%] max-w-[520px] flex-col items-center justify-center gap-3 rounded-sm border border-line bg-paper shadow-2">
                      <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-amber" />
                    </div>
                  )}
                </div>
              )}
              <OfficeEngineFrame iframeSrc={iframeSrc} iframeRef={iframeRef} onLoad={handleIframeLoad} cropScrollbar={officeApp === 'impress'} />
            </>
          )}
          <FloatingSelectionToolbar
            position={selection ? selectionPos : null}
            states={{ bold: states['.uno:Bold']?.state === true, italic: states['.uno:Italic']?.state === true, underline: states['.uno:Underline']?.state === true }}
            onBold={() => bridgeRef.current?.dispatch('.uno:Bold').catch(() => {})}
            onItalic={() => bridgeRef.current?.dispatch('.uno:Italic').catch(() => {})}
            onUnderline={() => bridgeRef.current?.dispatch('.uno:Underline').catch(() => {})}
            onLink={handleInsertLink}
            textColor={charFormatState.textColor}
            onTextColor={handleTextColor}
          />
          {docReady && !impress.presenting && <ZoomControl percent={zoom} onChange={(p) => { setZoom(p); bridgeRef.current?.setZoom(p).catch(() => {}) }} />}
          <CommandPalette
            open={paletteOpen}
            entries={officeApp === 'writer' ? WRITER_PALETTE_ENTRIES : officeApp === 'calc' ? CALC_PALETTE_ENTRIES : GENERIC_PALETTE}
            onClose={() => setPaletteOpen(false)}
            onRun={runPaletteEntry}
          />
          {conflict && <OfficeConflictDialog latestVersionNumber={conflict.latestVersionNumber} openedVersionNumber={versionNumber} saving={saving} onAction={handleConflictAction} onCancel={() => setConflict(null)} />}
          {confirmExit && (
            <UnsavedChangesDialog
              onDiscard={() => {
                // discardInFlightUpload waits for any in-flight save to
                // settle before telling the server to abandon it (task 1571
                // fix, PR #106 Codex P1 — calling abandonUpload the instant
                // abort() fires can race a still-in-flight initUpload and
                // no-op, leaving the file wedged `is_uploading=true` once that
                // late response lands).
                //
                // It MUST finish before onExit(): on the top-level
                // /office/:fileId route onExit() is window.close(), which
                // tears down this JS context — found by e2e (PR #113 Codex P1
                // regression spec): firing it and exiting in the same tick
                // meant the abandon request was never sent at all. Capped so
                // a save that somehow never settles cannot trap the user in
                // the tab; the server's TTL sweep (task 1571) is the backstop
                // for that case.
                setConfirmExit(false)
                reportDirty(false)
                const discard = discardInFlightUpload(inFlightUploadRef.current, inFlightFileIdRef.current, inFlightUploadPromiseRef.current, abandonUpload)
                void Promise.race([discard, new Promise<void>((resolve) => setTimeout(resolve, DISCARD_EXIT_CAP_MS))]).then(() => onExit())
              }}
              onCancel={() => setConfirmExit(false)}
            />
          )}
          {impress.presenting && <ImpressPresentOverlay onExit={impress.exitPresent} />}
        </div>
      </div>
      {officeApp === 'calc' && <CalcSheetTabs bridge={bridgeRef.current} docReady={docReady} />}
      {!impress.presenting && (
        <OfficeStatusBar
          pageLabel={officeApp === 'impress' && impress.slideStatus ? `Slide ${impress.slideStatus.index} of ${impress.slideStatus.count}` : null}
          wordCount={wordCount}
          language={docStats.language ? formatLanguageLabel(docStats.language) : undefined}
          dirty={dirty}
          conflict={!!conflict}
          versionNumber={versionNumber}
          lastSavedAt={lastSavedAt}
          extra={officeApp === 'calc' ? <CalcStatusExtra stats={calcSelectionStats} /> : undefined}
          loadingLabel={!docReady && !shownError ? 'Preparing the editor on this device…' : null}
          about={<OfficeAbout noticesUrl={noticesUrl} />}
        />
      )}
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChosen} data-testid="office-image-input" />
    </div>
  )
}

export { officeAppLabel }
