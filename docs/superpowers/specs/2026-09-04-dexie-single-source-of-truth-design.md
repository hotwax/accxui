# Dexie as the single source of truth for Order Manager seed data

Replace the Order Manager seed Pinia store with a Dexie-backed read path: one thin
operations layer over Dexie (`dbClient`), one in-memory lookup index fed only from Dexie
(`seedIndex`), and one pair of Vue composables (`useDb` / `useRecord`).

## Problem

Order Manager keeps seed reference data twice, filled by two pipelines that never talk to
each other.

1. **Worker → IndexedDB.** `appSync.worker.ts` walks the 27 domains in
   `ORDER_MANAGER_SYNC_CATALOG` and writes rows into Dexie.
2. **REST → Pinia.** `useSeedStore().loadInitialSeedData()` fires ~40 API calls and writes
   the results straight into store state. It never writes to Dexie.

The store is therefore not a cache of the database. It is a second copy with its own
fetchers, which is also periodically overwritten from the first copy. After a reload,
anything the worker has not synced yet must be refetched over the network, and
`loadDataset` short-circuits on `status === "loaded"`, so whichever pipeline wins first
sticks.

The refresh path amplifies this. `subscribeToDbUpdates` attaches three `liveQuery`
`count()` tripwires and one `BroadcastChannel` listener, each of which calls
`populateFromDb()` — a full 28-table `toArray()` sweep that rebuilds every `byId`/`ids` map
from scratch. `initSeedDb()` runs from both `App.vue` and `postLogin`, so a fresh login
registers two complete sets of subscriptions, none of which are ever unsubscribed. The
worker posts a message per synced domain plus a completion message. On a fresh login this
adds up to roughly 1,700 full table scans, overlapping and unguarded.

Storage is duplicated a second time inside IndexedDB itself: `projectRow` stores the
projected fields *and* a complete copy of the server payload under `raw`.

## Success criteria

- Exactly one writer for seed data: the sync worker.
- Boot performs 29 table reads once, not ~1,700 scans.
- No Pinia store holds seed reference data.
- Subscriptions are torn down on logout and re-established on OMS switch.
- IndexedDB rows carry projected fields only.
- Label lookups stay synchronous, with the same call-site shape.

### Accepted behaviour change

On a **fresh login**, labels resolve when the worker's domains land rather than when a
parallel REST call returns. Until a slice fills, lookups return the raw id — the same
fallback `itemDescription()` already produces for an unloaded dataset today, so it is a
timing shift, not a new failure mode. Reloads are unaffected: the database is already
populated, and `hydrate` reads it before first paint. If the delay proves noticeable,
prioritising the label-critical domains in the worker's sync order is the fix (see
Not doing).

## Scope

### In scope

| Area | Change |
| --- | --- |
| `common/db` | New `dbClient`. `useDbList`/`useDbRecord` → `useDb`/`useRecord`. `raw` dropped from `DbRow`. `defineDbEntity`/`DbEntity` deleted. `index`-free catalog reuse. |
| `apps/order-manager` | New `seedIndex` + `useSeedData`. Seed Pinia store deleted. REST loaders deleted. Catalog gains the two Shopify domains. 42 consumer files migrated. |

### Out of scope

- `order`, `orderDetail`, `customer`, `productCache` stores.
- `inventory-count` and `company` (neither uses `BaseDB`).
- `DEFAULT_COMMON_SYNC_CATALOG` in `useDbStatus.ts` — an unused fallback default; left alone.
- `productStore.ts`'s own `fetchProductStoreSettings`, which is unrelated to the seed store.

## Design

### Layers

```
Dexie (IndexedDB) ─────────────── the single source of truth
  │
  ├─ dbClient(db)          plain async ops. Usable in the worker, services,
  │                        stores and composables. Takes BaseDB as a parameter
  │                        so the worker never imports commonUtil.
  │
  ├─ seedIndex             plain module. In-memory lookup index over every
  │  (order-manager)       catalog table. Sync getters, importable anywhere.
  │
  ├─ useDb / useRecord     Vue composables over dbClient.live/liveOne.
  │  (common/db)
  │
  └─ useSeedData           thin composable wrapping seedIndex for templates.
     (order-manager)
```

