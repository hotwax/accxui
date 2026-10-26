# Installed-app service-worker compatibility

Run `node scripts/hosting/prepare.mjs apps/<app>` after the complete Firebase
hosting tree and rewrites have been assembled. Both shared deployment workflows
and `scripts/deploy.sh` do this. PR builds exercise the same preparation step.
It uses Node builtins and does not change an app's dependencies or pinned framework.
The release workflow checks out the current hosting tools separately because it
switches the framework checkout between historical refs while building tags.

Keep `/service-worker.js` available permanently, including versioned worker URLs.
Vue CLI installed apps still request this URL even after we migrated to Vite's
`/sw.js`. Returning the SPA HTML fallback makes worker updates fail. The old worker
can then keep serving an index that references deleted JavaScript bundles, leaving
a blank screen before any recovery code in the new app can run.

Preparation writes a small retirement worker at the old URL for the root and each
retained version, and adds a Firebase rewrite before the SPA rules for older version
worker URLs. Static files take precedence over rewrites, so retained versions also
need the physical replacement file. Worker responses use JavaScript MIME and
`Cache-Control: no-store`. Existing security headers, app rewrites and the Firebase
messaging worker remain intact.

The replacement uses `skipWaiting` and `activate.waitUntil`, unregisters itself,
and reloads only windows controlled by its registration. It has no fetch handler,
does not claim unrelated windows, and does not delete CacheStorage, IndexedDB,
localStorage, cookies, or push registrations. A window closing during recovery
must not prevent the other windows from navigating. Recovery depends on the browser
performing an online worker update; it cannot repair a permanently offline install
or replace a release that the deployment no longer serves.

Validation: `node --test scripts/hosting/*.test.mjs`. Browser regression steps:
install a caching worker and old index, remove its JS bundle and replace the worker
URL with an HTML fallback, reproduce the blank screen, then publish the prepared
worker at the **same URL** and trigger its normal update check. Verify current app
content loads and persisted login/draft data and unrelated workers remain intact.

Observed on iPadOS 27.0.1: Receiving, Fulfillment UAT and Order Routing loaded an
old index from `service-worker.js`; missing legacy JS was returned as HTML and
rejected by `X-Content-Type-Options: nosniff`. Unregistering the obsolete registration
and reloading restored all three apps, including after a cold relaunch.

References:
- https://firebase.google.com/docs/hosting/full-config#hosting_priority_order
- https://developer.mozilla.org/en-US/docs/Web/API/ExtendableEvent/waitUntil
- https://developer.mozilla.org/en-US/docs/Web/API/Clients/matchAll

## Retaining deployed versions

Release callers can set `reuseHostedVersions: true` to build only the newest release
(root and versioned URL) and keep older versions without reinstalling their historical
dependencies. The default remains rebuilding each retained tag.

`retain-versions.mjs` reads the current UAT Firebase file manifest, downloads only the
requested version directories, and verifies every file against its deployed SHA-256.
A missing version, changed content, unsafe path, occupied directory, or concurrent
release aborts before deployment. It never writes to Firebase. Run it after compatibility
preparation so even the retained workers stay unchanged; the root and new version
still receive current recovery endpoints. The final Firebase deployment includes the
complete tree and the usual hosted-version manifest and rewrites.

The helper uses the pinned Firebase CLI's authentication and Hosting API client.
For a read-only local trial, use `FIREBASE_ACCOUNT` with an existing CLI login;
`FIREBASE_TOOLS_LIB` can point to that installation's `firebase-tools/lib` directory.

## Local release build preflight

Run `pnpm deploy:app --build-only` from the framework root to prepare an app for
Dev, UAT or Prod without calling Firebase (including login). The same interactive
app, environment and retained-version choices apply. Each app tag's
`firebase-hosting-release.yml` supplies its `accxuiVersion`; releases without that
input use the caller's framework commit. Missing refs and frozen-lockfile install
failures stop the build.

The script creates isolated framework and nested app worktrees beneath
`apps/_worktrees/deploy-<app>-<environment>.*`. It does not switch or edit the
caller checkouts. These worktrees remain available after success or failure for
inspection; `build-versions.tsv` records the exact app and framework revisions.
The nested app contains `dist/`, generated Firebase configuration and a hosted
version manifest with the selected environment. Keep the generated environment
file private. Remove the worktrees through Git after the artifact is no longer
needed, following the repository's cleanup rules.

Normal `pnpm deploy:app` uses the same preparation, then asks whether to deploy.
Production additionally requires typing `deploy` after the build. Firebase gets
an explicit project, config path and environment Hosting target. The original
production artifact should be recorded separately before a rollout: rebuilding
an older app tag is not a substitute for keeping the existing Hosting version
available for an exact rollback.

Regression checks: `node --test scripts/deploy.test.mjs scripts/hosting/*.test.mjs`.
