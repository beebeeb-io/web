/**
 * OfficeEditorPage (task 1567) — the office editor's OWN top-level route,
 * `/office/:fileId`.
 *
 * Why a real route, not an overlay on the Drive page (an earlier version of
 * this integration tried exactly that — see git history): the engine iframe
 * needs `crossOriginIsolated === true` for SharedArrayBuffer (its pthread
 * build). That is NOT purely a property of the iframe's own response headers
 * — verified empirically against a real Chromium build while building this —
 * a nested browsing context only becomes cross-origin isolated when its
 * ENTIRE ancestor chain, including the top-level document, also carries
 * Cross-Origin-Opener-Policy + Cross-Origin-Embedder-Policy. The Drive app's
 * normal routes intentionally do NOT carry those headers (PLAN.md: applying
 * them site-wide would break any future cross-origin embed, e.g. Stripe).
 * A real, separate top-level document is the only way to scope isolation to
 * "the office route only" as PLAN.md intends for a client-routed SPA, since
 * nginx/Vite can only condition response headers on the REQUEST PATH of a
 * real navigation — not on client-side router state within one already-
 * loaded document. See vite.config.ts's `officeIsolationHeadersPlugin` and
 * nginx.conf's PRE-EXISTING `location /office/` block for the header side of this (no new nginx block needed).
 *
 * Opened via `window.open('/office/<fileId>', ...)` from file-preview.tsx's
 * Edit action (a new tab, not a same-tab navigation) —
 * the Drive tab and its in-memory state are untouched. This route reuses the
 * SAME app bundle/providers (App → ProtectedRoute → WasmGuard), so the vault
 * unlock behaves exactly as any other fresh page load: if "stay unlocked"
 * (task 1532's sliding IndexedDB vault) is active, it unlocks silently; if
 * not, the ordinary VaultUnlock screen appears — never a worse UX than
 * refreshing any other Beebeeb tab.
 */

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getFile, listVersions, type DriveFile } from '../lib/api'
import { decryptToBlob } from '../lib/encrypted-download'
import { decryptFileMetadata } from '../lib/crypto'
import { fetchAndDecryptThumbnail } from '../lib/thumbnail'
import { useKeys } from '../lib/key-context'
import { resolveOfficeFileKind } from '../lib/office/office-file-kind'
import { checkOfficeBytes } from '../lib/office/office-magic'
import { OfficeEditor } from '../components/office/office-editor'
import { ShareDialog } from '../components/share-dialog'

type LoadState =
  | { stage: 'loading' }
  | { stage: 'error'; message: string }
  | {
      stage: 'ready'
      file: DriveFile
      decryptedName: string
      bytes: Uint8Array
      officeApp: 'writer' | 'calc' | 'impress'
      openedVersionNumber: number
      /** CRITIQUE.md finding #5: null while none exists yet (e.g. never
       *  thumbnailed) or the fetch failed — OfficeEditor's own loading state
       *  degrades to a plain card rather than treating that as fatal. */
      thumbnailUrl: string | null
    }