`seedIndex` is a plain module rather than a composable or a store because
`store/order.ts:56`, `utils/badAddressState.ts:32` and `services/order.ts:793` need
synchronous lookups outside any component. A plain module import works in all four
contexts; a composable works in one. `useSeedData` exists solely to give templates
reactivity and delegates every call to the same module.

### `dbClient`

```ts
// common/db/dbClient.ts
export function dbClient(db: BaseDB): DbClient

interface DbClient {
  // read — return stored rows as-is
  get<T>(table: string, key: string): Promise<T | undefined>
  getMany<T>(table: string, keys: string[]): Promise<T[]>
  all<T>(table: string): Promise<T[]>
  query<T>(table: string, opts: QueryOptions): Promise<T[]>
  first<T>(table: string, opts: QueryOptions): Promise<T | undefined>
  count(table: string, opts?: QueryOptions): Promise<number>

  // write
  put(table: string, record: unknown): Promise<void>
  bulkPut(table: string, records: unknown[]): Promise<void>
  remove(table: string, key: string): Promise<void>
  bulkRemove(table: string, keys: string[]): Promise<void>
  clear(table: string): Promise<void>
  transaction<T>(mode: "r" | "rw", tables: string[], fn: () => Promise<T>): Promise<T>

  // live
  live<T>(table: string, opts?: QueryOptions): Observable<T[]>
  liveOne<T>(table: string, key: string): Observable<T | undefined>

  // meta
  tableNames(): string[]
  raw(): BaseDB
}
```

`QueryOptions` is today's `LiveQueryOptions` (`scope`, `equals`, `since`, `until`,
`dateField`, `filter`, `limit`, `order`), unchanged.

Apps get a one-line convenience wrapper:

```ts
// apps/order-manager/src/db/orderManagerDb.ts
export const omDb = () => dbClient(getOrderManagerDb(commonUtil.getOMSInstanceName()));
```

`live` wraps Dexie's `liveQuery`: it emits the query result immediately on subscribe, then
re-runs and re-emits whenever a write touches the queried table — including writes from the
sync worker and from other tabs. It re-runs the whole query rather than producing a delta,
which is why `seedIndex` debounces.

### Storing projected rows only

`DbRow` becomes the projected fields plus `syncedAt`. `raw` is removed.

```ts
// before: { statusId, statusTypeId, description, statusAge, raw: {…full payload}, syncedAt }
// after:  { statusId, statusTypeId, description, statusAge, syncedAt }
```

`syncedAt` is kept. Nothing reads it today — `useDbStatus` and the Settings screen take
their timestamps from domain-level `syncMeta` markers — but per-row staleness is expected
to matter for `syncClass: "A"` domains, and it costs one number per row.

`dbClient` then returns exactly what is stored. This also resolves an existing
inconsistency in `baseDb.ts`, where `live()` returned wrapped `DbRow`s while `all()` and
`get()` returned `r.raw ?? r` — silently dropping the synthetic composite keys
(`memberKey`, `transitionKey`, `carrierShipmentMethodKey`, `locationKey`), which exist only
on the row and never in `raw`.

**The projection becomes the contract.** Any field a consumer reads must be declared in
`EntityProjection.fields`; the `structured` field kind already covers nested payloads. This
turns a silent `undefined` into a deliberate decision, and it requires a projection audit
(see Execution, step 2).

Known gap found during design: `shopifyShopProjection` lacks `myshopifyDomain` and
`domain`, which `views/OrderDetail.vue:1172` reads to build the Shopify admin link. Fields
verified as already covered: `isPhysicalFacility` (`parentTypeId`, `facilityTypeId`),
`singleShopIdForProductStore` (`shopId`, `productStoreId`), carrier name parts
(`firstName`, `lastName`, `groupName`), `statusAge`, `facilityName`, geo
(`geoName`, `geoCode`, `geoCodeAlpha2`, `geoTypeEnumId`).

