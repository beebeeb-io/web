# Beebeeb web 1.1.0

This minor release collects the current web client into a named release, including
its file, sharing, version-history and security improvements. This release commit
changes version metadata and notes; dependencies, shared code and committed WASM
remain unchanged from functional source `0a21b1e9`. Deployment is not yet verified.

### What's New

- The app and upload-writer provenance identify the client as version 1.1.0.
  `/version.json` separately identifies the exact deployed commit and build time.
- Current main includes encrypted file and note readers, sharing, version history
  and server-provided country choices for storage preferences. This version bump
  enables no new transfer protocol or feature flag.

### Bug Fixes / Hardening

- Existing step-up confirmation uses OPAQUE for OPAQUE accounts; the legacy
  authentication fallback remains supported.
- Existing fixes cover paginated trash actions, file-detail move/star/trash actions
  and server-provided security activity. See the dated changelog for details.
- Encryption formats, API contracts and the committed WASM are preserved.

### Verification

- Functional source `0a21b1e98b1ec787c3b7bbda6d91c4bbe7431d6a`: 2,619 passed,
  0 failed across 203 unit-test files. Reversed, shuffled (seed 1590) and isolated
  file runs each total 2,619 passed / 0 failed. Typecheck and production bundle
  build exited 0; 1,215 modules were transformed.
- Those tests/build ran with OS network denial. Its probe failed at the intended
  assertion when network access was deliberately allowed, then passed with denial
  restored. The initial environment-fixture failure remains in the evidence.
- Fresh version-metadata build: typecheck, Vite and WASM integrity generation
  exited 0; 1,215 modules were transformed with OS network denial. Frozen install
  exited 0 and the lockfile is unchanged. The functional unit counts above are
  not represented as a new test run of this release commit.
- Browser/WASM startup and authenticated server interaction remain release gates.
  The informational hosted E2E job failed at server checkout before browser tests;
  its overall workflow status does not prove full-stack compatibility.

The [canonical performance and release report](https://github.com/beebeeb-io/workspace/blob/codex/2165-full-main-release-20261024/docs/perf/2026-10-performance-report.md)
links the counted evidence and remaining release gates. Server performance numbers
in that report are not browser throughput measurements.

### Install / update

Use the normal web deployment after the API release passes its schema/accounting
cutover and compatibility smoke. Verify the deployed SHA on both nodes, retain the
previous image, and check browser startup plus upload/download/share behavior.
The web app updates on reload after deployment; these notes do not claim that
deployment or browser smoke has occurred.

[Full changelog](https://github.com/beebeeb-io/web/compare/v1.0.0...v1.1.0)
