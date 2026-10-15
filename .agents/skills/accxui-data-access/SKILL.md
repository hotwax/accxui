---
name: accxui-data-access
description: How AccxUI app code reads and writes local app data (IndexedDB) and where each kind of code lives (composables, Pinia stores, utils, worker domains). Use whenever you read, list, look up, cache, store, upsert or delete server data in any AccxUI app (apps/company, apps/order-manager or a new one), add an API call, write a composable, Pinia store or util, touch useLiveEntity, companyDb / orderManagerDb, appDb.tables, useSeedData, refreshAfterMutation or resyncDomain, a worker sync domain, Dexie, liveQuery or IndexedDB, send a POST / PUT / DELETE that changes server data, or fix a data-access or layer lint error (one ending "See docs/APP_DB_DEVELOPER_GUIDE.md §7" or "See AGENTS.md (App layout)").
---

# AccxUI data access and app layers

Every app keeps server data in one IndexedDB database per OMS instance, filled by a background sync
worker. `appDb` below is the app's database object: `companyDb` (`@/db/companyDb`) in Company,
`orderManagerDb` (`@/db/orderManagerDb`) in Order Manager. Building the database itself (tables,
domains, worker) is the **accxui-app-db-setup** skill.

## Rules

1. **App composables are used only by other composables and `.vue` files.** A store, util, router
   or worker never imports `@/composables/*` (type-only imports are fine). *Why:* a composable may
   hold setup-time effects and per-tree state; outside setup it leaks or misbehaves. The framework's
   plain helpers (`useAuth`, `useSolrSearch`, …) are not affected.
2. **`useSeedData()` and `useLiveEntity()` are composables too:** call them only in a composable or a
   `.vue` file, during setup, and never `useSeedData()` in `App.vue`.
3. **App code reads the app db only through `useLiveEntity` (and `useSeedData` for seed tables).** No
   `appDb.entity(...)`, `appDb.client()`, `loadSeedData()`, Dexie or `dbClient` outside
   `src/workers/**` and `src/db/**`. *Why:* one read pattern, live by default; the worker owns
   everything else.
4. **API calls live in three places only:** composables, Pinia stores (when a store needs the data),
   and worker sync domains. Never in a `.vue` file, util, router or `src/db`. A request a store needs
   is a store action, and composables call it.
5. **Utils are pure.** No API calls, no Pinia stores, no app db, no composables. A util that needs
   store data or seed rows takes them as parameters; the caller passes them.
6. **Pinia stores never read the app db, and the app db never reaches a store.** Stores hold server
   data. When a page needs both, a page or domain composable joins them (store data + `useLiveEntity`
   / `useSeedData` rows). A store action that needs seed rows (facility types, …) takes them as an
   argument from that composable or page. `src/db/**` and `src/workers/**` never import a store.