`geoProjection.wellKnownText` is declared and read by nobody. It is removed — it is polygon
geometry and the largest projected field in the schema.

### `seedIndex`

```ts
// apps/order-manager/src/db/seedIndex.ts — plain module
const slices = new Map<string, Map<string, DbRow>>();  // table -> pk -> row, verbatim
const version = ref(0);                                 // the only reactive cell
let state: "cold" | "hydrating" | "ready" = "cold";
```

Because `raw` is gone, stored rows are already lean, so the index holds them verbatim —
there is no separate entry shape to define or keep in sync.

| Aspect | Behaviour |
| --- | --- |
| **Which tables** | Every entry in `ORDER_MANAGER_SYNC_CATALOG`. No flag, no second config file. |
| **Hydration** | Eager at boot — one `dbClient` read per table, in parallel. |
| **Refresh** | One `liveQuery(() => table.toArray())` per table, 150 ms trailing debounce, rebuilding only that slice. |
| **Reactivity** | A single `ref` version counter, bumped on slice rebuild. `useSeedData` wraps getters in computeds that read it; plain imports pay nothing. |
| **Miss** | Returns the raw id, exactly as `itemDescription()` does today. No new undefined-flash. |
| **Secondary indexes** | Built during slice rebuild: `statusesByType`, `enumsByType`, `enumChildTypesByParent`, `geoAssocsByCountry`, `carrierShipmentMethodsByParty`, `transitionsByStatus`. This removes the O(n) `flatMap` scans that `findStatus`/`findEnum` run on every `describe()` call today. |
| **Lifecycle** | `hydrate(catalog, db)` on login and on authenticated boot; `reset()` on logout; `reset()` then `hydrate()` on OMS switch. |
| **Writes** | `createOrderIdentificationType` POSTs, then calls the existing `refreshAfterMutation("enum", { enumId })` → worker refetch → Dexie write → liveQuery → slice rebuild. |

`liveQuery` is the correctness mechanism, not `DB_SYNC_CHANNEL`. Dexie's own change
tracking covers every writer — worker, main thread, other tabs — so a table cannot go
silently stale if something writes without broadcasting. `DB_SYNC_CHANNEL` survives only
for sync *progress* reporting to the Settings screen.

### Catalog reuse

`ORDER_MANAGER_SYNC_CATALOG` becomes the single registry for a domain. No new config file
and no `index` flag: every catalog table is indexed.

Three consumers, one list:

- `startAppDbSync` → `catalog.map(d => d.name)` (already the case)
- `useDbStatus(db, catalog)` → Settings screen (unchanged)
- `seedIndex.hydrate(catalog, db)` → one slice per entry

**Bug this surfaces.** `shopifyShop` and `shopifyShopLocation` have registered common sync
domains but are missing from `ORDER_MANAGER_SYNC_CATALOG`, so they never sync.
`views/CreateOrder.vue:327` and `views/OrderDetail.vue:1163` work today only because the
REST loaders fill the store. Dropping the REST path without adding these two entries breaks
those screens. They are added as part of this work, taking the catalog to 29 entries.

### `useDb` / `useRecord` / `useSeedData`

```ts
// common/db/useDb.ts
function useDb<T>(db: BaseDB, table: string, opts?: MaybeRefs<QueryOptions>): {
  records: Ref<T[]>; count: Ref<number>; hydrated: Ref<boolean>; error: Ref<Error | null>;
}

function useRecord<T>(db: BaseDB, table: string, key: MaybeRef<string>): {
  record: Ref<T | undefined>; hydrated: Ref<boolean>; error: Ref<Error | null>;
}
```

Both subscribe through `dbClient.live`/`liveOne`, unsubscribe on unmount, and re-subscribe
when reactive options or the key change — a gap in today's `useDbList`, which reads
`options` once at setup and never watches them. `hydrated` keeps its current semantic from
`useDbList.ts:30`: emitted at least once, and either rows are present or the bootstrap is
idle.

