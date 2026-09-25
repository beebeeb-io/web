#!/usr/bin/env bash
#
# prod-smoke.sh — driver for the prod-smoke Playwright suite (task 1495).
#
# Drives the WHOLE account lifecycle through the real UI (signup → email
# verification → recovery-phrase confirm → upload/download byte-compare →
# preview → share link opened logged-out → sign out/in → CLI browser handoff
# → bb ls → change password → phrase recovery on a fresh context → delete
# account → login fails / API 401) against ONE throwaway
# `smoke+<run-id>@beebeeb.io` account. See e2e/prod-smoke/prod-smoke.spec.ts
# for the actual steps and playwright.prod-smoke.config.ts for the harness
# config.
#
# Usage:
#   ./scripts/prod-smoke.sh --target local              # safe, isolated, anyone
#   ./scripts/prod-smoke.sh --target local --prove-red  # deliberate byte mismatch (see RED PROOF below)
#   BB_PROD_SMOKE_OK=1 ./scripts/prod-smoke.sh --target prod   # LEAD-AUTHORIZED ONLY — never run by a lane
#
# ── --target local ───────────────────────────────────────────────────────
# Spins up ITS OWN beebeeb-api instance on a free local port (never the
# shared :3001 dev API another session may be using — "never disturb a live
# lane") but points it at the SAME shared dev Postgres
# (`beebeebio-postgres-1`, database `beebeeb`) that the shared dev stack
# uses, by sourcing repos/server/.env for its secrets (OPAQUE_SERVER_SETUP
# etc.) so its secret fingerprints match what's already recorded in that DB.
# This is what makes the task's literal cleanup-proof command work:
#   docker exec beebeebio-postgres-1 psql -U beebeeb -d beebeeb \
#     -Atc "select count(*) from users where email like 'smoke+%'"
# BB_RATE_LIMIT_DISABLED=1 is set explicitly on this instance — never assumed
# from whatever the shared :3001 API happens to be running with. The
# pilot-key gate (BB_REQUIRE_PILOT_KEY) defaults to OFF here too, matching
# prod's actual state since the phase-2 launch (2026-09-25) — set
# BB_REQUIRE_PILOT_KEY=1 explicitly to exercise the gate-on bounce-back path
# instead (see e2e/prod-smoke/prod-smoke.spec.ts step 1).
# Also builds `repos/cli` (origin/main by default, or
# E2E_CLI_REV) from a DISPOSABLE `git worktree add --detach` copy — never the
# primary repos/cli checkout itself (task 1502: building inside the primary
# silently rewrote its Cargo.lock via the local `.cargo/config.toml` core
# patch) — into a SCRATCH target-dir and runs it with an ISOLATED HOME — the
# operator's real ~ holds a live prod CLI session and is never touched.
#
# ── --target prod ────────────────────────────────────────────────────────
# Points Playwright at https://app.beebeeb.io (E2E_NO_WEBSERVER=1, no local
# API/Vite started) and the CLI at the real https://api.beebeeb.io. This is a
# REAL PRODUCTION MUTATION (creates + deletes a real account) — refused
# unless BB_PROD_SMOKE_OK=1 is set, and even then this script does not decide
# to run it; a human does. `--target prod --prove-red` is refused outright —
# the deliberate-corruption RED proof is local-only (see RED PROOF below).
#
# The verification code cannot be supplied up front — it doesn't exist until
# the suite's own step 1 creates the account (task 1495, Codex P1
# prod-smoke.sh:269). Instead this script prints where to write it, and the
# suite POLLS that path for up to 10 minutes once step 2 starts (see
# e2e/prod-smoke/helpers.ts's readVerificationCode, source='file').
#
# ── RED PROOF ─────────────────────────────────────────────────────────────
# --prove-red (equivalently E2E_SMOKE_FORCE_BAD_BYTES=1) flips a byte of the
# downloaded file before the byte-compare in step 3, so that assertion is
# PROVEN load-bearing rather than a tautology (workspace "How we work": a new
# assertion isn't trusted until it's been seen to fail). LOCAL ONLY — refused
# together with --target prod. It also doubles as the CLEANUP proof: the
# forced failure happens well after the account is created but before the
# suite's own step 10 (UI delete-account) ever runs, so a green "0 leftover
# smoke accounts" after a --prove-red run is proof the trap-based cleanup
# below — not the happy-path UI step — did the deleting.
#
# ── Cleanup ───────────────────────────────────────────────────────────────
# Trap-based (EXIT/INT/TERM): stops the isolated API/Vite (by PID only —
# never pkill by name), then:
#   --target local: hard-deletes the run's smoke account directly from the
#     shared DB regardless of where the run stopped (see the `cleanup()`
#     function below for why this is NOT a bare `DELETE FROM users` — several
#     tables lack ON DELETE CASCADE despite user_purge.rs's header comment
#     claiming otherwise). Harmless no-op on the happy path — step 10 already
#     deleted the account via the real UI by then.
#   --target prod: NEVER touches the database directly (task 1495, Codex P1
#     prod-smoke.sh:175 — "prod has no failure cleanup"). If the run's scratch
#     credentials file still exists (meaning step 10 did not run its own
#     delete-account-and-clear-the-file sequence), signs in FRESH with those
#     per-run credentials and performs a REAL soft-delete through the public
#     API — see e2e/prod-smoke/cleanup-account.ts's header for the full
#     mechanism and its documented dependency on task 1501 (the purge-worker
#     FK bug) for the eventual hard purge.

