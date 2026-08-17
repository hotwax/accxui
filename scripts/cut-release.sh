#!/usr/bin/env bash
#
# Cut a release of accxui or of an AccxUI app.
#
# Usage: ./scripts/cut-release.sh [target] [options]
#        pnpm release [target] [options]
#
# `target` is `accxui` or the name of a directory under apps/ (e.g. bopis).
# Omit it and the script asks.
#
# Options:
#   --version <X.Y.Z>   new version, skipping that prompt
#   --accxui <vX.Y.Z>   new accxuiVersion for an app, skipping that prompt
#   --dry-run           print every git/gh command instead of running it
#   --skip-checks       merge without waiting for the PR's checks to pass
#   --admin             merge with admin bypass, GitHub's "Merge without
#                       waiting for requirements to be met (bypass rules)".
#                       Without this flag the script asks first, but only if
#                       branch protection actually blocks the merge.
#   --watch             follow the deploy run to conclusion
#   -y, --yes           assume yes at every confirmation, including the admin
#                       bypass above (use with care)
#
# The script will, in order:
#   * report the current version, latest tag, and commits since it
#   * ask for the new version, and for an app, the accxui version to build on
#   * refresh main and recreate the `release` branch
#   * bump package.json (and accxuiVersion in the app's release workflow)
#   * commit, push, and open a PR to main
#   * stop for one confirmation
#   * merge the PR, tag it, and publish the GitHub release with generated notes
#
# Nothing destructive happens without a confirmation, `main` is only ever
# fast-forwarded, and --dry-run mutates nothing.
#
# Individual phases are also exposed as subcommands (inspect, prepare, finish,
# merge, publish, set-version, set-accxui-version) for testing.
#
# Targets bash 3.2 (the macOS system bash).

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# The accxui root, one level above scripts/. Everything else - apps/, the
# accxui repo itself - is resolved from here, so this must stay correct if
# the script ever moves.
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

ACCXUI_REMOTE="https://github.com/hotwax/accxui.git"
WORKFLOW=".github/workflows/firebase-hosting-release.yml"
EXIT_CONFIRM_REQUIRED=10

if [ -t 1 ]; then
  BOLD=$'\033[1m'; RED=$'\033[31m'; GREEN=$'\033[32m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  BOLD=""; RED=""; GREEN=""; DIM=""; RESET=""
fi

DRY_RUN=0
REPO_DIR=""
SINCE=""
REMOTE=""
TAG=""
CONFIRM_DELETE_REMOTE=0
MESSAGE=""
TITLE=""
BODY=""
FILES=()
SKIP_CHECKS=0
ADMIN=0
WATCH=0
VERSION=""
ACCXUI_VERSION=""
ASSUME_YES=0
TARGET=""

die() {
  printf '%scut-release:%s %s\n' "$RED" "$RESET" "$1" >&2
  exit 1
}

# run <cmd...> - execute, or print under --dry-run.
run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '%s[dry-run] %s%s\n' "$DIM" "$*" "$RESET"
  else
    "$@"
  fi
}

git_in()  { git -C "$REPO_DIR" "$@"; }
run_git() { run git -C "$REPO_DIR" "$@"; }

run_gh() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '%s[dry-run] gh %s%s\n' "$DIM" "$*" "$RESET"
  else
    ( cd "$REPO_DIR" && gh "$@" )
  fi
}

require_repo_dir() {
  [ -n "$REPO_DIR" ] || die "--repo-dir is required"
  git -C "$REPO_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || die "not a git working tree: $REPO_DIR"
}

# ask <prompt> <default> -> echoes the answer (or the default on empty input)
ask() {
  local prompt=$1 fallback=${2:-} answer=""
  if [ -n "$fallback" ]; then
    printf '%s %s[%s]%s ' "$prompt" "$DIM" "$fallback" "$RESET" >&2
  else
    printf '%s ' "$prompt" >&2
  fi
  IFS= read -r answer || true
  if [ -z "$answer" ]; then printf '%s' "$fallback"; else printf '%s' "$answer"; fi
}