```ts
// apps/order-manager/src/db/useSeedData.ts
function useSeedData()  // seedIndex getters wrapped in computeds over the version ref
```

Method names match today's getters — `describe`, `statusDescription`, `enumDescription`,
`statusAge`, `facilityName`, `geoName`, `getCountries`, `getStates`, `getStatesForCountry`,
`allowedTransitions`, `getEnumsByType`, `getEnumsByParentType`, and the rest — so a
component migration is `useSeedStore()` → `useSeedData()` with call sites unchanged.
Non-component callers import the plain functions from `seedIndex` directly.

Datasets that consumers currently read as raw state get named accessors rather than exposed
slice maps, so `ids`/`byId` does not leak back into 42 files:

| Today | Becomes |
| --- | --- |
| `seed.shopifyShops.ids` / `.byId` | `shopifyShops()` |
| `seedStore.shipmentMethodTypes.byId` | `shipmentMethodTypes()` |
| `seedStore.enumsByType['X']` | `getEnumsByType('X')` |
| `seed.carriers.ids` / `.byId` | `carriers()` |
| `seedStore.productStores.byId[id]` | `productStore(id)` |
| `seedStore.facilities` | `facilities()` |
| `seedStore.productStoreFacilitiesByStoreId[id]` | `productStoreFacilities(id)` |
| `seedStore.shopifyShopLocations.byId` | `shopifyShopLocations()` |

### Boot flow

```
postLogin / authenticated boot
  startAppDbSync(token)            // worker: the only fetcher
  seedIndex.hydrate(catalog, db)   // read 29 tables once, subscribe per table
                                   // slices fill as the worker's domains land

postLogout
  seedIndex.reset()                // unsubscribe all, clear slices
  clearLocalDb(db)                 // unchanged
```

`loadInitialSeedData` and every `load*` action are deleted. The worker is the only fetcher,
so there is no second code path and no `resetTransientLoadStates` problem — the comment at
`seed.ts:493` about persisted mid-load state describes a persistence config that no longer
exists.

### Tables with no readers

Six tables have no reader anywhere in the app: `facilityGroups`, `groupFacilities`,
`productStoreEmailSettings`, `productStoreFacilities`, `productStoreFacilityGroups`,
`productStoreShipmentMethods`. They keep syncing (Settings shows their status) and, under
"index everything", they get slices like every other catalog table. If their footprint
later proves to matter, adding an opt-out flag to `SyncDomainCatalogItem` is a one-line
change — deliberately deferred rather than designed in now.

## Dead code removed

- `productStoreSettingsByStoreId` and `loadProductStoreSettings` — nothing outside
  `seed.ts` reads them. `productStore.ts:143` has its own unrelated
  `fetchProductStoreSettings`. This is why the seed store is deleted outright rather than
  shrunk: it holds nothing that Dexie does not.
- `defineDbEntity`, `DbEntity` — superseded by `dbClient` plus the catalog.
- `useDbList`, `useDbRecord` — zero consumers today.
- `geoProjection.wellKnownText` — declared, never read.
- Getters with zero call sites, not carried over to `seedIndex`:
  `contactPurposeDescription`, `communicationEventTypeDescription`,
  `returnTypeDescription`, `returnItemTypeDescription`, `roleTypeDescription`,
  `getCarrierOptions`, `getProductStoreShipmentMethodOptions`. Their underlying tables stay
  indexed regardless, because `describe()` falls back through them.

## Execution order

Each step should land green before the next starts.

1. **`dbClient` + `useDb`/`useRecord`** in `common/db`, alongside the existing code. Nothing
   consumes them yet. `useDbList`/`useDbRecord` deleted in the same step (zero consumers).
2. **Projection audit.** For every catalog table, diff the fields consumers read against
   `EntityProjection.fields`. Extend projections where they fall short — at minimum
   `shopifyShopProjection` gains `myshopifyDomain` and `domain`. Remove
   `geoProjection.wellKnownText`.
