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
import { listVersions } from '../../lib/api'
import { encryptedUpload } from '../../lib/encrypted-upload'
import { useKeys } from '../../lib/key-context'
import { useTheme } from '../../lib/theme-context'
import type { OfficeApp } from '../../lib/office/office-file-kind'
import { officeAppLabel } from '../../lib/office/office-file-kind'
import { hasVersionConflict, insertBeforeExtension, resolveOfficeConflictAction, type OfficeConflictAction } from '../../lib/office/office-conflict'
import { WRITER_HOME_COMMANDS, WRITER_PALETTE_ENTRIES, type PaletteEntry, type RibbonCommandDef, type UnoStateMap } from '../../lib/office/ribbon-commands'
import type { OfficeBridge, OutlineHeading } from '../../lib/office/bb-office-bridge'
import { useOfficeEngine, OfficeEngineFrame } from './office-engine-host'
import { OfficeHeader } from './office-header'
import { Ribbon } from './ribbon'
import { OutlinePane } from './outline-pane'
import { FloatingSelectionToolbar } from './floating-selection-toolbar'
import { ZoomControl } from './zoom-control'
import { OfficeStatusBar } from './office-status-bar'
import { CommandPalette } from './command-palette'
import { OfficeConflictDialog } from './office-conflict-dialog'
import { UnsavedChangesDialog } from '../editor/unsaved-changes-dialog'

const STATE_COMMANDS = WRITER_HOME_COMMANDS.filter((d) =>
  ['bold', 'italic', 'underline', 'strikethrough', 'align-left', 'align-center', 'align-right', 'align-justify', 'bullet-list', 'numbered-list'].includes(d.id),
).map((d) => d.command)

