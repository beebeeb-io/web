// Archive entry names from core's one path-safety rule (`beebeeb-wasm`).
//
// A name that comes back from the server is written into a ZIP the user then
// extracts on their own machine, so the rules are the portable ones: no
// separators, no `.`/`..`, no control characters, no Windows device names, no
// trailing dot or space. Core either rewrites a name that can be made safe or
// refuses it; this module only decides what a refused name falls back to — a
// deterministic id-based name, never a silently dropped file.

import init, { archiveEntryName } from 'beebeeb-wasm'

let wasmReady: Promise<void> | null = null

/** Load the wasm module once; every caller after the first reuses it. */
export function ensureArchiveNameWasm(): Promise<void> {
  if (wasmReady === null) {
    wasmReady = init().then(
      () => undefined,
      (error: unknown) => {
        wasmReady = null
        throw error
      },
    )
  }
  return wasmReady
}

void ensureArchiveNameWasm().catch(() => {
  /* a session that never downloads an archive does not need it */
})

/**
 * The archive path segment for one server-provided name.
 *
 * Core rewrites the recoverable cases (`:`, `?`, a trailing dot, a reserved
 * device name, bidi controls). A structurally unsafe name — one that carries a
 * separator, `.`/`..`, a control character, a drive prefix or 256+ bytes — is
 * refused; for those this keeps the last segment of the name if that segment
 * alone is safe, so `../report.txt` is written as `report.txt` rather than
 * losing the file, and otherwise falls back to `fallback`.
 *
 * Must be called after {@link ensureArchiveNameWasm} has resolved.
 */
export function safeArchiveName(name: string, fallback: string): string {
  try {
    return archiveEntryName(name)
  } catch {
    const segment = name.split(/[/\\]/).filter(Boolean).pop()
    if (segment !== undefined && segment !== name) {
      try {
        return archiveEntryName(segment)
      } catch {
        // fall through to the caller's deterministic name
      }
    }
    return fallback
  }
}
