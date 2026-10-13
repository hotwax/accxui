# AccxUI — rules for agents

AccxUI is a framework (`common/`) plus apps under `apps/*`. Each app is its **own git repo**: a
change to `common/` and a change to an app are separate commits in separate repos.

## Local database (IndexedDB) — non-negotiable

Every app keeps server data in one IndexedDB database per OMS instance, filled by a background
sync worker. The build's lint (`dbConfig` in `eslint.config.js`) enforces most of this.

1. **Read** with `useLiveEntity(appDb.tables.x, options)` on screen, or
   `appDb.entity(appDb.tables.x).get / query / all` for an answer now. Nothing else.
2. **Never write the app db from app code.** Each table's sync domain (`src/workers/**`) is its only
   writer. A record the db is missing: `refreshRecord(domain, pk)`, then read it back. A server
   change: `mutate(request, { refresh / resync })`, or `api()` + `refreshAfterMutation` /
   `resyncDomain` where the app has not wired `mutate` yet. Never write a response into a table.
3. **No Dexie, `dbClient`, `appDb.raw()` / `.get()` in app code; `appDb.client()` only in workers.**
   Table names always from `appDb.tables`, never a string.
4. **Worker code (`src/db/**`, `src/workers/**`) uses deep imports only** (`@common/db/schema/*`,
   `@common/db/sync/*`, `@common/core/workerRemoteApi`, …): never `@common`, `@common/db`,
   `commonUtil`, `api()`, stores or composables.
5. **Sync lifecycle:** `App.vue` starts sync when `useAuth().isAuthenticated` turns true;
   `postLogin` stops then restarts it; `postLogout` stops it (which clears the tables). A page that
   activates class A domains deactivates them with the same owner in `onIonViewDidLeave`.
6. **Any schema change bumps the app db `version`.** Nothing detects a forgotten bump.

**Load the skill before the work:** reading or writing app data → `accxui-data-access`; a new app
database, table, sync domain or seed table → `accxui-app-db-setup`. Full reference:
`docs/APP_DB_DEVELOPER_GUIDE.md`.

## Checks

- Framework: `npx vitest run common/tests` from this root. Never bare `vitest` here: it collects the
  apps' specs, which fail on `@/` aliases.
- An app: `pnpm test:unit` and `pnpm build` from `apps/<app>` (the build lints first).