set -euo pipefail

# ── Args ──────────────────────────────────────────────────────────────────

TARGET=""
PROVE_RED=0
while [ $# -gt 0 ]; do
  case "$1" in
    --target) TARGET="${2:-}"; shift 2 ;;
    --target=*) TARGET="${1#*=}"; shift ;;
    --prove-red) PROVE_RED=1; shift ;;
    -h|--help)
      sed -n '1,40p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "unknown argument: $1 (usage: $0 --target local|prod [--prove-red])" >&2; exit 1 ;;
  esac
done
case "$TARGET" in
  local|prod) ;;
  *) echo "usage: $0 --target local|prod [--prove-red]" >&2; exit 1 ;;
esac
if [ "$TARGET" = "prod" ] && [ "$PROVE_RED" = "1" ]; then
  echo "refusing --target prod --prove-red: this would deliberately corrupt a download from a" >&2
  echo "REAL production account just to prove step 3's assertion is load-bearing — that proof" >&2
  echo "is local-only. Run '$0 --target local --prove-red' instead (task 1495)." >&2
  exit 1
fi
[ "$PROVE_RED" = "1" ] && export E2E_SMOKE_FORCE_BAD_BYTES=1

log() { printf '\033[35m[prod-smoke]\033[0m %s\n' "$*"; }

# ── Load guard (shared machine — another session's build/sim fleet may be
#    running; never proceed into a build/test step at load >= 60) ──────────
wait_for_load() {
  local waited=0 load1
  while true; do
    load1="$(sysctl -n vm.loadavg | awk '{print int($2)}')"
    [ "$load1" -lt 60 ] && return 0
    if [ "$waited" -ge 1800 ]; then
      echo "[prod-smoke] BLOCKED: load average still >= 60 after 30 minutes (last observed: $load1). Not proceeding — another session's build/sim fleet is likely running." >&2
      exit 3
    fi
    log "load average $load1 >= 60 — waiting 60s before the next build/test step…"
    sleep 60
    waited=$((waited + 60))
  done
}

# ── Paths ─────────────────────────────────────────────────────────────────

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$WEB_DIR"

# Resolve the beebeeb.io WORKSPACE root via git's COMMON dir (same trick as
# e2e/scripts/web-e2e.sh) — this script's checkout is normally a `git
# worktree add` worktree OUTSIDE the workspace entirely (task 1495's own
# mandatory first step: ~/code/bb-worktrees/web-NNNN), so a fixed "../.."
# offset from here would resolve outside beebeeb.io altogether.
if GIT_COMMON_DIR="$(cd "$WEB_DIR" && git rev-parse --git-common-dir 2>/dev/null)"; then
  PRIMARY_WEB_DIR="$(cd "$GIT_COMMON_DIR/.." && pwd)"
  WORKSPACE="$(cd "$PRIMARY_WEB_DIR/../.." && pwd)"