# confirm <prompt> -> 0 for yes, 1 for no
confirm() {
  [ "$ASSUME_YES" = "1" ] && return 0
  local answer=""
  printf '%s %s[y/N]%s ' "$1" "$DIM" "$RESET" >&2
  IFS= read -r answer || true
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------------------------------------------------------------- file edits

# read_pkg_version <package.json>
# The top-level "version" key, at one to four spaces of indent. Nested objects
# (dependencies, pnpm.overrides) sit deeper, so they are never matched.
read_pkg_version() {
  awk '
    {
      n = match($0, /[^ ]/); indent = n - 1
      if (indent >= 1 && indent <= 4 && $0 ~ /^[ ]*"version"[ ]*:[ ]*"/) {
        match($0, /"version"[ ]*:[ ]*"[^"]*"/)
        s = substr($0, RSTART, RLENGTH)
        sub(/^"version"[ ]*:[ ]*"/, "", s); sub(/"$/, "", s)
        print s; exit
      }
    }
  ' "$1"
}

# set_pkg_version <package.json> <version>
# Rewrites only that one line: formatting, key order and trailing newline all
# survive. Writes via a temp file, so no sed -i portability trap.
set_pkg_version() {
  local file=$1 ver=$2 tmp
  tmp="$(mktemp)"
  awk -v ver="$ver" '
    {
      if (!done) {
        n = match($0, /[^ ]/); indent = n - 1
        if (indent >= 1 && indent <= 4 && $0 ~ /^[ ]*"version"[ ]*:[ ]*"/) {
          sub(/"version"[ ]*:[ ]*"[^"]*"/, "\"version\": \"" ver "\"")
          done = 1
        }
      }
      print
    }
    END { if (!done) exit 3 }
  ' "$file" > "$tmp" || { rm -f "$tmp"; die "no top-level \"version\" field in $file"; }
  mv "$tmp" "$file"
}

# read_accxui_version <workflow.yml> -> the value, or empty when absent
read_accxui_version() {
  awk '/^[ ]*accxuiVersion[ ]*:/ {
    sub(/^[ ]*accxuiVersion[ ]*:[ ]*/, ""); sub(/[ ]*$/, ""); print; exit
  }' "$1"
}

# set_accxui_version <workflow.yml> <version>
# Replaces the value when the key exists, and inserts it immediately after
# `appDir:` at the block's own indent when it does not. The key is always a
# sibling of app and appDir under `with:`, never nested deeper.
set_accxui_version() {
  local file=$1 ver=$2 tmp
  tmp="$(mktemp)"
  awk -v ver="$ver" '
    { line[NR] = $0 }
    END {
      w = 0
      for (i = 1; i <= NR; i++) if (line[i] ~ /^[ ]+with:[ ]*$/) { w = i; break }
      if (w == 0) exit 3

      wn = match(line[w], /[^ ]/) - 1

      end = NR + 1
      for (i = w + 1; i <= NR; i++) {
        if (line[i] ~ /^[ ]*$/) continue
        n = match(line[i], /[^ ]/) - 1
        if (n <= wn) { end = i; break }
      }

      bi = wn + 2
      for (i = w + 1; i < end; i++) {
        if (line[i] !~ /^[ ]*$/) { bi = match(line[i], /[^ ]/) - 1; break }
      }
      pad = ""
      for (k = 0; k < bi; k++) pad = pad " "

      found = 0
      for (i = w + 1; i < end; i++) {
        if (line[i] ~ /^[ ]*accxuiVersion[ ]*:/) {
          line[i] = pad "accxuiVersion: " ver; found = 1; break
        }
      }

      if (!found) {
        ins = end
        for (i = w + 1; i < end; i++) {
          if (line[i] ~ /^[ ]*appDir[ ]*:/) { ins = i + 1; break }
        }
        for (i = NR; i >= ins; i--) line[i + 1] = line[i]
        line[ins] = pad "accxuiVersion: " ver
        NR = NR + 1
      }

      for (i = 1; i <= NR; i++) print line[i]
    }
  ' "$file" > "$tmp" || { rm -f "$tmp"; die "no \`with:\` block in $file"; }
  mv "$tmp" "$file"
}

# next_minor <X.Y.Z> -> X.(Y+1).0, or empty when the input is not X.Y.Z
next_minor() {
  printf '%s' "$1" | awk -F. '
    NF == 3 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ && $3 ~ /^[0-9]+$/ {
      printf "%s.%s.0", $1, $2 + 1
    }'
}

# ---------------------------------------------------------------- subcommands

