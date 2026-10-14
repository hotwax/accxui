---
name: accxui-data-access
description: How AccxUI app code reads and writes local app data (IndexedDB). Use whenever you read, list, look up, cache, store, upsert or delete server data in any AccxUI app (apps/company, apps/order-manager or a new one), touch useLiveEntity, companyDb / orderManagerDb, appDb.entity, appDb.tables, useSeedData, refreshAfterMutation, resyncDomain or refreshRecord, a worker sync domain, Dexie, liveQuery or IndexedDB, send a POST / PUT / DELETE that changes server data, or fix a data-access lint error (one ending "See docs/APP_DB_DEVELOPER_GUIDE.md §7").
---

# AccxUI data access

Every app keeps server data in one IndexedDB database per OMS instance, filled by a background sync
worker. `appDb` below is the app's database object: `companyDb` (`@/db/companyDb`) in Company,
`orderManagerDb` (`@/db/orderManagerDb`) in Order Manager. Building the database itself (tables,
domains, worker) is the **accxui-app-db-setup** skill.

## Rules

1. **Read through two patterns only:** `useLiveEntity` on screen, `appDb.entity(...)` for an answer
   now. *Why:* both go through the framework's `dbClient`, which checks the database version and
   projects every row; anything else bypasses that.
2. **Never write the app db from app code.** Only a table's sync domain (`src/workers/**`) writes
   it. *Why:* one writer keeps one row shape; a second writer with its own fetch drops fields the
   domain stores. Lint rejects `upsertMany` / `snapshotReplace` and writes on `appDb.entity(...)`
   outside `src/workers/**` and `src/db/**`.
3. **A record the db is missing:** `refreshRecord(domain, pk)`, then read it back. Never `api()` it
   and store it yourself.
4. **After a server write:** `api()` from a composable or store, check it landed, then
   `refreshAfterMutation(domain, pk)` or `resyncDomain(domain)`. Never write the response into a
   table. *Why:* the domain re-reads the server's version, so the row matches what the next sync
   would store.
5. **Table names from `appDb.tables`, never a string.** *Why:* a typo fails to compile instead of
   reading an empty store.
6. **No Dexie, `dbClient`, `appDb.raw()` / `.get()` in app code; `appDb.client()` only in workers.**
7. **No server fetch on mount for synced data.** Read what the worker stored; the worker owns the
   cadence. *Why:* a page fetch reintroduces the load waterfalls the app database removes.

## Which call

| You want… | Use | Where |
|---|---|---|
| Rows that stay current **on screen** | `useLiveEntity<any>(appDb.tables.x, options)` | components, views, composables, during `setup` |
| An answer **now** | `appDb.entity(appDb.tables.x).get / query / all / first / count` | anywhere: stores, services, utils, composables, workers |
| A record the db **doesn't have** | `refreshRecord(domain, pk)`, then `appDb.entity(...).get` | composables, stores |
| To **change** server data | `api()`, check it, then `refreshAfterMutation` / `resyncDomain` | composables, stores |
| Labels and option lists from seed tables | `useSeedData()` (components) / `seedData` (stores, utils) | anywhere |
| Live rows **outside** a component (rare) | `appDb.entity(t).live(options)`; keep and `unsubscribe()` it on logout | stores, services, utils |

## Recipes

**On screen:**

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
  "really empty": use it for loading and empty states.
- While an id is unknown, return `{ filter: () => false }`, not `{}` (which reads the whole table).

**An answer now:**

```ts
const shops = companyDb.entity(companyDb.tables.shopifyShops);
const one = await shops.get(shopId);                              // by primary key
const some = await shops.query({ equals: { productStoreId } });   // through an index when one fits
const all = await shops.all();                                    // then filter / find in JS
```

`QueryOptions`: `scope` / `equals` (equalities; a dotted path reaches a nested field, and a list
matches when any value does), `dateField` + `since` / `until` / `order` (newest first by default),
`filter`, `limit`. Nothing re-renders afterwards.

**A record the db is missing:**

