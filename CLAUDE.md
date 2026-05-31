# beebeeb-io/web

React web client for Beebeeb. Encrypted file management in the browser.

## Stack

React 19 + Vite 6 + Tailwind 4 + react-router-dom 7. Package manager: **bun**.

## Build & dev

```sh
bun install
bun dev          # localhost:5173
bun run build    # Production build
bunx tsc --noEmit  # Type check
```

## API

Backend runs at `http://localhost:3001`. API client is in `src/lib/api.ts`. All endpoints documented in the server repo's CLAUDE.md.

## Design tokens (Tailwind 4 @theme)

Defined in `src/index.css`. Key colors:
- `paper` / `paper-2` / `paper-3` — warm off-whites
- `ink` / `ink-2` / `ink-3` / `ink-4` — warm darks
- `amber` / `amber-deep` / `amber-bg` — THE accent (encryption state + primary CTAs only)
- `green` — success
- `red` — danger
- `line` / `line-2` — borders

Typography: `font-sans` (Inter), `font-mono` (JetBrains Mono)
Spacing: 4px base (xs=4, sm=8, md=12, lg=18, xl=24, 2xl=36)
Radii: sm=4, md=6, lg=10, xl=14
Shadows: shadow-1 (subtle), shadow-2 (medium), shadow-3 (elevated)

## Design references

Hi-fi designs are in the workspace: `../../design/hifi/`. Key files:
- `hifi-auth.jsx` — signup, login, 2FA, passkey, forgot password
- `hifi-onboarding.jsx` — recovery phrase screen
- `hifi-drive.jsx` — main drive view with sidebar
- `hifi-upload-share.jsx` — upload zone + share dialog
- `hifi-preview.jsx` — image/PDF/video/markdown preview
- `hifi-settings.jsx` — profile, devices, notifications, language
- `hifi-security.jsx` — security center
- `hifi-billing.jsx` — pricing, upgrade, billing management
- `hifi-empty-errors.jsx` — empty states and error pages
- `hifi-brand-system.jsx` — complete design system doc

## Pages & routing

- `/signup`, `/login` — guest only
- `/onboarding` — post-signup recovery phrase
- `/` — Drive (main file view)
- `/trash` — trashed files
- `/search` — search results
- `/settings/*` — profile, devices, notifications, language
- `/security` — security center
- `/billing` — billing management
- `/s/:token` — public share recipient view (no auth)
- `*` — 404

## Components

In `src/components/`: bb-button, bb-input, bb-chip, bb-checkbox, bb-toggle, bb-logo, icons (24 SVGs), auth-shell, settings-shell, file-icon, upload-zone, upload-progress, share-dialog, new-folder-dialog, context-menu, move-modal, version-history, preview/* (chrome, rail, image, pdf, video, markdown, text), empty-states/*

## Brand rules

- Amber ONLY for encryption indicators and primary CTAs
- "If you can't read it aloud, it's mono" (hashes, IDs, sizes, timestamps)
- No emojis in UI
- Honest copy: "We can't recover this" not "bank-grade security"


## How to add a new page

1. Create `src/pages/my-page.tsx` — export a component that wraps content in `<DriveLayout>`
2. In `src/app.tsx`: import the component, add `<Route path="/my-page" element={<ProtectedRoute><MyPage /></ProtectedRoute>} />`
3. If it needs a sidebar link: add to `navItems` array in `src/components/drive-layout.tsx`

## How to add a new API function

Add to `src/lib/api.ts` following existing patterns:
```typescript
export async function myFunction(param: string): Promise<MyType> {
  return request<MyType>(`/api/v1/my-endpoint/${param}`)
}
```

## Thumbnails

Thumbnails are WebP format, generated client-side in `src/lib/thumbnail.ts`. The generation uses a quality cascade (768px width, quality 0.82→0.5) targeting max 50 KB before encryption. Encrypted with the file's AES-256-GCM key, uploaded via `PUT /api/v1/files/:id/thumbnail`.

Decrypted thumbnails are cached persistently via the Cache API (`beebeeb-thumbnails-v2`, max 10,000 entries) so they survive page reloads. In-memory `Map<string, string>` of object URLs provides the hot cache for the current session.

## Uploads (streaming encryption)

`src/lib/encrypted-upload.ts` encrypts files via the shared core streaming
primitive (`WasmChunkEncryptor`), NOT a whole-file read. Per chunk it slices the
`File`, calls `enc.pushChunk(slice)` (returns the full `nonce||ciphertext||tag`
frame — no JS recombine), PUTs the frame, and runs `enc.finish()` (integrity
guard) before `completeUpload`. Memory stays bounded to one slice + one frame.

- `encryptedUpload(..., masterKey, ...)` takes BOTH `fileKey` (metadata,
  thumbnails, folder-share) and `masterKey`. The encryptor derives the per-file
  key ONCE inside core from `masterKey` + the final `serverFileId` — do not
  recombine keys in JS. Pass `getMasterKey()` from `useKeys()` at call sites.
- The encryptor lives INSIDE the crypto worker (it's a pointer into WASM linear
  memory and can't cross Comlink). `crypto.ts` addresses it by an opaque handle
  via `StreamingEncryptor` / `startEncryptedStream[WithChunkSize]`.
- `crypto.ts` `maybeRestart()` skips the 256 MiB worker recycle while
  `liveEncryptorCount() > 0`, so an in-flight upload is never orphaned.
- Resume = push-but-don't-upload: already-uploaded chunks are STILL pushed (to
  keep index/nonce/count aligned with `finish()`), just not re-PUT.
- Wire contract unchanged: `init_upload` still sends `size_bytes = file.size`
  (plaintext) and `chunk_count` from the core plan — the server recomputes from
  chunks. Do NOT switch the init total to the ciphertext size.

## Critical prop chains

When opening the ShareDialog, ALWAYS pass `isFolder={file.is_folder}`. Folder sharing generates a folder_key and encrypts all children — without this prop, folder shares silently create regular file shares that don't work.

For full component reference: use `/beebeeb:components` skill.

## Graphify

This repo has a knowledge graph at graphify-out/.
- Before exploring code, read graphify-out/GRAPH_REPORT.md for module structure and relationships
- After modifying code, run `graphify update .` and commit the updated graphify-out/
- The graph tracks modules, functions, types, and their relationships (calls, imports, inherits)
- Use `graphify query "<question>"` to ask questions about the codebase
- Use `graphify path "<A>" "<B>"` to find connections between two concepts

## Keep shared docs in sync

When you add/change/remove endpoints, types, build commands, or dependencies: update the relevant skill file in `/home/guus/code/beebeeb.io/.claude/skills/` (beebeeb-api.md, beebeeb-designs.md, beebeeb-stack.md, beebeeb-dev.md). Other agents depend on these being accurate.
