#!/usr/bin/env bash
#
# Update the `main` branch of every app checked out under apps/.
#
# Usage: ./update-apps.sh [remote]
#        ./update-apps.sh --remote upstream
#
# `remote` is the git remote each app's main branch is pulled from (default: origin).
#
# For every git repository directly under apps/ the script will:
#   * fetch from the given remote
#   * fast-forward `main` to <remote>/main
#       - by pulling, when `main` is the checked out branch
#       - by updating the ref in place, when another branch is checked out
#   * skip (with a reason) when the app has no such remote, has uncommitted
#     changes on main, or when main cannot be fast-forwarded
#
# Nothing is ever force-updated, rebased or merged non-fast-forward, so local
# work is never discarded.

set -uo pipefail

MAIN_BRANCH="main"
REMOTE="origin"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APPS_DIR="$SCRIPT_DIR/apps"

if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; YELLOW=""; DIM=""; RESET=""
fi

usage() {
  cat <<EOF
Usage: $(basename "$0") [remote]

Fast-forwards the '$MAIN_BRANCH' branch of every app under apps/ from the given remote.

Arguments:
  remote            Name of the remote to pull '$MAIN_BRANCH' from (default: $REMOTE)

Options:
  -r, --remote NAME Same as passing the remote positionally
  -h, --help        Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -h|--help)
      usage
      exit 0
      ;;
    -r|--remote)
      if [ $# -lt 2 ] || [ -z "$2" ]; then
        echo "${RED}error:${RESET} $1 requires a remote name" >&2
        exit 2
      fi
      REMOTE="$2"
      shift 2
      ;;
    -*)
      echo "${RED}error:${RESET} unknown option '$1'" >&2
      usage >&2
      exit 2
      ;;
    *)
      REMOTE="$1"
      shift
      ;;
  esac
done

if [ ! -d "$APPS_DIR" ]; then
  echo "${RED}error:${RESET} apps directory not found at $APPS_DIR" >&2
  exit 1
fi

updated=()
skipped=()
failed=()

log_skip() {
  # $1 = app, $2 = reason
  echo "  ${YELLOW}skipped${RESET} — $2"
  skipped+=("$1 ($2)")
}

log_fail() {
  # $1 = app, $2 = reason
  echo "  ${RED}failed${RESET} — $2"
  failed+=("$1 ($2)")
}

echo "${BOLD}Updating '$MAIN_BRANCH' in $APPS_DIR from remote '$REMOTE'${RESET}"
echo

for app_path in "$APPS_DIR"/*/; do
  app_path="${app_path%/}"
  app="$(basename "$app_path")"

  # apps/ holds independently cloned repos; ignore anything that is not one.
  if ! git -C "$app_path" rev-parse --git-dir >/dev/null 2>&1; then
    continue
  fi

  echo "${BOLD}$app${RESET}"

  if ! git -C "$app_path" remote get-url "$REMOTE" >/dev/null 2>&1; then
    log_skip "$app" "no remote named '$REMOTE'"
    continue
  fi

  if ! git -C "$app_path" fetch --prune "$REMOTE" >/dev/null 2>&1; then
    log_fail "$app" "fetch from '$REMOTE' failed"
    continue
  fi

  if ! git -C "$app_path" rev-parse --verify --quiet "refs/remotes/$REMOTE/$MAIN_BRANCH" >/dev/null; then
    log_skip "$app" "'$REMOTE' has no '$MAIN_BRANCH' branch"
    continue
  fi

  current_branch="$(git -C "$app_path" symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
  before="$(git -C "$app_path" rev-parse --verify --quiet "refs/heads/$MAIN_BRANCH" || true)"

  if [ "$current_branch" = "$MAIN_BRANCH" ]; then
    # Refuse to touch a dirty working tree — a failed merge here is the user's problem to clean up.
    if [ -n "$(git -C "$app_path" status --porcelain)" ]; then
      log_skip "$app" "uncommitted changes on '$MAIN_BRANCH'"
      continue
    fi
    if ! git -C "$app_path" merge --ff-only "$REMOTE/$MAIN_BRANCH" >/dev/null 2>&1; then
      log_fail "$app" "'$MAIN_BRANCH' has diverged from '$REMOTE/$MAIN_BRANCH', cannot fast-forward"
      continue
    fi
  else
    # main is not checked out, so update its ref directly instead of switching branches.
    # This refspec form refuses anything that is not a fast-forward.
    if ! git -C "$app_path" fetch "$REMOTE" "$MAIN_BRANCH:$MAIN_BRANCH" >/dev/null 2>&1; then
      if [ -z "$before" ]; then
        log_fail "$app" "could not create local '$MAIN_BRANCH'"
      else
        log_fail "$app" "'$MAIN_BRANCH' has diverged from '$REMOTE/$MAIN_BRANCH', cannot fast-forward"
      fi
      continue
    fi
  fi

  after="$(git -C "$app_path" rev-parse --verify --quiet "refs/heads/$MAIN_BRANCH" || true)"
  on_branch_note=""
  if [ "$current_branch" != "$MAIN_BRANCH" ]; then
    on_branch_note=" ${DIM}(checked out: ${current_branch:-detached HEAD})${RESET}"
  fi

  if [ "$before" = "$after" ]; then
    echo "  ${GREEN}up to date${RESET} — $(git -C "$app_path" rev-parse --short "$after")$on_branch_note"
  elif [ -z "$before" ]; then
    echo "  ${GREEN}created${RESET} — $MAIN_BRANCH at $(git -C "$app_path" rev-parse --short "$after")$on_branch_note"
    updated+=("$app")
  else
    count="$(git -C "$app_path" rev-list --count "$before..$after" 2>/dev/null || echo "?")"
    echo "  ${GREEN}updated${RESET} — $(git -C "$app_path" rev-parse --short "$before") -> $(git -C "$app_path" rev-parse --short "$after") ($count new commit(s))$on_branch_note"
    updated+=("$app")
  fi
done

echo
echo "${BOLD}Summary${RESET}"
echo "  updated: ${#updated[@]}${updated:+ (${updated[*]})}"
if [ "${#skipped[@]}" -gt 0 ]; then
  echo "  ${YELLOW}skipped: ${#skipped[@]}${RESET}"
  for entry in "${skipped[@]}"; do echo "    - $entry"; done
fi
if [ "${#failed[@]}" -gt 0 ]; then
  echo "  ${RED}failed: ${#failed[@]}${RESET}"
  for entry in "${failed[@]}"; do echo "    - $entry"; done
  exit 1
fi
