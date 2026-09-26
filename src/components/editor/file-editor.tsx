/**
 * File editor (task 1563) — CodeMirror 6 editing surface for a file already
 * open in FilePreview. Owns: the doc/dirty state, the ⌘S save flow (encrypt
 * client-side, upload as a NEW VERSION of the same file through the
 * existing `encryptedUpload` path — no new server endpoints), the
 * pre-save conflict check, find/replace (via CodeMirror's own panel),
 * soft-wrap, and the markdown split view.
 *
 * Does NOT own the "close the whole preview while dirty" guard — that's
 * FilePreview's job, since it owns the close button. This component reports
 * dirty state up (`onDirtyChange`) and asks before it exits edit mode on its
 * own "Done editing" button (`onRequestExitEdit` is only called once this
 * component has itself confirmed there's nothing to lose) — distinct from
 * PreviewChrome's own back button, which always closes the whole preview.
 * This component's own toolbar (Done / Split preview / Wrap / Save) renders
 * via a PORTAL into a DOM node PreviewChrome's top bar owns
 * (`toolbarSlotEl`), so the filename/back control and the editor's controls
 * share ONE header row instead of two stacked ones (PR #103 review: "double
 * header" — the filename used to appear both in PreviewChrome's bar and in
 * this component's own header).
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Markdown from 'react-markdown'
import { Icon, BBButton } from '@beebeeb/shared'
import type { DriveFile } from '../../lib/api'
import { getFile, listVersions } from '../../lib/api'
import { decryptToBlob } from '../../lib/encrypted-download'
import { encryptedUpload } from '../../lib/encrypted-upload'
import { useKeys } from '../../lib/key-context'
import {
  hasVersionConflict,
  insertBeforeExtension,
  resolveConflictAction,
  type ConflictAction,
} from '../../lib/editor-conflict'
import { CodeMirrorEditor, type CursorPosition } from './codemirror-editor'
import { ConflictDialog } from './conflict-dialog'
import { MarkdownSafeLink } from '../preview/markdown-safe-link'

interface ConflictState {
  latestVersionNumber: number
  latestText: string | null
}

interface FileEditorProps {
  file: DriveFile
  decryptedName: string
  initialText: string
  mimeType: string | null
  isMarkdown: boolean
  language: string | undefined
  openedVersionNumber: number
  onDirtyChange: (dirty: boolean) => void
  /** Fires after ANY successful save that changed THIS file's own version
   *  history (not the Keep Both sibling-file case). */
  onSaved: (updatedFile: DriveFile, savedText: string) => void
  /** Fires after a Keep Both save created a sibling file, so the caller can
   *  refresh the listing — the current preview keeps showing the original. */
  onSiblingCreated: (newFile: DriveFile) => void
  /** DOM node (owned by PreviewChrome's merged top bar) to portal this
   *  component's Done / Split preview / Wrap / Save controls into. Null on
   *  the very first render before the ref callback fires — nothing renders
   *  there yet for that one frame. */
  toolbarSlotEl: HTMLDivElement | null
  /** Exits edit mode back to read mode (dirty-guarded by the caller) —
   *  distinct from PreviewChrome's own back button, which always closes the
   *  WHOLE preview. Only called once this component has confirmed there's
   *  nothing to lose. */
  onRequestExitEdit: () => void
}

export interface FileEditorHandle {
  /** Aborts whichever save/conflict-resolution upload is currently in
   *  flight, if any (no-op otherwise). Called by FilePreview right before
   *  it unmounts this component via "Discard changes" (PR #103 review
   *  thread). */
  abortSave: () => void
}

const LANGUAGE_LABEL: Record<string, string> = {
  markdown: 'Markdown',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  python: 'Python',
  rust: 'Rust',
  sql: 'SQL',
  yaml: 'YAML',
  xml: 'XML',
  cpp: 'C++',
  c: 'C',
}

function languageLabel(isMarkdown: boolean, language: string | undefined): string {
  if (isMarkdown) return 'Markdown'
  if (!language) return 'Plain Text'
  return LANGUAGE_LABEL[language] ?? language.charAt(0).toUpperCase() + language.slice(1)
}