const GENERIC_PALETTE: PaletteEntry[] = WRITER_HOME_COMMANDS.filter((d) => ['bold', 'italic', 'underline', 'undo', 'redo'].includes(d.id)).map((d) => ({
  id: d.id,
  label: d.label,
  group: d.group,
  command: d.command,
  args: d.args,
  shortcut: d.shortcut,
}))

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
  onSiblingCreated: (newFile: DriveFile) => void
  onExit: () => void
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
}: OfficeEditorProps) {
  const { getFileKey, getMasterKey } = useKeys()
  const { resolved: appTheme } = useTheme()

  const [activeTab, setActiveTab] = useState('Home')
  const [docReady, setDocReady] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [states, setStates] = useState<UnoStateMap>({})
  const [dirty, setDirty] = useState(false)
  const [outline, setOutline] = useState<OutlineHeading[]>([])
  const [zoom, setZoom] = useState(100)
  const [selection, setSelection] = useState<{ text: string } | null>(null)
  const [selectionPos, setSelectionPos] = useState<{ x: number; y: number } | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [confirmExit, setConfirmExit] = useState(false)
  const [versionNumber, setVersionNumber] = useState(openedVersionNumber)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)

  const bridgeRef = useRef<OfficeBridge | null>(null)
  const unsubscribersRef = useRef<Array<() => void>>([])
  const inFlightUploadRef = useRef<AbortController | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)

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

  const handleReady = useCallback(
    async (bridge: OfficeBridge) => {
      bridgeRef.current = bridge
      try {
        await bridge.open(initialBytes, decryptedName)
      } catch (err) {
        setOpenError(err instanceof Error ? err.message : 'Failed to open this document')
        return
      }
      setDocReady(true)

      const commandsToTrack = officeApp === 'writer' ? STATE_COMMANDS : STATE_COMMANDS.slice(0, 4)
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
        const unsubMod = await bridge.onModifiedChange((modified) => reportDirty(modified))
        unsubscribersRef.current.push(unsubMod)
      } catch {
        // best-effort
      }
      try {
        const unsubSel = await bridge.onSelectionChange((sel) => setSelection(sel.text ? sel : null))
        unsubscribersRef.current.push(unsubSel)
      } catch {
        // best-effort
      }
      refreshOutline()
    },
    [initialBytes, decryptedName, officeApp, reportDirty, refreshOutline],
  )

  const { status, error: engineError, iframeSrc, iframeRef, handleIframeLoad } = useOfficeEngine({
    initialTheme: appTheme === 'dark' ? 'dark' : 'light',
    onReady: handleReady,
    onError: setOpenError,
  })

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
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.metaKey || e.ctrlKey
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSaveRef.current()
      } else if (e.key === 'Escape') {
        setSelectionPos(null)
      }
    }
    window.addEventListener('keydown', onKey)
    const iframeDoc = iframeRef.current?.contentWindow?.document
    iframeDoc?.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      iframeDoc?.removeEventListener('keydown', onKey)
    }
  }, [docReady, iframeRef])

  const runCommand = useCallback(
    (def: RibbonCommandDef) => {
      bridgeRef.current
        ?.dispatch(def.command, def.args)
        .then(() => {
          if (def.group === 'Format' && def.id.startsWith('style-')) refreshOutline()
        })
        .catch(() => {})
    },
    [refreshOutline],
  )

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

  const handleImageChosen = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const bytes = new Uint8Array(await f.arrayBuffer())
    await bridgeRef.current?.insertImage(bytes, f.type || 'image/png').catch(() => {})
  }, [])

  async function performUpload(targetFileId: string | undefined, conflictCreated: boolean, signal: AbortSignal, savedBytes: Uint8Array, nameOverride?: string): Promise<DriveFile> {
    const uploadFileId = targetFileId ?? crypto.randomUUID()
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
    const controller = new AbortController()
    inFlightUploadRef.current = controller
    try {
      const { current_version: serverVersion } = await listVersions(file.id)
      if (controller.signal.aborted) return
      if (hasVersionConflict({ openedVersion: versionNumber, serverVersion })) {
        setConflict({ latestVersionNumber: serverVersion })
        return
      }
      const savedBytes = await bridgeRef.current.save()
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
      if (inFlightUploadRef.current === controller) inFlightUploadRef.current = null
    }
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
      const controller = new AbortController()
      inFlightUploadRef.current = controller
      try {
        const savedBytes = await bridgeRef.current.save()
        const nameOverride = resolution.nameSuffix ? insertBeforeExtension(decryptedName, resolution.nameSuffix) : undefined
        const updated = await performUpload(resolution.fileId, resolution.conflictCreated, controller.signal, savedBytes, nameOverride)
        reportDirty(false)
        setConflict(null)
        if (updated.id === file.id) {
          setVersionNumber(updated.version_number ?? conflict.latestVersionNumber + 1)
          setLastSavedAt(new Date())
          onSaved(updated, savedBytes)
        } else {
          onSiblingCreated(updated)
        }
      } catch (err) {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setSaveError(err instanceof Error ? err.message : 'Save failed. Try again.')
        }
      } finally {
        setSaving(false)
        if (inFlightUploadRef.current === controller) inFlightUploadRef.current = null
      }
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

  const wordCount = null // Not exposed by the bridge (no .uno:WordCountDialog readout without a dialog) — status bar omits it honestly rather than showing a fake number.

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-paper" data-testid="office-editor">
      <OfficeHeader
        breadcrumb={breadcrumb}
        filename={decryptedName}
        dirty={dirty}
        saving={saving}
        onBack={requestExit}
        onOpenPalette={() => setPaletteOpen(true)}
        onSave={handleSave}
      />
      <Ribbon
        app={officeApp}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        states={states}
        onCommand={runCommand}
        onInsertLink={handleInsertLink}
        onInsertImage={handleInsertImage}
      />
      {saveError && (
        <div className="shrink-0 border-b border-red-border bg-red-bg px-3 py-1.5 text-[11.5px] text-red" data-testid="office-save-error">
          {saveError}
        </div>
      )}
      <div className="flex min-h-0 flex-1">
        {officeApp === 'writer' && docReady && <OutlinePane headings={outline} onSelect={(i) => bridgeRef.current?.goToHeading(i).catch(() => {})} />}
        <div className="relative min-h-0 flex-1 bg-paper-3">
          {openError || engineError ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-center">
              <p className="text-[13px] text-ink-2">We couldn&apos;t prepare the editor on this device.</p>
              <p className="text-[11.5px] text-ink-4">{openError ?? engineError}</p>
            </div>
          ) : (
            <>
              {status !== 'ready' && !docReady && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-paper-2">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-line border-t-amber" />
                  <span className="text-[13px] text-ink-2">Preparing the editor on this device…</span>
                </div>
              )}
              <OfficeEngineFrame iframeSrc={iframeSrc} iframeRef={iframeRef} onLoad={handleIframeLoad} />
            </>
          )}
          <FloatingSelectionToolbar
            position={selection ? selectionPos : null}
            states={{ bold: states['.uno:Bold']?.state === true, italic: states['.uno:Italic']?.state === true, underline: states['.uno:Underline']?.state === true }}
            onBold={() => bridgeRef.current?.dispatch('.uno:Bold').catch(() => {})}
            onItalic={() => bridgeRef.current?.dispatch('.uno:Italic').catch(() => {})}
            onUnderline={() => bridgeRef.current?.dispatch('.uno:Underline').catch(() => {})}
            onLink={handleInsertLink}
          />
          {docReady && <ZoomControl percent={zoom} onChange={(p) => { setZoom(p); bridgeRef.current?.setZoom(p).catch(() => {}) }} />}
          <CommandPalette open={paletteOpen} entries={officeApp === 'writer' ? WRITER_PALETTE_ENTRIES : GENERIC_PALETTE} onClose={() => setPaletteOpen(false)} onRun={runPaletteEntry} />
          {conflict && <OfficeConflictDialog latestVersionNumber={conflict.latestVersionNumber} openedVersionNumber={versionNumber} saving={saving} onAction={handleConflictAction} onCancel={() => setConflict(null)} />}
          {confirmExit && <UnsavedChangesDialog onDiscard={() => { inFlightUploadRef.current?.abort(); setConfirmExit(false); reportDirty(false); onExit() }} onCancel={() => setConfirmExit(false)} />}
        </div>
      </div>
      <OfficeStatusBar pageLabel={null} wordCount={wordCount} language={undefined} dirty={dirty} conflict={!!conflict} versionNumber={versionNumber} lastSavedAt={lastSavedAt} />
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageChosen} data-testid="office-image-input" />
    </div>
  )
}

export { officeAppLabel }
