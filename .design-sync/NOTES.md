# design-sync notes: @beebeeb/shared → Claude Design ("Beebeeb Design System")

## How this repo builds
- The package (`packages/shared`) has no build and no dist: the converter runs in synth-entry mode from `packages/shared/src/` (`--node-modules ./node_modules`, no `--entry`).
- The components are styled with Tailwind 4 utility classes, so there is no shipped stylesheet. `cfg.buildCmd` compiles `.design-sync/tailwind-entry.css` with the web app's own Tailwind version (4.3.0, from `bun.lock`) into `packages/shared/.ds-css/beebeeb.css` (gitignored), and `cfg.cssEntry` points at it. **Run `buildCmd` before every converter run** (new classes in previews only resolve after it), then a full `package-build.mjs`: `preview-rebuild.mjs` does not refresh `_ds_bundle.css`.
- The entry uses `@import "tailwindcss" source(none)` plus explicit `@source` lines (index.html, `packages/shared/src`, `src`, `.design-sync/previews`). Automatic source detection scanned the whole repo and pulled in Tailwind's default serif stack, which fired `[FONT_MISSING] "Cambria"`.
- Paths in the config resolve from the symlink `node_modules/@beebeeb/shared`, not from `packages/shared`: `extraFonts` is `../../@fontsource/...`, `docsDir` is `../../../.design-sync/docs`.
- Fonts come from the same `@fontsource` files `src/index.css` imports (Inter 400/500/600/700, JetBrains Mono 400/500, every subset).
- The three error classes in `src/api/errors.ts` are excluded via `componentSrcMap` (they are PascalCase exports, not components).
- Groups come from the `category` frontmatter in `.design-sync/docs/<Name>.md`: Actions, Forms, Status, Brand, Icons, Loading.
- Playwright: 1.60.0 matches the cached Chromium 1223 on this Mac; install it into `.ds-sync/` only (`npm i playwright@1.60.0`), never into the repo.

## Preview copy
- Every string in the previews and docs is shipped copy from `src/` (checked with grep), so the design agent imitates real wording. Two invented lines were caught and replaced: the activity-tracking description (the shipped setting does log file activity) and an encryption tagline. Re-check copy against `src/` when editing a preview.
- Billing chips follow `statusVariant` in `src/components/billing/TransactionList.tsx`: paid green, pending/open amber, failed red.

## Known render warns
- Skeleton cards are low-contrast (`bg-paper-2` on `bg-paper`, `animate-pulse`); that is the shipped look, not a blank render.
- `BBButton` and `BBInput` "Disabled" cells look the same as enabled: neither component has disabled styling in code. Graded good as a faithful render; the gap is a product finding (see below).
- Seven wide components use `cardMode: column` (the row skeletons, CardSkeleton, PhotoGroupSkeleton, Icon, BBLogo).

## Findings in the shipped code (not fixed here)
- `BBButton` and `BBInput` have no disabled styles.
- The `key` icon draws a stray line (design PR beebeeb-io/workspace#488, `_shots/defect-key-icon-split.png`).
- `BBLogo` renders the wordmark as live text, while the brand rule says the mark comes from `repos/core/brand/` as paths.

## Re-sync risks
- `buildCmd` pins Tailwind 4.3.0 by hand: when `bun.lock` moves, update it, or the compiled classes drift from the product.
- The previews and docs quote product copy; when the product copy changes they go stale silently.
- `tokens.css` is the shared source; web's `src/index.css` repeats the same theme plus `--color-canvas-dark` and app-only classes (`.auth-bg`, `.upload-glow`) that are NOT in the sync.
- The project held hand-made files before the first sync (preview/, ui_kits/, assets/, ...); the first upload's deletes were reviewed with Guus, see the git log of this file.
