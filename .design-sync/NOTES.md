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
- The product names in the `BBProductIcon` / `BBProductLockup` previews (Drive, Pass, VPN, Mail, Chat) come from the lockup spec (`design/system/cards/products-lockups.html`), not from `src/`: the web app ships Drive only. The lockup header's "Share" is shipped copy.
- Billing chips follow `statusVariant` in `src/components/billing/TransactionList.tsx`: paid green, pending/open amber, failed red.

## Known render warns
- `BBProductLockup` at 40 px and below: the mono label sits on its 9 px floor, so it is small next to the wordmark. Graded good (whole, aligned, legible); it is the ruled layout, and the doc points smaller uses at `BBProductIcon`.
- Skeleton cards are low-contrast (`bg-paper-2` on `bg-paper`, `animate-pulse`); that is the shipped look, not a blank render.
- `BBButton` and `BBInput` "Disabled" cells look the same as enabled: neither component has disabled styling in code. Graded good as a faithful render; the gap is a product finding (see below).
- Nine wide components use `cardMode: column` (the row skeletons, CardSkeleton, PhotoGroupSkeleton, Icon, BBLogo, BBProductIcon, BBProductLockup).

## Findings in the shipped code (not fixed here)
- `BBButton` and `BBInput` have no disabled styles.
- ~~The `key` icon draws a stray line~~ (design PR beebeeb-io/workspace#488, `_shots/defect-key-icon-split.png`): fixed in the shared `Icon` by task 2322 (one `<path>` per glyph; the split at `z` cut the relative `m0 0` loose from its start point). The web app's own `src/components/icons.tsx` is a divergent copy with the same split, so its `key` would still draw the line; none of its 10 importers renders `key` today (checked 2026-11-02), it is not part of the sync and was not touched.
- `BBLogo` renders the wordmark as live text, while the brand rule says the mark comes from `repos/core/brand/` as paths.
- `BBProductIcon` / `BBProductLockup` (task 2322) restate the geometry of `repos/core/brand/products/build.py` as constants; the web test run does not read core, so a change to the generator needs the same numbers here (checked once, 2026-11-02: all 10 icons pixel-identical at 512).

## Re-sync risks
- `buildCmd` pins Tailwind 4.3.0 by hand: when `bun.lock` moves, update it, or the compiled classes drift from the product.
- The previews and docs quote product copy; when the product copy changes they go stale silently.
- `tokens.css` is the shared source; web's `src/index.css` repeats the same theme plus `--color-canvas-dark` and app-only classes (`.auth-bg`, `.upload-glow`) that are NOT in the sync.
- First sync, 2026-11-02 (re-adopted project, no anchor): Guus approved deleting 69 hand-made files that predate the sync (SKILL.md, colors_and_type.css with old `--paper`-style names, preview/, ui_kits/, _temp/, the source copies in assets/). Kept on purpose: the 11 brand images in `assets/` (logo, icon, favicons, app screenshots, X header PNGs) and `uploads/`. They are not produced by this build: never put them in a delete list.