else
  WORKSPACE="$(cd "$WEB_DIR/../.." && pwd)"
fi
SERVER_DIR="$WORKSPACE/repos/server"
CLI_DIR="$WORKSPACE/repos/cli"
API_BIN="${E2E_API_BIN:-$SERVER_DIR/target/debug/beebeeb-api}"

RUN_ID="${E2E_SMOKE_RUN_ID:-$(date +%s)-$RANDOM}"
SMOKE_EMAIL="smoke+${RUN_ID}@beebeeb.io"
export E2E_SMOKE_RUN_ID="$RUN_ID"

PSQL_CONTAINER="${E2E_PG_CONTAINER:-beebeebio-postgres-1}"
# -i: forwards this script's stdin into the container — required for the
# heredoc-piped cleanup DO block below (`docker exec` without -i never
# connects stdin, so a piped psql script silently reads nothing).
db_psql() { docker exec -i -e PGPASSWORD=beebeeb_dev "$PSQL_CONTAINER" psql -U beebeeb "$@"; }

SCRATCH_DIR="$WEB_DIR/.prod-smoke-scratch/$RUN_ID"
mkdir -p "$SCRATCH_DIR"

# Scratch credentials handoff (task 1495, Codex P1 prod-smoke.sh:175) — the
# run's spec (prod-smoke.spec.ts) writes {email, password} here right after
# signup and again right after the password change, and deletes the file as
# the LAST action of its own successful step 10. Only wired up (exported) for
# --target prod below; --target local's spec sees the env var unset and
# never writes it, since local cleanup below deletes straight from the DB.
CRED_FILE="$SCRATCH_DIR/prod-credentials.json"

API_PID=""
VITE_PID=""
# Disposable `git worktree add --detach` checkout of repos/cli that build_cli()
# compiles the CLI from (task 1502) — set as soon as the worktree is created
# so cleanup() can always remove it, even if the build itself then fails.
CLI_WORKTREE_PATH=""

# Guards re-entrancy: a signal-triggered trap (INT/TERM) calls `exit` at the
# end of cleanup(), which itself fires the EXIT trap again — without this
# flag cleanup() (and its DB DELETE) runs twice per invocation.
CLEANUP_DONE=0

