#!/usr/bin/env bash
#
# deploy.sh — deploy an accxui app through its GitHub Actions hosting workflow.
#
# Run from the accxui repo root:  pnpm deploy:app   (or ./scripts/deploy.sh)
# NOTE: the script is named "deploy:app", not "deploy", because `pnpm deploy` is a built-in pnpm command.
#
# Nothing is built or deployed from this machine: builds run in GitHub Actions with the GitHub secrets,
# exactly like the tag rollout and Release Management. Each deploy is a reviewed plan, then an execute run.
#
#   pnpm deploy:app                                               latest N minors, latest release at root
#   pnpm deploy:app --count 3                                     same, without the prompt
#   pnpm deploy:app --versions v3.5.0,v3.4.2 --default v3.4.2     the site becomes exactly these versions
#   pnpm deploy:app --publish-only --versions v3.6.0,v3.4.2       add or rebuild these; root and others stay
#   --app <app> --environment dev|uat|prod                        skip the prompts
#
# dev re-runs the latest merge deployment of the app's default branch (no versioned builds on dev).
# uat / prod need the app's .github/app-hosting.json and manage-app-hosting.yml (see scripts/hosting/manager).
#
# Requires: node and the GitHub CLI (`gh auth login`) with Actions write access to the app repository.

set -euo pipefail
command -v gh >/dev/null 2>&1 || { echo "ERROR: GitHub CLI (gh) not found" >&2; exit 1; }
exec node "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/hosting/deploy-app.mjs" "$@"