cmd_inspect() {
  require_repo_dir
  local branch dirty latest count has_local has_remote
  branch=$(git_in rev-parse --abbrev-ref HEAD)
  if [ -n "$(git_in status --porcelain)" ]; then dirty=1; else dirty=0; fi
  latest=$(git_in tag --list 'v*' --sort=-v:refname | head -1)
  if [ -n "$latest" ]; then
    count=$(git_in rev-list --count "$latest"..HEAD)
  else
    count=$(git_in rev-list --count HEAD)
  fi
  if git_in show-ref --verify --quiet refs/heads/release; then has_local=1; else has_local=0; fi
  if git_in ls-remote --exit-code --heads origin release >/dev/null 2>&1; then
    has_remote=1
  else
    has_remote=0
  fi
  printf 'current_branch=%s\n' "$branch"
  printf 'is_dirty=%s\n' "$dirty"
  printf 'latest_tag=%s\n' "$latest"
  printf 'commits_since_tag=%s\n' "$count"
  printf 'has_local_release=%s\n' "$has_local"
  printf 'has_remote_release=%s\n' "$has_remote"
}

cmd_changelog() {
  require_repo_dir
  [ -n "$SINCE" ] || die "--since is required"
  git_in log --oneline --no-merges "$SINCE"..HEAD
}

cmd_check_tag() {
  [ -n "$REMOTE" ] || die "--remote is required"
  [ -n "$TAG" ] || die "--tag is required"
  if git ls-remote --exit-code --tags "$REMOTE" "refs/tags/$TAG" >/dev/null 2>&1; then
    exit 0
  fi
  exit 1
}

cmd_set_version() {
  require_repo_dir
  [ -n "$VERSION" ] || die "--version is required"
  set_pkg_version "$REPO_DIR/package.json" "$VERSION"
}

cmd_set_accxui_version() {
  require_repo_dir
  [ -n "$ACCXUI_VERSION" ] || die "--accxui is required"
  [ -f "$REPO_DIR/$WORKFLOW" ] || die "no $WORKFLOW in $REPO_DIR"
  set_accxui_version "$REPO_DIR/$WORKFLOW" "$ACCXUI_VERSION"
}

cmd_prepare() {
  require_repo_dir

  local dirty
  dirty=$(git_in status --porcelain)
  if [ -n "$dirty" ]; then
    printf '%s\n' "$dirty" >&2
    die "working tree is dirty; commit or stash before cutting a release"
  fi

  run_git fetch origin --prune --tags

  # The gate precedes every mutation: an unconfirmed run changes nothing.
  local remote_release=0
  if git_in ls-remote --exit-code --heads origin release >/dev/null 2>&1; then
    remote_release=1
    if [ "$CONFIRM_DELETE_REMOTE" != "1" ]; then
      local tip
      tip=$(git_in log -1 --format='%h %s' origin/release 2>/dev/null || echo "unknown")
      printf 'A release branch already exists on origin. Deleting it discards:\n' >&2
      printf '  %s\n' "$tip" >&2
      printf 'Re-run with --confirm-delete-remote to proceed.\n' >&2
      # Returns rather than exits, so cmd_run can prompt and retry.
      return $EXIT_CONFIRM_REQUIRED
    fi
  fi

  run_git checkout main
  run_git pull --ff-only origin main

  if git_in show-ref --verify --quiet refs/heads/release; then
    run_git branch -D release
  fi
  if [ "$remote_release" = "1" ]; then
    run_git push origin --delete release
  fi
  run_git checkout -b release
}

cmd_finish() {
  require_repo_dir
  [ -n "$MESSAGE" ] || die "--message is required"
  [ -n "$TITLE" ] || die "--title is required"
  [ -n "$BODY" ] || die "--body is required"
  [ ${#FILES[@]} -gt 0 ] || die "at least one --file is required"

  local branch
  branch=$(git_in rev-parse --abbrev-ref HEAD)
  if [ "$branch" != "release" ]; then
    # Under --dry-run prepare never switched branches, so this is expected;
    # aborting here would hide the rest of the plan.
    if [ "$DRY_RUN" = "1" ]; then
      printf '%s[dry-run] would be on release; currently on %s%s\n' "$DIM" "$branch" "$RESET"
    else
      die "expected to be on the release branch, found: $branch"
    fi
  fi

  local changed
  changed=$(git_in status --porcelain -- "${FILES[@]}")
  if [ -z "$changed" ] && [ "$DRY_RUN" != "1" ]; then
    die "none of the given files have changes; nothing to release"
  fi

  run_git add -- "${FILES[@]}"
  run_git commit -m "$MESSAGE"
  run_git push -u origin release
  run_gh pr create --base main --head release --title "$TITLE" --body "$BODY"
}

# gh_capture <args...> - run gh in REPO_DIR, collecting stdout+stderr in GH_OUT
# so the caller can inspect why it failed. Returns gh's exit code.
GH_OUT=""
gh_capture() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '%s[dry-run] gh %s%s\n' "$DIM" "$*" "$RESET"
    GH_OUT=""
    return 0
  fi
  local rc=0
  GH_OUT=$( cd "$REPO_DIR" && gh "$@" 2>&1 ) || rc=$?
  return $rc
}

# Branch protection refusing the merge, as opposed to any other gh failure.
is_protection_error() {
  case "$1" in
    *"base branch policy prohibits the merge"*) return 0 ;;
    *"not mergeable"*)                          return 0 ;;
    *"Protected branch update failed"*)         return 0 ;;
    *"required status checks"*)                 return 0 ;;
    *) return 1 ;;
  esac
}