cleanup() {
  local rc=$?
  [ "$CLEANUP_DONE" = "1" ] && exit "$rc"
  CLEANUP_DONE=1
  log "cleaning up (exit code so far: $rc)…"
  # Kill only PIDs THIS script started, never by name (workspace CLAUDE.md:
  # "never pkill by name" — a lane's `pkill -f beebeeb-api` once killed the
  # shared dev API on :3001).
  if [ -n "$VITE_PID" ]; then kill -- -"$VITE_PID" 2>/dev/null || kill "$VITE_PID" 2>/dev/null || true; fi
  if [ -n "$API_PID" ]; then kill -- -"$API_PID" 2>/dev/null || kill "$API_PID" 2>/dev/null || true; fi
  sleep 1

  # Remove the disposable cli worktree (task 1502) — `git worktree remove`
  # (not a bare `rm -rf`) so the PRIMARY repos/cli checkout's
  # .git/worktrees/<name> administrative entry is cleaned up promptly rather
  # than left dangling until a future `git worktree prune`.
  if [ -n "$CLI_WORKTREE_PATH" ]; then
    log "removing disposable cli worktree ${CLI_WORKTREE_PATH}…"
    git -C "$CLI_DIR" worktree remove --force "$CLI_WORKTREE_PATH" 2>/dev/null || {
      rm -rf "$CLI_WORKTREE_PATH" 2>/dev/null || true
      git -C "$CLI_DIR" worktree prune 2>/dev/null || true
    }
  fi

  # Trap-based account cleanup (see header) — runs unconditionally, hits the
  # shared DB directly, independent of whether the suite's own step 10
  # (UI delete-account) ever ran.
  #
  # A bare `DELETE FROM users` is NOT enough: several tables that a real
  # signup/upload/session flow populates reference users(id) WITHOUT
  # ON DELETE CASCADE (found the hard way — `sync_ops.user_id` is NO ACTION,
  # despite user_purge.rs's header comment claiming "ON DELETE CASCADE for
  # all foreign keys"; a live FK audit turned up ~20 more: files.uploaded_by,
  # shares.created_by, stream_tokens.user_id, invoices.user_id, etc). Rather
  # than hardcode that table list (liable to drift as the schema grows), this
  # introspects information_schema for every non-CASCADE FK pointing at
  # users(id) and deletes the dependent rows first, in one transaction, then
  # the user row itself. Verified against a real leftover row while building
  # this harness (task 1495 notes).
  if [ "$TARGET" = "local" ]; then
    # UNQUOTED heredoc (<<SQL, not <<'SQL') so bash substitutes $SMOKE_EMAIL —
    # deliberately NOT psql's `-v`/`:'var'` substitution: verified live
    # (task 1495 notes) that psql does NOT perform `:'var'` interpolation
    # INSIDE a dollar-quoted ($$...$$) PL/pgSQL body (it recognizes
    # dollar-quoting as a literal context precisely so a body containing
    # its own colons isn't corrupted) — that first attempt round-tripped
    # with no substitution and errored "syntax error at or near \":\"".
    # $SMOKE_EMAIL is program-generated (smoke+<run-id>@beebeeb.io) and can
    # never contain a quote, so direct interpolation is safe. The PL/pgSQL
    # `$$` body-quoting and the `format(...)`'s `$1` placeholder are escaped
    # (\$\$, \$1) so BASH doesn't touch them and psql receives them literally.
    db_psql -d beebeeb <<SQL >/dev/null 2>&1 || true
DO \$\$
DECLARE
  uid uuid;
  r RECORD;
BEGIN
  SELECT id INTO uid FROM users WHERE email = '$SMOKE_EMAIL';
  IF uid IS NULL THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT tc.table_name AS tbl, kcu.column_name AS col
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name AND tc.table_schema = rc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'users'
      AND rc.delete_rule <> 'CASCADE'
      AND tc.table_name <> 'users'
  LOOP
    EXECUTE format('DELETE FROM %I WHERE %I = \$1', r.tbl, r.col) USING uid;
  END LOOP;
  DELETE FROM users WHERE id = uid;
END \$\$;
SQL
    local left
    left="$(db_psql -d beebeeb -Atc "select count(*) from users where email = '$SMOKE_EMAIL'" 2>/dev/null || echo '?')"
    log "leftover rows for $SMOKE_EMAIL after cleanup: $left"
  fi

  # --target prod: NEVER a direct DB mutation (task 1495, Codex P1
  # prod-smoke.sh:175). If the scratch credentials file still exists, the
  # run did not reach its own step 10 (which deletes it as the LAST action of
  # a successful UI account deletion) — sign in fresh and delete through the
  # real API. See e2e/prod-smoke/cleanup-account.ts's header for the full
  # mechanism; this is a best-effort soft delete, not fatal to the run's own
  # exit code if it fails (logged loudly either way).
  if [ "$TARGET" = "prod" ]; then
    if [ -f "$CRED_FILE" ]; then
      log "prod credentials file present — the account may still exist; running API-based cleanup delete…"
      if E2E_SMOKE_CREDENTIALS_FILE="$CRED_FILE" bun run "$WEB_DIR/e2e/prod-smoke/cleanup-account.ts"; then
        log "cleanup-account.ts succeeded."
      else
        log "cleanup-account.ts FAILED — the account may still exist in production for $SMOKE_EMAIL. Check manually."
      fi
    else
      log "no prod credentials file at $CRED_FILE — nothing to clean up (step 10 already deleted the account, or the run never reached signup)."
    fi
  fi

  rm -rf "$SCRATCH_DIR" 2>/dev/null || true
  rm -f "$WEB_DIR/.env.test.local" 2>/dev/null || true
  log "cleanup done."
  exit "$rc"
}
trap cleanup EXIT INT TERM

