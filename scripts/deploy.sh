#!/usr/bin/env bash
#
# deploy.sh — build & deploy an accxui app (root bootstrap + last-N versioned builds) to
# dev / uat / prod using your local Firebase login.
#
# Run from the accxui repo root:  pnpm deploy:app   (or ./scripts/deploy.sh)
# NOTE: the script is named "deploy:app", not "deploy", because `pnpm deploy` is a built-in pnpm command.
#
# Behaviour (mirrors the release/merge GitHub workflows):
#   - dev      : root = main branch;   versioned releases optional (default: none)
#   - uat/prod : root = latest tag;    last N minor releases (default: 2)
#   Version set = latest patch of each major.minor, then the last N of those (tags are vX.Y.Z).
#   Root is built first (buildVersion="" -> dist/index.html); each version -> dist/vX.Y.Z/.
#   environmentTypeId is baked to match the chosen env (dev->AppEnvDev, uat->AppEnvUAT, prod->AppEnvProd).
#   Each release uses its recorded accxuiVersion in isolated worktrees. Caller checkouts stay untouched.
#   --build-only assembles the deployable artifact without authenticating to or invoking Firebase.
#
# Requires: pnpm, firebase CLI (logged in), jq, node, git. Written for bash 3.2 (macOS default).
#
# Prereqs handled elsewhere by you:
#   - each app's .env exists with real config for the target environment
#   - each app's .firebaserc has "dev" / "uat" / "prod" project aliases (so `firebase use <env>` works)

set -euo pipefail

# Explicit additive mode; the established default deployment flow below is unchanged.
if [ "${1:-}" = "--publish-only" ]; then
  shift
  exec node "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/hosting/publish-versions.mjs" "$@"
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
APPS_DIR="$ROOT_DIR/apps"
DEFAULT_VERSION_COUNT=2
MAIN_BRANCH="main"
BUILD_ONLY=0
case "${1:-}" in
  --build-only) BUILD_ONLY=1 ;;
  "") ;;
  *) echo "Usage: $0 [--build-only]" >&2; exit 1 ;;
esac
[ "$#" -le 1 ] || { echo "Unexpected arguments" >&2; exit 1; }

die() { echo "ERROR: $*" >&2; exit 1; }

env_type() {
  case "$1" in
    dev)  echo "AppEnvDev" ;;
    uat)  echo "AppEnvUAT" ;;
    prod) echo "AppEnvProd" ;;
  esac
}

# ----------------------------------------------------------------------------- preflight
command -v pnpm     >/dev/null 2>&1 || die "pnpm not found"
if [ "$BUILD_ONLY" = 0 ]; then
  command -v firebase >/dev/null 2>&1 || die "firebase CLI not found"
fi
command -v jq       >/dev/null 2>&1 || die "jq not found"
command -v node     >/dev/null 2>&1 || die "node not found"

# ----------------------------------------------------------------------------- pick app
APPS=()
while IFS= read -r a; do
  [ -n "$a" ] && APPS+=("$a")