function formatClock(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

/** True for the DOMException `encryptedUpload` throws when its AbortSignal
 *  fires mid-upload (PR #103 review thread). A deliberate cancel (the user
 *  chose "Discard changes" while a save was still in flight) is not a save
 *  FAILURE — surfacing it as one would flash a red error banner on a
 *  component that's unmounting anyway. */
function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

export const FileEditor = forwardRef<FileEditorHandle, FileEditorProps>(function FileEditor({
  file,
  decryptedName,
  initialText,
  mimeType,
  isMarkdown,
  language,
  openedVersionNumber,
  onDirtyChange,
  onSaved,
  onSiblingCreated,
  toolbarSlotEl,
  onRequestExitEdit,
}, ref) {
  const { getFileKey, getMasterKey } = useKeys()

  const [doc, setDoc] = useState(initialText)
  const lastSavedTextRef = useRef(initialText)
  const [dirty, setDirty] = useState(false)
  const [wrap, setWrap] = useState(true)
  const [splitView, setSplitView] = useState(false)
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, col: 1 })
  const [versionNumber, setVersionNumber] = useState(openedVersionNumber)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  // The AbortController for whichever save/conflict-resolution upload is
  // CURRENTLY in flight, if any. Exposed via `abortInFlightSave` (below) so
  // FilePreview can cancel it BEFORE unmounting this component on "Discard
  // changes" — otherwise an upload started before the user chose to discard
  // keeps running in the background and can still land as a new version
  // AFTER the dialog said the edit would be discarded (PR #103 review
  // thread).
  const inFlightUploadRef = useRef<AbortController | null>(null)

  const abortInFlightSave = useCallback(() => {
    inFlightUploadRef.current?.abort()
  }, [])

  useImperativeHandle(ref, () => ({ abortSave: abortInFlightSave }), [abortInFlightSave])

  const handleChange = useCallback(
    (next: string) => {
      setDoc(next)
      const nowDirty = next !== lastSavedTextRef.current
      setDirty(nowDirty)
      onDirtyChange(nowDirty)
    },
    [onDirtyChange],
  )

  // Takes the caller's OWN AbortSignal rather than creating one internally —
  // the caller (handleSave / handleConflictAction) must register its
  // controller in `inFlightUploadRef` BEFORE its first `await` (including
  // any pre-upload network call, e.g. handleSave's write-ahead
  // `listVersions()`), or a "Discard changes" landing during that earlier
  // window would call `abortInFlightSave()` while the ref is still null —
  // a no-op — and the upload would go on to actually start moments later
  // with a signal nobody ever aborts (reproduced live: the discard dialog
  // closed immediately, but the backgrounded save still completed several
  // seconds later and landed as a new version).
  async function performUpload(
    targetFileId: string | undefined,
    conflictCreated: boolean,
    signal: AbortSignal,
    nameOverride?: string,
  ): Promise<DriveFile> {
    const uploadFileId = targetFileId ?? crypto.randomUUID()
    const fileKey = await getFileKey(uploadFileId)
    const name = nameOverride ?? decryptedName
    const effectiveType = mimeType ?? (isMarkdown ? 'text/markdown' : 'text/plain')
    const uploadFile = new File([doc], name, { type: effectiveType })
    const masterKey = getMasterKey()
    return encryptedUpload(
      uploadFile,
      uploadFileId,
      fileKey,
      masterKey,
      file.parent_id ?? undefined,
      undefined,
      undefined,
      undefined,
      signal,
      getFileKey,
      { conflictCreated },
    )
  }

  const handleSave = useCallback(async () => {
    // Both the toolbar Save button (disabled via `saving || !dirty`) AND the
    // keyboard paths (CodeMirror's own Mod-s keymap, plus the document-level
    // fallback listener below) call this same handler — the button's
    // disabled state alone doesn't stop ⌘S from firing with editor focus.
    // Without this check, pressing ⌘S right after opening a file (or again
    // right after a successful save) uploaded the UNCHANGED content as a
    // redundant new version (PR #103 review thread).
    if (saving || !dirty) return
    setSaving(true)
    setSaveError(null)
    // Registered BEFORE the very first await below (the write-ahead
    // `listVersions()` call) — not just before the actual upload — so a
    // "Discard changes" landing at ANY point during this save (including
    // while that pre-check is still in flight) has a real controller to
    // abort. See performUpload's comment for the failure this closed.
    const controller = new AbortController()
    inFlightUploadRef.current = controller
    try {
      // Write-ahead conflict check (design: "checks the latest version
      // before it saves") — never upload blind.
      //
      // Uses listVersions(), NOT getFile(): GET /api/v1/files/:id (server
      // beebeeb-api/src/routes/files.rs get_file()) never selects/returns
      // version_number at all, so `getFile(id).version_number` is always
      // undefined and every conflict check silently no-ops (reproduced live
      // via the task-1563 concurrent-edit e2e test — a second save landed
      // as a plain new version, no dialog). GET .../versions
      // (beebeeb-api/src/routes/versions.rs:114) reads `files.version_number`
      // directly and is what the rest of this file already uses for the
      // version scrubber, so this fix adds no new server surface.
      const { current_version: serverVersion } = await listVersions(file.id)
      if (controller.signal.aborted) return // discarded while the pre-check was in flight
      if (hasVersionConflict({ openedVersion: versionNumber, serverVersion })) {
        setConflict({ latestVersionNumber: serverVersion, latestText: null })
        // Decrypt the racing (current LIVE) content for the diff view. This
        // is NOT a historical version lookup — serverVersion IS the file's
        // current version by definition here, so its bytes come from the
        // normal download path (decryptToBlob), using getFile() ONLY for
        // its accurate chunk_count/size_bytes (the version_number field is
        // the one that's missing from that response — see the comment
        // above; size_bytes/chunk_count are both present and correct).
        try {
          const latest = await getFile(file.id)
          const fileKey = await getFileKey(file.id)
          const { plaintext } = await decryptToBlob(
            file.id,
            fileKey,
            file.name_encrypted,
            mimeType ?? undefined,
            latest.chunk_count,
            latest.size_bytes,
          )
          const text = await plaintext.text()
          setConflict({ latestVersionNumber: serverVersion, latestText: text })
        } catch {
          // Diff content failed to load — the dialog still offers all three
          // actions, just without a preview of the other side.
        }
        return
      }

      const updated = await performUpload(file.id, false, controller.signal)
      lastSavedTextRef.current = doc
      setDirty(false)
      onDirtyChange(false)
      setVersionNumber(updated.version_number ?? versionNumber + 1)
      setLastSavedAt(new Date())
      onSaved(updated, doc)
    } catch (err) {
      if (!isAbortError(err)) {
        setSaveError(err instanceof Error ? err.message : 'Save failed. Try again.')
      }
    } finally {
      setSaving(false)
      if (inFlightUploadRef.current === controller) {
        inFlightUploadRef.current = null
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saving, dirty, file, versionNumber, doc, mimeType, onDirtyChange, onSaved])

  const handleConflictAction = useCallback(
    async (action: ConflictAction) => {
      if (!conflict) return
      const resolution = resolveConflictAction(action, file.id)
      if (resolution === null) return // 'show-differences' — the dialog reveals its own diff, nothing to upload
      // Guard against a double-click (or a repeated click while a slow
      // upload is still in flight) launching a SECOND resolution upload —
      // "Keep both" clicked twice creates two sibling files, "Save as
      // version" clicked twice races two uploads against the same file id
      // (PR #103 review thread). ConflictDialog also disables its own
      // buttons while `saving`, but this guard is the actual source of
      // truth — a synthetic/fast double-click can still land before React
      // re-renders the disabled attribute.
      if (saving) return

      setSaving(true)
      setSaveError(null)
      // Registered before the upload starts (this path has no earlier await
      // to race, unlike handleSave's pre-check) — see performUpload's
      // comment.
      const controller = new AbortController()
      inFlightUploadRef.current = controller
      try {
        const nameOverride = resolution.nameSuffix
          ? insertBeforeExtension(decryptedName, resolution.nameSuffix)
          : undefined
        const updated = await performUpload(
          resolution.fileId,
          resolution.conflictCreated,
          controller.signal,
          nameOverride,
        )
        lastSavedTextRef.current = doc
        setDirty(false)
        onDirtyChange(false)
        setConflict(null)

        if (updated.id === file.id) {
          setVersionNumber(updated.version_number ?? conflict.latestVersionNumber + 1)
          setLastSavedAt(new Date())
          onSaved(updated, doc)
        } else {
          // Keep Both created a sibling file. This session's original file
          // is untouched — hand the new file to the caller, which forces
          // the exit back to read mode itself directly (dirty was just
          // cleared above in this same batch, so a PARENT guard callback
          // closed over the pre-update `dirty` from its last render would
          // still see the stale `true` and wrongly pop the discard-changes
          // dialog on a save that already succeeded).
          onSiblingCreated(updated)
        }
      } catch (err) {
        if (!isAbortError(err)) {
          setSaveError(err instanceof Error ? err.message : 'Save failed. Try again.')
        }
      } finally {
        setSaving(false)
        if (inFlightUploadRef.current === controller) {
          inFlightUploadRef.current = null
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [conflict, saving, file, doc, decryptedName, onDirtyChange, onSaved, onSiblingCreated],
  )

  // ⌘S is bound inside CodeMirrorEditor itself (so it works with editor
  // focus); this top-level listener is a FALLBACK for when focus is on a
  // toolbar button instead of the editor content. Guarded on
  // `e.defaultPrevented`: CodeMirror's own Mod-s keymap binding runs first
  // (bubble phase, innermost element first) and calls preventDefault() —
  // without this guard, a ⌘S pressed with editor focus fired handleSave()
  // TWICE (once from each listener), racing two concurrent saves.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        handleSave()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [handleSave])

  const langLabel = languageLabel(isMarkdown, language)
  const statusRight = conflict
    ? 'not saved · conflict'
    : dirty
      ? 'unsaved changes'
      : lastSavedAt
        ? `saved as version ${versionNumber} · ${formatClock(lastSavedAt)}`
        : `version ${versionNumber}`

  // Done / Split preview / Wrap / Save — portaled into the DOM node
  // PreviewChrome's merged top bar renders (`toolbarSlotEl`) instead of a
  // second header row here, so the filename/back control and these controls
  // share ONE header row (PR #103 review: "double header" — the filename
  // used to appear in both rows; it now lives ONLY in PreviewChrome's own
  // filename block, which also grew the unsaved dot for edit mode — see
  // preview-chrome.tsx's `editing`/`dirty` props). "Done" exits edit mode
  // back to read mode within the SAME open preview — distinct from
  // PreviewChrome's own back button, which always closes the whole preview.
  const toolbar = (
    <>
      <button
        type="button"
        onClick={onRequestExitEdit}
        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-ink-2 hover:bg-paper-3 hover:text-ink"
        aria-label="Done editing"
        data-testid="editor-done"
      >
        <Icon name="chevron-right" size={12} className="rotate-180" />
        Done
      </button>
      {isMarkdown && (
        <button
          type="button"
          onClick={() => setSplitView((v) => !v)}
          aria-pressed={splitView}
          data-testid="editor-split-toggle"
          className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] transition-colors ${
            splitView ? 'bg-paper-3 text-ink' : 'text-ink-2 hover:bg-paper-3 hover:text-ink'
          }`}
        >
          <Icon name="columns" size={12} />
          Split preview
        </button>
      )}
      <button
        type="button"
        onClick={() => setWrap((v) => !v)}
        aria-pressed={wrap}
        data-testid="editor-wrap-toggle"
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] transition-colors ${
          wrap ? 'bg-paper-3 text-ink' : 'text-ink-2 hover:bg-paper-3 hover:text-ink'
        }`}
      >
        Wrap
      </button>
      <BBButton
        size="sm"
        variant="amber"
        onClick={handleSave}
        disabled={saving || !dirty}
        data-testid="editor-save"
      >
        <Icon name="lock" size={12} className="mr-1" />
        {saving ? 'Saving…' : 'Save'}
        <span className="ml-1.5 font-mono text-[10px] opacity-70">⌘S</span>
      </BBButton>
    </>
  )

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-md border border-line bg-paper" data-testid="file-editor">
      {toolbarSlotEl && createPortal(toolbar, toolbarSlotEl)}

      {saveError && (
        <div className="shrink-0 border-b border-red-border bg-red-bg px-3 py-1.5 text-[11.5px] text-red" data-testid="editor-save-error">
          {saveError}
        </div>
      )}

      {/* Body */}
      <div className="flex min-h-0 flex-1">
        <div className={splitView ? 'w-1/2 border-r border-line' : 'w-full'}>
          <CodeMirrorEditor
            initialDoc={initialText}
            language={language}
            wrap={wrap}
            onChange={handleChange}
            onCursorChange={setCursor}
            onSave={handleSave}
            ariaLabel={`Editing ${decryptedName}`}
          />
        </div>
        {splitView && (
          <div className="w-1/2 overflow-auto bg-paper p-5" data-testid="editor-split-preview">
            <div className="prose-editor max-w-none text-[13px] leading-[1.7] text-ink-2">
              <Markdown
                components={{
                  // Split preview renders arbitrary file content — a same-tab
                  // link click would navigate the page away and unmount this
                  // editor with an unsaved draft still in memory, bypassing
                  // the unsaved-changes guard entirely (the browser leaves
                  // the page; no React unmount handler runs). Opening in a
                  // new tab instead means the current tab, and the draft,
                  // never move (PR #103 review thread).
                  a: ({ href, children }) => (
                    <MarkdownSafeLink href={href} className="text-amber-deep underline underline-offset-2">
                      {children}
                    </MarkdownSafeLink>
                  ),
                }}
              >
                {doc}
              </Markdown>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex shrink-0 items-center gap-2.5 border-t border-line bg-paper-2 px-3 py-1.5 font-mono text-[10.5px] text-ink-3" data-testid="editor-status-bar">
        <span>{langLabel}</span>
        <span>UTF-8</span>
        <span>
          Ln {cursor.line}, Col {cursor.col}
        </span>
        <span className="ml-auto flex items-center gap-1.5 text-amber-deep">
          <Icon name="lock" size={11} />
          Encrypted
        </span>
        <span data-testid="editor-status-saved">{statusRight}</span>
      </div>

      {conflict && (
        <ConflictDialog
          latestVersionNumber={conflict.latestVersionNumber}
          openedVersionNumber={versionNumber}
          latestText={conflict.latestText}
          localText={doc}
          saving={saving}
          onAction={handleConflictAction}
          onCancel={() => setConflict(null)}
        />
      )}
    </div>
  )
})