# macOS has no `setsid` (util-linux); fall back to a plain exec so $! is the
# real child PID (matches e2e/scripts/web-e2e.sh's shim).
if ! command -v setsid >/dev/null 2>&1; then
  setsid() { exec "$@"; }
fi

# ── Build the CLI from a DISPOSABLE `git worktree add --detach` copy of
#    repos/cli — never inside the primary repos/cli checkout itself. ───────
#
# (task 1502) The previous version ran `cargo build` directly inside
# CLI_DIR. repos/cli/.cargo/config.toml is gitignored, local-dev-only, and
# `[patch]`es the beebeeb-core/beebeeb-types git dependency to `../core` — so
# every build inside the primary checkout silently REWROTE its Cargo.lock,
# dropping the `source = "git+https://github.com/beebeeb-io/core?rev=…"`
# lines for both crates (seen red below: reproduced on 2026-09-23's harness
# run and again while fixing this task — see the diff in the task's Notes).
# The lead had to hand-restore it with `git checkout -- Cargo.lock` both
# times, and nothing stopped a THIRD accidental rewrite from ever landing.
#
# Fix: `git worktree add --detach` a throwaway checkout of repos/cli into
# SCRATCH_DIR and build there. A worktree shares the parent repo's objects
# and refs but is a SEPARATE working tree with its own (nonexistent)
# .cargo/config.toml — so it builds against the beebeeb-core GIT DEPENDENCY,
# not a local path patch, exactly like CI and the release build do. That is
# deliberate: this harness is meant to smoke-test what actually ships, and a
# fresh worktree gives us that for free instead of having to reason about
# whether `cargo build --locked` would also refuse to rewrite the lock under
# the patch (untested; the worktree sidesteps the question entirely).
build_cli() {
  wait_for_load

  # Snapshot the primary checkout's HEAD + working-tree status before
  # touching anything, so the post-build assertion below has a baseline
  # (see that assertion for why: `git worktree add` on the primary's own
  # repo must not perturb either).
  local cli_head_before cli_status_before
  cli_head_before="$(git -C "$CLI_DIR" rev-parse HEAD)"
  cli_status_before="$(git -C "$CLI_DIR" status --porcelain)"

  # <rev> defaults to origin/main (CI-identical); E2E_CLI_REV pins a specific
  # commit instead (e.g. to reproduce a specific harness run).
  local cli_rev="${E2E_CLI_REV:-}"
  if [ -z "$cli_rev" ]; then
    log "fetching origin/main for repos/cli (updates only .git/refs/remotes — never the primary checkout's tracked files or HEAD)…"
    git -C "$CLI_DIR" fetch --quiet origin main \
      || { echo "git fetch origin main failed in $CLI_DIR" >&2; exit 1; }
    cli_rev="$(git -C "$CLI_DIR" rev-parse origin/main)"
  fi

  local cli_src="$SCRATCH_DIR/cli-src"
  # Set the global BEFORE calling `git worktree add`, not after (Codex P2 on
  # PR #62): if SIGINT/SIGTERM lands while the checkout is still running — or
  # in the gap between it returning and the assignment — the EXIT/INT/TERM
  # trap fires with CLI_WORKTREE_PATH still empty, cleanup() skips `git
  # worktree remove`, and the primary repos/cli's `.git/worktrees/<name>`
  # registration is left dangling once the scratch dir is rm -rf'd out from
  # under it (a retry reusing the same RUN_ID/path would then fail outright).
  # Safe to assign early: cleanup()'s `git worktree remove --force
  # "$CLI_WORKTREE_PATH"` simply fails (2>/dev/null) and falls through to
  # rm -rf + prune when nothing was ever registered at that path.
  CLI_WORKTREE_PATH="$cli_src"
  log "checking out disposable cli worktree @ $cli_rev into ${cli_src}…"
  git -C "$CLI_DIR" worktree add --detach --quiet "$cli_src" "$cli_rev" \
    || { echo "git worktree add failed for $cli_src @ $cli_rev" >&2; exit 1; }

  log "building bb CLI (repos/cli @ $(git -C "$cli_src" rev-parse --short HEAD), git-dependency build, no local core patch) into scratch target-dir…"
  ( cd "$cli_src" && cargo build --target-dir "$SCRATCH_DIR/cli-target" ) \
    || { echo "cli build failed — see output above" >&2; exit 1; }
  CLI_BIN_PATH="$SCRATCH_DIR/cli-target/debug/bb"
  [ -x "$CLI_BIN_PATH" ] || { echo "cli binary missing after build: $CLI_BIN_PATH" >&2; exit 1; }
  CLI_HOME_DIR="$SCRATCH_DIR/cli-home"
  mkdir -p "$CLI_HOME_DIR"
  log "cli binary: $CLI_BIN_PATH · isolated HOME: $CLI_HOME_DIR"

  # Post-run assertion (task 1502's declared Verification): the primary
  # repos/cli checkout must come out of this build byte-for-byte as it went
  # in — neither its HEAD nor its working-tree status may have moved. This
  # is what makes the fix a proof, not just a belief that worktrees are
  # isolated.
  local cli_head_after cli_status_after
  cli_head_after="$(git -C "$CLI_DIR" rev-parse HEAD)"
  cli_status_after="$(git -C "$CLI_DIR" status --porcelain)"
  if [ "$cli_head_after" != "$cli_head_before" ] || [ "$cli_status_after" != "$cli_status_before" ]; then
    echo "FATAL (task 1502 regression): the primary repos/cli checkout was touched by the CLI build." >&2
    echo "  HEAD before=$cli_head_before after=$cli_head_after" >&2
    echo "  status before=[$cli_status_before] after=[$cli_status_after]" >&2
    exit 1
  fi
}