7. **Only worker sync domains write the app db.** A record the db is missing: `refreshAfterMutation`
   (it runs the domain's `refetchOne`). After a server write: `refreshAfterMutation` /
   `resyncDomain`. Never write a response into a table.
8. **Table names from `appDb.tables`, never a string,** and **no server fetch on mount for synced
   data** (read what the worker stored; the worker owns the cadence).

## Where code goes

| Code | Lives in | May use |
|---|---|---|
| Reading app-db rows, seed labels | a composable or `.vue` file | `useLiveEntity`, `useSeedData` |
| An API call a store needs | a Pinia store action | `api()`, other stores, utils |
| An API call only components need | a composable | `api()`, stores, other composables, utils |
| Joining store data with app-db / seed rows | a page or domain composable | stores + `useLiveEntity` / `useSeedData` |
| Mapping, payload building, formatting | `src/utils/` | parameters only (no stores, db, API, composables) |
| Writing the app db, polling the server | a worker sync domain (`src/workers/**`) | `appDb.entity(...)`, `appDb.client()`, `workerRemoteApi` |
| The database, schema, sync facade, app-local Dexie stores | `src/db/` | deep `@common/db/*` imports only |

There is no `src/services/`.

## Which call

| You want… | Use | Where |
|---|---|---|
| Rows that stay current **on screen** | `useLiveEntity<any>(appDb.tables.x, options)` | composables, `.vue`, during setup |
| Labels and option lists from seed tables | `useSeedData()` | composables, `.vue` (never `App.vue`) |
| Seed rows inside a store action or util | take them as an argument; the composable / page passes `await seed.getFacilityTypes()`, `seed.facilities()`, … | the caller |
| A record the db **doesn't have** | `refreshAfterMutation(domain, pk)`; the `useLiveEntity` on it then shows it | composables, stores |
| To **change** server data | `api()`, check it, then `refreshAfterMutation` / `resyncDomain` | composables, stores |

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
- `QueryOptions`: `scope` / `equals` (equalities; a dotted path reaches a nested field, and a list
  matches when any value does), `dateField` + `since` / `until` / `order` (newest first by default),
  `filter`, `limit`.

**Seed labels and option lists:**

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

**A util that needs store data or seed rows:** parameterize it.

```ts
// utils/index.ts — pure: the caller passes the cached product
export const isKit = (product?: any): boolean => product?.productTypeId === "MARKETING_PKG_PICK";
// .vue: isKit(getProduct(item.productId))
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
if (commonUtil.hasError(response)) throw new Error(getResponseErrorMessage(response, "Failed to save the job."));
await refreshAfterMutation("serviceJob", { jobName });   // re-reads that one record through the domain
// or, when the write touches more than one record:
await resyncDomain("facilityGroup");                     // re-snapshots the whole domain
```

- In a composable or a store action. Both take **sync domain names**, not table names. List every
  domain the write touches.
- Reconcile only after the write is known to have landed: a failed write reconciles nothing.
- A `CacheReconciliationError` means the write succeeded and only the local refresh failed: warn
  ("saved, refresh to see it"), don't retry the write.

## Lint errors and their fix

Data-access messages end with "See docs/APP_DB_DEVELOPER_GUIDE.md §7"; layer messages end with "See
AGENTS.md (App layout)".

| Rejected | Do instead |
|---|---|
| `import { api, client } from "@common"` outside composables, stores and workers | call the composable or store action that owns the request |
| `@/composables/*` imported in a store, util, router, `src/db` or a worker | take what it needs as arguments; a page or composable passes it |
| `useLiveEntity` / `useSeedData` / `useDbStatus` outside composables and `.vue` files | the caller passes the rows |
| `useSeedData` in `App.vue` | call it in the page or component that shows the labels |
| `appDb.entity(...)` or `loadSeedData()` outside `src/workers/**` and `src/db/**` | `useLiveEntity` / `useSeedData` in a composable or `.vue`; elsewhere take the rows as arguments |
| an app db module (`@/db/companyDb`, …) imported in a store | a page or domain composable joins store data with `useLiveEntity` rows (a store may import `@/db/appDbSync`) |
| a store (`@/store/*`, `pinia`) imported in a util, `src/db` or a worker | utils take the data as parameters; the db and workers stay independent of stores |
| a `use…Store()` call in a util | take the data as a parameter |
| `import Dexie / liveQuery from "dexie"`; `dbClient`, `getAppDb`, `ensureDbReady`, `hasSyncedThisLogin` …, or value imports from `@common/db/storage/dbClient` / `baseDb` / `schema/appDbRegistry` | `useLiveEntity` (type-only imports are fine) |
| `appDb.raw()` | doesn't exist: `useLiveEntity` |
| `appDb.get(oms)` | worker entry (`src/workers/*.worker.ts`) and `src/db/**` only |
| `appDb.client()` | worker sync domains, and as the `useDbStatus(...)` argument only |
| `.live()` / `.liveRead()` in `src/workers/**` | a one-shot `appDb.entity(...).get / query / all` |
| `activateSyncDomains` without `deactivateSyncDomains` in the file, or in a page without `onIonViewDidLeave` | deactivate with the same owner in `onIonViewDidLeave` |
| `deactivateSyncDomains()` with no owner | `deactivateSyncDomains(SYNC_OWNER)` |
| a string-literal table name | `appDb.tables.x` |
| `upsertMany` / `snapshotReplace` anywhere, or `put` / `bulkPut` / `remove` / `bulkRemove` / `clear` on `appDb.entity(...)`, outside `src/workers/**` | `refreshAfterMutation` for a missing record; `refreshAfterMutation` / `resyncDomain` after a server write |

Exempt: an app-local Dexie store outside the app database, switched off in that app's own
`eslint.config.js` (Company `src/db/shopifySyncDb.ts`; Order Manager `src/db/productDb.ts` and the
`productCache` store that mirrors it).

## Before you finish

- [ ] App-db reads use `useLiveEntity` / `useSeedData` in a composable or `.vue` file, table names from `appDb.tables`.
- [ ] No app composable, `useLiveEntity` or `useSeedData` in a store, util, router or worker.
- [ ] API calls only in composables, store actions or worker domains; none in `.vue`, utils or the router.
- [ ] Utils take what they need as parameters: no store, app db, API or composable.
- [ ] Stores import no app db module; a composable joins store data with app-db rows.
- [ ] No app-db writes outside `src/workers/**`; missing records go through `refreshAfterMutation`.
- [ ] Every server write reconciles with `refreshAfterMutation` / `resyncDomain` for each domain it touches.
- [ ] A new table or domain went through accxui-app-db-setup (schema, `version` bump, registered domain).
- [ ] `pnpm lint` (or `pnpm build`, which lints first) and `pnpm test:unit` pass in the app.

Reference: `docs/APP_DB_DEVELOPER_GUIDE.md` (§1 patterns, §4 writes, §7 rules) and `AGENTS.md`.