done < <(
  for d in "$APPS_DIR"/*/; do
    [ -f "${d}firebase.json" ] && [ -f "${d}package.json" ] && basename "$d"
  done | sort
)
[ "${#APPS[@]}" -gt 0 ] || die "no deployable apps found under $APPS_DIR"

PS3="Select app to deploy (number): "
select APP in "${APPS[@]}"; do [ -n "${APP:-}" ] && break; done
APP_DIR="$APPS_DIR/$APP"
PKG="$(node -p "require('$APP_DIR/package.json').name")"

# ----------------------------------------------------------------------------- pick env
PS3="Select target environment (number): "
select ENV in dev uat prod; do [ -n "${ENV:-}" ] && break; done
ENV_TYPE="$(env_type "$ENV")"

# ----------------------------------------------------------------------------- version count
if [ "$ENV" = "dev" ]; then
  read -r -p "Also build versioned releases for dev? [y/N] " ans
  if printf '%s' "${ans:-}" | grep -qiE '^y'; then
    read -r -p "How many minor versions? [$DEFAULT_VERSION_COUNT] " COUNT
    COUNT="${COUNT:-$DEFAULT_VERSION_COUNT}"
  else
    COUNT=0
  fi
else
  read -r -p "How many minor versions to build? [$DEFAULT_VERSION_COUNT] " COUNT
  COUNT="${COUNT:-$DEFAULT_VERSION_COUNT}"
fi
case "$COUNT" in ''|*[!0-9]*) die "version count must be a number" ;; esac

# ----------------------------------------------------------------------------- app repo state
cd "$APP_DIR"
# Each build copies a fresh .env from this tag's .env.example, so .env.example is what we require
# (different versions may ship different .env.example). Any pre-existing local .env is restored at the end.
[ -f .env.example ] || die "$APP has no .env.example"
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "$APP is not a git repository"
[ -z "$(git status --porcelain --untracked-files=no)" ] \
  || die "$APP has uncommitted changes to tracked files — commit or stash before deploying."

SOURCE_APP_DIR="$APP_DIR"
DEFAULT_FRAMEWORK="$(git -C "$ROOT_DIR" rev-parse HEAD)"
ENV_CONFIG_FILE="$SCRIPT_DIR/env-config/.env.$ENV"
[ -f "$ENV_CONFIG_FILE" ] \
  || echo "warn: no environment override file for $ENV; using release .env.example."

git fetch origin --tags --quiet
# Never overwrite a published tag or use stale refs after a failed fetch.
git -C "$ROOT_DIR" fetch origin --tags --quiet

# ----------------------------------------------------------------------------- select versions
VERSIONS=()
if [ "$COUNT" -gt 0 ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && VERSIONS+=("$line")
  done < <(
    git tag -l | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | awk -v n="$COUNT" '
      { key=$0; sub(/\.[0-9]+$/,"",key); if(!(key in seen)){order[++c]=key; seen[key]=1} latest[key]=$0 }
      END { s=c-n; if(s<0)s=0; for(i=s+1;i<=c;i++) print latest[order[i]] }'
  )
fi

# ----------------------------------------------------------------------------- root ref
if [ "$ENV" = "dev" ]; then
  if   git rev-parse --verify -q "origin/$MAIN_BRANCH" >/dev/null; then ROOT_REF="origin/$MAIN_BRANCH"
  elif git rev-parse --verify -q "$MAIN_BRANCH"        >/dev/null; then ROOT_REF="$MAIN_BRANCH"
  else die "no '$MAIN_BRANCH' branch found for $APP"
  fi
else
  ROOT_REF="$(git tag -l | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1)"
  [ -n "$ROOT_REF" ] || die "no vX.Y.Z release tags found for $APP"
fi

# ----------------------------------------------------------------------------- confirm
echo
echo "  App          : $APP        (pnpm package: $PKG)"
echo "  Environment  : $ENV        (environmentTypeId: $ENV_TYPE)"
echo "  Env overrides: $([ -f "$ENV_CONFIG_FILE" ] && echo "$ENV_CONFIG_FILE" || echo '(none)')"
echo "  Root build   : $ROOT_REF   ($([ "$ENV" = dev ] && echo 'main branch' || echo 'latest tag'))"
if [ "${#VERSIONS[@]}" -gt 0 ]; then
  echo "  Versions     : ${VERSIONS[*]}"
else
  echo "  Versions     : (none — root only)"
fi
echo "  Mode         : $([ "$BUILD_ONLY" = 1 ] && echo build-only || echo build-and-confirm-deploy)"
echo
read -r -p "Proceed? [y/N] " go
printf '%s' "${go:-}" | grep -qiE '^y' || die "aborted"
# Keep this script and hosting tools in the caller checkout while dependency versions change.
# Worktrees live under the configured apps worktree directory and are retained for inspection.
mkdir -p "$ROOT_DIR/apps/_worktrees"
BUILD_ROOT=$(mktemp -d "$ROOT_DIR/apps/_worktrees/deploy-$APP-$ENV.XXXXXX")
git -C "$ROOT_DIR" worktree add --detach "$BUILD_ROOT" "$DEFAULT_FRAMEWORK"
APP_DIR="$BUILD_ROOT/apps/$APP"
git -C "$SOURCE_APP_DIR" worktree add --detach "$APP_DIR" "$ROOT_REF"
cd "$APP_DIR"
echo "  Isolated build: $BUILD_ROOT"
# On any failure, preserve the new worktrees for diagnosis; caller files were never changed.
trap 'echo "Build workspace retained at $BUILD_ROOT"' EXIT
LAST_INSTALL=""

# Replace matching keys in the app's .env from env-config/.env.<env> (only keys already present in .env
# are overridden; values are applied literally, so JSON/quotes/= are safe). No-op if the file is absent.
apply_overrides() {
  [ -f "$ENV_CONFIG_FILE" ] || return 0
  node -e '
    const fs = require("fs");
    const [cfgPath, envPath] = process.argv.slice(1);
    let env = fs.readFileSync(envPath, "utf8");
    for (const line of fs.readFileSync(cfgPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);   // skips blanks/comments
      if (!m) continue;
      const key = m[1], val = m[2];
      const re = new RegExp("^" + key + "=.*$", "m");
      if (re.test(env)) env = env.replace(re, () => key + "=" + val);   // only if key already present
    }
    fs.writeFileSync(envPath, env);
  ' "$ENV_CONFIG_FILE" ".env"
}

# Bake $1 as buildVersion and $ENV_TYPE as environmentTypeId into the app's .env (edits in place).
set_config() {
  node -e '
    const fs = require("fs");
    const [bv, et] = process.argv.slice(1);
    let s = fs.readFileSync(".env", "utf8");
    if (!/^VITE_APP_VERSION_CONFIG=/m.test(s)) { console.error("VITE_APP_VERSION_CONFIG missing from .env"); process.exit(1); }
    s = s.replace(/^VITE_APP_VERSION_CONFIG=(.*)$/m, (_, j) => {
      const o = JSON.parse(j); o.buildVersion = bv; o.environmentTypeId = et;
      return "VITE_APP_VERSION_CONFIG=" + JSON.stringify(o);
    });
    fs.writeFileSync(".env", s);
  ' "$1" "$ENV_TYPE"
}

build_at() {   # $1 = app ref, $2 = buildVersion (empty for root)
  local framework_ref framework_commit install_key config
  framework_ref=$(git -C "$SOURCE_APP_DIR" show "$1:.github/workflows/firebase-hosting-release.yml" 2>/dev/null |
    awk '/^[ ]*accxuiVersion[ ]*:/ {print $2; exit}' | tr -d "\"'") || true
  framework_ref="${framework_ref:-$DEFAULT_FRAMEWORK}"
  framework_commit=$(git -C "$ROOT_DIR" rev-parse --verify "${framework_ref}^{commit}") \
    || die "$1 declares unavailable AccxUI ref $framework_ref"
  git checkout --quiet --detach "$1"
  git -C "$BUILD_ROOT" checkout --quiet --detach "$framework_commit"
  echo ">> building ${2:-root} from $1 against AccxUI $framework_ref ($framework_commit)"
  install_key="$(git rev-parse HEAD):$framework_commit"
  if [ "$install_key" != "$LAST_INSTALL" ]; then
    ( cd "$BUILD_ROOT" && CI=true pnpm install --frozen-lockfile )
    LAST_INSTALL="$install_key"
  fi
  cp .env.example .env
  apply_overrides
  set_config "$2"
  config=$(sed -n 's/^VITE_APP_VERSION_CONFIG=//p' .env)
  ( cd "$BUILD_ROOT"
    # Target environment wins over inherited shell settings and every .env file.
    export VITE_APP_VERSION_CONFIG="$config"
    pnpm --filter "$PKG" build
  )
  [ -f "dist/${2:+$2/}index.html" ] || die "$1 built to the wrong path"
  printf '%s\t%s\t%s\t%s\n' "${2:-root}" "$(git rev-parse HEAD)" "$framework_ref" "$framework_commit" >> "$BUILD_ROOT/build-versions.tsv"
}

build_at "$ROOT_REF" ""
# Build the newest version beside root before switching framework dependencies.
for v in "${VERSIONS[@]:-}"; do
  if [ -n "$v" ] && [ "$v" = "$ROOT_REF" ]; then build_at "$v" "$v"; fi
done
for v in "${VERSIONS[@]:-}"; do
  if [ -n "$v" ] && [ "$v" != "$ROOT_REF" ]; then build_at "$v" "$v"; fi
done

echo ">> dist/ now contains:"; ls -1 dist

# ----------------------------------------------------------------------------- firebase.json rewrites
# Base off the root ref's firebase.json (keeps its headers/targets), then set rewrites to exactly
# the versions built, catch-all last -> the root bootstrap.
git show "$ROOT_REF:firebase.json" > firebase.json
git show "$ROOT_REF:.firebaserc" > .firebaserc
if [ "${#VERSIONS[@]}" -gt 0 ]; then
  vs_json="$(printf '%s\n' "${VERSIONS[@]}" | jq -R . | jq -s .)"
else
  vs_json="[]"
fi
jq --argjson versions "$vs_json" '
  .hosting |= map(
    .rewrites =
      ( $versions | map({ source: ("/" + . + "/**"), destination: ("/" + . + "/index.html") }) )
      + [ { source: "**", destination: "/index.html" } ]
  )
' firebase.json > firebase.json.tmp && mv firebase.json.tmp firebase.json
# Always preserve update endpoints for previously installed apps, including old version scopes.
node "$ROOT_DIR/scripts/hosting/prepare.mjs" "$APP_DIR"
app_id=$(git show "$ROOT_REF:.env.example" | sed -n 's/^VITE_APP_VERSION_CONFIG=//p' | jq -r .appId)
jq -n --arg appId "$app_id" --arg env "$ENV_TYPE" --arg root "$ROOT_REF" --argjson versions "$vs_json" \
  '{schemaVersion:1,appId:$appId,environmentTypeId:$env,rootVersion:$root,versions:[$versions[]|{version:.,environmentTypeId:$env}]}' > dist/hosted-versions.json
PROJECT_ID=$(jq -r --arg env "$ENV" '.projects[$env] // empty' .firebaserc)
[ -n "$PROJECT_ID" ] || die "Release has no Firebase project for $ENV"
jq -e --arg project "$PROJECT_ID" --arg env "$ENV" '.targets[$project].hosting[$env] | length > 0' .firebaserc >/dev/null \
  || die "Release has no Hosting target $ENV in $PROJECT_ID"
echo ">> firebase.json rewrites:"; jq -c '.hosting[].rewrites' firebase.json

# ----------------------------------------------------------------------------- pre-deploy gate
echo
echo "Build complete. Nothing has been deployed."
echo "  Artifact: $APP_DIR/dist"
echo "  Target: $PROJECT_ID / hosting:$ENV"
if [ "$BUILD_ONLY" = 1 ]; then exit 0; fi
read -r -p "Deploy $APP to $ENV now? [y/N] " deploy_go
if ! printf '%s' "${deploy_go:-}" | grep -qiE '^y'; then exit 0; fi
if [ "$ENV" = prod ]; then
  read -r -p "This is a PRODUCTION deploy. Type 'deploy' to confirm: " confirm
  [ "$confirm" = deploy ] || die "aborted"
fi
if ! firebase login:list 2>/dev/null | grep -q "@"; then
  die "No Firebase login. Authenticate explicitly before deploying."
fi
firebase deploy --project "$PROJECT_ID" --config "$APP_DIR/firebase.json" --only "hosting:$ENV" \
  -m "deploy $APP $ENV (root $ROOT_REF + ${#VERSIONS[@]} version(s))"
echo "Done: $APP -> $ENV (root=$ROOT_REF, versions=[${VERSIONS[*]:-}])."
