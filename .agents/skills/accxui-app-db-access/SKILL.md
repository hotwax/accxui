---
name: accxui-app-db-access
description: "Use when AccxUI app code reads or writes the local app database (IndexedDB) in an app that has one (apps/company, apps/order-manager or a new one): showing synced rows, looking up a record, reconciling after a POST / PUT / DELETE, or fixing a data-access lint error. Triggers include useLiveEntity, companyDb / orderManagerDb, appDb.tables, appDb.entity, appDb.client, hydrated, refreshAfterMutation, resyncDomain, CacheReconciliationError, which domain name or pk to pass, a refresh that resolves 0, a record missing from the db, Dexie, liveQuery, IndexedDB, upsertMany / snapshotReplace outside a worker, and lint errors ending 'See docs/APP_DB_DEVELOPER_GUIDE.md §7'."
---

# AccxUI app database: reading and writing local data

Every app keeps server data in one IndexedDB database per OMS instance, filled by a background sync
worker. `appDb` below is the app's database object: `companyDb` (`@/db/companyDb`) in Company,
`orderManagerDb` (`@/db/orderManagerDb`) in Order Manager. Building the database itself (tables,
domains, worker) is **accxui-app-db-setup**; which folder may call the API or a composable is
**accxui-app-layers**.

## Rules

1. **App code reads the app db only through `useLiveEntity`** (and `useSeedData` for seed tables:
   **accxui-seed-data**), in a composable or a `.vue` file, during setup. No `appDb.entity(...)`,
   `appDb.client()` (except as the `useDbStatus(...)` argument), `loadSeedData()`, Dexie or `dbClient`
   outside `src/workers/**` and `src/db/**`. *Why:* one read pattern, live by default; the worker owns
   everything else.
2. **Stores, utils and the router never read the app db.** They take rows from their caller; a page or
   domain composable joins store data with `useLiveEntity` / `useSeedData` rows.