cmd_merge() {
  require_repo_dir
  if [ "$SKIP_CHECKS" != "1" ]; then
    run_gh pr checks release --watch
  fi

  local rc=0
  if [ "$ADMIN" = "1" ]; then
    gh_capture pr merge release --merge --admin || rc=$?
  else
    gh_capture pr merge release --merge || rc=$?
  fi
  if [ -n "$GH_OUT" ]; then printf '%s\n' "$GH_OUT"; fi

  # Branch protection blocked it. This is GitHub's "Merge without waiting for
  # requirements to be met (bypass rules)" button; on the CLI it is --admin,
  # and it only works if you actually hold the bypass permission.
  if [ "$rc" -ne 0 ] && [ "$ADMIN" != "1" ] && is_protection_error "$GH_OUT"; then
    printf '\n%sBranch protection is blocking this merge.%s\n' "$BOLD" "$RESET" >&2
    printf 'Bypassing it is the CLI equivalent of GitHub'"'"'s\n' >&2
    printf '  "Merge without waiting for requirements to be met (bypass rules)"\n' >&2
    if confirm "Retry the merge with admin bypass?"; then
      rc=0
      gh_capture pr merge release --merge --admin || rc=$?
      if [ -n "$GH_OUT" ]; then printf '%s\n' "$GH_OUT"; fi
    else
      die "merge declined; the release PR is still open"
    fi
  fi

  if [ "$rc" -ne 0 ]; then
    die "could not merge the release PR"
  fi

  run_git checkout main
  run_git pull --ff-only origin main
}

cmd_publish() {
  require_repo_dir
  [ -n "$VERSION" ] || die "--version is required"
  [ -n "$TAG" ] || die "--prev-tag is required"

  local tag="v$VERSION"
  if git_in ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
    die "tag $tag already exists on origin; nothing was published"
  fi

  run_gh release create "$tag" \
    --target main \
    --title "Release $VERSION" \
    --generate-notes \
    --notes-start-tag "$TAG"

  if [ "$DRY_RUN" = "1" ]; then
    printf '%s[dry-run] would report the firebase-hosting-release deploy run%s\n' "$DIM" "$RESET"
    return 0
  fi

  if [ "$WATCH" = "1" ]; then
    sleep 5   # the tag push needs a moment to register as a workflow run
    local run_id
    run_id=$( cd "$REPO_DIR" && gh run list \
      --workflow firebase-hosting-release.yml --limit 1 \
      --json databaseId --jq '.[0].databaseId' 2>/dev/null )
    if [ -n "$run_id" ]; then
      run_gh run watch "$run_id"
    else
      printf 'No deploy run found yet; check the Actions tab.\n' >&2
    fi
  else
    run_gh run list --workflow firebase-hosting-release.yml --limit 3
  fi
}

# ------------------------------------------------------------------ the flow

