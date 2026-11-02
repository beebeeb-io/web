// Decides whether a MIME type can be previewed in the app.
//
// The rules live in core (`beebeeb_core::media`): one extension allowlist and
// one set of MIME classes for web, admin, desktop and mobile. This gate runs
// on double-click BEFORE `pickRenderer` gets a chance to render anything
// (file-list.tsx: `isPreviewable(...) ? open : toast`), so a gate that drifted
// from the renderer silently hid files that could preview. Keeping both sides
// on core's list is what keeps them in step; a rule change belongs in core,
// never here.
import init, { is_previewable, is_previewable_by_extension } from 'beebeeb-wasm'

let wasmReady = false
let wasmInitPromise: Promise<void> | null = null

/**
 * Resolves once the preview predicates can answer. Exported for the vector
 * test and for any caller outside `<WasmGuard>` that must wait explicitly.
 */
export function ensurePreviewWasm(): Promise<void> {
  if (wasmReady) return Promise.resolve()
  if (!wasmInitPromise) {
    wasmInitPromise = init()
      .then(() => {
        wasmReady = true
      })
      .catch(() => {
        wasmInitPromise = null
      })
  }
  return wasmInitPromise
}

// Start the init on module load; the app renders behind `<WasmGuard>`, which
// waits for the same bundle.
void ensurePreviewWasm()

/**
 * True when the file can be previewed.
 *
 * MIME and extension are two independent ways to pass, never a fallback chain
 * (task 1565: a browser-reported MIME that matched nothing used to bypass a
 * perfectly good extension). Before the bundle is ready the answer is `false`
 * rather than a local guess — the UI is still behind the guard at that point.
 */
export function isPreviewable(mimeType: string | null | undefined, fileName?: string | null): boolean {
  if (!wasmReady) return false
  if (mimeType && is_previewable(mimeType)) return true
  if (fileName) return is_previewable_by_extension(fileName)
  return false
}
