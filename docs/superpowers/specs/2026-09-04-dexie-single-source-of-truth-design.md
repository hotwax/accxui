# Dexie as the single source of truth for Order Manager seed data

Replace the Order Manager seed Pinia store with a Dexie-backed read path: one thin
operations layer over Dexie (`dbClient`), one module of lazily built lookup slices fed only
from Dexie (`useSeedData.ts`), and one Vue composable for reactive reads (`useDb`).

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
- A table is read at most once per session, plus one subscription, and only if used —
  replacing ~1,700 overlapping full-table scans on a fresh login.
- No Pinia store holds seed reference data, and no boot hydration step exists.
- Subscriptions are torn down on logout and before an OMS switch.
- IndexedDB rows carry projected fields only.
- Label lookups stay synchronous, with the same call-site shape.

### Accepted behaviour change

Lookups return the raw id until their slice fills — the same fallback `itemDescription()`
already produces for an unloaded dataset today. Two cases differ from current behaviour:

**First access to a table**, even on a warm database, resolves a tick late. Where the value
is read in a computed it self-corrects invisibly; where it is stamped into data it would
not, which is what `ensureLoaded` exists for.

**On a fresh login**, labels resolve when the worker's domains land rather than when a
parallel REST call returns. This is a timing shift, not a new failure mode — and unlike a
stamped value, a computed self-corrects the moment the slice fills. If the delay proves
noticeable, prioritising the label-critical domains in the worker's sync order is the fix
(see Not doing).

## Scope

### In scope

| Area | Change |
| --- | --- |
| `common/db` | New `dbClient`. `useDbList`/`useDbRecord` → a single `useDb`. `raw` dropped from `DbRow`. `defineDbEntity`/`DbEntity` deleted. `index`-free catalog reuse. |
| `apps/order-manager` | New `useSeedData.ts` (state + getters + composable + `ensureLoaded`). Seed Pinia store deleted. REST loaders deleted. Catalog gains the two Shopify domains. 42 consumer files migrated. |

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
  ├─ useDb                 Vue composable over dbClient.live. One entry point,
  │  (common/db)           list-shaped, with `first` for the single-record case.
  │
  └─ useSeedData.ts        ONE module, order-manager. Module-scoped reactive
     (order-manager)       slices built lazily on first access, plus:
                             · plain sync getters  -> stores, services, utils
                             · useSeedData()       -> components
                             · ensureLoaded(tables) -> async stamping sites
                             · reset()             -> logout / OMS switch