list_apps() {
  local d
  for d in "$ROOT"/apps/*/; do
    [ -f "$d/package.json" ] || continue
    basename "$d"
  done
}

cmd_run() {
  local target=$TARGET kind dir

  if [ -z "$target" ]; then
    printf '\n%sTargets%s\n  accxui\n' "$BOLD" "$RESET"
    list_apps | sed 's/^/  /'
    printf '\n'
    target=$(ask "Which target?")
    [ -n "$target" ] || die "no target given"
  fi

  if [ "$target" = "accxui" ]; then
    kind="core"; dir="$ROOT"
  else
    kind="app"; dir="$ROOT/apps/$target"
    [ -f "$dir/package.json" ] || die "unknown target: $target
Available: accxui, $(list_apps | tr '\n' ' ')"
  fi
  REPO_DIR="$dir"

  # --- report -------------------------------------------------------------
  local state branch is_dirty latest_tag current_version yml current_accxui=""
  state=$(cmd_inspect)
  branch=$(printf '%s\n' "$state" | awk -F= '$1=="current_branch"{print $2}')
  is_dirty=$(printf '%s\n' "$state" | awk -F= '$1=="is_dirty"{print $2}')
  latest_tag=$(printf '%s\n' "$state" | awk -F= '$1=="latest_tag"{print $2}')
  current_version=$(read_pkg_version "$dir/package.json")
  yml="$dir/$WORKFLOW"
  if [ "$kind" = "app" ] && [ -f "$yml" ]; then
    current_accxui=$(read_accxui_version "$yml")
  fi

  printf '\n%sReleasing %s%s %s(%s)%s\n' "$BOLD" "$target" "$RESET" "$DIM" "$dir" "$RESET"
  printf '  branch            %s\n' "$branch"
  printf '  current version   %s\n' "$current_version"
  printf '  latest tag        %s\n' "${latest_tag:-(none)}"
  if [ "$kind" = "app" ]; then
    printf '  accxuiVersion     %s\n' "${current_accxui:-not set -> defaults to main}"
  fi

  if [ "$is_dirty" = "1" ]; then
    printf '\n%sWorking tree is dirty. Commit or stash first:%s\n' "$RED" "$RESET" >&2
    git_in status --short >&2
    exit 1
  fi

  if [ -n "$latest_tag" ]; then
    local log n
    log=$(git_in log --oneline --no-merges "$latest_tag"..HEAD)
    n=$(printf '%s' "$log" | grep -c '' || true)
    printf '\n%sShipping %s commit(s) since %s%s\n' "$BOLD" "$n" "$latest_tag" "$RESET"
    # awk rather than head: under pipefail a closed pipe would abort the run.
    printf '%s\n' "$log" | awk 'NR<=15 { print "  " $0 }'
    if [ "$n" -gt 15 ]; then
      printf '%s  ... and %s more%s\n' "$DIM" "$((n - 15))" "$RESET"
    fi
  fi

  # --- ask ----------------------------------------------------------------
  local version suggested
  suggested=$(next_minor "$current_version")
  if [ -n "$VERSION" ]; then
    version=$VERSION
  else
    version=$(ask $'\nNew version?' "$suggested")
  fi
  [ -n "$version" ] || die "no version given"

  local new_tag="v$version" origin_url
  origin_url=$(git_in remote get-url origin)
  if git ls-remote --exit-code --tags "$origin_url" "refs/tags/$new_tag" >/dev/null 2>&1; then
    die "tag $new_tag already exists on origin; pick another version"
  fi

  local accxui_version=""
  if [ "$kind" = "app" ] && [ -f "$yml" ]; then
    local accxui_latest
    accxui_latest=$(git -C "$ROOT" tag --list 'v*' --sort=-v:refname | head -1)
    printf '%s\naccxui latest tag: %s%s\n' "$DIM" "${accxui_latest:-(none)}" "$RESET"
    if [ -n "$ACCXUI_VERSION" ]; then
      accxui_version=$ACCXUI_VERSION
    else
      accxui_version=$(ask "accxuiVersion?" "${current_accxui:-${accxui_latest:-main}}")
    fi
    if [ -n "$accxui_version" ] && [ "$accxui_version" != "main" ]; then
      if ! git ls-remote --exit-code --tags "$ACCXUI_REMOTE" \
             "refs/tags/$accxui_version" >/dev/null 2>&1; then
        die "accxui tag $accxui_version does not exist.
Release accxui first - an app pinned to a missing ref fails in CI at deploy time."
      fi
    fi
  fi

  # --- prepare -------------------------------------------------------------
  printf '\n%sResetting the release branch%s\n' "$BOLD" "$RESET"
  local rc=0
  cmd_prepare || rc=$?
  if [ "$rc" -eq "$EXIT_CONFIRM_REQUIRED" ]; then
    if confirm "Delete the remote release branch?"; then
      CONFIRM_DELETE_REMOTE=1
      cmd_prepare || die "prepare failed"
    else
      printf 'Stopped. Nothing was changed.\n'
      return 0
    fi
  elif [ "$rc" -ne 0 ]; then
    die "prepare failed"
  fi

  # --- edit ----------------------------------------------------------------
  FILES=("package.json")
  if [ "$DRY_RUN" != "1" ]; then
    set_pkg_version "$dir/package.json" "$version"
  fi
  if [ -n "$accxui_version" ]; then
    FILES[${#FILES[@]}]="$WORKFLOW"
    if [ "$DRY_RUN" != "1" ]; then
      set_accxui_version "$yml" "$accxui_version"
    fi
  fi

  printf '\n%sEdited%s\n' "$BOLD" "$RESET"
  printf '  package.json      %s -> %s\n' "$current_version" "$version"
  if [ -n "$accxui_version" ]; then
    printf '  %s\n                    %s -> %s\n' \
      "$WORKFLOW" "${current_accxui:-(absent)}" "$accxui_version"
  fi

  # --- commit, push, PR ----------------------------------------------------
  if [ "$kind" = "core" ]; then
    MESSAGE="Updated: accxui version to $new_tag"
    BODY="Version bump for release $version."
  else
    MESSAGE="Updated: app version for release $new_tag"
    BODY="Version bump for release $version${accxui_version:+ against accxui $accxui_version}."
  fi
  TITLE="Release $version"
  cmd_finish || die "could not open the release PR"

  # --- the gate ------------------------------------------------------------
  printf '\n%sNext, without stopping again:%s\n' "$BOLD" "$RESET"
  printf '  merge the PR into main (waiting for checks)\n'
  printf '  create tag       %s\n' "$new_tag"
  printf '  publish release  Release %s\n' "$version"
  printf '  notes range      %s...%s\n' "${latest_tag:-(none)}" "$new_tag"

  if ! confirm $'\nMerge and publish now?'; then
    printf '\nStopped after the PR. Merge and tag by hand, or re-run to finish.\n'
    return 0
  fi

  # --- merge, publish ------------------------------------------------------
  cmd_merge || die "merge failed"

  if [ "$DRY_RUN" != "1" ]; then
    local merged
    merged=$(read_pkg_version "$dir/package.json")
    if [ "$merged" != "$version" ]; then
      die "package.json is at $merged after the merge, expected $version.
Nothing was tagged - investigate before publishing."
    fi
  fi

  VERSION="$version"
  TAG="${latest_tag:-$new_tag}"
  cmd_publish || die "publish failed"

  printf '\n%sReleased %s %s%s\n' "$GREEN$BOLD" "$target" "$version" "$RESET"
}

# ------------------------------------------------------------------ dispatch

usage() {
  sed -n '2,32p' "$0" | sed 's/^# \{0,1\}//'
}

COMMAND=""
case "${1:-}" in
  inspect|changelog|check-tag|prepare|finish|merge|publish|set-version|set-accxui-version)
    COMMAND=$1; shift ;;
  -h|--help)
    usage; exit 0 ;;
  "")
    COMMAND="run" ;;
  -*)
    COMMAND="run" ;;
  *)
    COMMAND="run"; TARGET=$1; shift ;;
esac

while [ $# -gt 0 ]; do
  case "$1" in
    --repo-dir) REPO_DIR=$2; shift 2 ;;
    --since)    SINCE=$2;    shift 2 ;;
    --remote)   REMOTE=$2;   shift 2 ;;
    --tag)      TAG=$2;      shift 2 ;;
    --prev-tag) TAG=$2;      shift 2 ;;
    --message)  MESSAGE=$2;  shift 2 ;;
    --title)    TITLE=$2;    shift 2 ;;
    --body)     BODY=$2;     shift 2 ;;
    --file)     FILES[${#FILES[@]}]=$2; shift 2 ;;
    --version)  VERSION=$2;  shift 2 ;;
    --accxui)   ACCXUI_VERSION=$2; shift 2 ;;
    --confirm-delete-remote) CONFIRM_DELETE_REMOTE=1; shift ;;
    --skip-checks) SKIP_CHECKS=1; shift ;;
    --admin)    ADMIN=1;     shift ;;
    --watch)    WATCH=1;     shift ;;
    --dry-run)  DRY_RUN=1;   shift ;;
    -y|--yes)   ASSUME_YES=1; shift ;;
    -h|--help)  usage; exit 0 ;;
    *) die "unknown option: $1" ;;
  esac
done

case "$COMMAND" in
  inspect)            cmd_inspect ;;
  changelog)          cmd_changelog ;;
  check-tag)          cmd_check_tag ;;
  set-version)        cmd_set_version ;;
  set-accxui-version) cmd_set_accxui_version ;;
  prepare)            cmd_prepare ;;
  finish)             cmd_finish ;;
  merge)              cmd_merge ;;
  publish)            cmd_publish ;;
  run)                cmd_run ;;
  *) usage; die "unknown command: $COMMAND" ;;
esac