# ═══════════════════════════════════════════════════════════════════════════
# --target prod (LEAD-AUTHORIZED ONLY — this script never invokes this path
# on its own; a human runs it)
# ═══════════════════════════════════════════════════════════════════════════
if [ "$TARGET" = "prod" ]; then
  if [ "${BB_PROD_SMOKE_OK:-0}" != "1" ]; then
    echo "refusing --target prod: this is a real production mutation (creates + deletes a real account)." >&2
    echo "set BB_PROD_SMOKE_OK=1 to proceed — lead-authorized only, see task 1495." >&2
    exit 1
  fi
  log "*** PROD TARGET — real production mutation, lead-authorized (BB_PROD_SMOKE_OK=1) ***"
  log "smoke account: $SMOKE_EMAIL"

  export E2E_WEB_URL="https://app.beebeeb.io"
  export E2E_NO_WEBSERVER=1
  export E2E_VERIFICATION_SOURCE="file"
  export E2E_PROD_VERIFICATION_CODE_FILE="$SCRATCH_DIR/verification-code"
  export E2E_CLI_API_URL="${E2E_CLI_API_URL:-https://api.beebeeb.io}"
  export E2E_SMOKE_CREDENTIALS_FILE="$CRED_FILE"

  # The verification code doesn't exist until the suite's own step 1 creates
  # the account — no way to supply it up front (Codex P1, prod-smoke.sh:269).
  # Step 2 polls the path below for up to 10 minutes instead of failing
  # immediately; this just prints where, early, so it's not a silent wait.
  log "PROD VERIFICATION CODE: once step 1 (signup) completes, look up the 6-digit code sent to $SMOKE_EMAIL and write it to:"
  log "  $E2E_PROD_VERIFICATION_CODE_FILE"
  log "  e.g.: echo 123456 > '$E2E_PROD_VERIFICATION_CODE_FILE'"
  log "Step 2 waits up to 10 minutes for that file — this run will NOT fail immediately if it's not there yet."

  build_cli
  export E2E_CLI_BIN="$CLI_BIN_PATH"
  export E2E_CLI_HOME="$CLI_HOME_DIR"

  wait_for_load
  log "running prod-smoke suite against PRODUCTION (account=$SMOKE_EMAIL)…"
  set +e
  bunx playwright test --config=playwright.prod-smoke.config.ts 2>&1 | tee "$SCRATCH_DIR/playwright.log"
  rc=${PIPESTATUS[0]}
  set -e
  log "playwright exit code: $rc"
  exit "$rc"