```

There is no separate index module and no boot hydration step. `useSeedData.ts` owns its
state, and a slice comes into existence the first time something asks for it.

The module is plain — not a composable, not a store — because `store/order.ts:56`,
`utils/badAddressState.ts:32` and `services/order.ts:793` need synchronous lookups outside
any component. A plain import works in all four contexts; a composable works only in
components. `useSeedData()` exists solely to give templates and computeds reactivity, and
delegates to the same module state.


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
which is why the seed slices debounce.

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

### `useSeedData.ts` — lazy reactive slices

One module owns everything: the state, the subscriptions, the sync getters, and the
composable.

```ts
// apps/order-manager/src/db/useSeedData.ts
const slices = new Map<string, ShallowRef<Map<string, Row>>>();
const subscriptions = new Map<string, Subscription>();
```

**A slice is created on first access.** The first call for a table finds nothing, returns
the raw id, and kicks off an async read plus a `liveQuery` subscription. When the read
lands, the ref is set; any computed that read it re-evaluates and the real label appears.

```ts
function sliceOf(table: string): Map<string, Row> {
  let slice = slices.get(table);
  if (!slice) {
    slice = shallowRef(new Map());
    slices.set(table, slice);
    void loadAndSubscribe(table);   // async; fills the ref, then keeps it fresh
  }
  return slice.value;                // reading .value registers the dependency
}
```

There is no catalog to configure and no boot step. Only tables a session actually touches
are ever read or subscribed — a user who never opens a country picker never loads the 1,388
geo rows.

| Aspect | Behaviour |
| --- | --- |
| **Which tables** | Whichever ones get asked for. No config. |
| **First access** | Returns the raw id, starts an async read and a `liveQuery` subscription. |
| **Refresh** | One `liveQuery(() => table.toArray())` per live slice, 150 ms trailing debounce, replacing only that slice's ref. |
| **Reactivity** | Per-slice `shallowRef`. Reading through a getter registers a dependency, so only computeds that touched a changed table re-run. |
| **Miss** | Returns the raw id, exactly as `itemDescription()` does today. |
| **Secondary indexes** | Rebuilt with their source slice: `statusesByType`, `enumsByType`, `enumChildTypesByParent`, `geoAssocsByCountry`, `carrierShipmentMethodsByParty`, `transitionsByStatus`. Removes the O(n) `flatMap` scans `findStatus`/`findEnum` run on every `describe()` today. |
| **Lifecycle** | `reset()` on logout and before an OMS switch: unsubscribe everything, drop every slice. |
| **Writes** | `createOrderIdentificationType` POSTs, then `refreshAfterMutation("enum", { enumId })` → worker refetch → Dexie write → liveQuery → slice replaced. |

`liveQuery` is the correctness mechanism, not `DB_SYNC_CHANNEL`. Dexie's own change tracking
covers every writer — worker, main thread, other tabs — so a live slice cannot go silently
stale. `DB_SYNC_CHANNEL` survives only for sync progress reporting on the Settings screen.

### `ensureLoaded` — the one rule lazy loading imposes

Reactive refs self-correct only where a **computed re-reads them**. Where a lookup result is
*stamped into data* — copied into a row, a form, or a `ref` — it is evaluated once and never
revisited, so a cold slice leaves a raw id there permanently.

Every such site in the app is already inside an async function, so the module exports:

```ts
export async function ensureLoaded(tables: string[]): Promise<void>
```

Call it before stamping:

```ts
// store/order.ts — inside async fetchWorkflowPage
await ensureLoaded(["productStores", "shipmentMethodTypes"]);
const orders = docs.map((doc) => ({ …, productStoreName: productStoreName(doc.productStoreId) }));
```

The six stamping sites:

| Site | Enclosing scope | Tables |
| --- | --- | --- |
| `store/order.ts:47` | `async fetchWorkflowPage` | `productStores`, `shipmentMethodTypes` |
| `store/customer.ts:326` | `async loadCustomerDashboard` | `statuses` |
| `store/customer.ts:374` | async order-progress block | `statuses` |
| `store/customerService.ts:1058` | async filter-rule builder | `enums` |
| `services/order.ts:793,798` | `allocationDocuments` caller | `facilityTypes` |
| `components/tasks/BadAddressTaskCard.vue:171` | `hydrate()` in `onMounted` — make it `async` | `geos`, `geoAssocs` |

Everything else self-corrects for free, including `orderDetail.ts`'s `adjustmentDisplayLabel`
(read from three Pinia getters, which are computeds), every component computed, and every
template binding.

### `useDb`

```ts
// common/db/useDb.ts
function useDb<T>(db: BaseDB, table: string, opts?: MaybeRefs<QueryOptions>): {
  records:  Ref<T[]>
  first:    Ref<T | undefined>   // computed over records — the single-record case
  count:    Ref<number>
  hydrated: Ref<boolean>
  error:    Ref<Error | null>
}
```

One composable, not two. `useDbList`/`useDbRecord` are split only because that is what exists
today; both have zero consumers. A naive merge would still return two shapes (`records` vs
`record`), which moves the split from the function name into the type. Collapsing it properly
means one return shape with the single-record case as a computed:

```ts
const { records } = useDb(db, "facilities", { scope: { field: "facilityTypeId", value: type } });
const { first: facility, hydrated } = useDb(db, "facilities", { equals: { facilityId: id } });
```

Reading one row through `equals` on the primary key costs nothing extra: Dexie resolves
`where(pk).equals(v)` through the index, the same work `get()` does. `dbClient.liveOne` is
therefore not part of the API; `dbClient.get()` remains for promise-based pk reads.

It re-subscribes when reactive options change — a gap in today's `useDbList`, which reads
`options` once at setup. `hydrated` keeps its semantic from `useDbList.ts:30`. Note that
`first === undefined` means either "no such row" or "not hydrated yet".

`useDb` ships with **zero consumers**. `useSeedData.ts` uses `dbClient` directly and nothing
else reads Dexie reactively today. It exists so new code has a sanctioned way to do reactive
reads instead of reaching for bare `liveQuery` — which is how the current duplication started.

### `useSeedData()` — the component entry point

```ts
function useSeedData()  // the module's getters, wrapped so computeds track slice changes
```

Method names match today's getters — `describe`, `statusDescription`, `facilityName`,
`geoName`, `getCountries`, `allowedTransitions`, `getEnumsByType`, and the rest — so a
component migration is `useSeedStore()` → `useSeedData()` with call sites unchanged.
Non-component callers import the same plain functions from the same file.

Four getters were Pinia *properties* and become functions, so their call sites gain `()`:
`getCountries`, `getStates`, `getShipmentMethodOptions`, `orderIdentificationTypeOptions`.

Datasets consumers read as raw state get named accessors rather than exposed maps, so
`ids`/`byId` does not leak back into 42 files:

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
| `(seed as any).partyRelationshipTypes.ids` | `partyRelationshipTypes()` |
| `(seed as any).roleTypes.ids` | `roleTypes()` |

### The Shopify catalog gap

`shopifyShop` and `shopifyShopLocation` have registered common sync domains but are missing
from `ORDER_MANAGER_SYNC_CATALOG`, so they never sync. `views/CreateOrder.vue:327` and
`views/OrderDetail.vue:1163` work today only because the REST loaders fill the store.
Dropping the REST path without adding these two entries breaks those screens. They are added
as part of this work, taking the catalog to 29 entries. The catalog still drives what the
worker syncs and what Settings displays — it just no longer drives what is held in memory.


### Boot flow

```
postLogin / authenticated boot
  startAppDbSync(token)     // worker: the only fetcher
                            // no seed wiring at all — slices build on demand