```ts
import { refreshRecord } from "@/services/appDbSync";

const logs = companyDb.entity(companyDb.tables.dataManagerLogs);
const cached = await logs.get(logId);
if (cached) return cached;
await refreshRecord("dataManagerLog", { logId });   // the domain's refetchOne, in the worker
return (await logs.get(logId)) ?? null;
```

- Takes a **sync domain name** and that record's key. The domain needs a `refetchOne`; a table
  filled only on request gets a class C domain (accxui-app-db-setup).
- Waits only for the worker to be open, not its first sync pass. Rejects with the domain's own
  error, or the start error if the sync could not start.

**After a server write:**

```ts
import { refreshAfterMutation, resyncDomain } from "@/services/appDbSync";

const response = await api({ url: `oms/serviceJobs/${jobName}`, method: "put", data });
if (commonUtil.hasError(response)) throw new Error(getResponseErrorMessage(response, "Failed to save the job."));
await refreshAfterMutation("serviceJob", { jobName });   // re-reads that one record through the domain
// or, when the write touches more than one record:
await resyncDomain("facilityGroup");                     // re-snapshots the whole domain
```

- Both take **sync domain names**, not table names. List every domain the write touches.
- Reconcile only after the write is known to have landed: a failed write reconciles nothing.
- A `CacheReconciliationError` means the write succeeded and only the local refresh failed: warn
  ("saved, refresh to see it"), don't retry the write.

## Lint errors and their fix

Every data-access message ends with "See docs/APP_DB_DEVELOPER_GUIDE.md §7".

| Rejected | Do instead |
|---|---|
| `import Dexie / liveQuery from "dexie"` | the two read patterns |
| `dbClient`, `getAppDb`, `ensureDbReady`, `hasSyncedThisLogin` …, or value imports from `@common/db/storage/dbClient` / `baseDb` / `schema/appDbRegistry` | `appDb.entity(...)` / `useLiveEntity` (type-only imports are fine) |
| `appDb.raw()` | doesn't exist: `appDb.entity(...)` |
| `appDb.get(oms)` | worker entry (`src/workers/*.worker.ts`) and `src/db/**` only |
| `appDb.client()` | worker sync domains, and as the `useDbStatus(...)` argument only |
| `useLiveEntity` outside `.vue` files, `src/components`, `src/views`, `src/composables` | `appDb.entity(...)` |
| `.live()` / `.liveRead()` in `.vue`, components, views, composables | `useLiveEntity` (it owns the subscription) |
| `.live()` / `.liveRead()` in `src/workers/**` | a one-shot `appDb.entity(...).get / query / all` |
| `x.live(...).subscribe(...);` with the result discarded | keep it; `unsubscribe()` it in the logout teardown |
| `activateSyncDomains` without `deactivateSyncDomains` in the file, or in a page without `onIonViewDidLeave` | deactivate with the same owner in `onIonViewDidLeave` |
| `deactivateSyncDomains()` with no owner | `deactivateSyncDomains(SYNC_OWNER)` |
| a string-literal table name | `appDb.tables.x` |
| `upsertMany` / `snapshotReplace` anywhere, or `put` / `bulkPut` / `remove` / `bulkRemove` / `clear` on `appDb.entity(...)`, outside `src/workers/**` and `src/db/**` | `refreshRecord` for a missing record; `refreshAfterMutation` / `resyncDomain` after a server write |
| `import { api, client } from "@common"` in a `.vue` file | the call goes in a composable or store |

Exempt: an app-local Dexie store outside the app database, switched off in that app's own
`eslint.config.js` (Company `src/utils/storage.ts`, Order Manager `src/services/productDb.ts`).

## Before you finish

- [ ] Reads use `useLiveEntity` / `appDb.entity`, table names from `appDb.tables`.
- [ ] No app-db writes outside `src/workers/**`; missing records go through `refreshRecord`.
- [ ] Every server write reconciles with `refreshAfterMutation` / `resyncDomain` for each domain it touches.
- [ ] A new table or domain went through accxui-app-db-setup (schema, `version` bump, registered domain).
- [ ] `pnpm lint` (or `pnpm build`, which lints first) and `pnpm test:unit` pass in the app.

Reference: `docs/APP_DB_DEVELOPER_GUIDE.md` (§1 patterns, §4 writes, §7 rules).
