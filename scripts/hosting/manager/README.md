# App hosting workflows

The Release Management UI uses the signed-in user's GitHub token to dispatch a thin workflow in the app repo. That workflow calls `common-app-hosting.yml@main` with `tools_ref: main` (a full AccxUI commit SHA also works, to pin both). The run resolves the tools to an exact commit and binds the plan to it, so if `main` moves between plan and execute, execute refuses and asks for a new plan. Firebase credentials remain in the Actions environment. `pnpm deploy:app` (`scripts/hosting/deploy-app.mjs`) dispatches the same workflow from the command line with the signed-in GitHub CLI user, so local deploys follow the same plan and execute steps.

## Contract

Caller `workflow_dispatch` inputs: `operation` (`inventory`, `plan`, `execute`), `environment` (`uat` or `prod`), `request_id` (UUID), `action` (`publish`, `default`, `remove`, `rebuild`, `replace`), `version` (a comma-separated list for `publish` and `replace`), `default_version` (`replace` only), `plan_sha`, `confirmation`. Its `run-name` must include `[${{ inputs.request_id }}]` for UI tracking. Dispatch only on the app's default branch. Callers list `uat` and `prod`; the shared workflow refuses production unless `APP_HOSTING_PROD_ENABLED=true`.

Repository discovery file `.github/app-hosting.json`:

```json
{"schemaVersion":1,"workflow":"manage-app-hosting.yml","stateBranch":"app-hosting-state","environments":["uat","prod"]}
```

Read the app's current `.firebaserc` to resolve the project and site. Do not hardcode targets in the UI. The workflow verifies project/site membership, reads the active live channel and its complete file manifest, and verifies public Default metadata against that manifest. Inventory snapshots include a checked timestamp, version directories and Default when identifiable; no release tag is assumed to be hosted.

## Credentials and permissions

`envPAT` provides source repository read/clone access. The calling `GITHUB_TOKEN` needs Contents write and Actions read for state. Firebase access uses a service account key per Firebase project, each holding only the Firebase Hosting Admin and Service Usage Viewer roles: `UAT_FIREBASE_SERVICE_ACCOUNT` for UAT and `PROD_FIREBASE_SERVICE_ACCOUNT` for production. The workflow selects the key for the requested environment; the deprecated Firebase CLI token is not used. App build values come from secrets named per environment and are mapped in `build.mjs` (`BUILD_SECRETS`): UAT builds use `DEV_VUE_APP_FIREBASE_CONFIG`, `DEV_VUE_APP_FIREBASE_VAPID_KEY` and `DEV_SHOPIFY_SHOP_CONFIG`, as the tag rollout does; production builds use `PROD_VUE_APP_FIREBASE_CONFIG`, `PROD_VUE_APP_FIREBASE_VAPID_KEY`, `PROD_SHOPIFY_SHOP_CONFIG`, `PROD_OMS_ALIAS`, `PROD_FARO_COLLECTOR_URL` and `PROD_FARO_API_KEY`. A missing production value is left at the app's `.env.example` default, never taken from the dev values. No local operator credentials are part of these changes.

Production requires explicit onboarding, `PROD_FIREBASE_SERVICE_ACCOUNT`, and `APP_HOSTING_PROD_ENABLED=true`. Configure environment reviewers in GitHub before enabling production. This PR does not change environment settings or deploy anything.

## Review and execution

Inventory and operation results are written to `app-hosting-state`: `inventory/<environment>.json`, `requests/<uuid>.json`, and `plans/<uuid>.json`. Plans expire after one hour. Execute takes the exact plan blob SHA, checks actor/repository/environment/action/version/tool SHA/confirmation, re-inspects live Hosting, re-resolves source commits, and recomputes the plan. Changes require a fresh review.

Builds run in isolated runner directories from the released app commit and its immutable framework pin, using frozen dependencies and the correct AppEnvUAT/AppEnvProd. A failed build prevents publishing. File hashes and routing/security configuration are verified before release and read back afterward. Publish adds the listed versions and rebuilds listed versions that are already hosted, clearing their old files; the root and unlisted versions are preserved. Default changes require the old Default to have a retained version URL. Removal rejects the current Default. Rebuild includes every hosted version and Default, not merely the latest two releases. Replace makes the site exactly the listed versions with the chosen Default (one of them) at root and removes every other version; it does not require a verified current Default, and asks for `REPLACE <ENV> SITE` when it removes versions. Every action rewrites `hosted-versions.json` and `release-manager.json` once the Default is known, and keeps the manifest's uncached cross-origin header. An added version's `no-cache` rule goes before the existing header rules, so the immutable `**/assets/**` cache still applies to its files; removing a version drops its rule.

The job shares `release-${{ github.repository }}` concurrency with the existing tag rollout. Other workflows/console operators must use the same discipline: Firebase lacks an atomic release precondition, so external simultaneous deployments remain a race despite last-moment fingerprint checks. A failed result after publication may mean verification/state persistence failed; inspect live Hosting before retrying.

The existing tag rollout is unchanged unless `publishHostingInventory` is opted in; this refreshes the derived snapshot after its normal deployment. `hostingToolsRef` lets that caller pin the inventory tooling, independently from each app release's framework pin.

## Validation

Run `node --test scripts/hosting/*.test.mjs scripts/hosting/manager/*.test.mjs`. These use modeled API responses for destructive paths. A read-only run of `preparePlan` against Job Manager UAT confirmed Default v3.5.0, hosted v3.5.0/v3.4.2 and immutable source resolution for a potential v3.4.2 rollback. No Firebase writes were made.

After approved merges, run a separately authorized UAT end-to-end exercise covering inventory, plan, execution, workflow tracking, publish/default/rollback/remove/rebuild and browser readback. Local tests and CI checks alone do not prove a live deployment.
