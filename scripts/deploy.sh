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
#   firebase.json rewrites are regenerated to match exactly the versions built, then restored.
#
# Requires: pnpm, firebase CLI (logged in), jq, node, git. Written for bash 3.2 (macOS default).
#
# Prereqs handled elsewhere by you:
#   - each app's .env exists with real config for the target environment
#   - each app's .firebaserc has "dev" / "uat" / "prod" project aliases (so `firebase use <env>` works)

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"
APPS_DIR="$ROOT_DIR/apps"
DEFAULT_VERSION_COUNT=2
MAIN_BRANCH="main"

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
command -v firebase >/dev/null 2>&1 || die "firebase CLI not found (npm i -g firebase-tools)"
command -v jq       >/dev/null 2>&1 || die "jq not found"
command -v node     >/dev/null 2>&1 || die "node not found"

if ! firebase login:list 2>/dev/null | grep -q "@"; then
  echo "Not logged in to Firebase — launching 'firebase login'..."
  firebase login
fi

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

ORIG_REF="$(git rev-parse --abbrev-ref HEAD)"
[ "$ORIG_REF" = "HEAD" ] && ORIG_REF="$(git rev-parse HEAD)"

# Local env overrides for this environment (firebase config etc.) — replaces GitHub secrets locally.
ENV_CONFIG_FILE="$SCRIPT_DIR/env-config/.env.$ENV"
[ -f "$ENV_CONFIG_FILE" ] \
  || echo "warn: $ENV_CONFIG_FILE not found — app .env keys (e.g. VITE_FIREBASE_CONFIG) won't be overridden."

# Restore the repo to how we found it — on success, error, or Ctrl-C.
cleanup() {
  cd "$APP_DIR" 2>/dev/null || return
  git checkout -q -f "$ORIG_REF" 2>/dev/null || true
  git checkout -q -- firebase.json 2>/dev/null || true
  if [ -f .env.deploybak ]; then mv -f .env.deploybak .env; else rm -f .env; fi
}
trap cleanup EXIT INT TERM
[ -f .env ] && cp .env .env.deploybak   # back up a pre-existing local .env (restored in cleanup)

git fetch --tags --force --quiet 2>/dev/null || echo "warn: 'git fetch --tags' failed; using local tags"

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
  if   git rev-parse --verify -q "$MAIN_BRANCH"        >/dev/null; then ROOT_REF="$MAIN_BRANCH"
  elif git rev-parse --verify -q "origin/$MAIN_BRANCH" >/dev/null; then ROOT_REF="origin/$MAIN_BRANCH"
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
echo "  Deploy       : firebase use $ENV  &&  firebase deploy --only hosting:$ENV"
echo
read -r -p "Proceed? [y/N] " go
printf '%s' "${go:-}" | grep -qiE '^y' || die "aborted"
if [ "$ENV" = "prod" ]; then
  read -r -p "This is a PRODUCTION deploy. Type 'deploy' to confirm: " confirm
  [ "$confirm" = "deploy" ] || die "aborted"
fi

# ----------------------------------------------------------------------------- install + build
echo ">> pnpm install"
( cd "$ROOT_DIR" && pnpm install )

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

build_at() {   # $1 = git ref, $2 = buildVersion ("" for the root bootstrap)
  echo ">> building ${2:-<root bootstrap>} from $1"
  git checkout -q -f "$1"
  cp .env.example .env      # fresh per tag (this version's own .env.example)
  apply_overrides           # env-config/.env.<env> -> firebase config etc.
  set_config "$2"           # buildVersion + environmentTypeId
  ( cd "$ROOT_DIR" && pnpm --filter "$PKG" build )
}

rm -rf dist
build_at "$ROOT_REF" ""                       # root FIRST (its build empties dist/)
if [ "${#VERSIONS[@]}" -gt 0 ]; then
  for v in "${VERSIONS[@]}"; do build_at "$v" "$v"; done
fi

echo ">> dist/ now contains:"; ls -1 dist

# ----------------------------------------------------------------------------- firebase.json rewrites
# Base off the root ref's firebase.json (keeps its headers/targets), then set rewrites to exactly
# the versions built, catch-all last -> the root bootstrap.
git checkout -q "$ROOT_REF" -- firebase.json
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
echo ">> firebase.json rewrites:"; jq -c '.hosting[].rewrites' firebase.json

# ----------------------------------------------------------------------------- pre-deploy gate
# Build is done and nothing has been pushed yet. Pause so you can inspect dist/ and the rewrites above
# (e.g. `open apps/$APP/dist`) before anything goes live — especially for uat/prod.
echo
echo "Build complete. Nothing has been deployed yet."
echo "  Reviewing: apps/$APP/dist  ->  firebase deploy --only hosting:$ENV"
read -r -p "Deploy $APP to $ENV now? [y/N] " deploy_go
if ! printf '%s' "${deploy_go:-}" | grep -qiE '^y'; then
  # Abort WITHOUT cleanup: leave the built tree intact (dist/, generated firebase.json, .env) so the
  # build can be deployed by hand. Dropping the trap is what preserves everything.
  trap - EXIT INT TERM
  echo
  echo "Aborted before deploy — nothing pushed. The full build is left in apps/$APP/dist/."
  echo "Deploy it manually with:"
  echo "    cd apps/$APP && firebase use $ENV && firebase deploy --only hosting:$ENV"
  echo "When you're done, restore the working tree:"
  echo "    cd apps/$APP && git checkout $ORIG_REF && git checkout -- firebase.json"
  [ -f .env.deploybak ] && echo "    mv .env.deploybak .env   # your original .env (kept as backup)"
  exit 0
fi

# ----------------------------------------------------------------------------- deploy
firebase use "$ENV" || die "'firebase use $ENV' failed — ensure $APP/.firebaserc has a '$ENV' project alias."
firebase deploy --only "hosting:$ENV" -m "deploy $APP $ENV (root + ${#VERSIONS[@]} version(s))"

echo
echo "Done: $APP -> $ENV (root=$ROOT_REF, versions=[${VERSIONS[*]:-}])."
