# Design deviations

Per `CLAUDE.md`'s "Design before code" rule: where the code and an approved
design artefact disagree, that gap is recorded here in the same commit as the
code, never shipped silently.

## Task 1567 — office editor

### First-load state (CRITIQUE.md finding #5, fixed 2026-09-27)

**Correction to the record first:** the critique evaluated
`src/components/office/office-loading-skeleton.tsx` (`OfficeLoadingSkeleton`)
as if it were the shipped first-load experience. It is not — grep confirms
its only importer is `src/pages/dev-office-preview.tsx`, a dev-only preview
route; `office-editor.tsx` never rendered it. The REAL shipped loading state
was a small inline block in `office-editor.tsx` (an opaque `bg-paper-2` layer
inside the canvas area, a spinner, and "Preparing the editor on this
device…" — not the header/ribbon, which were already rendered
unconditionally the whole time, just not visually muted).

Neither the real inline block nor the orphaned `OfficeLoadingSkeleton`
component matched the approved mockup screen
(`design/office-editor-shots/firstload-{light,dark}.png`): full chrome in
place, a muted ribbon, an outline pane with 3 grey skeleton bars, the real
decrypted thumbnail as the "document" (not a small centered card), and
"Preparing the editor on this device…" in the STATUS BAR, not overlapping the
document.

Fixed directly in `office-editor.tsx` + `outline-pane.tsx` +
`office-status-bar.tsx` (this commit): ribbon wrapped in a
muted/pointer-events-none treatment while `!docReady`; `OutlinePane` gained a
`loading` prop rendering 3 skeleton bars; the canvas overlay now shows the
real thumbnail (fetched via the same `fetchAndDecryptThumbnail` pipeline
`preview.tsx` uses) as a floating page on the same tinted canvas the live
document will occupy, falling back to a plain spinner card only when no
thumbnail exists yet (a brand-new document); `OfficeStatusBar` gained a
`loadingLabel` prop that replaces the page/word-count cluster with the
mockup's amber-dot "Preparing…" text and "read-only for now".

**`office-loading-skeleton.tsx` itself was left as-is** (not deleted, not
rewired) — it is dead code reachable only from `dev-office-preview.tsx`, and
its OWN visual design (a centered thumbnail card + spinner) doesn't match the
approved mockup either, so wiring it in as-is would not have closed the
finding. A follow-up should either delete it or rebuild it to match this
same fix and use it as the single source of truth for both the dev preview
and the real route — not done here (out of this pass's scope; flagging per
this rule rather than leaving two divergent loading treatments unremarked).

**Not pixel-identical to the mockup:** the skeleton bar widths/positions in
`outline-pane.tsx` are a reasonable approximation of the mockup's own bars,
not measured pixel-for-pixel from the reference screenshot.

## Task 1585 — office editor follow-ups (2026-09-27)

Three changes that `design/office-editor.html` does not show. Flagged here for
review, not decided silently:

- **"Licenses" in the status bar (after the save state).** It opens a small
  About popover that names the source repo (`github.com/beebeeb-io/office`) and
  links `/office/<version>/THIRD_PARTY_NOTICES.txt`. The mockup has no
  about or licenses entry. This one is needed: MPL-2.0 §3.2(a) requires telling
  recipients where the Source Code Form is. It went in the status bar, not the
  header, because it is reference material and not a working tool. Where it
  lives is a design call to confirm.
- **Outline pane at phone-portrait width (< 640 px).** The pane starts collapsed
  to its existing 32 px rail. When opened, it floats over the canvas with the
  `shadow-2` token instead of docking, so the engine canvas is never resized,
  and it closes after a heading is picked. The mockup is desktop-only. At
  640 px and wider, nothing changes.
- **Open-error state.** The fixed headline "We couldn't prepare the editor on
  this device." is replaced by a message per error kind, with the raw engine
  text on a mono line underneath (`src/lib/office/office-open-error.ts`). The
  mockup has no error screen.