3. **Only worker sync domains write the app db.** A record the db is missing: `refreshAfterMutation`
   (it runs the domain's `refetchOne`). After a server write: `refreshAfterMutation` /
   `resyncDomain`. Never write a response into a table.
4. **Table names from `appDb.tables`, never a string.**
5. **No server fetch on mount for synced data**: read what the worker stored; the worker owns the
   cadence (class A data the page polls: **accxui-page-sync**).

## Where app-db code goes

| Code | Lives in | May use |
|---|---|---|
| Reading app-db rows, seed labels | a composable or `.vue` file | `useLiveEntity`, `useSeedData` |
| Joining store data with app-db / seed rows | a page or domain composable | stores + `useLiveEntity` / `useSeedData` |
| Reconciling after a server write | the composable or store action that made the write | `refreshAfterMutation`, `resyncDomain` from `@/db/appDbSync` |
| Writing the app db, polling the server | a worker sync domain (`src/workers/**`) | `appDb.entity(...)`, `appDb.client()`, `workerRemoteApi` |
| The database, schema, sync facade, app-local Dexie stores | `src/db/` | deep `@common/db/*` imports only |

## Which call

| You want… | Use | Where |
|---|---|---|
| Rows that stay current **on screen** | `useLiveEntity<any>(appDb.tables.x, options)` | composables, `.vue`, during setup |
| Labels and option lists from seed tables | `useSeedData()` | composables, `.vue` (never `App.vue`) |
| Seed rows inside a store action or util | take them as an argument; the composable / page passes `await seed.getFacilityTypes()`, `seed.facilities()`, … | the caller |
| A record the db **doesn't have** | `refreshAfterMutation(domain, pk)`; the `useLiveEntity` on it then shows it | composables, stores |
| To **change** server data | `api()`, check it, then `refreshAfterMutation` / `resyncDomain` | composables, stores |
| Rows a class A domain polls while the screen is open | activate it from the page: **accxui-page-sync** | the page (or a composable it calls) |

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

- Returns `{ records, first, count, hydrated, synced, error }` refs. `hydrated`: the first read
  landed (and the worker isn't still starting). Use it for loading states.
- **"Not synced yet" vs "really empty" for one domain's table:** pass `syncDomain: "<domain name>"`
  in the options. The rows are then read in the same transaction as that domain's login marker, and
  `synced` is true only once the domain has written this login. Show the skeleton while `!synced`,
  the empty state when `synced && !records.length`. (Seed getters have `.withSync` for the same
  thing: **accxui-seed-data**; a polled class A list uses the first-pass check: **accxui-page-sync**.)

  ```ts
  const { records: audits, synced } = useLiveEntity<any>(appDb.tables.audits, { syncDomain: "audit" });
  ```
- While an id is unknown, return `{ filter: () => false }`, not `{}` (which reads the whole table).
- `QueryOptions`: `scope` / `equals` (equalities; a dotted path reaches a nested field, and a list
  matches when any value does), `dateField` + `since` / `until` / `order` (newest first by default),
  `filter`, `limit`.

**Seed labels and option lists** (every getter, `.withSync`, and stores that need seed rows: **accxui-seed-data**):

```ts
import { useSeedData } from "@common/db";

const seed = useSeedData();                      // during setup only
// template / computed: seed.statusDescription(order.statusId), seed.enumsByType("ORDER_SALES_CHANNEL")
const states = computed(() => seed.statesForCountry.withSync(countryGeoId.value)); // empty is real once synced
```

- The first `useSeedData()` in a component tree opens one live read per table it uses and provides
  it; every component below injects the same instance, so a page's cards add no queries. The reads
  close when that component unmounts. Call it in the page or component that shows the labels, never
  in `App.vue` or a layout (that would hold every seed table open for the session).
- `await seed.getFacilities()` / `getFacilityTypes()` / … answer once the table is read, for an
  action that needs the rows now.

**Store data joined with seed rows:**

```ts
// composables/useOrderQueue.ts — the store fetches, the composable joins
export function useOrderQueue() {
  const orderStore = useOrderStore();
  const seed = useSeedData();

  // The store action takes the seed rows it needs; it never reads the app db itself.
  const search = async () => orderStore.runSearch(await seed.getFacilityTypes().catch(() => []));
  const rows = computed(() => orderStore.searchResults.map((order) => ({
    ...order,
    statusLabel: seed.statusDescription(order.statusId),
  })));

  return { rows, search };
}
```

**A record the db is missing:**

```ts
import { refreshAfterMutation } from "@/db/appDbSync";

const { first: log, hydrated } = useLiveEntity<any>(
  companyDb.tables.dataManagerLogs,
  () => ({ equals: { logId: props.logId } }),
);
// Once the read lands empty, ask the domain for it; the live read shows it when it is written.
watch(hydrated, (ready) => {
  if (ready && !log.value) void refreshAfterMutation("dataManagerLog", { logId: props.logId }).catch(showLookupError);
});
```

- Takes a **sync domain name** and that record's key. The domain needs a `refetchOne`; a table
  filled only on request gets a class C domain (accxui-app-db-setup).
- The same call as after a write: waits for the worker's first sync pass and rejects with a
  `CacheReconciliationError`. Its message says a change was saved, so a lookup catches it and shows
  its own message.

**After a server write:**

```ts
import { refreshAfterMutation, resyncDomain } from "@/db/appDbSync";

const response = await api({ url: `oms/serviceJobs/${jobName}`, method: "put", data });
if (commonUtil.hasError(response)) throw new Error("Failed to save the job.");   // the caller toasts translate(...)
await refreshAfterMutation("serviceJob", { jobName });   // re-reads that one record through the domain
// or, when the write touches more than one record:
await resyncDomain("facilityGroup");                     // re-snapshots the whole domain
```

- In a composable or a store action. Both take **sync domain names**, not table names. List every
  domain the write touches.
- Reconcile only after the write is known to have landed: a failed write reconciles nothing.
- A `CacheReconciliationError` means the write succeeded and only the local refresh failed: warn
  ("saved, refresh to see it"), don't retry the write.

### `refreshAfterMutation(domain, pk)` exactly

It asks the worker to run that domain's `refetchOne(ctx, pk, activeArgs)` and resolves with the
number of rows written. The `useLiveEntity` reading the table then re-renders by itself; never read
the return value to update the screen.

| Situation | Result |
|---|---|
| The worker has not finished starting | waits for it (it starts the sync if nothing has) |
| The sync failed to start, or the service is down | rejects `CacheReconciliationError` |
| Unknown domain name (typo, a **table** name), or a domain with no `refetchOne` | after the start wait, rejects `CacheReconciliationError` (cause `domain has no refetchOne`) and shows on the status card |
| A snapshot domain with no `byPk` / `refetchScope` / `fanOut` (`status`, `geo`, `carrier` and most other seed type tables) | resolves `0`: **nothing refreshed**. Use `resyncDomain(name)` for these |
| The refetch request failed | rejects `CacheReconciliationError` |
| The server no longer has the record | `byPk`: the stored row is removed. `refetchScope` / `fanOut`: that scope is replaced, so the row is pruned. `defineCursorDomain` and most hand-written domains: only upsert, the row stays |
| Two calls for the same domain and pk | run one after the other, never in parallel |

**`pk`** carries what the domain's refetch reads: the primary-key fields (`{ facilityId }`,
`{ cycleCountId, itemSeqId }`), the scope field for a `refetchScope` domain, the parent key for a
`fanOut` domain (`{ productStoreId }`), or extra fields a class C fetch needs. Names are **domain
names** (`facility`, `productStore`, `enum`, `status`), not table names (`facilities`). The seed
domains and which ones can refetch are listed in **accxui-app-db-setup** ("Framework (seed)
entities"); an app's own domains are in `src/workers/appSyncDomains.ts`.

| After the write… | Call |
|---|---|
| One record of a domain that can refetch changed | `refreshAfterMutation(domain, pk)` |
| Several records, a delete you can't name by key, or a domain that can't refetch | `resyncDomain(domain)`: clears its "synced this login" marker and re-runs the full sync now |
| Records of several domains changed (an association and both sides) | one call per domain, `await Promise.all([...])` |
| Everything (Settings "Refresh all") | `resyncReferenceData()` |

`resyncDomain` rejects with a plain `Error` (not `CacheReconciliationError`) when the service is
down. Check the error with `isCacheReconciliationError(error)` from
`@common/db/sync/reconciliation` (Company re-exports it from `@/utils/db/cacheReconciliationError`).

## Lint errors and their fix

Data-access messages end with "See docs/APP_DB_DEVELOPER_GUIDE.md §7". Layer messages ("See
AGENTS.md (App layout)": API calls, composables, stores in utils) are in **accxui-app-layers**.

| Rejected | Do instead |
|---|---|
| `useLiveEntity` / `useSeedData` / `useDbStatus` outside composables and `.vue` files | the caller passes the rows |
| `useSeedData` in `App.vue` | call it in the page or component that shows the labels |
| `appDb.entity(...)` or `loadSeedData()` outside `src/workers/**` and `src/db/**` | `useLiveEntity` / `useSeedData` in a composable or `.vue`; elsewhere take the rows as arguments |
| an app db module (`@/db/companyDb`, …) imported in a store | a page or domain composable joins store data with `useLiveEntity` rows (a store may import `@/db/appDbSync`) |
| `import Dexie / liveQuery from "dexie"`; `dbClient`, `getAppDb`, `ensureDbReady`, `hasSyncedThisLogin` …, or value imports from `@common/db/storage/dbClient` / `baseDb` / `schema/appDbRegistry` | `useLiveEntity` (type-only imports are fine) |
| `appDb.raw()` | doesn't exist: `useLiveEntity` |
| `appDb.get(oms)` | worker entry (`src/workers/*.worker.ts`) and `src/db/**` only |
| `appDb.client()` | worker sync domains, and as the `useDbStatus(...)` argument only |
| `.live()` / `.liveRead()` in `src/workers/**` | a one-shot `appDb.entity(...).get / query / all` |
| `activateSyncDomains` without `deactivateSyncDomains` in the file, or in a page without `onIonViewDidLeave` | deactivate with the same owner in `onIonViewDidLeave` (**accxui-page-sync** has the page recipe) |
| `deactivateSyncDomains()` with no owner | `deactivateSyncDomains(SYNC_OWNER)` |
| a string-literal table name | `appDb.tables.x` |
| `upsertMany` / `snapshotReplace` anywhere, or `put` / `bulkPut` / `remove` / `bulkRemove` / `clear` on `appDb.entity(...)`, outside `src/workers/**` | `refreshAfterMutation` for a missing record; `refreshAfterMutation` / `resyncDomain` after a server write |

Exempt: an app-local Dexie store outside the app database, switched off in that app's own
`eslint.config.js`. No app has one today: Order Manager's products moved into its app db.

## Before you finish

- [ ] App-db reads use `useLiveEntity` / `useSeedData` in a composable or `.vue` file, table names from `appDb.tables`.
- [ ] No `useLiveEntity` / `useSeedData` in a store, util, router or worker; stores import no app db module.
- [ ] No app-db writes outside `src/workers/**`; missing records go through `refreshAfterMutation`.
- [ ] Every server write reconciles with `refreshAfterMutation` / `resyncDomain` for each domain it touches.
- [ ] A new table or domain went through accxui-app-db-setup (schema, `version` bump, registered domain).
- [ ] Every `refreshAfterMutation` names a domain that can refetch; `resyncDomain` for the ones that can't.
- [ ] `pnpm build` (runs `eslint src` and the wiring spec first) and `pnpm test:unit` pass in the app.

Reference: `docs/APP_DB_DEVELOPER_GUIDE.md` (§1 patterns, §4 writes, §7 rules) and `AGENTS.md`.
