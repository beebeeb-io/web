# Design deviations

Per `CLAUDE.md`'s "Design before code" rule: where the code and an approved
design artefact disagree, that gap is recorded here in the same commit as the
code, never shipped silently.

## Full-speed L2 — Settings structure (2026-10-26)

Guus requested clearer settings categories and fewer duplicates. The workspace design and plan at `docs/superpowers/{specs,plans}/2026-10-26-settings-ia-{design,plan}.md` were written before implementation; program §5.6 item 5 permits building without waiting for approval. PR publication is blocked by this session's network/approval policy; the lead receives local branches and evidence.

This supersedes the flat settings navigation and Profile's privacy controls in the old settings mockup: group live pages by purpose, use shared plain labels, move the existing tracking editor to Privacy & data, retain the canonical deletion flow there, and omit the inert Recovery contact input while preserving its stored field. Developer/Referrals URLs remain; their coming-soon navigation entries are removed. Authentication, billing and deletion handlers are retained. Focused test counts and runtime checks deferred by program §5.4 are recorded in the workspace plan.

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
- **Status bar at phone width (< 640 px).** It stays on one line. The
  segments that describe the document (page or slide, word count, Calc's
  stats) sit on the left and are ellipsized when space runs out. Encrypted,
  the save state and Licenses never shrink. Some items are dropped only
  below 640 px:
  - the language;
  - the clock after "saved as version N";
  - Calc's Average and Count (Sum stays).
- **Open-error state.** The fixed headline "We couldn't prepare the editor on
  this device." is replaced by a message per error kind, with the raw engine
  text on a mono line underneath (`src/lib/office/office-open-error.ts`). The
  mockup has no error screen.

## Task 1690 — share dialog: always ONE full link (split presentation removed)

**Design:** `design/hifi/hifi-upload-share.jsx` (`HiShare`) shows the share
result as two separate items: a bare link input plus a "Decryption key" box
badged "Send via a different channel" (the code added a
"Full link / Link + key (extra secure)" toggle on top of it).

**Ruling (Guus, verbatim, 2026-10-02):**
> "Met delen voortaan altijd full link, er staat nu dat het los is maar is
> eigenlijk alsnog 1 geheel. Maak er gewoon 1 geheel van."

**What shipped instead (2026-10-02):** the share dialog always presents and
copies ONE complete link — `/s/<token>#key=<K_c>` built by the new
`src/lib/share-full-link.ts` `buildFullShareLink()`. The toggle, the bare-URL
box, the separate "Decryption key" box, and the "send the link and the key
through separate channels" copy are removed. The key still travels only in
the URL fragment (1531 semantics untouched); the lead-in now says the key is
embedded in the link and never reaches the servers. The passphrase surface
("Share it separately") is unchanged — the passphrase genuinely is separate
from the link.

**Why:** the ruling is dated after the artefact and explicitly supersedes it
(precedent: task 1357, "a verbal ruling from Guus supersedes the artefact").

## Task 1704 SLICE 2 — locked-state self-service exits (2026-10-02)

Three recorded choices on the honest "Vault locked (no vault key)" surface
(`src/components/vault-locked-no-key.tsx`). The governing artefact is the
approved decision doc (`.claude/tasks/decisions/2026-10-02-vault-key-password-
recovery-and-admin-reset-policy.md`, §6 exits table + open-question #7
default), not a hifi mockup — none exists for this state; 1693's
`vault-locked-impersonated.tsx` is the design-language sibling it was told to
follow.

- **Destructive confirmations are danger/red, not amber.** The slice brief's
  phrasing ("amber reserved for encryption state + primary destructive
  confirmations") is overridden by the repo's own brand rule (CLAUDE.md:
  "amber ONLY for encryption indicators and primary CTAs"; red = danger) and
  the shipped destructive precedent (`settings/delete-account` uses the
  `danger` BBButton variant). Amber appears exactly once on this surface: the
  primary re-entry CTA ("Unlock with recovery phrase") — an encryption-state
  primary CTA, squarely inside the brand rule.
- **Detection signal is a reset-completion marker, not a new
  VaultUnlockOutcome.** The brief pointed at VaultUnlockOutcome for the
  "exact signal"; on study, no outcome can honestly carry it:
  `wrong_password` is byte-identical for a typo and for a fresh password
  against an old wrap (distinguishing them would require key-context crypto
  changes, out of slice scope), and `needs_provisioning` means the opposite
  case (password RIGHT, entry unproven). The honest fact that exists is the
  SLICE-1 reset completion itself, so `/set-password` stamps a
  sessionStorage marker (`src/lib/post-reset-lock.ts`) and ProtectedRoute
  routes on it (`resolveLockedVaultSurface`). The wrapped vault is never
  cleared — the old password may still be remembered — and the surface keeps
  an explicit escape hatch back to the password form.
- **Per-file blind deletion omitted.** Sanctioned by the brief's honesty rule
  (drive rows are `name_encrypted` ciphertext — a list of unidentifiable
  deletions is not self-service). The surface says so in plain copy instead
  of hiding the gap; full detail in the task-file Notes entry.


## Task 2237b — shared-folder guest page (Guus's rulings, 2026-10-28)

There is no hi-fi artefact for the shared-folder guest page; these verbal
rulings are the design, recorded verbatim and applied in the same commit:

- "share a folder becomes different than a single file or bunch of files …
  has an alike folder and file overview as files has right now"
- "On the screenshots i think the grid items are too big, so make it smaller"
  → "More towards 80px"

What that means in code:

- **Files primitives, not a look-alike.** The guest list is built from the
  Files row surface and header (`src/components/file-browser-row.tsx`:
  `FileBrowserRow`, `FILE_HEADER_BAR`, `FILE_HEADER_LABEL`, `FILE_STATUS_BAR`;
  `file-list.tsx` and `drive.tsx` now use the same constants), the Files
  `FileIcon`, extension badge and `timeAgo`, the same "All encrypted ·
  AES-256-GCM" status line (`EncryptionStatus`, shared with the drive footer),
  and the Files drop zone (`UploadZone`). Columns: name / size / modified; on a
  phone size and age fold under the name, as in Files.
- **Grid tiles are 80 px** (`GUEST_GRID_TILE_PX`): an 80 px square, the name on
  one line with an ellipsis and the full name as the tile's `title`, size
  below. This overrides any Files grid size. At 390 px wide four tiles fit per
  row (6 px gaps, 8 px card padding); a laptop fits a dozen or more. Every tap
  target is at least 44 px (tiles are 80 × ~112 px; buttons, inputs and the
  sort/view controls are `min-h-11` on phones).
- **Slim Beebeeb header, no sidebar, no owner identity** anywhere on the page.
  The folder title has its own line under the bar and wraps instead of
  truncating, so it is never clipped under the top edge.
- **States:** passphrase prompt, opening, listed (grid or list), empty
  (different copy for view and add links), no search results, unavailable link.
- **Deviation, flagged:** an edit link reads "You can view, download and add
  files", the same as an add link, because rename and delete are not offered
  in the guest UI yet; the page says only what it does.
- **"Download all"** streams each file into the zip chunk by chunk and the zip
  to disk through the service worker (no size cap). A browser without that
  streaming path builds the zip in memory, so there a folder over 128 MiB is
  refused up front with a plain message (`GUEST_ZIP_MAX_BYTES`).
