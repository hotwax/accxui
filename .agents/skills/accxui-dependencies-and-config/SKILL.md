---
name: accxui-dependencies-and-config
description: Use when adding or upgrading a package, adding or reading an environment variable, running an AccxUI app locally, cutting a release or deploying, in the accxui workspace (common/ framework or any app under apps/*). Triggers include pnpm add / pnpm install, "catalog:", pnpm-workspace.yaml, pnpm-lock.yaml, frozen-lockfile, package.json version, .env / .env.example / .env.local, import.meta.env.VITE_*, VITE_APP_VERSION_CONFIG, VITE_APP_PERMISSION_ID, commonEnvPlugin, dev auto login (VITE_ALIAS, VITE_DEV_USERNAME), pnpm --filter <app> dev / build, pnpm release / cut-release.sh, pnpm deploy:app / deploy.sh, accxuiVersion, firebase-hosting-merge / release workflows, GitHub secrets, multi-version hosting (/vX.Y.Z/), and pnpm update:apps.
---

# Dependencies, env config and releases

One pnpm workspace: the framework lives in the accxui root (`common/`, root `package.json`), apps in
`apps/*` (each its own git repo, in the workspace via `pnpm-workspace.yaml`), one lockfile at the root.

## Dependencies

| Package used by | Declared in |
|---|---|
| `common/` (framework) | root `package.json` |
| an app | `apps/<app>/package.json` |

1. **Shared versions come from the catalog.** Add the exact version to the `catalog:` block in
   `pnpm-workspace.yaml`, then reference it as `"<pkg>": "catalog:"` in the package that uses it.
   Prefer an existing catalog entry; never pin a second version of something the catalog has.
2. An app that really needs a different version keeps an explicit version in its own `package.json`
   (it overrides the catalog), or a named catalog (`catalogs.<name>`, referenced `"catalog:<name>"`).
   Ask before doing either.
3. **Install from the accxui root:** `pnpm install` (never inside an app, never `npm`). Commit the
   root `pnpm-lock.yaml` with the accxui change; CI installs with a frozen lockfile, so an app whose
   dependencies don't match the lockfile fails its build.
4. The framework's packages are resolved for apps through Vite (`@common` → `../../common`,
   `resolve.dedupe` for vue / pinia / ionic …). Don't add a framework package to an app to make an
   import work; add it to the root.
5. `pnpm.overrides` (root) force `rollup`, `@stencil/core`, `pinia` to the catalog.
6. Ask before adding any new dependency.

## Env variables

- **App variables** live in `apps/<app>/.env` (git-ignored), with every name listed in
  `apps/<app>/.env.example` (committed; placeholders only, no secrets). Only `VITE_*` names reach code,
  read as `import.meta.env.VITE_X` (typed loosely in `common/env.d.ts`). JSON values (`VITE_APP_VERSION_CONFIG`,
  `VITE_SHOPIFY_SHOP_CONFIG`, `VITE_FIREBASE_CONFIG`) are `JSON.parse`d by the code that uses them.
- **Adding one:** add the name to `.env.example` (and your `.env`), read it where needed. If it holds a
  per-environment or secret value, it must also be set at deploy, as a GitHub secret the hosting workflows
  inject (ask). Every deploy, `pnpm deploy:app` included, builds in GitHub Actions; per-environment build
  values are mapped in `BUILD_SECRETS` (`scripts/hosting/manager/build.mjs`) and in the shared workflows.
- **Shared by every app:** `VITE_OMS_TYPE`, `VITE_I18N_LOCALE`, `VITE_I18N_FALLBACK_LOCALE`,
  `VITE_CACHE_MAX_AGE`, `VITE_VIEW_SIZE`, `VITE_APP_PERMISSION_ID` (app access, **accxui-permissions**),
  `VITE_APP_VERSION_CONFIG` (`{ appId, environmentTypeId, buildVersion }`, below), `VITE_DEFAULT_LOG_LEVEL`.
- **Dev login, root only:** `VITE_DEFAULT_ALIAS`, `VITE_ALIAS` (JSON), `VITE_DEV_USERNAME`,
  `VITE_DEV_PASSWORD` in the accxui root's `.env.development.local` (`docs/DEV_AUTO_LOGIN.md`).
  `commonEnvPlugin` (in every app's `vite.config`) passes root `VITE_*` values to an app **only while
  serving**, only where the app's own value is empty. Never put credentials in an app's `.env` or
  `.env.local` (a production build reads them into the bundle), and never list a production instance in
  `VITE_ALIAS`.
- Never commit `.env` or `.env.local`.

## Running locally

From the accxui root: `pnpm --filter <app> dev` (Company on 8100), `pnpm --filter <app> build`. The
login page offers dev servers on `localhost` (`VITE_LOCAL_API_SERVER_PORTS` + 8080) and your aliases.
Checks: `npx vitest run common/tests` at the root; `pnpm test:unit` and `pnpm build` in the app.

## Versions and releases

- **Multi-version hosting:** an app can be served at `/` and at `/vX.Y.Z/` side by side.
  `VITE_APP_VERSION_CONFIG.buildVersion` picks the build's `base` and `dist/` folder; at login and
  on each signed-in reload `fetchAppVersion` asks the OMS which version this tenant is pinned to and the
  router redirects there (`docs/MULTI_VERSION_APP_HOSTING_DESIGN.md`, **accxui-auth**). Never hardcode a version in code.
- **Cut a release:** `pnpm release <app>` (or `pnpm release accxui`) from the accxui root. It asks for
  the version, for an app also the `accxuiVersion`, bumps `package.json` (and the app's
  `firebase-hosting-release.yml` `accxuiVersion:`), opens a `release` → `main` PR, merges it after checks,
  and creates the GitHub release `vX.Y.Z` with generated notes; the tag triggers the UAT deploy.
  **Release accxui first** when the app needs framework changes: the app's tag pins an accxui tag.
  `--dry-run` shows what it would do.
- **Deploy on demand:** `pnpm deploy:app` (needs the GitHub CLI). Nothing builds locally: it runs the
  app's `manage-app-hosting.yml` in GitHub Actions, shows the plan, asks for confirmation, then executes.
  Default: the latest patch of the newest N minors with the latest release at root (`--count N`);
  `--versions a,b --default a` makes the site exactly those versions; `--publish-only --versions a,b`
  adds or rebuilds just those, leaving root alone. Dev re-runs the latest merge deploy. UAT / prod only
  for apps onboarded with `.github/app-hosting.json` (`scripts/hosting/manager/README.md`).
- **CI** (`hotwax/accxui/.github/workflows/common-*.yml`, called by each app's thin workflows): a PR
  builds the app; a push to `main` deploys dev; a tag deploys every retained version to UAT.
- Release notes live on GitHub releases only (`--generate-notes`); don't edit `release-notes.md` /
  `CHANGELOG.md`.
- `pnpm update:apps` fast-forwards `main` in every app repo; it never rebases or forces.

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| `pnpm add <pkg>` inside an app | a version outside the catalog, lockfile drift | catalog entry + `"catalog:"`, `pnpm install` at the root |
| `npm install` | a second lockfile | `pnpm install` at the root |
| A new env var only in your `.env` | other devs and CI build without it | list it in `.env.example`; set it for deploy |
| Credentials in an app `.env` | shipped in the production bundle | root `.env.development.local` |
| Releasing an app before accxui | CI fails: the pinned accxui tag doesn't exist | release accxui first |
| Hardcoding `/vX.Y.Z/` paths | breaks other versions | use `BASE_URL` / router paths |
| Committing `.env*` | leaked secrets | they're git-ignored; keep them so |
