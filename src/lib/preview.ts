// Decides whether a MIME type can be previewed in the app.
//
// The rules live in core (`beebeeb_core::media`): one extension table with a
// column per client, plus one platform-neutral set of MIME classes. This gate
// runs on double-click BEFORE `pickRenderer` gets a chance to render anything
// (file-list.tsx: `isPreviewable(...) ? open : toast`), so a gate that drifted
// from the renderer silently hid files that could preview. Keeping both sides
// on core's table is what keeps them in step; a rule change belongs in core,
// never here.
//
// The extension half asks for core's **`web`** column, never the platform-less
// predicate: that one answers for mobile, and using it here is what dropped 18
// types web renders (camera RAW, HEVC, AIFF/ALAC, OGA, PPT/KEY, ZIP, XLS, TSV)
// when consolidation replaced web's own list. Core #65 added the columns;
// `previewableBatchFor(names, platform)` is the additive export that reads them.
import init, { is_previewable, previewableBatchFor } from 'beebeeb-wasm'

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

/** Core's name for the client whose preview column this app reads. */
const WEB_PREVIEW_PLATFORM = 'web'

/**
 * True when core's `web` column renders this filename's extension.
 *
 * One name goes through the batch export (the only per-platform entry point on
 * the boundary), so this gate and any listing that batches names read the same
 * column through the same function. No local allowlist: core owns the table.
 */
function isPreviewableExtensionOnWeb(fileName: string): boolean {
  return previewableBatchFor([fileName], WEB_PREVIEW_PLATFORM)[0] === 1
}

/**
 * True when the file can be previewed.
 *
 * MIME and extension are two independent ways to pass, never a fallback chain
 * (task 1565: a browser-reported MIME that matched nothing used to bypass a
 * perfectly good extension). The MIME half is platform-neutral in core (a
 * whole media/text class), so it is unchanged; the extension half reads core's
 * `web` column. Before the bundle is ready the answer is `false` rather than a
 * local guess — the UI is still behind the guard at that point.
 */
export function isPreviewable(mimeType: string | null | undefined, fileName?: string | null): boolean {
  if (!wasmReady) return false
  if (mimeType && is_previewable(mimeType)) return true
  if (fileName) return isPreviewableExtensionOnWeb(fileName)
  return false
}
