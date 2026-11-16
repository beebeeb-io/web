# PR 198 review fixes — lane l-2237b-B

Owner: Codex l-2237b-B; branch oc/2237b-web; worktree /Users/guuslangelaar/code/bb-worktrees/oc-2237b-web. No other agent owns these edits. Handoff: push tested changes to web #198, post counted evidence, preserve worktree. No production, merges or child agents.

## Design rulings (Guus, 2026-10-28)

“share a folder becomes different than a single file or bunch of files … has an alike folder and file overview as files has right now”

“On the screenshots i think the grid items are too big, so make it smaller” → “More towards 80px”.

Reuse Files presentation primitives for guest name/size/modified rows, file icons and encryption status. Guest grid uses 80px squares, ellipsis and full-name titles, with targets >=44px. Slim Beebeeb header; no owner identity or sidebar. Record these rulings before code changes.

## Fix and verification plan

1. Use core desktop chunk plan for guest uploads, matching server inference; failing chunk-boundary test then >5MiB byte-for-byte owner/second-guest e2e.
2. Preserve server chunk headers in guest byte reader; failing real-WASM multi-frame tests. Zip entries load lazily, one file at a time; bound per-file plaintext and total fallback archive to 128MiB, report every failed entry.
3. Guest folder name sealed to its own random name key, wrapped under shared root; all descendant wraps use shared root. Failing nested decrypt test plus folder e2e owner/second guest.
4. Shared ownership predicate across listing/preview, including guest attribution and shared-root ancestor lookup; failing unit tests and live owner preview.
5. Refresh key index once on miss, evict rejected fetches; failing cache tests plus live guest-after-owner-load e2e.
6. Member rename requires existing wrap (no member master-key guess); validate metadata before write-once adoption and send base64. Owner uploads publish wraps through shared root. Failing tests per behavior.
7. Opened protected-link keys stay in memory; invalid proof clears proof/key and prompts again. Every upload batch includes the remembered encrypted actor name. Failing tests per behavior.
8. Guest Files design and ten screenshots: passphrase/list/grid/after-upload/unavailable at 1280x720 and 390x844. Preserve before images too.

**Verification:** failing regressions before implementation, then bun test (positive count/0 fail), bunx tsc --noEmit exit 0, all three shared-folder Playwright specs plus new cases against local API from server #348. Screenshots saved under /Users/guuslangelaar/code/bb-gate-logs/fullspeed/2237b-guest-*.png. Fresh HEAD gate, diff check, push and PR reply. Logs l-2237b-B-* in that directory.

## Evidence

Started at c9be865999f97435c6a2620bcb434f2eac9c0b38; clean assigned worktree. COMMON normally defers e2e; this lane brief explicitly requires it. Referenced workspace spec found in ws-2236 worktree (not current root).
