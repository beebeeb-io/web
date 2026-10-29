#!/usr/bin/env bash
#
# workspace-root.sh — resolve the beebeeb.io WORKSPACE root from a web checkout
# (task 1581). Sourced, never executed:
#
#   source "$WEB_DIR/scripts/lib/workspace-root.sh"
#   WORKSPACE="$(bb_workspace_root "$WEB_DIR")"
#
# Why git's COMMON dir (task 1406): worktrees live outside the workspace
# (`~/code/bb-worktrees/web-NNNN`), so a fixed "../.." offset from the checkout
# lands outside beebeeb.io. The common dir is always the PRIMARY checkout's
# .git, and the primary checkout is <workspace>/repos/web.
#
# The bug this replaces (task 1581): every caller did
#   GIT_COMMON_DIR="$(cd "$WEB_DIR" && git rev-parse --git-common-dir)"
#   PRIMARY_WEB_DIR="$(cd "$GIT_COMMON_DIR/.." && pwd)"
# From a PRIMARY checkout git prints the common dir RELATIVE (".git"), but the
# second `cd` ran in the CALLER's cwd, not in $WEB_DIR. Run from anywhere other
# than repos/web, ".git/.." resolved against that cwd — from the workspace root
# it produced ~/Development/repos/office. A linked worktree hid the bug because
# there git prints an absolute path. Here a relative answer is joined to
# $WEB_DIR explicitly, so the caller's cwd never enters the computation.
#
# Falls back to "$WEB_DIR/../.." when the checkout is not a git repo at all.

bb_workspace_root() {
  local web_dir="$1" common primary
  if common="$(git -C "$web_dir" rev-parse --git-common-dir 2>/dev/null)" && [[ -n "$common" ]]; then
    case "$common" in
      /*) ;;
      *) common="$web_dir/$common" ;;
    esac
    primary="$(cd "$common/.." && pwd)" || return 1
    (cd "$primary/../.." && pwd)
  else
    (cd "$web_dir/../.." && pwd)
  fi
}
