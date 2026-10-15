# AccxUI — rules for agents

AccxUI is a framework (`common/`) plus apps under `apps/*`. Each app is its **own git repo**: a
change to `common/` and a change to an app are separate commits in separate repos.

## Local database (IndexedDB) — non-negotiable

Every app keeps server data in one IndexedDB database per OMS instance, filled by a background
sync worker. The build's lint (`dbConfig` in `eslint.config.js`) enforces most of this.

1. **Read** only with `useLiveEntity(appDb.tables.x, options)` (and `useSeedData()` for seed
   tables), in a composable or a `.vue` file. No `appDb.entity(...)` or `loadSeedData()` in app code:
   those are for `src/workers/**` and `src/db/**`. Stores, utils and the router take rows from their
   caller.
2. **Only worker sync domains write the app db.** A record the db is missing:
   `refreshAfterMutation(domain, pk)`, and the `useLiveEntity` on it shows it. A server change:
   `api()`, then `refreshAfterMutation(domain, pk)` or `resyncDomain(domain)` once the write has
   landed. Never write a response into a table.
3. **No Dexie, `dbClient`, `appDb.raw()` / `.get()` in app code; `appDb.client()` only in workers.**
   Table names always from `appDb.tables`, never a string.
4. **Worker code (`src/db/**`, `src/workers/**`) uses deep imports only** (`@common/db/schema/*`,
   `@common/db/sync/*`, `@common/core/workerRemoteApi`, …): never `@common`, `@common/db`,
   `commonUtil`, `api()`, stores or composables.
5. **Seed lookups:** `useSeedData()` during setup, in the page, component or composable that shows
   the labels; it shares its live reads with every component below it and closes them on unmount.
   Never in `App.vue` (lint rejects it): one there holds every seed table open for the session. A
   store action or util that needs seed rows takes them as an argument.
6. **Sync lifecycle:** `App.vue` starts sync when `useAuth().isAuthenticated` turns true;
   `postLogin` stops then restarts it; `postLogout` stops it (which clears the tables). A page that
   activates class A domains deactivates them with the same owner in `onIonViewDidLeave`.
7. **Any schema change bumps the app db `version`.** Nothing detects a forgotten bump.

**Load the skill before the work:** reading or writing app data → `accxui-data-access`; a new app
database, table, sync domain or seed table → `accxui-app-db-setup`. Full reference:
`docs/APP_DB_DEVELOPER_GUIDE.md`.

## App layout

The build's lint enforces these too; the `accxui-data-access` skill has the recipes.

- **Composables** (`@/composables/*`, plus `useLiveEntity` and `useSeedData`) are used only by other
  composables and `.vue` files: never in a store, util, router, `src/db` or a worker. The framework's
  plain helpers (`useAuth`, `useSolrSearch`, …) are not affected.
- **API calls** live only in composables, Pinia stores (when a store needs the data) and worker sync
  domains. A `.vue` file calls a composable or store; utils and the router never call the API.
- **Utils are pure:** no API, no stores, no app db, no composables. They take what they need as
  parameters.
- **Stores and the app db stay apart:** a store never imports an app db module (only `@/db/appDbSync`
  to reconcile after a write), and `src/db` / `src/workers` never import a store. A page or domain
  composable joins store data with `useLiveEntity` / `useSeedData` rows.
- `src/db/` holds only the database objects, the schema, the sync facade (`appDbSync.ts`) and any
  app-local Dexie store. There is no `src/services/`.

## Checks

- Framework: `npx vitest run common/tests` from this root. Never bare `vitest` here: it collects the
  apps' specs, which fail on `@/` aliases.
- An app: `pnpm test:unit` and `pnpm build` from `apps/<app>` (the build lints first).