export function OfficeEditorPage() {
  const { fileId } = useParams<{ fileId: string }>()
  const { getFileKeyForFile, isUnlocked } = useKeys()
  const [state, setState] = useState<LoadState>({ stage: 'loading' })
  const [closedHint, setClosedHint] = useState(false)
  // Ship-prep Codex review (PR #113, P1): this route's own top-level
  // `beforeunload` guard — the ONLY line standing between an unsaved edit
  // and the user closing/reloading this tab (there is no Drive-page dirty
  // guard to fall back on here, unlike file-preview.tsx's embedded editor).
  // `onDirtyChange` below used to be a no-op, so this never fired.
  const [dirty, setDirty] = useState(false)
  // CRITIQUE.md finding #3: Share was never wired into this route at all
  // (`<OfficeHeader>` never received an `onShare`). Reuses the SAME
  // `ShareDialog` every other Share entry point in the app uses
  // (file-details-panel.tsx, preview-chrome.tsx via drive.tsx) — it is a
  // self-contained modal needing only fileId/fileName/fileSize, no
  // Drive-page-specific state, so it works unmodified in this separate
  // top-level tab (see this file's header comment for why the route is a
  // separate tab in the first place).
  const [shareOpen, setShareOpen] = useState(false)

  useEffect(() => {
    if (!fileId) {
      setState({ stage: 'error', message: 'No file specified.' })
      return
    }
    if (!isUnlocked) return
    let cancelled = false
    async function load() {
      try {
        const file = await getFile(fileId!)
        const fileKey = await getFileKeyForFile(file)
        const { name, mimeType } = await decryptFileMetadata(fileKey, file.name_encrypted)
        const officeKind = resolveOfficeFileKind(mimeType ?? file.mime_type, name)
        if (!officeKind) {
          if (!cancelled) setState({ stage: 'error', message: `"${name}" is not an office document this editor can open.` })
          return
        }
        const [{ current_version: openedVersionNumber }, { plaintext }, thumbnailUrl] = await Promise.all([
          listVersions(file.id).catch(() => ({ current_version: file.version_number ?? 1 })),
          decryptToBlob(file.id, fileKey, file.name_encrypted, mimeType ?? undefined, file.chunk_count, file.size_bytes),
          // CRITIQUE.md finding #5: best-effort — a brand-new/never-
          // thumbnailed file has none, and that must never block opening
          // the document itself.
          fetchAndDecryptThumbnail(file.id, fileKey).catch(() => null),
        ])
        const bytes = new Uint8Array(await plaintext.arrayBuffer())
        if (cancelled) return
        // Task 1584: the engine only ever gets bytes that really are the
        // claimed document type. A mismatch (ciphertext that slipped past a
        // decryption/assembly bug, a damaged upload, a renamed file) fails
        // loudly here with a message that says what is wrong, instead of
        // being handed to LibreOffice to make sense of.
        const check = checkOfficeBytes(bytes, officeKind.ext)
        if (!check.ok) {
          console.error(`[office] refused to open: expected ${check.expected ?? 'zip/ole'} container, found ${check.found ?? 'none'}`)
          setState({ stage: 'error', message: check.message })
          return
        }
        setState({
          stage: 'ready',
          file,
          decryptedName: name,
          bytes,
          officeApp: officeKind.app,
          thumbnailUrl,
          openedVersionNumber,
        })
      } catch (err) {
        if (!cancelled) setState({ stage: 'error', message: err instanceof Error ? err.message : 'Failed to open this file.' })
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [fileId, isUnlocked, getFileKeyForFile])

  // Ship-prep Codex review (PR #113, P1): closing or reloading this tab
  // while an edit is unsaved used to lose it silently — OfficeEditor's own
  // in-app "Discard changes?" dialog only guards the in-app Back button
  // (requestExit), never a real tab close/reload, and this page's own
  // `onDirtyChange` prop was a no-op so this effect never had anything to
  // react to. Standard beforeunload guard, scoped to `dirty` so it's a
  // no-op the rest of the time (never prompts on a clean document).
  useEffect(() => {
    if (!dirty) return
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  // Ship-prep Codex review (PR #113, P1): "Keep Both" conflict resolution
  // creates a SIBLING file (OfficeEditor's own handleConflictAction calls
  // this with the new DriveFile once the upload lands) — without
  // retargeting this page's own session state, `state.file`/`versionNumber`
  // stayed bound to the ORIGINAL file, so a subsequent Save inside this
  // SAME tab would write the sibling's content back onto the original as a
  // new version, silently defeating the whole point of Keep Both. Retarget
  // by updating `state` in place (no re-fetch/re-decrypt/engine-reboot
  // needed — the engine's own in-memory document is already the sibling's
  // correct content, it just didn't know its own new identity yet).
  function handleSiblingCreated(newFile: DriveFile, plaintextName: string) {
    setState((prev) =>
      prev.stage === 'ready'
        ? { ...prev, file: newFile, decryptedName: plaintextName, openedVersionNumber: newFile.version_number ?? 1 }
        : prev,
    )
  }

  function handleExit() {
    window.close()
    // window.close() is a no-op on a tab the script didn't open itself (e.g.
    // a bookmarked/typed-URL visit to this route) — tell the user honestly
    // instead of leaving a dead Back button as the only way out.
    setTimeout(() => {
      if (!window.closed) setClosedHint(true)
    }, 150)
  }

  if (state.stage === 'loading') {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-paper" data-testid="office-editor-page-loading">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-amber" />
      </div>
    )
  }

  if (state.stage === 'error') {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-3 bg-paper text-center" data-testid="office-editor-page-error">
        <p className="text-[14px] text-ink">{state.message}</p>
        <button type="button" onClick={() => window.close()} className="text-[13px] text-amber-deep underline">
          Close this tab
        </button>
      </div>
    )
  }

  if (closedHint) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-paper text-center" data-testid="office-editor-page-close-hint">
        <p className="text-[13px] text-ink-3">You can close this tab now.</p>
      </div>
    )
  }

  return (
    <>
      <OfficeEditor
        file={state.file}
        decryptedName={state.decryptedName}
        initialBytes={state.bytes}
        officeApp={state.officeApp}
        openedVersionNumber={state.openedVersionNumber}
        breadcrumb={['Vault']}
        onDirtyChange={setDirty}
        // Deliberately still a no-op, checked not overlooked (ship-prep
        // Codex review, PR #113): a same-file save's new version_number is
        // already tracked in OfficeEditor's OWN internal state (its
        // `versionNumber`, updated via setVersionNumber right where this
        // fires) — that internal state, not this page's `openedVersionNumber`
        // prop (only ever read once, to SEED it at mount), is what every
        // later conflict check in this same session actually reads.
        onSaved={() => {}}
        onSiblingCreated={handleSiblingCreated}
        onExit={handleExit}
        onShare={() => setShareOpen(true)}
        thumbnailUrl={state.thumbnailUrl}
      />
      <ShareDialog
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        fileId={state.file.id}
        fileName={state.decryptedName}
        fileSize={state.file.size_bytes}
        onShareCreated={() => setShareOpen(false)}
      />
    </>
  )
}