fi

# ═══════════════════════════════════════════════════════════════════════════
# --target local
# ═══════════════════════════════════════════════════════════════════════════

[ -x "$API_BIN" ] || { echo "debug binary missing: $API_BIN — build with: (cd $SERVER_DIR && cargo build -p beebeeb-api)" >&2; exit 1; }
[ -f "$SERVER_DIR/.env" ] || {
  echo "missing $SERVER_DIR/.env — this harness reuses the shared dev API's secrets" >&2
  echo "(OPAQUE_SERVER_SETUP etc.) so its fingerprint matches the shared 'beebeeb' DB. See .env.example." >&2
  exit 1
}

API_PORT="${E2E_SMOKE_API_PORT:-3011}"
VITE_PORT="${E2E_SMOKE_VITE_PORT:-5183}"
port_free() { ! lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }
port_free "$API_PORT" || { echo "port $API_PORT is already in use — set E2E_SMOKE_API_PORT to a free one" >&2; exit 1; }
port_free "$VITE_PORT" || { echo "port $VITE_PORT is already in use — set E2E_SMOKE_VITE_PORT to a free one" >&2; exit 1; }

log "smoke account: $SMOKE_EMAIL · API :$API_PORT · web :$VITE_PORT"

wait_for_load
log "bun install --frozen-lockfile"
bun install --frozen-lockfile || { echo "bun install failed — check the lockfile" >&2; exit 1; }

# Mailpit (dev mail sink, task 1448) — idempotent; usually already running.
docker compose -f "$WORKSPACE/docker-compose.yml" up -d mailpit >/dev/null 2>&1 || true

# ── Start the isolated API instance, secrets sourced from the shared .env ──
# Capture the CALLER's pilot-gate choice before .env is sourced: a
# BB_REQUIRE_PILOT_KEY line in $SERVER_DIR/.env must never override an explicit
# override on the command line (Codex P2, web PR #71).
CALLER_BB_REQUIRE_PILOT_KEY="${BB_REQUIRE_PILOT_KEY-}"
set -a
# shellcheck disable=SC1091
source "$SERVER_DIR/.env"
set +a
export BB_PORT="$API_PORT"
export CORS_ORIGINS="http://localhost:$VITE_PORT"
export APP_URL="http://localhost:$VITE_PORT"
export BLOB_STORE=local
export BLOB_STORE_PATH="$SCRATCH_DIR/blobs"
mkdir -p "$BLOB_STORE_PATH"
# Mailpit takes no auth. `SMTP_USER`/`SMTP_PASS` MUST be cleared even though
# the sourced .env sets them (real-relay credentials for the shared :3001
# dev API) — email.rs only skips AUTH when BOTH are empty; leaving either
# set sends Mailpit an AUTH command it never advertised and every send fails
# with "No compatible authentication mechanism was found" (found the hard
# way: step 2's verification email silently never arrived — see task 1495
# notes). This does not touch repos/server/.env itself.
export SMTP_HOST=localhost SMTP_PORT=1025 SMTP_TLS_MODE=none SMTP_USER= SMTP_PASS=
# Same file the shared :3001 dev API writes to — reusing it means an
# identical-secrets boot here never CRITICAL-logs a fingerprint mismatch.
export SECRET_FINGERPRINTS_PATH="$SERVER_DIR/data/.secret-fingerprints"
export BB_RATE_LIMIT_DISABLED=1
# Default to the PROD state (gate OFF) rather than forcing it on — prod has
# run BB_REQUIRE_PILOT_KEY=0 on both nodes since the phase-2 launch
# (2026-09-25). An explicit `BB_REQUIRE_PILOT_KEY=1` in the calling
# environment overrides this default to exercise the gate-on bounce-back
# path instead (prod-smoke.spec.ts step 1 handles both states).
export BB_REQUIRE_PILOT_KEY="${CALLER_BB_REQUIRE_PILOT_KEY:-0}"
export BB_PILOT_SIGNUP_KEY="${BB_PILOT_SIGNUP_KEY:-test-pilot-key}"
# Kept in lockstep with the server-side key (mirrors e2e/scripts/web-e2e.sh) —
# e2e/helpers/signup.ts's PILOT_KEY constant reads BB_TEST_PILOT_KEY, which
# defaults to the same 'test-pilot-key' literal, but set it explicitly so a
# future default change on either side can't silently drift out of lockstep.
export BB_TEST_PILOT_KEY="$BB_PILOT_SIGNUP_KEY"

