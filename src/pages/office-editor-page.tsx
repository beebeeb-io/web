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
import { useKeys } from '../lib/key-context'
import { resolveOfficeFileKind } from '../lib/office/office-file-kind'
import { OfficeEditor } from '../components/office/office-editor'

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
    }

export function OfficeEditorPage() {
  const { fileId } = useParams<{ fileId: string }>()
  const { getFileKeyForFile, isUnlocked } = useKeys()
  const [state, setState] = useState<LoadState>({ stage: 'loading' })
  const [closedHint, setClosedHint] = useState(false)

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
        const [{ current_version: openedVersionNumber }, { plaintext }] = await Promise.all([
          listVersions(file.id).catch(() => ({ current_version: file.version_number ?? 1 })),
          decryptToBlob(file.id, fileKey, file.name_encrypted, mimeType ?? undefined, file.chunk_count, file.size_bytes),
        ])
        const buf = await plaintext.arrayBuffer()
        if (cancelled) return
        setState({
          stage: 'ready',
          file,
          decryptedName: name,
          bytes: new Uint8Array(buf),
          officeApp: officeKind.app,
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
    <OfficeEditor
      file={state.file}
      decryptedName={state.decryptedName}
      initialBytes={state.bytes}
      officeApp={state.officeApp}
      openedVersionNumber={state.openedVersionNumber}
      breadcrumb={['Vault']}
      onDirtyChange={() => {}}
      onSaved={() => {}}
      onSiblingCreated={() => {}}
      onExit={handleExit}
    />
  )
}
