# Using the Local Database — Developer Guide

**Audience:** app developers working in `apps/*`.
**Architecture:** [APP_DB_ARCHITECTURE.md](APP_DB_ARCHITECTURE.md) (structure) ·
[APP_DB_SYNC_FLOWS.md](APP_DB_SYNC_FLOWS.md) (flows).
**Last updated:** 2026-10-13 — checked against the current `common/db`; app-neutral names (`appDb`, `appSchema`, `{oms}-AppDB`).

This is the how-to. It answers "I need X on screen — what do I write?", for a generic **APP**: its
database object is `appDb` (`src/db/appDb.ts`), its own entities are `appSchema`
(`src/db/appSchema.ts`), and its database is `{oms}-AppDB`. Read the architecture doc for the big picture; read this to get work done.

---

## 0. What you get out of the box

Your app declares its tables once, and the framework gives you:

- **One IndexedDB database per OMS instance**, named `{omsInstance}-{suffix}`. Switching tenant
  lands on a different database; you never have to filter by instance.
- **A background sync worker** that fills those tables on its own thread, on its own cadence, with
  the bearer token kept fresh.
- **Reactive reads** — your view re-renders when rows change, whether the change came from the
  worker or from your own write-through.
- **29 HotWax seed reference tables** (statuses, enums, facilities, geos, carriers, shipment
  methods, …) already declared and already synced. You pick which ones you want.
- **A `products` master table**, filled from Solr when a screen shows a product and kept across
  logout. Pick it like a seed table and read it with `useProductMaster` (the `accxui-product-search`
  skill).

The rule of thumb: **read from the database, never fetch reference data in a view.**

---

## 1. Choosing a data API

App code reaches the database one way — through `dbClient`, with one query shape (`QueryOptions`) —
and **one pattern**: the composables.

| You want… | Use | Where it works |
|---|---|---|
| Rows that stay current **on screen** (§1b) | `useLiveEntity(table, options?)` | Composables and `.vue` files, during `setup` |
| Seed labels, option lists and joins (§1a) | `useSeedData()` | Composables and `.vue` files, during `setup` (never `App.vue`) |
| One-shot reads and **writes** (§1d) | `appDb.entity(table)` — `get`, `getMany`, `all`, `query`, `first`, `count`, `put`, `bulkPut`, `upsertMany`, `snapshotReplace`, `remove`, … | Worker sync domains (`src/workers/**`) and `src/db/**` only |

`appDb` is the APP's database object (`src/db/appDb.ts`). Stores, utils and the router never read
it: a store action or util that needs rows takes them as arguments, and the composable or page that
calls it passes them (§1e).

Two conveniences sit on the same layer and are not separate data paths:

| You need | Use | Shape |
|---|---|---|
| A label, option list or joined lookup for seed data | `useSeedData()` during setup in a composable or `.vue` file (never in `App.vue`) | `seed.facilityName(id)` in a template or `computed` |
| Row counts + last-sync per domain (Settings) | `useDbStatus(appDb.client(), catalog, actions)` | `{ domains, totalRows, refreshAll, … }` |

**Not for pages or stores** — framework and worker internals:

| You want… | Use | Who uses it |
|---|---|---|
| Snapshot reads across several tables; sync login markers | `appDb.client()` — `read`, `liveRead`, `syncedThisLogin`, `markSyncedThisLogin`, `clearSyncedThisLogin` | Framework internals (`useLiveEntity`'s `syncDomain`, `loadSeedData`, `useDbStatus`, `setupAppDbSync`) and hand-written worker sync domains |

**Name tables through `appDb.tables`.** Every schema carries its table names as a static object —
`commonSchema.tables`, `appSchema.tables`, and the composed `appDb.tables` (the seed tables
the app picked plus its own). It is plain data built when the module loads, with no database
involved, so it works in the worker and before sign-in:

```ts
useLiveEntity<any>(appDb.tables.facilities, () => ({ equals: { facilityTypeId } }));
await appDb.entity(appDb.tables.statuses).all();   // in a worker sync domain
```

A misspelled name is a missing property, so it fails to compile — including in `useLiveEntity`,
which otherwise takes any string. `appDb.entity(table)` and every table-taking `appDb.client()`
method also check a literal name against the app's tables, and `useLiveEntity` checks at runtime
(§1b). For a helper that takes a table, type the parameter as `AppDbTables<typeof appDb>`.

Rows are not typed from the schema yet: `entity(...)` rows are `Record<string, any>` and
`useLiveEntity` rows are what you pass it (`<any>` at most call sites). Stronger row typing is
planned as a separate effort.

There is no raw Dexie handle on an app database: nothing outside `common/db` touches Dexie.

### 1a. `useSeedData()` — seed lookups

Typed getters over the framework seed tables: labels, option lists and in-memory joins. It takes no
arguments and resolves the active database itself. The APP may wrap it in its own lookup composable,
which then also runs during setup.

**One instance per component tree.** The first `useSeedData()` in a tree creates the instance and
provides it; every component below it (a page's cards, rows, segments) injects that same instance,
so a list of 200 cards still holds one read per table. A second call in the same setup returns the
same instance. Each seed table is opened through `useLiveEntity` the first time a getter needs it,
usually from a template during render, inside the scope captured at setup, and closes when the
providing component unmounts. The read re-emits whenever the table changes: the login sync filling
it, a `refreshAfterMutation`, or a resync from Settings. A table nobody asks for is never read.

**Where to call it.** In the page, component or composable that shows the labels, during setup. Never in
`App.vue` or a layout: everything would inject that instance and every seed table it touched would
stay open for the session (lint rejects it in `App.vue`). It throws outside setup. Ionic keeps
pages in the navigation stack mounted, so a page's reads stay open while a page pushed over it is
shown. A modal opened with `modalController` is mounted outside the page's tree and opens its own.

Getters come in two kinds, told apart by name:

| Kind | Names | Returns | Use it for |
|---|---|---|---|
| Reactive | no prefix: `statusDescription`, `facilityName`, `enumsByType`, `countries`, `shipmentMethodOptions`, `partyRelationshipTypes`, `allowedTransitions`, … | a value, synchronously | templates and `computed`s |
| Async | `get` prefix: `getFacilities`, `getGeos`, `getProductStores`, `getEnumsByType`, … | a Promise of the table's current rows, read once | code that must act on the rows, such as building a request from them |

```ts
import { useSeedData } from "@common/db";

const seed = useSeedData();

// Reactive: call it where the value is shown. It re-renders when the table loads or changes.
const channels = computed(() => seed.enumsByType("ORDER_SALES_CHANNEL"));
const states = computed(() => seed.statesForCountry(form.countryGeoId));  // geos ⋈ geoAssocs
```

```vue
<ion-label>{{ seed.statusDescription(item.statusId) }}</ion-label>
<ion-note>{{ seed.facilityName(item.facilityId) }}</ion-note>
```

```ts
// Async: only when the rows must be in hand before continuing.
const facilityRows = await seed.getFacilities();
const facilityIds = facilityRows.filter(isPhysicalFacility).map((facility) => facility.facilityId);
```

**A store or util never reads seed data itself.** It takes the rows or getters it needs as
arguments, and the composable or page that calls it passes them from its `useSeedData()`. A util
types the parameter as just the getters it reads (`Pick<SeedData, "facility" | "facilityType">`); a
store action takes plain rows:

```ts
// The page (or its composable) reads the rows; the store action only uses them.
const seed = useSeedData();
await orderStore.runSearch(await seed.getFacilityTypes().catch(() => []));
```

`loadSeedData()` (a one-shot snapshot) is framework-internal: app code does not call it, and lint
rejects it outside `src/workers/**` and `src/db/**`.

**Don't resolve seed data into a ref.** There's no need for `watch` + `await` + a label-map `ref`:
the reactive getter already re-renders on its own, and a watcher only adds a raw-id flash and a race
between out-of-order reads.

**A cold table answers with the raw id or `[]`.** The first render after a table's first use shows
the id (or an empty list) until the read lands, a few milliseconds later, then re-renders. On a
fresh login the table may also still be empty because the background sync hasn't filled it yet.

**When an empty list drives a decision, use `.withSync()`.** Every list getter has it, with the
same arguments, and it answers `{ data, synced }`. `synced` turns true once the tables behind the
getter hold this login's sync (it reads the domain's `loginSync:` marker in the same transaction as
the rows), so an empty `data` with `synced` true really is empty:

```ts
// An address form: "no states" only once geos have synced (SG, HK have none).
const countryStates = computed(() => seed.statesForCountry.withSync(form.countryGeoId));
const isLoadingStates = computed(() => !!form.countryGeoId && !countryStates.value.synced);
```

`synced` stays false if that domain's sync fails, so a screen that must not spin forever also
accepts "first read landed and `serviceState.running` is false".

**The async `get*` getters read the table once, now, not after the sync.** Use them when the rows
must be in hand before you continue, such as code that stamps a looked-up value permanently
(for example, building an address state from `await getGeos()`). On a fresh
login they can still resolve `[]`, so they do not tell "not synced yet" from "empty". Use
`.withSync()` or `useLiveEntity`'s `hydrated` for that.

Label getters accept a missing id (`undefined` or `null`) and answer `""`; list getters answer `[]`.
Countries come from `geoTypeEnumId === "GEOT_COUNTRY"`; a country's states follow its `GAT_REGIONS`
associations only, so group memberships such as DBIC never appear as states.

`allowedTransitions(statusId, statusFlowId?)` reads one status flow, `Default` unless you name
another, as OMS does for an order with none. Flows reuse status ids, so reading every flow would mix
their transitions. Rows come in `transitionSequence` order with `toStatusDescription` added, and
carry `transitionName` and `conditionExpression`.

### 1b. `useLiveEntity()` — reactive reads

One entry point, always a list, backed by a Dexie `liveQuery`. The APP's read composables over its
own tables are built on it; seed lookups go through `useSeedData` instead.

Pick `useSeedData` for read-only seed lookups: labels, dropdown options, names by id. Pick `useLiveEntity`
when the screen queries a table (`equals`, `scope`, `filter`, a date range), needs `hydrated` for
its loading and empty states, or reads one of the app's own tables. Each `useLiveEntity` call is its own
subscription, closed on unmount; `useSeedData`'s are shared by the component tree that opened them
and close when its root unmounts.

```ts
import { useLiveEntity } from "@common";
import { appDb } from "@/db/appDb";

// Whole table, live.
const { records, hydrated } = useLiveEntity<any>(appDb.tables.statuses);

// One row: `equals` on the primary key is an index lookup, and `first` is the row.
const { first: facility, hydrated } = useLiveEntity<any>(appDb.tables.facilities, () => ({ equals: { facilityId: props.id } }));

// A scoped slice.
const { records } = useLiveEntity<any>(appDb.tables.productStoreFacilities, { scope: { field: "productStoreId", value: id } });
```

Pass a **function** when the options depend on reactive state — it re-subscribes when they change,
and until the new query's first emit `records` is empty and `hydrated` is false, so store A's rows
never render under store B. Pass a plain object when they're static.

For a single-row read whose id may not be known yet, return `{ filter: () => false }` rather than
`{}` while it is missing: `{}` reads the whole table, and `first` would be some other row.

`useLiveEntity(table, options?)` reads the signed-in app database through `getAppDb().client()`;
`useLiveEntity(client, table, options?)` reads another database through its `DbClient` (a raw `BaseDB` is
still accepted and wrapped).

It is the Vue form of `appDb.entity(table).live(options)`, hence the name. A table the database
does not have throws at the call — `[db] useLiveEntity: "facilitys" is not a table in
OMS-AppDB.` — rather than surfacing only in `error`. (It was called `useDb` until 2026-10-12.)

`QueryOptions`:

- `scope` and `equals` are one set of equalities (`scope` is just the first), and every one holds on
  the result. The read uses the widest declared index that covers them: `[scope+…equals+dateField]`,
  then `[scope+…equals]`, then the first indexed field. Whatever the index can't cover is filtered
  in memory, and with no usable index the whole table is read. Matching is strict `===`, so a number
  never matches a string.
- `dateField` **orders** the result, newest first unless `order: "asc"`; `since`/`until` bound it.
- `filter` (in-memory predicate), then `limit`, applied after sorting, so `dateField` + `limit` is
  "the latest N".
- `order` defaults to `"desc"` with a `dateField`, otherwise storage order.

> **`hydrated`, not `records.length`.** `hydrated` is false while the first sync is still running, so
> use it to tell "not loaded yet" from "genuinely empty". Rendering an empty state off
> `records.length === 0` will flash it on every cold start.

### 1c. `useDbStatus()` — the Settings card

```ts
import { catalogFrom, useDbStatus } from "@common/db";

const { domains, totalRows, lastSyncedAt, refreshDomain, refreshAll } = useDbStatus(
  appDb.client(),
  // Every domain the APP registers, loaded lazily so the domain modules stay out of the page chunk.
  async () => catalogFrom((await import("@/workers/appSyncDomains")).appSyncDomains),
  { resyncDomain, resyncAll: resyncReferenceData },
);
```

Build the catalog from `appSyncDomains`, not from the worker (`syncService()?.catalog()`): the card
then lists every domain even before the worker is up or after it failed to start, when its
per-domain Refresh is the way back. `appDb.statusCatalog` exists too, but it lists only the seed
tables' common domains, not the APP's own or overridden ones.

Actions are injected rather than imported, because the card must refresh through the same service
that owns your app's worker.

### 1d. `appDb.entity()` — for worker sync domains

One-shot reads and writes, used by the worker's sync domains (`src/workers/**`) and `src/db/**`.
App code (composables, pages, stores, utils) does not use it: lint rejects it outside those two
folders. Every call resolves the signed-in database, so a client held in a module-scope const
follows an OMS switch.

```ts
// src/workers/domains/facilityDomain.ts
import { appDb } from "@/db/appDb";

const facilities = appDb.entity(appDb.tables.facilities);

const one = await facilities.get(facilityId);                           // by primary key
const some = await facilities.query({ equals: { facilityTypeId } });    // same QueryOptions as useLiveEntity
await facilities.upsertMany(rows);                                      // the domain is the table's only writer
```

`first`, `count`, `getMany`, `put`, `bulkPut`, `remove`, `snapshotReplace` and the rest are on the same
`EntityClient`. Writes project through the entity, so pass the server's record as-is. **Only sync
domains write**: the domain that fills a table is the only thing that writes it, so the row has one
shape however it arrived. App code reads with `useLiveEntity` / `useSeedData`, changes server data
with `api()` then `refreshAfterMutation` / `resyncDomain` (§4), and fetches a record it is missing with
`refreshAfterMutation` too (§4); the `useLiveEntity` reading that record then shows it.

No live queries in the worker: it writes and renders nothing, so it reads once with
`get / query / all`. In app code, `useLiveEntity` owns every subscription: it subscribes,
re-subscribes when the options change and unsubscribes on unmount.

### 1e. Store data with app-db rows

Pinia stores hold server data (what `api()` returned, raw ids) and never read the app db; the app db
and its workers never reach a store. When a screen needs both, a **page or domain composable** joins
them, and a store action or util that needs seed rows takes them as arguments:

```ts
// src/composables/useOrderQueue.ts
export function useOrderQueue() {
  const orderStore = useOrderStore();
  const seed = useSeedData();

  // The store action gets the facility type rows it needs from here.
  const search = async () => orderStore.runSearch(await seed.getFacilityTypes().catch(() => []));
  const rows = computed(() => orderStore.searchResults.map((order) => ({
    ...order,
    statusLabel: seed.statusDescription(order.statusId),   // the join, in the composable
  })));

  return { rows, search };
}
```

The same holds for utils: they are pure, so they take store data and seed rows as parameters
rather than reading a store or the db.

---

## 2. Adding a table to your app

Four steps. Miss the last one and existing installs keep the old row shape.

**1. Declare the entity.** In your app's schema module (`src/db/appSchema.ts`):

```ts
widgets: defineEntity({
  primaryKey: "widgetId",              // comma-separate for a compound key: "productStoreId,widgetId"
  fields: {                            // THE WHITELIST — see the warning below
    widgetId: "text",
    widgetName: "text",
    statusId: "text",
    lastUpdatedStamp: "date",
  },
  indexes: ["statusId", "lastUpdatedStamp", "[statusId+lastUpdatedStamp]"],
  rename: { widgetName: "name" },      // stored name ← the field the API actually sends
}),
```

`FieldKind` picks the coercion: `text` → trimmed string, `count` → number, `date` → epoch millis
(accepts millis, numeric string or ISO), `structured` → passed through as-is (an empty array stays `[]`).

**Nested fields.** A field can hold a nested object or a list instead of a scalar, declared in place,
so a row can carry the shape a screen wants (the way a Pinia store would hold it) rather than the
server's flat one:

```ts
shipments: defineEntity({
  primaryKey: "shipmentId",
  fields: {
    shipmentId: "text",
    statusId: "text",
    carrier: { partyId: "text", name: "text", createdDate: "date" },        // nested object
    packages: [{ packageSeqId: "text", weight: "count", trackingCodes: ["text"] }], // list of objects
    tags: ["text"],                                                          // list of scalars
  },
  indexes: [
    "carrier.partyId",                   // dotted path into an object
    "[statusId+carrier.partyId]",        // compound indexes may use dotted paths too
    "*packages.trackingCodes",           // multi-value: matches a row when ANY package has the code
    "*tags",
  ],
  rename: { "carrier.name": "groupName", "packages.weight": "grossWeight" },
}),
```

- A nested declaration is a whitelist like the top level: undeclared keys are dropped and every leaf
  is coerced by its kind (a `date` inside `carrier` becomes millis too). A value of the wrong shape
  (a string where an object is declared) is left out; a list item of the wrong shape is dropped.
  `structured` remains the way to store something as-is.
- `rename` names a nested field by its dotted **stored** path; the value is the source key inside
  the same parent object. Lists are not part of the path: `packages.weight` renames it on every item.
- A field inside a list is indexed with `*`. IndexedDB cannot index into an array of objects, so
  for `*packages.trackingCodes` projection also writes a flattened top-level array,
  `packages$trackingCodes`, and the index is declared on that. You query the dotted path
  (`equals: { "packages.trackingCodes": "1Z1" }`) and the client picks that index. The hidden
  field is on every row you read; ignore it.
- `equals` / `scope` on a dotted path works without an index too (read in memory). In memory and
  through a `*` index alike, a list matches when any of its values equals the one asked for.
- A primary-key field must be a top-level `text`, `count` or `date`. Field names are plain
  identifiers (no `.` or `$`). Compound indexes cannot include a field inside a list, and
  `dateField` / cursor fields stay top-level.

Nested fields shape what is **stored**; they do not fetch anything. If the shape comes from several
APIs, the domain that fills the table assembles each record before it is written (a custom `sync`
in `defineSyncDomain`, §3).

A row missing **any** primary-key member is dropped as unkeyable. If the server legitimately omits
a key member (a document attached to no feed), give it a stand-in with `keyDefaults: { feedId: "" }`.
Each key in `keyDefaults` must be a primary-key field. Use it only where the absence is a real state,
never to cover a wrong field name.

Logout empties every table. `retainOnLogout: true` keeps one table's rows for the next login on the
same OMS instance (the default is `false`). Use it only for data that is the same for every user
of the instance, such as a product catalog, and never for anything scoped to the signed-in user.
A version bump still rebuilds the database and drops those rows. Nothing refreshes a retained row
by itself: the screen that reads it decides when it is stale (its `syncedAt`) and calls
`refreshAfterMutation`. The framework's `products` seed table works this way: `useProductMaster`
asks its `product` domain for the ids a screen shows, and the domain fetches only the stale ones.

> ⚠️ **`fields` is a whitelist, and it is the only thing stored.** A field you don't declare is
> dropped at write time — it is not tucked away anywhere. If a screen needs it, declare it. This is
> the single most common cause of "the row is in IndexedDB but my field is undefined".

**2. Add an index for every way you query it.** A `scope`, `equals` or `dateField` with no index
still works, but it reads the whole table and filters or sorts in memory. A two-part question ("this
store's widgets, newest first") wants a compound index `[productStoreId+createdDate]`, not two single-field
ones: the read then comes back filtered and ordered from the index alone.

**3. Bump the version** in your app's db module:

```ts
export const appDb = defineAppDb({
  suffix: "AppDB",
  version: 4,                          // ← was 3
  schema: mergeSchemas(commonSchema.pick([...APP_SEED_TABLES]), appSchema),
});
```

**4. Give it a domain** so something fills it — §3.

The new table is then on `appDb.tables` (and `appSchema.tables`) with nothing more to do:
name it as `appDb.tables.widgets` wherever you read or write it (§1).

### Why the version bump is not optional

A database recording a different version than the build declares is **dropped and rebuilt** on first
use, and the worker refills it. That is the only migration mechanism: there is no in-place upgrade.

Bump it for *any* schema change — new table, added or removed index, changed primary key, changed
`fields`, changed `rename` or `keyDefaults`. **Nothing detects a forgotten bump.** The app will run, and rows written
by the previous build will still be there with their old shape — a `date` field still holding an ISO
string, a renamed field still absent. Treat bumping as part of the change, not a step afterwards.

### Extending an entity

An APP often composes entities it did not declare: the seed tables today, and shared framework
entities (products, orders, …) as they are added. When such an entity is right but your APP needs
more of the row (a field the shared projection drops, an index for your query), extend it instead of
redeclaring it. `extendEntities` works on any schema, seed or not, so apply it to the schema the
entity comes from, before `mergeSchemas`:

```ts
// src/db/appDb.ts
export const appDb = defineAppDb({
  suffix: "AppDB",
  version: 5,                                            // ← bump: this is a schema change
  schema: mergeSchemas(
    sharedSchema.pick(["products", "facilities"]).extendEntities({
      products: {
        fields: { brandName: "text", introductionDate: "date" }, // added to the whitelist
        indexes: ["brandName", "[productTypeId+brandName]"],     // may use the added fields
        rename: { brandName: "brand" },                          // stored name ← API field name
      },
    }),
    appSchema,
  ),
});
```

`sharedSchema` stands for whichever schema declares the entity: `commonSchema` for a seed table, or
any other shared schema the APP picks from. Then read the field as usual:
`useLiveEntity(appDb.tables.products, () => ({ equals: { brandName } }))`.

**It merges, never replaces.** Your fields, indexes and renames are added to the entity's own. A
nested object (or list of objects) is merged into rather than replaced:
`fields: { carrier: { email: "text" } }` adds `email` to an existing `carrier`, and
`rename: { "carrier.email": "emailAddress" }` / `indexes: ["carrier.email"]` can name it. It
throws at load, naming the table, when you:

- add a field the entity already declares (you cannot change a field's kind), at any depth,
- rename a field the entity does not declare, or one it already renames,
- name a table the schema does not have, or add an index `defineEntity` rejects (an undeclared
  field, or the primary key restated).

An index the entity already has is skipped rather than duplicated. The primary key and
`keyDefaults` cannot be changed; to change those, declare your own table under that name in your
APP schema instead of picking the shared one.

**The table's domain stores your fields with no change to it.** Sync domains store rows through the
APP's composed entity, not the original declaration, so whichever domain fills the table writes the
added fields on its next sync. The fields must be in what that domain's endpoint returns. If they
aren't, they stay empty, and the table needs a domain that reads an endpoint which does return them.

**What it does not affect.** `extendEntities` returns a new schema and leaves the source schema
untouched, so another APP picking the same entity still gets the original. Provenance is kept: a
seed table stays a seed table (same domain, same status-card entry), and any other table keeps
whatever domain fills it. `extendIndexes(map)` is still there as the indexes-only form.

**Bump `version`** as with any schema change. Without the bump, existing installs keep rows written
without the new fields until the next full resync, and an added index may not exist on them.

### Picking seed tables

Take only what you read:

```ts
const APP_SEED_TABLES = ["productStores", "statuses", "enums", "facilities", /* … */] as const;
mergeSchemas(commonSchema.pick([...APP_SEED_TABLES]), appSchema)
```

To take every seed table, pass `commonSchema` itself. Picking seven gives seven tables, not all of
them.

Two ways to fill a seed table differently from the framework (to keep the framework's domain and
only store more of each row, see [Extending an entity](#extending-an-entity)):

- **Same table, your own domain.** Pick the seed table, and register a domain with the seed domain's
  **name** and your endpoint, leaving the seed one out of `registerDomains`. For example, an APP
  that wants `statuses` from `oms/statuses` instead of the seed `admin/status` picks the seed table,
  registers its own `{ name: "status", listUrl: "oms/statuses" }`, and filters the seed `status`
  domain out of its `workers/appSyncDomains.ts` list (keep an `OVERRIDDEN_SEED_TABLES` set there).
  Build the status card from that same list (§1c), so it shows the domain that actually runs.
- **Your own table under a seed name.** Declare it in your own schema and don't `pick` the seed one.
  The framework tracks provenance, so `appDb.statusCatalog` leaves it out instead of pointing it at
  the seed endpoint.

---

## 3. Filling a table: pick a sync class

| Class | Meaning | Cadence | Use |
|---|---|---|---|
| **B** | Reference / config. Rarely changes. | Once per login, then only on mutation | `defineSnapshotDomain` |
| **A** | Live, append-mostly. Transactional. | `intervalMs`, only while a view needs it | `defineCursorDomain`, or hand-written |
| **C** | One record at a time, when a screen asks. | Never polled; filled by `refreshAfterMutation` | `defineSyncDomain` with `sync` returning `0` and a `refetchOne` |

**Class B — the common case.** Fetch the whole set, replace what's stored:

```ts
defineSnapshotDomain({
  name: "widget",                  // registry name — what refreshAfterMutation() calls
  label: "Widgets",                // shown on the status card
  syncClass: "B",
  table: "widgets",
  listUrl: "oms/widgets",
  collectionKey: null,             // null = bare array; "widgetList" = resp.widgetList
  byPk: (pk) => ({ url: `oms/widgets/${encodeURIComponent(String(pk.widgetId))}` }),
})
```

`collectionKey` is explicit on purpose — the envelope differs per endpoint, and guessing is how a
snapshot silently becomes `[]`. Add `strictCollection: true` to fail loudly instead of degrading.

`defineSnapshotDomain` options:

| Option | Use it when |
|---|---|
| `collectionKey` | the list is wrapped: `"widgetList"` reads `resp.widgetList`; `null` for a bare array |
| `strictCollection: true` | a missing envelope key should throw rather than snapshot to `[]` |
| `listParams` | the list needs fixed server params (a type filter); also sent by `refetchScope` |
| `batchSize` / `unpaged: true` | page size (default 250) / the route ignores paging: one request, still asks for a full page |
| `scopeOnSync: { field, value }` | the table holds more than this list returns: prune only rows in that partition |
| `fanOut: { parentTable, parentKeyField, urlFor, collectionKey? }` | rows come per parent (one URL per id in an already-synced parent table); the parent id is stamped on each row, and `refetchOne` re-reads that parent's rows |
| `byPk` (+ `byPkRecordKey`) | a by-id route exists; `byPkRecordKey` unwraps `{ <key>: record }`. An empty answer **removes** the stored row |
| `refetchScope: (pk) => ({ params, scope? })` | no by-id route, but the list filters by key: re-read that slice and prune within `scope` |

Each sync refuses to replace a populated table with an empty fetch (unless forced), and skips
rows it cannot key. An entity whose key member the server may legitimately omit declares
`keyDefaults: { feedId: "" }` on `defineEntity` (§2), so those rows are kept instead of dropped.

**Class A — live data.** A cursor domain fetches only what's newer than what you hold:

```ts
defineCursorDomain({
  name: "widgetEvent",
  label: "Widget events",
  table: "widgetEvents",
  intervalMs: 15_000,
  listUrl: "oms/widgetEvents",
  cursorField: "createdDate",       // the stored field that advances
  cursorParam: "createdDate_from",  // the server param that lower-bounds it
  total: 100,                       // window depth per scope
  scopeOf: (args) => (args.productStoreId ? { field: "productStoreId", value: args.productStoreId } : undefined),
})
```

⚠️ **Probe the endpoint before trusting a cursor param.** Filter support is per-route, not a Moqui
convention. `admin/dataManager/details` honours `_from` but ignores `_op`; `admin/systemMessages`
ignores both and silently returns the unfiltered page. If the server ignores your param the `keep`
predicate still trims client-side, but you pay for the full page every tick.

**Then register it** in your worker entry (`src/workers/appSync.worker.ts`):

```ts
registerDomains(appSyncDomains);   // src/workers/appSyncDomains.ts: [...appSeedDomains, widgetDomain, /* … */]
```

A domain that isn't registered never runs, with no error. Every app runs the shared wiring checks
from `@common/db/testing/appDbWiring` in `tests/db/appDbWiring.spec.ts`:

```ts
expect(checkDomainWiring({
  tables: Object.keys(appDb.tables),
  domains: appSyncDomains,                       // exactly what the worker registers
  filledBy: { widgetNotes: "widget" },           // a table one domain fills besides its own
  unfilled: {},                                  // declared on purpose with nothing filling it: say why
})).toEqual([]);
expect(checkSyncLifecycle({ appVue: source("App.vue"), userStore: source("store/user.ts") })).toEqual([]);
```

`checkDomainWiring` reports a domain whose table the database doesn't declare, a domain name
registered twice, a table nothing fills, and a class C domain without a `refetchOne`.
`checkSyncLifecycle` reports an `App.vue` that doesn't start the sync on `isAuthenticated`, a
`postLogin` that doesn't stop the sync before starting it, and a `postLogout` that doesn't stop it.
Each returns a list of problems, so a failure names all of them.

---

## 4. Keeping the database fresh after a write

Mutations go to the server first, then you reconcile the local row. Never write the server's
response into the table yourself.

```ts
import { refreshAfterMutation } from "@/db/appDbSync";

const response = await api({ url: "oms/widgets", method: "post", data: { widgetId, widgetName } });
// ...check the response however your APP does (for example a local `hasError` helper)
// and only reconcile once the write is known to have landed:
await refreshAfterMutation("widget", { widgetId });   // domain name + primary key
// or, when the write touches more than one record of the domain:
await resyncDomain("widget");                         // re-reads the whole domain
```

Both take **sync domain names**, not table names. List every domain the write touches.

`refreshAfterMutation` throws `CacheReconciliationError` when the server change landed but the local
refresh didn't. **That is not a failed mutation** — it carries `mutationCommitted = true`, so don't
retry the write. Show "saved, but refresh to see it" and let the user reload.

Which refetch strategy your domain needs:

| Situation | Config |
|---|---|
| A `GET /thing/{id}` route exists | `byPk` |
| That route wraps the record differently from the list | `byPk` + `byPkRecordKey: "jobDetail"` |
| No by-id route, but the list filters by id | `refetchScope` |
| The stored row is (parent, child) and the mutation only knows the parent | `refetchScope` — a plain upsert would leave the old child row behind |
| None of `byPk`, `refetchScope` or `fanOut` configured | **Nothing happens.** `refreshAfterMutation` resolves `0` and the row stays stale. Add one, or call `resyncDomain(name)` instead |

Check the seed domain before relying on it. Of the seed domains, only `productStore` and `facility`
(`byPk`), `enum` and `groupFacility` (`refetchScope`), and the `fanOut` ones (`productStoreFacility`,
`productStoreFacilityGroup`, `productStoreShipmentMethod`, which re-read every row for the
`productStoreId` in the key) reconcile after a mutation. `enum` refetches by its
`enumId` (`refreshAfterMutation("enum", { enumId })`); `status`, `geo`, `carrier` and the other
type tables don't, so after mutating one of those use `resyncDomain`.

A `byPk` read that fails rejects, so it surfaces as `CacheReconciliationError` rather than a silent
stale row. A `byPk` route may answer with the record itself or a one-item list; an empty answer
removes the stored row.

### A record you don't have yet

A screen that reads a record the db does not have asks the table's domain for it through the same
`refreshAfterMutation`, instead of fetching and writing it itself. The `useLiveEntity` reading the
record shows it once the domain has written it:

```ts
import { refreshAfterMutation } from "@/db/appDbSync";

const { first: widget, hydrated } = useLiveEntity<any>(
  appDb.tables.widgets,
  () => ({ equals: { widgetId: props.widgetId } }),
);
watch(hydrated, (ready) => {
  // worker: the widget domain's refetchOne; the live read above then shows the row
  if (ready && !widget.value) void refreshAfterMutation("widget", { widgetId: props.widgetId }).catch(showLookupError);
});
```

- It behaves exactly as after a write: it waits for the worker's first sync pass, records a failure
  in the sync status, and rejects with a `CacheReconciliationError`.
- That error's message says a server change was saved. A lookup changed nothing, so catch it and
  show your own message; don't pass it to a mutation-error helper.
- The domain needs a `refetchOne`. A table filled only on request gets a class C domain whose
  `sync` returns `0`.

---

## 5. Polling while a view is open (class A)

Class-A domains are off by default. A view switches on what it reads, with args, and switches them
off when it leaves. The three functions come from your app's `db/appDbSync.ts`, which
re-exports them from `setupAppDbSync`:

```ts
import { activateSyncDomains, createSyncDomainOwner, deactivateSyncDomains } from "@/db/appDbSync";

// Once per screen instance, at setup — never a shared constant.
const SYNC_OWNER = createSyncDomainOwner("widgetView");

const widgetSyncDomains = () => [
  { name: "widgetEvent", intervalMs: 15_000, args: { productStoreId: props.id } },
  { name: "widgetRun", intervalMs: 60_000, args: { productStoreId: props.id } },
];

// Ionic lifecycle, not onMounted — a cached page re-enters without remounting.
onIonViewWillEnter(() => { void activateSyncDomains(widgetSyncDomains(), SYNC_OWNER); });
// Re-scope when the thing the domains are scoped to resolves or changes.
watch(() => props.id, () => { void activateSyncDomains(widgetSyncDomains(), SYNC_OWNER); });
onIonViewDidLeave(() => { void deactivateSyncDomains(SYNC_OWNER); });
```

`activateSyncDomains` is idempotent, so call it again whenever the set changes. There is no
separate "update" call.

**Why the owner.** Ionic fires the old view's `didLeave` *after* the new view's `willEnter`. The
owner lets `deactivateSyncDomains` recognise that the leaving view no longer holds the worker, and
ignore the call, instead of wiping the domains the new view just switched on. For this to work:

- create the owner **once per instance** with `createSyncDomainOwner(label)`, inside `setup`. A
  module-level constant would be shared by every instance of the component, which defeats the
  guard when two routes reuse one component;
- pass the **same** owner to every `activateSyncDomains` and `deactivateSyncDomains` call on that
  screen;
- always deactivate in `onIonViewDidLeave`, not only in `onUnmounted` / `onBeforeUnmount`: Ionic
  keeps a page mounted when the user navigates on from it, so an unmount-only teardown leaves its
  domains polling behind a hidden page;
- don't re-activate from a `watch` while the page is hidden: gate it on a flag set in `willEnter` and
  cleared in `didLeave`, or the hidden page takes the worker back from the one on screen.

Lint checks the wiring it can see: a file that activates must also deactivate, a page (`.vue`) that
activates must register `onIonViewDidLeave`, and `deactivateSyncDomains()` always takes the owner
(§7). A composable that activates exposes a `deactivate()`, and the page calls it on leave.

**What the screen can read back:**

| From `db/appDbSync` | Use |
|---|---|
| `syncDomainsReady` | `Ref<boolean>` — the worker has accepted this activation |
| `syncDomainsError` | `ComputedRef<string>` — an error from one of the *activated* domains, else `""`. Drive the screen's warning banner from this |
| `syncNow()` | Force a pass over **this screen's** activated domains (a "refresh" button). Not the login seed set, and it clears no markers. Called mid-pass, it queues a fresh pass instead of resolving against the running one |
| `serviceState.syncedAt[domain]` (from `@common/db`) | When that domain last finished a pass **for its current activation**. Use it to tell "nothing for this store" from "not fetched yet". It is removed when the screen leaves or re-scopes the domain, and cleared on logout |

**One screen, one set.** There is one worker and one active set. If two features on one screen
both need polling, build one combined list and activate it once (a shared composable can own that list). Two separate `activateSyncDomains` calls overwrite each other. The login set (class
B) is separate: it stays active alongside whatever a screen activates, and a screen can't switch it
off.

An activation that runs before the sync has started (a deep link lands before `App.vue` starts it)
is held and handed to the worker when it comes up, so the screen doesn't lose its set.

`syncNow()` is the screen's refresh. Settings' "Refresh all" is `resyncReferenceData()`: it clears
every sync marker, then forces a pass over every active domain, login set and screen set together
(`syncService()?.syncAll()` underneath).

Two rules that matter:

- **Pass only what this screen renders.** Args multiply into requests — six message types across two
  remotes is twelve requests per tick, most for a screen nobody is looking at.
- **Scope, don't window.** "The newest 100 system messages" caches whatever happens to be recent,
  which is usually not what your screen needs. Declare a scope (this store, this config)
  so the window is about your data. Keep that policy in one place, such as `src/config/appSyncConfig.ts`.

Leaving the view stops the polling but keeps the rows, so a revisit paints instantly.

---

## 6. Standing up a database for a new app

Seven steps. The resulting folder structure, and what each file must contain, is in §9.

```ts
// 1. src/db/appSchema.ts — the APP's own entities (§2). DEEP imports only.
import { defineEntity } from "@common/db/schema/defineEntity";
import { defineSchema } from "@common/db/schema/defineSchema";

export const appSchema = defineSchema({
  widgets: defineEntity({ primaryKey: "widgetId", fields: { widgetId: "text", statusId: "text" }, indexes: ["statusId"] }),
});
```

```ts
// 2. src/db/appDb.ts — DEEP imports only, never "@common/db" (the worker reaches this file)
import { defineAppDb } from "@common/db/schema/defineAppDb";
import { mergeSchemas } from "@common/db/schema/defineSchema";
import { commonSchema } from "@common/db/seed/seedSchema";
import { appSchema } from "./appSchema";

const APP_SEED_TABLES = ["productStores", "statuses", "enums", "facilities"] as const;

export const appDb = defineAppDb({
  suffix: "AppDB",
  version: 1,
  schema: mergeSchemas(commonSchema.pick([...APP_SEED_TABLES]), appSchema),
});
appDb.setOmsInstanceResolver(() => "default");          // test fallback; main.ts replaces it
```

```ts
// 3a. src/workers/appSyncDomains.ts — every domain the APP registers (worker-safe imports)
import { commonDomains } from "@common/db/seed/seedDomains";
import { appDb } from "@/db/appDb";
import { widgetDomain } from "./domains/widgetDomain";

const appSeedDomains = Object.values(commonDomains).filter((d) => d.table && appDb.seedTables.has(d.table));
export const appSyncDomains = [...appSeedDomains, widgetDomain];

// 3b. src/workers/appSync.worker.ts — registration happens here
import { exposeWorkerHarness } from "@common/db/sync/pollingWorkerHarness";
import { registerDomains } from "@common/db/sync/syncRegistry";
import { appDb } from "@/db/appDb";
import { appSyncDomains } from "./appSyncDomains";

registerDomains(appSyncDomains);
exposeWorkerHarness((omsInstance) => {
  appDb.setOmsInstanceResolver(() => omsInstance);   // APP domains use appDb.entity(...)
  return appDb.get(omsInstance);
});
```

```ts
// 4. src/db/appDbSync.ts — the main-thread facade. DEEP imports, like the rest of src/db
import { setupAppDbSync } from "@common/db/sync/setupAppDbSync";
import { createSyncService } from "@common/db/sync/syncService";
import { appDb } from "@/db/appDb";
import workerUrl from "../workers/appSync.worker.ts?worker&url";

export const {
  startAppDbSync, stopAppDbSync, refreshAfterMutation,
  resyncDomain, resyncReferenceData, syncService, bootstrapState,
  // Only if the app has class-A domains (§5):
  activateSyncDomains, deactivateSyncDomains, createSyncDomainOwner,
  syncDomainsReady, syncDomainsError, syncNow,
} = setupAppDbSync({ db: appDb, getWorkerUrl: () => new URL(workerUrl, import.meta.url), createSyncService });
```

```ts
// 5. src/main.ts — register the real resolver, keeping commonUtil out of the worker chunk
appDb.setOmsInstanceResolver(() => commonUtil.getOMSInstanceName());
```

```ts
// 6. src/App.vue — start on login. WATCH, don't check once.
watch(useAuth().isAuthenticated, (authed) => { if (authed) void startAppDbSync() }, { immediate: true });
```

```ts
// 7. src/store/user.ts — stop and clear at the start of postLogin, and again on logout
async postLogin() {
  // A session that expired silently never ran postLogout, so its rows and once-per-login
  // markers are still there. Clear them before anything reads, then start fresh.
  await stopAppDbSync().catch((error) => logger.error("Failed to clear the local database on login", error));
  // ... profile, permissions ...
  void startAppDbSync();
},
async postLogout() {
  await stopAppDbSync().catch(() => { /* never block logout on cleanup */ });
},
```

`stopAppDbSync` closes the seed live queries and empties every table, but keeps the
`schemaVersion` record, so the next login doesn't rebuild the database.

The worker registers its own resolver (step 3b) because the APP's hand-written domains reach the
database through `appDb.entity(...)`, which resolves the instance per call. An APP whose domains are
all factory-built can pass `appDb.get(omsInstance)` straight through without it.

---

## 7. Rules that will bite you

**Never import `@common/db` (the barrel) from anything the worker reaches.** It re-exports modules
that import `vue`, and Vite must emit the worker chunk as a single iife. Use deep imports in your db
module, your schema module, and every domain file. The barrel is fine in components, composables, stores and
`main.ts`; `src/db/appDbSync.ts` uses deep imports like the rest of `src/db`.

Deep imports follow the folder layout of `common/db`:

| Folder | What you import from it | Worker-safe |
|---|---|---|
| `@common/db/types` | `DbRow`, `DbKey`, `FieldKind`, `SyncContext`, `SyncDomain` | yes |
| `@common/db/schema/*` | `defineEntity`, `defineSchema` / `mergeSchemas`, `defineAppDb`; `appDbRegistry` is framework-only | yes |
| `@common/db/storage/*` | `projection` (`toMillis`, `canonicalKey`, …); from `dbClient` / `baseDb`, **types only** (`EntityClient`, `BaseDB`) in app code | yes |
| `@common/db/seed/*` | `seedSchema` (`commonSchema`), `seedDomains` (`commonDomains`) | yes |
| `@common/db/sync/*` | `defineSyncDomain`, `defineSnapshotDomain`, `defineCursorDomain`, `syncRegistry`, `pollingWorkerHarness` | yes, except `syncService` and `setupAppDbSync` |
| `@common/db/composables/*` | `useLiveEntity`, `useSeedData`, `useDbStatus` | **no** — main thread only; import them from the barrel |

**App code uses one read pattern and fixed layers, and the build checks it.** Reads go through
`useLiveEntity` / `useSeedData` in composables and `.vue` files, with table names from `appDb.tables`;
there is no raw handle on an app database. Writes belong to the table's sync domain: app code calls
`refreshAfterMutation` for a missing record and `api()` then `refreshAfterMutation` / `resyncDomain`
for a server change. API calls live in composables, Pinia stores and worker domains; utils are pure;
stores and the app db never reach each other (`AGENTS.md`, App layout). The rules live in the root
`eslint.config.js`, built from core rules: layer and data-access imports through
`@typescript-eslint/no-restricted-imports`, the API import through `no-restricted-imports`, calls
through `no-restricted-syntax`. The root file also exports `dbConfig`, these rules with the parsers
they need. The APP's `eslint.config.js` spreads `dbConfig`, and its build runs that lint first
(`"build": "eslint src && vite build"`), so a violation fails `pnpm --filter <app> build`. Editors
show the same errors as you type. Data-access messages end with "See docs/APP_DB_DEVELOPER_GUIDE.md
§7"; layer messages with "See AGENTS.md (App layout)".

An "app db" is any identifier ending in `Db` (`appDb`, `companyDb`, …).

| Rule | Rejects | Where |
|---|---|---|
| `no-restricted-imports` | `import { api, client } from "@common"` or `@common/core/remoteApi`: API calls live in composables, stores and worker domains | everywhere except `src/composables`, `src/store` |
| `@typescript-eslint/no-restricted-imports` | `@/composables/*` (value imports; types are fine): composables are used only by composables and `.vue` files | everywhere except `src/composables` and `.vue` files |
| `@typescript-eslint/no-restricted-imports` | an app db module (`@/db/*` except `@/db/appDbSync`) | `src/store` |
| `@typescript-eslint/no-restricted-imports` | `@/store/*`, `pinia`, `@/db/*`, and `useLiveEntity` / `useSeedData` / `loadSeedData` from `@common` / `@common/db` | `src/utils` (stores and `pinia` also in `src/db` and `src/workers`) |
| `@typescript-eslint/no-restricted-imports` | value imports of `dexie`, `@common/db/storage/dbClient` / `baseDb`, `@common/db/schema/appDbRegistry`, or low-level names (`dbClient`, `getAppDb`, `ensureDbReady`, `hasSyncedThisLogin`, …) from `@common` / `@common/db` | all of `src/` |
| `no-restricted-syntax` | `appDb.raw()`; a string-literal table in `appDb.entity("x")`, `useLiveEntity("x")`, `appDb.client().get("x")` or `appDb.client().liveRead(["x"])`, and the same on a client held in a variable named `…Client` (`companyClient.count("x")`); also behind `as any` | all of `src/` |
| `no-restricted-syntax` | `appDb.entity(...)` and `loadSeedData()`: read with `useLiveEntity` / `useSeedData` | outside `src/db/**` and `src/workers/**` |
| `no-restricted-syntax` | `useLiveEntity(...)`, `useSeedData()`, `useDbStatus(...)`: the caller passes the rows | outside `src/composables` and `.vue` files |
| `no-restricted-syntax` | a `use…Store()` call: take the data as a parameter | `src/utils` |
| `no-restricted-syntax` | `appDb.get(oms)` | outside `src/db/**` and `src/workers/*.worker.ts` |
| `no-restricted-syntax` | `appDb.client()`, except as the `useDbStatus` argument | outside `src/db/**` and `src/workers/**` |
| `no-restricted-syntax` | a write: `upsertMany(...)` / `snapshotReplace(...)` on anything, or `put` / `bulkPut` / `remove` / `bulkRemove` / `clear` called on `appDb.entity(...)`. Use `refreshAfterMutation` for a missing record, or `refreshAfterMutation` / `resyncDomain` after a server write (§4) | outside `src/workers/**` |
| `no-restricted-syntax` | `useSeedData()`: it would hold every seed table open for the session (§1a) | `src/App.vue` |
| `no-restricted-syntax` | `.live(...)` / `.liveRead(...)` at all | `src/workers/**` |
| `no-restricted-syntax` | `activateSyncDomains(...)` in a file with no `deactivateSyncDomains(...)` | all of `src/` (§5) |
| `no-restricted-syntax` | `deactivateSyncDomains()` with no owner | all of `src/` (§5) |
| `no-restricted-syntax` | `activateSyncDomains(...)` in a page with no `onIonViewDidLeave` | `.vue` files (§5) |

The framework's plain helpers that happen to be named `use…` (`useAuth`, `useSolrSearch`, …) come
from `@common`, not `@/composables`, so stores and the router keep using them.

In `.vue` files the API ban is `no-restricted-imports` alone, so an APP still moving its page-level
API calls can switch it off for just those pages in its own `eslint.config.js` (list the files, with
a TODO) until they are moved.

Type-only imports are fine. There is no autofix: write `appDb.tables.x` by hand.

Flat config replaces a rule's options per file instead of merging them. So the root config composes
the lists per folder: each data-access block restates the folder's other selectors (no `api()` in
`.vue`, `use*` composable and store names) and its import bans (`IMPORT_*`). Add a new data-access
selector to the `DA_*` lists, or a layer ban to the `IMPORT_*` lists, at the top of
`eslint.config.js`, and check it by linting a sample file from an app folder (`eslint --stdin
--stdin-filename src/views/X.vue`). Lint rules have no committed spec.

The APP's config:

```js
// apps/<app>/eslint.config.js
import { dbConfig } from "../../eslint.config.js"

export default [...dbConfig]
```

Data that must outlive logout (a product catalog, the same for every user of the instance) is an
app db table declared `retainOnLogout: true` (§2), not an app-local Dexie store. Only a store that
genuinely can't live in the app db gets an exemption, by file, after `...dbConfig`:

```js
  {
    files: ["src/db/<thing>Db.ts"],   // the APP's own Dexie store
    rules: { "@typescript-eslint/no-restricted-imports": "off", "no-restricted-syntax": "off" }
  }
```

AI agents get the same guidance from the `accxui-app-db-access` skill (`.agents/skills/accxui-app-db-access/SKILL.md`), and the layer rules from `accxui-app-layers`.

**`fields` is the whitelist.** Undeclared fields are dropped. Stored rows carry the declared fields
plus `syncedAt` — nothing else. There is no `raw` copy of the server payload to fall back on.

**`refetchOne(ctx, pk, args)` takes the context first**, like `sync`. The harness holds one context
and can't tell a factory domain from a hand-written one. Get the order wrong and the failure is
silent: the domain reads its key fields off the context (all `undefined`) and fires the request with
the primary key where the token belongs — after your mutation already succeeded.

**A snapshot domain prunes.** It treats the fetched set as authoritative and deletes everything in
scope that isn't in it. The factory guards the obvious footguns (a fetch that returns rows none of
which can be keyed; an empty fetch over a populated table on an auto sync), but if you hand-write a
snapshot pass, pass `requireComplete: true` to `pageAll` (`@common/core/workerRemoteApi`) so a
truncated walk throws instead of pruning live rows. The factory itself does not set it.

**Inside `common/db`, a `liveQuery` needs an `async` querier that awaits inside it.** Dexie tracks which
tables a querier read only across the awaits of an `async` function; a plain arrow that returns a
promise loses the tracking at its first await, so the query never re-runs when the table changes.
`dbClient.live` / `liveRead` already do this; app code never writes a `liveQuery` itself.

**Bump `version` when you touch the schema.** Nothing checks it. §2.

---

## 8. Troubleshooting

| Symptom | Likely cause | Check |
|---|---|---|
| Row is there, one field is `undefined` | Field not in `fields`, or the API names it differently | Declare it, or add a `rename` |
| Scoped query returns nothing, unscoped works | The field is not in `fields`, is absent because a `rename` was needed, or holds a different type (matching is strict `===`, so `123` ≠ `"123"`) | Entity `fields` and `rename`; the stored value's type |
| Scoped or dated query is slow on a big table | No index covers it, so the whole table is read and filtered in memory | Add the field, or a compound `[scope+dateField]`, to `indexes` (and bump `version`) |
| "Latest N" shows the oldest rows | No `dateField`, so `limit` cuts storage order | Pass `dateField`; it orders newest first |
| Seed list empty on a fresh login, screen shows "none" | Read before the seed sync landed: a reactive getter or `get*` answers `[]` until then | Use the getter's `.withSync()` and wait for `synced` (§1a) |
| `refreshAfterMutation` resolves but the row is stale | The domain has no `byPk`, `refetchScope` or `fanOut`, so the refetch does nothing | §4; use `resyncDomain(name)` |
| Table stays empty, no error | Domain not registered, or the table name differs between domain and schema | Worker entry; `checkDomainWiring` in `tests/db/appDbWiring.spec.ts` names the table |
| Table empty and the status card says "none" | Class-B domain never ran — check `syncMeta` for its `loginSync:` marker | Force via `resyncDomain(name)` |
| Snapshot wiped rows that still exist server-side | Envelope mis-declared, so the response unwrapped to `[]` | `collectionKey`; add `strictCollection: true` |
| Rows stop updating after switching OMS instance | A captured Dexie handle instead of the late-binding client | Use `useLiveEntity` in app code and `appDb.entity()` / `appDb.client()` in domains, never a stored `BaseDB` handle |
| Empty state flashes on every load | Rendering off `records.length` instead of `hydrated` | §1b |
| Old field shape persists after a deploy | `version` not bumped | §2 |
| Class-A domain polls but writes nothing | Server ignores the cursor param, or `keep` trims everything | Probe the endpoint; log the page size |
| `liveQuery` errors with `DatabaseClosedError` | Something held a handle across an instance switch | As above |
| Screen stops polling after navigating to it from another polling screen | The old view's `didLeave` cleared the new view's domains: an owner shared between instances, or a `deactivateSyncDomains()` call with no owner | One `createSyncDomainOwner` per instance, passed to every call (§5) |
| Domains keep polling after leaving the view | No `deactivateSyncDomains(owner)` in `onIonViewDidLeave`, or a different owner passed than the one activated | §5 |
| A banner shows another screen's sync failure | Reading `bootstrapState.errors` / `serviceState.errors` directly | Use `syncDomainsError`, which is scoped to the active set |

Useful while debugging: `bootstrapState.errors` holds the last failure per domain,
`bootstrapState.running` says whether a sync is in flight, `serviceState.syncedAt` records when each
domain last finished, and `resyncReferenceData()` clears every sync marker and re-runs the lot.

---

## 9. APP folder structure

Every file in an APP that belongs to the local database and its sync. Create exactly these; the
names are what the lint rules, the worker bundling and the other docs expect.

```text
apps/<app>/
├── src/
│   ├── db/                              ← schema, database, sync facade. DEEP imports only
│   │   ├── appSchema.ts                 the APP's own entities (defineEntity / defineSchema)
│   │   ├── appDb.ts                     defineAppDb(...): picked seed tables + appSchema
│   │   └── appDbSync.ts                 main-thread facade: setupAppDbSync(...) re-exports
│   ├── workers/                         ← runs in the sync worker. Worker-safe: DEEP imports only
│   │   ├── appSync.worker.ts            worker entry: registerDomains + exposeWorkerHarness
│   │   ├── appSyncDomains.ts            the list of every domain the APP registers
│   │   └── domains/
│   │       ├── <thing>Domain.ts         one APP sync domain per file (class A or B)
│   │       └── referenceDomains.ts      APP class-B domains + seed-domain overrides
│   ├── config/
│   │   └── appSyncConfig.ts             optional: polling scopes, windows, intervals
│   ├── main.ts                          registers the real OMS resolver
│   ├── App.vue                          starts the sync when isAuthenticated turns true
│   ├── store/user.ts                    postLogin / postLogout → stopAppDbSync / startAppDbSync
│   └── views/Settings.vue               the status card (useDbStatus)
├── eslint.config.js                     ...dbConfig from the root; the build lints first
└── tests/db/
    ├── appDbWiring.spec.ts              checkDomainWiring + checkSyncLifecycle (§3)
    └── appSchema.spec.ts                optional: entity keys, indexes, projections
```

```mermaid
flowchart LR
    SCH["db/appSchema.ts"] --> DB["db/appDb.ts"]
    DB --> DOMS["workers/domains/*.ts"]
    DOMS --> LIST["workers/appSyncDomains.ts"]
    DB --> LIST
    LIST --> W["workers/appSync.worker.ts"]
    W -. "?worker&url" .-> SVC["db/appDbSync.ts"]
    DB --> SVC
    SVC --> BOOT["main.ts · App.vue · store/user.ts"]
    SVC --> PAGES["pages · composables · stores"]
    DB --> PAGES
    LIST -. "lazy import for the catalog" .-> SET["views/Settings.vue"]
    SVC --> SET
```

### `src/db/appSchema.ts`

| Contains | Rules |
|---|---|
| `export const appSchema = defineSchema({ table: defineEntity({...}), ... })`: one entry per APP-owned table, keyed by IndexedDB store name | Deep imports only (`@common/db/schema/defineEntity`, `.../defineSchema`), because the worker reaches this file. Every field a screen reads is in `fields`; an index for every way the table is queried. No `syncMeta`. Omit the file if the APP owns no tables |

### `src/db/appDb.ts`

| Contains | Rules |
|---|---|
| `APP_SEED_TABLES` (the seed tables the APP reads); `export const appDb = defineAppDb({ suffix, version, schema: mergeSchemas(commonSchema.pick([...APP_SEED_TABLES]), appSchema) })`; `appDb.setOmsInstanceResolver(() => "default")` as a test fallback | Deep imports only. Never import `commonUtil` (the real resolver goes in `main.ts`). Bump `version` with every schema change, with a one-line comment saying what changed. Nothing else in `src/` creates a database |

### `src/workers/domains/<thing>Domain.ts`

| Contains | Rules |
|---|---|
| One exported domain: `defineSnapshotDomain` (class B), `defineCursorDomain` or `defineSyncDomain` (class A). Hand-written domains hold their tables in module scope: `const widgets = appDb.entity(appDb.tables.widgets)` | Deep imports only; HTTP through `@common/core/workerRemoteApi` (`pageAll`, `pageNewestFirst`, `workerGet`), never `api()`. `refetchOne(ctx, pk, args)` takes the context first. Name the file after the domain |

`referenceDomains.ts` collects the APP's class-B domains and any seed domain it re-declares under
the seed domain's name (the "same table, your own domain" case in §2).

### `src/workers/appSyncDomains.ts`

| Contains | Rules |
|---|---|
| `OVERRIDDEN_SEED_TABLES`; `appSeedDomains` = `commonDomains` filtered to `appDb.seedTables` minus the overrides; `export const appSyncDomains: SyncDomain[] = [...appSeedDomains, ...appOwnDomains]` | Worker-safe imports only. It is the single list: the worker registers it and the status card builds its catalog from it, so the two never disagree |

### `src/workers/appSync.worker.ts`

| Contains | Rules |
|---|---|
| `registerDomains(appSyncDomains)`; `exposeWorkerHarness((oms) => { appDb.setOmsInstanceResolver(() => oms); return appDb.get(oms); })` | Nothing else. Deep imports only, never the `@common/db` barrel (it pulls in `vue`). The only file besides `src/db/**` allowed to call `appDb.get(...)` |

### `src/db/appDbSync.ts`

| Contains | Rules |
|---|---|
| `setupAppDbSync({ db: appDb, getWorkerUrl: () => new URL(workerUrl, import.meta.url), createSyncService })` with `import workerUrl from "../workers/appSync.worker.ts?worker&url"` (relative: the apps' alias-import check rejects a `?worker&url` suffix on an `@/` path), and re-exports: `startAppDbSync`, `stopAppDbSync`, `refreshAfterMutation`, `resyncDomain`, `resyncReferenceData`, `syncService`, `bootstrapState`; for page-level sync also `activateSyncDomains`, `deactivateSyncDomains`, `createSyncDomainOwner`, `syncDomainsReady`, `syncDomainsError`, `syncNow` | Main thread only, but deep imports like the rest of `src/db`. Call `setupAppDbSync` exactly once (this module): it registers itself, and framework composables (`useProductMaster`) reach it through `getAppDbSync()`. Every other file imports sync functions from here, never from `@common/db/sync/*` |

### `src/config/appSyncConfig.ts` (optional)

The APP's polling policy in one place: which scopes and per-type windows a class-A domain uses, and
default `intervalMs` values. Imported by domains and by pages that build their activation lists.

### Boot and auth files

| File | Adds |
|---|---|
| `src/main.ts` | `appDb.setOmsInstanceResolver(() => commonUtil.getOMSInstanceName())` |
| `src/App.vue` | `watch(useAuth().isAuthenticated, (on) => { if (on) void startAppDbSync() }, { immediate: true })` |
| `src/store/user.ts` | `postLogin`: `await stopAppDbSync()` first, then `void startAppDbSync()` after profile and permissions. `postLogout`: `await stopAppDbSync()` |
| `src/views/Settings.vue` | `useDbStatus(appDb.client(), async () => catalogFrom((await import("@/workers/appSyncDomains")).appSyncDomains), { resyncDomain, resyncAll: resyncReferenceData })` |

### Everywhere else

Pages, composables and stores never add files to this structure. Pages and composables read with
`useLiveEntity(appDb.tables.x, ...)` and `useSeedData()`; stores hold server data and take any rows
they need from their caller (§1e). Both use `refreshAfterMutation` and the page-activation functions
from `db/appDbSync.ts`. The APP's build lints it first (§7).