wait_for_load
log "starting isolated beebeeb-api on :$API_PORT (shared DB, isolated port+blobs+CORS)…"
setsid "$API_BIN" >"$SCRATCH_DIR/api.log" 2>&1 &
API_PID=$!
api_healthy=0
for _ in $(seq 1 60); do
  if curl -fsS -m5 -o /dev/null "http://localhost:$API_PORT/health"; then api_healthy=1; break; fi
  kill -0 "$API_PID" 2>/dev/null || { echo "API died on boot; see $SCRATCH_DIR/api.log" >&2; tail -40 "$SCRATCH_DIR/api.log" >&2; exit 1; }
  sleep 1
done
[ "$api_healthy" = "1" ] || { echo "API never became healthy on :$API_PORT; see $SCRATCH_DIR/api.log" >&2; tail -40 "$SCRATCH_DIR/api.log" >&2; exit 1; }
log "API healthy on :$API_PORT"

# ── Start Vite pointed at the isolated API (same NODE_ENV=test defense as
#    e2e/scripts/web-e2e.sh — see that script's comment for why both layers
#    are needed to keep bun's auto-dotenv from leaking :3001 in). ──────────
printf 'VITE_API_URL=http://localhost:%s\n' "$API_PORT" > "$WEB_DIR/.env.test.local"
setsid bash -c "cd '$WEB_DIR' && NODE_ENV=test VITE_API_URL='http://localhost:$API_PORT' exec bunx vite --mode test --port $VITE_PORT --strictPort" >"$SCRATCH_DIR/vite.log" 2>&1 &
VITE_PID=$!
vite_healthy=0
for _ in $(seq 1 60); do
  if curl -fsS -m3 -o /dev/null "http://localhost:$VITE_PORT"; then vite_healthy=1; break; fi
  kill -0 "$VITE_PID" 2>/dev/null || { echo "vite died on boot; see $SCRATCH_DIR/vite.log" >&2; tail -40 "$SCRATCH_DIR/vite.log" >&2; exit 1; }
  sleep 1
done
[ "$vite_healthy" = "1" ] || { echo "vite never became healthy on :$VITE_PORT; see $SCRATCH_DIR/vite.log" >&2; tail -40 "$SCRATCH_DIR/vite.log" >&2; exit 1; }
log "vite up on :$VITE_PORT"

build_cli

export E2E_WEB_URL="http://localhost:$VITE_PORT"
export E2E_API_URL="http://localhost:$API_PORT"
export E2E_NO_WEBSERVER=1
export E2E_MAILPIT_URL="http://localhost:8025"
export E2E_VERIFICATION_SOURCE="mailpit"
export E2E_CLI_BIN="$CLI_BIN_PATH"
export E2E_CLI_HOME="$CLI_HOME_DIR"
export E2E_CLI_API_URL="http://localhost:$API_PORT"

wait_for_load
log "running prod-smoke suite (target=local, account=$SMOKE_EMAIL)$([ "$PROVE_RED" = 1 ] && echo ' [--prove-red: byte-compare WILL be mutated]')…"
set +e
bunx playwright test --config=playwright.prod-smoke.config.ts 2>&1 | tee "$SCRATCH_DIR/playwright.log"
rc=${PIPESTATUS[0]}
set -e
log "playwright exit code: $rc"
grep -E '[0-9]+ (passed|failed|skipped)' "$SCRATCH_DIR/playwright.log" | tail -5 || true
exit "$rc"