3. **Drop `raw`** from `projectRow` and `DbRow`. Add a `shapeVersion` marker to `syncMeta`,
   checked in `startDbBootstrap` on the main thread before `harnessProxy.start`: on
   mismatch, `clearDatabaseTables(db)` once, write the new marker, and let the worker
   refill. No Dexie version bump is needed, because indexed fields do not change.
4. **Catalog.** Add `shopifyShop` and `shopifyShopLocation` to
   `ORDER_MANAGER_SYNC_CATALOG`. Verify both sync and populate.
5. **`seedIndex` + `useSeedData`.** Build them and wire `hydrate`/`reset` into `App.vue`,
   `postLogin` and `postLogout`, running *alongside* the existing store. Both paths live at
   once; the index is verified against the store's values.
6. **Migrate consumers**, 42 files. Components take `useSeedData()`; stores, services and
   utils import `seedIndex` functions directly. Mechanical, since the names match.
7. **Delete the seed store** and its REST loaders. Remove
   `startAppDbSync(token, () => …populateFromDb())` callbacks in `App.vue:73` and
   `user.ts:175`.

Steps 5–7 are the only ones where both systems coexist, and step 5 is deliberately
additive so the index can be validated before anything depends on it.

## Verification

- `pnpm --filter order-manager test:unit` green.
- New unit tests:
  - `dbClient` against a real Dexie instance under `fake-indexeddb` (new devDependency):
    round-trip `put`/`get`, `bulkPut`/`getMany`, `query` with each option, `count`, `clear`,
    and `live` emitting on write.
  - `seedIndex`: hydrate from a seeded database; a write to one table rebuilds only that
    slice; the debounce collapses a burst of batched writes into one rebuild; `reset()`
    unsubscribes; secondary indexes are correct; a miss returns the raw id.
  - `projectRow` no longer emits `raw` and still emits `syncedAt` and synthetic keys.
- `tests/store/seed.spec.ts` is deleted; its intent — "seed data comes from bounded REST
  endpoints, never generic entity endpoints" — moves to an assertion over the sync domain
  registry's `listUrl`s, which is where those URLs now live.
- Manual: fresh login, reload, logout/login, OMS switch. Confirm labels resolve on the
  order list, order detail, Create Order (Shopify locations), Bad Address (geos) and
  Settings (sync status).
- `common/tests/projection.spec.ts` asserts on `raw` and will need updating. Note that
  `common/tests` is not wired into any test run and several of its specs already fail; it
  is updated for correctness, not because it gates the change.

## Alternatives considered

**Keep a REST fallback that writes to Dexie.** Preserves today's fast first login, but
reintroduces two writers to one store and the clobbering risk that comes with it. Rejected:
the whole point is one writer.

**Zero in-memory mirror; make every lookup async.** The truest single source of truth, but
the synchronous row mappers in `store/order.ts`, `store/orderDetail.ts` and
`utils/badAddressState.ts` would all have to become async, or stop decorating rows
entirely. Rejected as disproportionate; the derived, read-only, single-writer index gets
the correctness benefit without it.

**A lazily built, per-key label cache.** Lowest memory, but the order list — the busiest
screen — would render raw ids on first paint and fill in a tick later. Rejected for the
visible flicker.

**`BroadcastChannel` as the index refresh trigger.** One listener instead of 29, and the
worker's messages already name the domain. Rejected because it only sees writers that
broadcast: any direct Dexie write leaves the index silently stale, with no error. Dexie's
own change tracking has no such hole.

**A separate `seedIndexConfig.ts`.** Rejected in favour of reusing
`ORDER_MANAGER_SYNC_CATALOG`, so adding a domain remains a one-file change.

## Not doing

- Migrating `order`, `orderDetail`, `customer` or `productCache` onto Dexie. Each deserves
  its own spec.
- Promoting `seedIndex` to `common/db`. It stays in `order-manager` until a second app
  needs it.
- Reconciling `DEFAULT_COMMON_SYNC_CATALOG` with the app catalogs.
- Prioritising label-critical domains in the worker's sync order. Worth revisiting if the
  time-to-correct-labels on a fresh login proves too long in practice.