postLogout
  resetSeedData()           // unsubscribe every live slice, drop them
  clearLocalDb(db)          // unchanged

OMS switch
  resetSeedData()           // next access rebuilds against the new database
```

`loadInitialSeedData` and every `load*` action are deleted. The worker is the only fetcher,
so there is no second code path and no `resetTransientLoadStates` problem — the comment at
`seed.ts:493` about persisted mid-load state describes a persistence config that no longer
exists.

### Tables with no readers

Five tables have no reader anywhere in the app: `facilityGroups`, `groupFacilities`,
`productStoreEmailSettings`, `productStoreFacilityGroups`, `productStoreShipmentMethods`.
They keep syncing, and Settings keeps showing their status — but because slices are lazy,
they are never read into memory and never subscribed. Lazy loading makes this correct by
construction; no opt-out flag is needed.

(`productStoreFacilities` *is* read — `views/CreateOrder.vue:318` and
`components/fulfillment/FacilityInventoryModal.vue:412` — so it gets a slice on demand.)

## Dead code removed

- `productStoreSettingsByStoreId` and `loadProductStoreSettings` — nothing outside
  `seed.ts` reads them. `productStore.ts:143` has its own unrelated
  `fetchProductStoreSettings`. This is why the seed store is deleted outright rather than
  shrunk: it holds nothing that Dexie does not.
- `defineDbEntity`, `DbEntity` — superseded by `dbClient` plus the catalog.
- `useDbList`, `useDbRecord` — zero consumers today; replaced by the single `useDb`.
- `geoProjection.wellKnownText` — declared, never read.
- Getters with zero call sites, not carried over to `useSeedData.ts`:
  `contactPurposeDescription`, `communicationEventTypeDescription`,
  `returnTypeDescription`, `returnItemTypeDescription`, `roleTypeDescription`,
  `getCarrierOptions`, `getProductStoreShipmentMethodOptions`. Their underlying tables stay
  indexed regardless, because `describe()` falls back through them.

## Execution order

Each step should land green before the next starts.

1. **`dbClient` + `useDb`** in `common/db`, alongside the existing code. Nothing
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
5. **`useSeedData.ts`.** Build the module and wire `resetSeedData()` into `postLogout`,
   running *alongside* the existing store. Both paths live at once; the slices are verified
   against the store's values. No boot wiring is needed — slices are lazy.
6. **Migrate consumers**, 42 files. Components take `useSeedData()`; stores, services and
   utils import the plain functions from the same module. Add `ensureLoaded` at the six
   stamping sites. Mechanical otherwise, since the names match.
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
  - `useSeedData.ts`: a cold getter returns the raw id and triggers a load; the value is
    correct on the next tick; a write to one table replaces only that slice; the debounce
    collapses a burst of batched writes into one rebuild; `ensureLoaded` resolves only after
    the named tables are populated; `resetSeedData()` unsubscribes; secondary indexes are
    correct.
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

**A separate index config, or driving the index from the catalog.** Both rejected once
slices became lazy: the set of indexed tables is now simply the set of tables something
asked for, so there is nothing to configure.

**Eager hydration of every catalog table at boot.** Rejected in favour of lazy slices: it
loads tables a session never touches (all 1,388 geo rows for a user who never opens a
country picker) and adds a boot step to both `App.vue` and `postLogin`. Lazy loading costs
one rule — `ensureLoaded` at the six stamping sites — and removes the wiring entirely.

## Not doing

- Migrating `order`, `orderDetail`, `customer` or `productCache` onto Dexie. Each deserves
  its own spec.
- Promoting `useSeedData.ts` to `common/db`. It stays in `order-manager` until a second app
  needs it.
- Reconciling `DEFAULT_COMMON_SYNC_CATALOG` with the app catalogs.
- Prioritising label-critical domains in the worker's sync order. Worth revisiting if the
  time-to-correct-labels on a fresh login proves too long in practice.
