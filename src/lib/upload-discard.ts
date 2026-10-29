// ─── Discard-during-save sequencing (task 1571 follow-up) ─────────────
//
// "Discard changes" while a save is still in flight (file-editor.tsx) must
// tell the server to abandon the in-flight upload — otherwise the file is
// left `is_uploading = true` forever (server task 1571,
// `POST /api/v1/files/:id/upload/abandon`).
//
// The bug (web PR #106, Codex P1): the pre-fix code called `abandonUpload`
// immediately on abort, as a fire-and-forget request racing whatever save
// work was still in flight — most dangerously `initUpload`, whose signal
// was never wired into the actual `fetch()` call (see encrypted-upload.ts),
// so aborting the client's AbortController did nothing to stop it
// server-side. Sequence observed live: abort() → abandonUpload fires and
// sees `is_uploading = false` (nothing to abandon yet) → not_uploading
// no-op → THEN the init response lands and sets `is_uploading = true` —
// wedging the file exactly like the bug task 1571 was written to fix.
//
// The fix: never call abandon while the save's own promise is still
// pending. Always let it settle first — resolve or reject, outcome doesn't
// matter, we're discarding either way — and only then call abandon.
// `abandonUpload` is idempotent (a no-op, never an error, whenever the file
// isn't currently mid-upload — see its doc comment in api.ts), so calling
// it unconditionally after settle is always correct, whether or not this
// particular save ever actually reached init.
export async function discardInFlightUpload(
  controller: AbortController | null,
  fileId: string | null,
  pending: Promise<unknown> | null,
  abandon: (fileId: string) => Promise<unknown>,
): Promise<void> {
  controller?.abort()
  if (!fileId) return
  if (pending) {
    // Outcome doesn't matter — a rejected save (including its own
    // AbortError) still counts as "settled" for this purpose.
    await pending.catch(() => {})
  }
  await abandon(fileId).catch(() => {
    // Best-effort only. A failure here just means the 7-day TTL sweep
    // (server task 1571) reclaims the wedged upload later instead of this
    // call doing it immediately — never a data-loss risk.
  })
}
