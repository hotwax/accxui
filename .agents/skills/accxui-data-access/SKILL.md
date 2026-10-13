---
name: accxui-data-access
description: How AccxUI app code reads and writes local app data (IndexedDB). Use whenever you read, list, look up, cache, store, upsert or delete server data in apps/company or apps/order-manager, touch useLiveEntity, companyDb / orderManagerDb, appDb.entity, appDb.tables, useSeedData, mutate, refreshAfterMutation or resyncDomain, a worker sync domain, Dexie, liveQuery or IndexedDB, send a POST / PUT / DELETE that changes server data, or fix a data-access lint error (one ending "See docs/APP_DB_DEVELOPER_GUIDE.md §7").
---

# AccxUI data access

App code reaches the app database (one IndexedDB database per OMS instance) through **two
patterns only**. Both go through the framework's `dbClient`; app code never touches Dexie.
The root `eslint.config.js` enforces this with core rules (`no-restricted-syntax`, `@typescript-eslint/no-restricted-imports`); every data-access message ends with "See docs/APP_DB_DEVELOPER_GUIDE.md §7".

`appDb` below is the app's database object: `companyDb` (`@/db/companyDb`) in Company,
`orderManagerDb` (`@/db/orderManagerDb`) in Order Manager.

## The two patterns

| You want… | Use | Where |
|---|---|---|
| Rows that stay current **on screen** | `useLiveEntity<any>(appDb.tables.x, options)` | components, views, composables — during `setup` |
| An answer **now**, or a **write** | `appDb.entity(appDb.tables.x).get / query / all / first / count / upsertMany / remove …` | anywhere: stores, services, utils, async handlers, composables, workers |

### 1. Live, on screen — `useLiveEntity`

```ts
import { useLiveEntity } from "@common";
import { companyDb } from "@/db/companyDb";

// Reactive options: pass a function; it re-subscribes when they change.
const { records, first, hydrated } = useLiveEntity<any>(
  companyDb.tables.shopifyShops,
  () => ({ equals: { shopId: props.shopId } }),
);
```

- Returns `{ records, first, count, hydrated, error }` refs. `hydrated` tells "not loaded yet" from
  "really empty" — use it for loading/empty states.
- It is a composable: never call it in a store, service, util or worker.
- While an id is unknown, return `{ filter: () => false }`, not `{}` (which reads the whole table).

### 2. One-shot read or write — `appDb.entity`

```ts
import { companyDb } from "@/db/companyDb";

const shops = companyDb.entity(companyDb.tables.shopifyShops);

const one = await shops.get(shopId);                              // by primary key
const some = await shops.query({ equals: { productStoreId } });   // same QueryOptions
const all = await shops.all();                                    // then filter/find in JS — fine
await shops.upsertMany([fetchedRow]);                             // write-through after a fetch
```

Nothing re-renders afterwards. For live updates outside a component (rare, stores / services /
utils only, never setup code or the worker), `appDb.entity(t).live(options)` returns a Dexie
`Observable`: keep the subscription and `unsubscribe()` it in the logout teardown. Guide §1e.

`QueryOptions`: `scope` / `equals` (equalities, resolved through indexes), `dateField` + `since` /
`until` / `order` (newest first by default), `filter`, `limit`.

## Table names: always `appDb.tables`

`companyDb.tables.facilities`, `orderManagerDb.tables.statuses`. These are static (no database
needed — they work in workers and before sign-in) and list exactly the tables that app's database
has. A typo is a missing property and fails to compile. **Never** pass a string literal
(`entity("facilities")`, `useLiveEntity("facilities")`) — the lint rule rejects it
(there is no autofix; write `appDb.tables.x`).

## After a server write

**New writes use `mutate`** (from `@/services/appDbSync`): it sends the request through `api()` and
reconciles the local db before it resolves. The reconcile argument is required, so the refresh
cannot be forgotten. Never write the server's response into the table yourself.

```ts
await mutate({ url: `oms/serviceJobs/${jobName}`, method: "put", data }, { refresh: [["serviceJob", { jobName }]] });
await mutate({ url: "oms/facilityGroups", method: "post", data }, { resync: ["facilityGroup"] });     // whole domain
await mutate({ url: "oms/facilities", method: "post", data }, (resp) => ({ refresh: [["facility", { facilityId: resp.data.facilityId }]] }));
await mutate({ url: "oms/jobs/run", method: "post", data }, { none: "fires a job; nothing stored locally" });
```

- `refresh` and `resync` can be combined; list every domain the write touches.
- A failed write (thrown, or flagged by the app's `isError`) rejects with its own error and
  reconciles nothing.
- **Adoption is in progress.** Existing code still uses `api()` + `refreshAfterMutation` /
  `resyncDomain`; leave it unless you are migrating it. If your app's `appDbSync.ts` does not export
  `mutate` yet, wire it there first: pass `api` and `isError: (resp) => commonUtil.hasError(resp)` to
  `setupAppDbSync` and add `mutate` to the exports. Only fall back to the two-call form below when
  `mutate` cannot express the write.

The two-call form, for existing code:

```ts
await refreshAfterMutation("serviceJob", { jobName });   // domain name + primary key
// or, to re-snapshot a whole domain:
await resyncDomain("facilityGroup");
```

These take **sync domain names** (strings), not table names. A `CacheReconciliationError` (from
either form) means the server write succeeded and only the local refresh failed — warn, don't retry
the write.

## Seed lookups

Labels, option lists and joins over seed reference tables come from `useSeedData()` (components)
or `seedData` (stores, utils): `seed.facilityName(id)`, `seed.enumsByType(typeId)`. It is a shared
cache on the same layer, not a separate data path.

## Never in app code (data-access lint errors)

| Don't | Do instead |
|---|---|
| `import Dexie / liveQuery from "dexie"` | the two patterns above |
| `dbClient`, `getAppDb`, `ensureDbReady`, `hasSyncedThisLogin` …, or value imports from `@common/db/storage/dbClient` / `baseDb` / `schema/appDbRegistry` | `appDb.entity(...)` / `useLiveEntity` (type-only imports are fine) |
| `appDb.raw()` | doesn't exist — use `appDb.entity(...)` |
| `appDb.get(oms)` | worker entry (`src/workers/*.worker.ts`) and `src/db/**` only |
| `appDb.client()` | worker sync domains (`src/workers/**`) and as the argument to `useDbStatus(...)` only |
| `useLiveEntity` outside `.vue` files, `src/components`, `src/views`, `src/composables` | `appDb.entity(...)` |
| `.live()` / `.liveRead()` in `.vue`, components, views, composables | `useLiveEntity` (it owns the subscription) |
| `.live()` / `.liveRead()` in `src/workers/**` | a one-shot `appDb.entity(...).get / query / all` |
| `x.live(...).subscribe(...);` with the result discarded | keep it; `unsubscribe()` it in the logout teardown |
| `activateSyncDomains` without `deactivateSyncDomains` in the file, or in a `.vue` page without `onIonViewDidLeave` | deactivate with the same owner in `onIonViewDidLeave` (not only on unmount) |
| `deactivateSyncDomains()` with no owner | `deactivateSyncDomains(SYNC_OWNER)` |
| a string literal table name | `appDb.tables.x` |

Exempt: an app-local Dexie store outside the app database, switched off in that app's own
`eslint.config.js` (Company `src/utils/storage.ts`, Order Manager `src/services/productDb.ts`). The app's
config spreads `dbConfig` from the root `eslint.config.js`: the local-database rules, plus no
`api` / `client` imports from `@common` in `.vue` files.

## Adding a table

Declare the entity in the app's schema (`src/db/companySchema.ts`), add indexes for every way you
query it, **bump `version`** in the app db module, and give it a sync domain. It then appears on
`companyDb.tables` automatically. Details: `docs/APP_DB_DEVELOPER_GUIDE.md` §2–§3.

## Check your work

```bash
pnpm lint                      # from the app directory; the build (`eslint src && vite build`) runs it first
```

Reference: `docs/APP_DB_DEVELOPER_GUIDE.md` (§1 patterns, §7 rules); the rules themselves are in
the root `eslint.config.js` (the `DA_*` selector lists).
