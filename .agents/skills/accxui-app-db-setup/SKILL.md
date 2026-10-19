---
name: accxui-app-db-setup
description: Use when an AccxUI app under apps/* needs local IndexedDB storage it does not have yet, or a new table, sync domain or seed table in its app database. Also when changing Company's or Order Manager's src/db or src/workers (companyDb, companySchema, orderManagerDb, referenceDomains, appSyncDomains). Triggers include a new app that should "store / cache / sync data locally", "work like Company / Order Manager", defineAppDb, defineEntity, defineSchema, mergeSchemas, commonSchema.pick, extendEntities / extendIndexes, extending or overriding a framework (seed) entity or its endpoint, OVERRIDDEN_SEED_TABLES, defineSnapshotDomain (byPk, refetchScope, fanOut), defineSyncDomain, defineCursorDomain, pageNewestFirst, refetchOne, refreshAfterMutation, a class C / on-request table, registerDomains, exposeWorkerHarness, setupAppDbSync, appSync.worker.ts, startAppDbSync / stopAppDbSync, checkDomainWiring, a schema version bump, or a table that stays empty.
---

# Setting up the AccxUI app database

Every app gets **one IndexedDB database per OMS instance**, filled by a **background sync worker**.
This skill builds it: tables, the database, sync domains, the worker and the login wiring. Reading
and writing the data afterwards is the **accxui-app-db-access** skill.

`appDb` / `appSchema` stand for the app's names (`companyDb`, `companySchema`). Working references:
`apps/company` (own and seed tables, class A, B and C domains) and `apps/order-manager` (every seed
table, including the `products` master, and no own tables). Full reference: `docs/APP_DB_DEVELOPER_GUIDE.md`.

**Changing Company's or Order Manager's database? Read [existing-apps.md](existing-apps.md) first.**
It maps every file in their `src/db` and `src/workers`, and says which existing file a new table,
domain or seed pick goes in (for example: a Company class B table from one list endpoint is an entry in
`src/workers/domains/referenceDomains.ts`, not a new file). The recipes below are for a new app.

## Rules

1. **Worker code uses deep imports only.** `src/db/**` and `src/workers/**` run in the sync worker:
   import `@common/db/schema/*`, `@common/db/seed/*`, `@common/db/sync/*`, `@common/db/types`,
   `@common/core/workerRemoteApi`. Never `@common`, `@common/db`, `commonUtil`, `api()`, stores or
   composables. *Why:* the barrel pulls in Vue and the worker chunk breaks or bloats.
2. **Only sync domains write the app db.** A screen missing a record calls `refreshAfterMutation`; a
   server write reconciles with `refreshAfterMutation` / `resyncDomain`. If no domain fits, add one (class C
   if it is fetched only on request). *Why:* one writer keeps one row shape.
3. **Every table is filled by a registered domain**, and every domain is in `appSyncDomains`.
   *Why:* `define*Domain` does not register anything; a missing domain fails silently and the table
   stays empty. `checkDomainWiring` catches it.
4. **`fields` is a whitelist.** Whatever a screen reads must be declared (or renamed into place).
5. **Every schema change bumps `version`.** *Why:* the database is rebuilt only on a version change;
   nothing detects a forgotten bump, and old-shaped rows stay.
6. **Domain HTTP goes through `@common/core/workerRemoteApi`** (`pageAll`, `pageNewestFirst`,
   `workerGet`, `workerPost`). Never `api()` or `fetch` in a domain. **Before writing a fetch in a
   hand-written domain, read [worker-remote-api.md](worker-remote-api.md)**: every option, how
   arrays, empty bodies and errors behave, and when a snapshot needs `requireComplete`.
7. **Wire the lifecycle exactly:** `App.vue` starts the sync when `isAuthenticated` turns true;
   `postLogin` stops it, then starts it; `postLogout` stops it (which clears the tables).
   `checkSyncLifecycle` catches a mistake.
8. **Class B is never activated from a page; class A always is,** and the page deactivates it with
   the same owner in `onIonViewDidLeave` (**accxui-page-sync**).
9. **Seed tables are picked, then extended or overridden, never copied.** Statuses, facilities,
   enums and the other reference tables come from `commonSchema`; the four ways to change one are in
   "Framework (seed) entities" below. Labels come from `useSeedData()` in the pages and composables
   that show them (never `App.vue`, which lint rejects). A store or util takes seed rows as arguments.

## Which sync class

| Data | Class | Build it with | Company reference |
|---|---|---|---|
| Reference / config from one list endpoint | **B**: once per login, then after writes | `defineSnapshotDomain` | `workers/domains/referenceDomains.ts` |
| Reference data needing several calls or assembly | **B** | `defineSyncDomain` with `sync` + `refetchOne` | `workers/domains/organizationDomain.ts` |
| Live, append-mostly; polled only while a screen is open | **A** | `defineSyncDomain` with a cursor read, or `defineCursorDomain` | `dataManagerLogDomain.ts`, `systemMessageDomain.ts` |
| One record at a time, when a screen asks; never polled | **C** | `defineSyncDomain`: `sync` returns `0`, `refetchOne` fetches | `systemMessageErrorDomain.ts`, `shopifyBulkOperationDomain.ts` |

The class says **when** a domain runs, the builder **how** it fetches:

- **When:** class B domains are the base set `startAppDbSync` runs at login; one without `intervalMs`
  stays due until a pass completes (`syncedThisLogin`, or forced). Class A runs only while a page
  activates it, and `intervalMs` (activation's, else domain's) is what repeats a pass.
  `refreshAfterMutation` calls `refetchOne` in any class.
- **`syncClass` doesn't gate polling:** any activated domain with an interval is polled. An activated
  domain with **no** interval that never marks `syncedThisLogin` (a cursor or hand-written domain)
  retries every 30 s (`RETRY_WITHOUT_INTERVAL_MS`): give every class A domain an explicit
  `intervalMs`.
- **Class C** is never activated or in the base set, and its `sync` returns `0`, so ticks,
  `resyncDomain` and the Settings Refresh fetch nothing. Rows come only from `refreshAfterMutation`
  → `refetchOne`, and a stored row is **not refreshed on its own**: it stays until that pk is asked
  for again or logout clears the table (`retainOnLogout` tables survive). A `refetchOne` that must
  stay fresh checks its own age (`dataManagerErrorRecordDomain.ts`: two hours).
- **Builder × class:** `defineSyncDomain` works as A, B or C. `defineSnapshotDomain` works only as
  **B**: its type accepts `"A" | "C"`, but it has no `intervalMs` and skips after its first pass
  each login, so it would never poll. `defineCursorDomain` is always A, and no app uses it yet.
- **Class A fetch patterns** (pick by what the endpoint does; all hand-written in Company):

| Pattern | One pass | Use when | Example |
|---|---|---|---|
| Cursor | rows newer than the newest stored stamp, upsert | a stamp the endpoint filters on (`_from`) or sorts by; rows don't change once written | `productUpdateHistoryDomain.ts` |
| Cursor + re-check | cursor, then a bounded re-fetch of unfinished rows | events whose status settles later | `systemMessageDomain.ts`, `dataManagerLogDomain.ts`, `serviceJobRunDomain.ts` |
| Window re-read | the newest page(s), upsert | no usable cursor (stamp doesn't move on change, or filters ignored) | `syncRunDomain.ts` |
| Snapshot window | the current set, `snapshotReplace` | a small list whose dropped rows must disappear | `shopifyPendingFulfillmentDomain.ts` |
| Status row | one computed record per scope, overwrite | a health / summary value | `shopifyFulfillmentHealthDomain.ts` |

Only a snapshot (or an explicit delete) removes rows; cursor, re-check and status passes never do. A
cursor on a creation stamp (`createdDate`, `initDate`) misses edits; use `lastUpdatedStamp` or add a
re-check pass.

## Files, in build order

| # | File | Contains |
|---|---|---|
| 1 | `src/db/appSchema.ts` | `defineSchema({ table: defineEntity({...}) })` for the app's own tables (omit if none) |
| 2 | `src/db/appDb.ts` | `defineAppDb({ suffix, version, schema: mergeSchemas(commonSchema.pick([...SEED]), appSchema) })` |
| 3 | `src/workers/domains/<thing>Domain.ts` | one sync domain per file |
| 4 | `src/workers/appSyncDomains.ts` | the single list: seed domains for the picked tables + own domains |
| 5 | `src/workers/appSync.worker.ts` | `registerDomains(appSyncDomains)` + `exposeWorkerHarness(...)`, nothing else |
| 6 | `src/db/appDbSync.ts` | `setupAppDbSync({...})` once; re-export its functions |
| 7 | `src/main.ts` | `appDb.setOmsInstanceResolver(() => commonUtil.getOMSInstanceName())` |
| 8 | `src/App.vue` + `src/store/user.ts` | the lifecycle wiring (below) |
| 9 | `eslint.config.js` + `package.json` | `import { dbConfig } from "../../eslint.config.js"; export default [...dbConfig]`; scripts `"build": "eslint src && pnpm check:wiring && vite build"` and `"check:wiring": "vitest run tests/db/appDbWiring.spec.ts"` (a lint error or a wiring failure stops the build) |
| 10 | `tests/db/appDbWiring.spec.ts` | `checkDomainWiring` + `checkSyncLifecycle` (below) |
| opt | `src/views/Settings.vue` | status card: `useDbStatus(appDb.client(), async () => catalogFrom((await import("@/workers/appSyncDomains")).appSyncDomains), { resyncDomain, resyncAll: resyncReferenceData })`; class C rows read "fetched when opened" with no Refresh (copy Company's; fields and options in **accxui-seed-data**) |

## Recipes

### Tables and the database

```ts
// src/db/appSchema.ts
import { defineEntity } from "@common/db/schema/defineEntity";
import { defineSchema } from "@common/db/schema/defineSchema";

export const appSchema = defineSchema({
  cycleCounts: defineEntity({
    primaryKey: "cycleCountId",                       // "a,b" for a compound key
    fields: { cycleCountId: "text", countName: "text", statusId: "text", facilityId: "text", createdDate: "date" },
    indexes: ["statusId", "facilityId", "[facilityId+createdDate]"],   // one per way you query
    // rename: { countName: "name" },                 // stored field ← field the API sends
  }),
  cycleCountItems: defineEntity({
    primaryKey: "cycleCountId,itemSeqId",
    fields: { cycleCountId: "text", itemSeqId: "text", productId: "text", quantity: "count", lastUpdatedStamp: "date" },
    indexes: ["[cycleCountId+lastUpdatedStamp]"],     // scope + cursor, for the class A domain below
  }),
});
```

```ts
// src/db/appDb.ts
import { defineAppDb } from "@common/db/schema/defineAppDb";
import { mergeSchemas } from "@common/db/schema/defineSchema";
import { commonSchema } from "@common/db/seed/seedSchema";
import { appSchema } from "./appSchema";

const APP_SEED_TABLES = ["statuses", "facilities"] as const;   // only the seed tables you read

export const appDb = defineAppDb({
  suffix: "InventoryAuditDB",                         // database becomes `{oms}-InventoryAuditDB`
  version: 1,                                         // bump on EVERY schema change, with a comment
  schema: mergeSchemas(commonSchema.pick([...APP_SEED_TABLES]), appSchema),
});
appDb.setOmsInstanceResolver(() => "default");        // test fallback; main.ts sets the real one
```

- Kinds: `text`, `count`, `date` (stored as epoch millis), `structured` (as-is). Nested objects
  `{ … }` and lists `[{ … }]` / `["text"]` are declared in place and coerced like the top level.
  Index a nested field by its dotted path (`"carrier.partyId"`), a field inside a list with `*`
  (`"*items.productId"`), and query the dotted path (`equals: { "items.productId": pid }`).
- Logout empties every table. `retainOnLogout: true` on `defineEntity` keeps one (default `false`):
  only for data that is the same for every user of the instance, such as a product catalog, never for
  anything user-scoped. A `version` bump still drops it, and nothing refreshes it by itself: the
  reader decides when a row is stale (its `syncedAt`) and asks with `refreshAfterMutation`
  (the framework's `products` seed table).
- `defineSchema`, `pick`, `extendEntities` and `mergeSchemas` each return a new schema and never
  mutate their input. `mergeSchemas` throws when two schemas claim the same table: take a table from
  exactly one of them.

### Framework (seed) entities: pick, extend, override

Seed tables are declared in `common/db/seed/seedSchema.ts` and filled by the class B domains in
`common/db/seed/seedDomains.ts`. Check the seed domain's `listUrl` / `collectionKey` against your API
before relying on one.

| Seed table | Seed domain name | Refetch after a write |
|---|---|---|
| `productStores` | `productStore` | `byPk` (`productStoreId`) |
| `facilities` | `facility` | `byPk` (`facilityId`) |
| `enums` | `enum` | `refetchScope` (`enumId`) |
| `groupFacilities` | `groupFacility` | `refetchScope` |
| `productStoreFacilities`, `productStoreFacilityGroups`, `productStoreShipmentMethods` | `productStoreFacility`, `productStoreFacilityGroup`, `productStoreShipmentMethod` | `fanOut` (re-reads every row for the `productStoreId`) |
| `products` | `product` (class C, fetched when shown; kept across logout) | `refetchOne` by `{ productIds }`: fetches the missing or stale ones (**accxui-product-search**) |
| `statuses`, `enumTypes`, `facilityTypes`, `facilityGroups`, `geos`, `geoAssocs`, `carriers`, `carrierShipmentMethods`, `shipmentMethodTypes`, `paymentMethodTypes`, `returnReasons`, `returnTypes`, `returnItemTypes`, `roleTypes`, `orderAdjustmentTypes`, `contactMechPurposeTypes`, `communicationEventTypes`, `partyRelationshipTypes`, `statusFlowTransitions`, `productStoreEmailSettings`, `shopifyShops`, `shopifyShopLocations` | the table name in the singular: `status`, `enumType`, `facilityType`, `geo`, `carrier`, `shopifyShop`, … | **none**: `refreshAfterMutation` resolves `0`; use `resyncDomain(name)` |

Pick the smallest change that does the job:

| You need | Do | Version bump |
|---|---|---|
| The seed row as it is | `commonSchema.pick([...])` | yes, when the picked set changes |
| More fields, renames or indexes on the seed row | `pick(...).extendEntities({...})` (below) | yes |
| The same table filled from another endpoint, or with other domain options | your own domain under the seed domain's **name** + `OVERRIDDEN_SEED_TABLES` (below) | only if the entity changed too |
| A different primary key, `keyDefaults` or field kind | don't pick it; declare your own table under the seed name in `appSchema`, with your own domain | yes |

**Extend** (additive only; it throws at load on a field the entity already declares at any depth,
a rename of an undeclared or already-renamed field, an unknown table, or an index on an undeclared
field or the pk):

```ts
// src/db/appDb.ts
export const appDb = defineAppDb({
  suffix: "InventoryAuditDB",
  version: 2,                                             // v2: facilities gained externalId, openedDate
  schema: mergeSchemas(
    commonSchema.pick([...APP_SEED_TABLES]).extendEntities({
      facilities: {
        fields: { externalId: "text", openedDate: "date" },  // added to the whitelist
        rename: { openedDate: "openingDate" },               // stored name ← API field name
        indexes: ["externalId"],                             // may use the added fields
      },
    }),
    appSchema,
  ),
});
```

- An app with no own tables passes the extended pick alone: `schema: commonSchema.pick([...]).extendEntities({...})`.
- `rename` may name a field added in the same call (as above), but not one the entity already renames.
- A nested object merges: `fields: { carrier: { email: "text" } }` adds `email` to an existing
  `carrier`. `extendIndexes({ facilities: ["ownerPartyId"] })` is the indexes-only form.
- **The seed domain needs no change.** Domains store rows through the app's composed entity, so the
  added fields are written on the next sync, provided the domain's endpoint returns them. If it
  doesn't, override the domain (next).
- The table stays a seed table: same domain, same status-card entry, `useSeedData()` still reads it.

**Override the domain** (same table, your endpoint or options):

```ts
// src/workers/domains/referenceDomains.ts
export const statusDomain = defineSnapshotDomain({
  name: "status",                 // the SEED domain's name, so refreshAfterMutation / resyncDomain / the status card agree
  label: "Statuses",
  syncClass: "B",
  table: "statuses",
  listUrl: "oms/statuses",        // instead of the seed's admin/status
  collectionKey: null,
});

// src/workers/appSyncDomains.ts
const OVERRIDDEN_SEED_TABLES = new Set<string>(["statuses"]);   // drops the seed `status` domain
export const appSyncDomains: SyncDomain[] = [...appSeedDomains, statusDomain, /* own domains */];
```

Leave the seed domain in as well and both register under one name: the last one in the list wins
and the other is dead code. Company overrides `carriers`, `carrierShipmentMethods`, `shopifyShops`,
`facilityGroups` and `statuses` this way (`apps/company/src/workers/domains/referenceDomains.ts`).

**Replace the entity** (different pk or field kind): leave the table out of `pick`, declare it in
`appSchema` under the same name, and register your own domain for it. Provenance is tracked, so it
is not a seed table: the `appSeedDomains` filter drops the seed domain for it by itself (no
`OVERRIDDEN_SEED_TABLES` entry needed) and the status catalog leaves it out. Keep the seed domain's
name for yours (`facility`) so existing `refreshAfterMutation` / `resyncDomain` calls still work.
`useSeedData()` reads tables by name, so its getters still work if the row keeps the fields they
read. `extendEntities` can't do this: the pk, `keyDefaults` and existing fields never change.

```ts
// src/db/appDb.ts — "facilities" is no longer picked from the framework
const APP_SEED_TABLES = ["statuses", "enums"] as const;
export const appDb = defineAppDb({
  suffix: "InventoryAuditDB",
  version: 3,                              // v3: facilities is the app's own, keyed (facilityId, ownerPartyId)
  schema: mergeSchemas(commonSchema.pick([...APP_SEED_TABLES]), appSchema),
});

// src/db/appSchema.ts — the app's own table under the seed name
export const appSchema = defineSchema({
  facilities: defineEntity({
    primaryKey: "facilityId,ownerPartyId",
    // keep facilityId / facilityName / facilityTypeId: useSeedData's facility getters read them
    fields: { facilityId: "text", ownerPartyId: "text", facilityName: "text", facilityTypeId: "text", externalId: "text" },
    indexes: ["facilityTypeId", "externalId"],
  }),
  // …the app's other tables
});

// src/workers/domains/facilityDomain.ts — your domain, under the seed domain's name
export const facilityDomain = defineSnapshotDomain({
  name: "facility",
  label: "Facilities",
  syncClass: "B",
  table: "facilities",
  listUrl: "oms/facilities",
  collectionKey: null,
  refetchScope: (pk) => ({                 // a write knows facilityId; re-list it and replace every owner's row
    params: { facilityId: pk.facilityId },
    scope: { field: "facilityId", value: pk.facilityId },
  }),
});

// src/workers/appSyncDomains.ts — no OVERRIDDEN_SEED_TABLES entry: the seed `facility` domain is
// already filtered out, because `facilities` is not in appDb.seedTables any more
export const appSyncDomains: SyncDomain[] = [...appSeedDomains, facilityDomain, /* own domains */];
```

With a compound key, `seed.facility(id)` from `useSeedData()` gives one row for that `facilityId`;
read every owner's row with `useLiveEntity(appDb.tables.facilities, () => ({ equals: { facilityId } }))`.

### Class B, one endpoint

```ts
// src/workers/domains/cycleCountDomain.ts
import { defineSnapshotDomain } from "@common/db/sync/defineSnapshotDomain";

export const cycleCountDomain = defineSnapshotDomain({
  name: "cycleCount",                 // what refreshAfterMutation / resyncDomain name
  label: "Cycle counts",              // shown on the Settings status card
  syncClass: "B",
  table: "cycleCounts",
  listUrl: "oms/cycleCounts",
  collectionKey: null,                // null = a bare array (or the first array in the answer); "cycleCountList" = resp.cycleCountList
  byPk: (pk) => ({ url: `oms/cycleCounts/${encodeURIComponent(String(pk.cycleCountId))}` }),
});
```

It fetches the whole set and **prunes** rows it didn't get back, so get `collectionKey` right
(`null` also accepts the first array of an envelope; set `strictCollection: true` when the shape is
known, so an unexpected answer throws instead of unwrapping to `[]`). It
runs once per login (skipped while `syncedThisLogin`), refuses to wipe a filled table on an empty
answer during an automatic sync, and stores rows through the app's composed entity. That holds for
every factory and for `appDb.entity(...)` in a hand-written domain: `projection` defaults to
`appDb.entities[table]`, so pass it only to store through a different entity.

**Give it a refetch path**, or `refreshAfterMutation` resolves `0` and leaves the row stale:

| The API has | Option | What `refreshAfterMutation(name, pk)` does |
|---|---|---|
| `GET /thing/{id}` | `byPk: (pk) => ({ url, params? })` | GETs it and upserts it; an empty answer **removes** the stored row. A failed GET rejects |
| … wrapping the record (`{ jobDetail: {…} }`) | `byPk` + `byPkRecordKey: "jobDetail"` | the same, reading the record from that key |
| No by-id route, but the list filters by id (probe that it does: an ignored filter returns everything) | `refetchScope: (pk) => ({ params: { thingId: pk.thingId }, scope: { field: "thingId", value: pk.thingId } })` | re-lists with those params and **replaces that scope**: rows the server no longer returns are pruned |
| Rows listed per parent (`/parents/{id}/children`) | `fanOut: { parentTable, parentKeyField, urlFor: (id) => url, collectionKey? }` | re-lists that parent's children (from `pk[parentKeyField]`) and replaces its slice |
| None of these | — | resolves `0`; call `resyncDomain(name)` after writes |

This is how the seed `productStoreShipmentMethod` domain is built; picking that seed table needs no
domain of your own. Use the pattern for your own per-parent tables. The entity's pk is the full
compound key (`"productStoreId,shipmentMethodTypeId"`); the refetch `pk` only needs the parent key.

```ts
// Rows (productStoreId, shipmentMethodTypeId), listed per store. sync reads every productStoreId in
// the parent table, fetches each store's list and stamps productStoreId onto its rows.
export const storeShipmentMethodDomain = defineSnapshotDomain({
  name: "productStoreShipmentMethod",
  label: "Store shipment methods",
  syncClass: "B",
  table: "productStoreShipmentMethods",
  listUrl: "oms/productStores",            // required by the type; fanOut supplies the real urls
  collectionKey: null,
  fanOut: {
    parentTable: "productStores",          // must be in the db and filled first
    parentKeyField: "productStoreId",
    urlFor: (storeId) => `oms/productStores/${encodeURIComponent(storeId)}/shipmentMethods`,
  },
});
```

Other options: `listParams` (sent on every list call), `strictCollection` (throw when an
answer is not shaped as `collectionKey` says, rather than store a truncated set), `batchSize` (default 250),
`unpaged` (one call, no paging), `scopeOnSync` (snapshot-replace only that slice).

### Class A, polled with a cursor

`defineCursorDomain` covers the plain case when the endpoint honours its cursor param:

```ts
// src/workers/domains/returnDomain.ts
import { defineCursorDomain } from "@common/db/sync/defineCursorDomain";

export const returnDomain = defineCursorDomain({   // syncClass is always "A"
  name: "return",
  label: "Returns",
  table: "returns",
  intervalMs: 10_000,                       // default cadence; an activation's intervalMs overrides it
  listUrl: "oms/returns",
  collectionKey: null,
  cursorField: "lastUpdatedStamp",          // stored date field that advances
  cursorParam: "lastUpdatedStamp_from",     // server lower bound, sent as ISO
  total: 200,                               // rows held per scope (default 100), filled before reads go incremental
  batchSize: 25,                            // default 25
  scopeOf: (args) => (args?.facilityId ? { field: "facilityId", value: args.facilityId } : undefined),
  paramsOf: (args) => (args?.facilityId ? { facilityId: args.facilityId } : {}),
});
// schema: index "[facilityId+lastUpdatedStamp]" so the per-scope count and cursor hit an index.
```

Its `refetchOne` re-lists by the **first** primary-key field (`{ [pk0]: id }`, one row) and upserts;
it never removes a row. It sends **none** of `paramsOf(args)`, so it is right only if the endpoint
filters by that field (probe it); otherwise reconcile writes with `syncNow()` (**accxui-page-sync**).
Its `sync` runs unscoped when called with no args (the Settings Refresh does that when no screen holds
the domain): wrap it to return `0` without the scope arg:

```ts
const cursor = defineCursorDomain({ /* …as above… */ });
export const returnDomain: SyncDomain = { ...cursor, sync: (ctx, args: any) => (args?.facilityId ? cursor.sync(ctx, args) : Promise.resolve(0)) };
``` `narrowOf(args)` adds a filter that applies both server-side and to the local
count and cursor; `orderByField` defaults to `-cursorField`.

Hand-write it when the endpoint is not a plain feed: client-side scoping, a re-check of in-flight
rows, enrichment from other tables, a window re-read, or an endpoint that may 404. Every Company
class A domain is hand-written (the patterns are under "Which sync class"):

```ts
// src/workers/domains/cycleCountItemDomain.ts
import { appDb } from "@/db/appDb";
import { defineSyncDomain } from "@common/db/sync/defineSyncDomain";
import { keepNewerThan } from "@common/db/storage/projection";
import type { SyncContext } from "@common/db/types";
import { pageNewestFirst, workerGet } from "@common/core/workerRemoteApi";

const ENDPOINT = "oms/cycleCountItems";
const items = appDb.entity(appDb.tables.cycleCountItems);       // module scope, late-binding

interface CycleCountItemArgs { cycleCountId?: string; total?: number; batchSize?: number }

export const cycleCountItemDomain = defineSyncDomain({
  name: "cycleCountItem",
  table: "cycleCountItems",
  label: "Cycle count items",
  syncClass: "A",
  intervalMs: 15_000,
  async sync(ctx: SyncContext, args: CycleCountItemArgs = {}) {
    // Local partition: count and cursor per cycle count, so one count's rows don't move another's cursor.
    const scope = args.cycleCountId ? { field: "cycleCountId", value: args.cycleCountId } : undefined;
    const target = args.total ?? 200;
    const isShallow = (await items.count({ scope })) < target;
    const cursor = isShallow ? undefined : await items.newestCursor("lastUpdatedStamp", scope);

    const rows = await pageNewestFirst({
      ctx,
      url: ENDPOINT,
      collectionKey: null,
      total: isShallow ? target : (args.batchSize ?? 25),
      batchSize: args.batchSize ?? 25,
      params: {
        ...(args.cycleCountId ? { cycleCountId: args.cycleCountId } : {}),
        ...(cursor !== undefined ? { lastUpdatedStamp_from: new Date(cursor).toISOString() } : {}),
        orderByField: "-lastUpdatedStamp",
      },
      // `_from` is inclusive, and some endpoints ignore it: drop rows not newer than the cursor.
      keep: cursor === undefined ? undefined : (page) => keepNewerThan(page, "lastUpdatedStamp", cursor),
    });
    return items.upsertMany(rows);
  },
  async refetchOne(ctx, pk) {                                   // context FIRST
    if (!pk?.cycleCountId || !pk?.itemSeqId) return 0;
    const resp = await workerGet(ctx, ENDPOINT, { cycleCountId: pk.cycleCountId, itemSeqId: pk.itemSeqId });
    return Array.isArray(resp) && resp[0] ? items.upsertMany([resp[0]]) : 0;
  },
});
```

- `args` are what the page passes to `activateSyncDomains([{ name: "cycleCountItem", args }], owner)`.
- Index `[scopeField+cursorField]` so the count and cursor lookups hit an index.
- **Probe the endpoint** before trusting `<field>_from`; filter support differs per route.

### Class C, fetched on request

```ts
// src/workers/domains/cycleCountNoteDomain.ts
import { appDb } from "@/db/appDb";
import { defineSyncDomain } from "@common/db/sync/defineSyncDomain";
import { workerGet } from "@common/core/workerRemoteApi";

const notes = appDb.entity(appDb.tables.cycleCountNotes);

export const cycleCountNoteDomain = defineSyncDomain({
  name: "cycleCountNote",
  table: "cycleCountNotes",
  label: "Cycle count notes",
  syncClass: "C",
  async sync() { return 0; },                         // never runs a pass of its own
  async refetchOne(ctx, pk) {
    const cycleCountId = String(pk?.cycleCountId ?? "");
    if (!cycleCountId) return 0;
    const resp = await workerGet(ctx, `oms/cycleCounts/${encodeURIComponent(cycleCountId)}/notes`, {});
    const rows: any[] = Array.isArray(resp) ? resp : [];
    // The route does not echo the parent id on each row: stamp it, or the key cannot be built.
    return rows.length ? notes.upsertMany(rows.map((row) => ({ ...row, cycleCountId }))) : 0;
  },
});
```

The screen side stays cache-first and only reads, through `useLiveEntity` in a composable or `.vue`
file; `pk` may carry more than the key when the fetch needs it:

```ts
const { records: notes, hydrated } = useLiveEntity<any>(
  appDb.tables.cycleCountNotes,
  () => ({ equals: { cycleCountId: props.cycleCountId } }),
);
// Once the read lands empty, the domain fetches and stores; the live read shows the rows.
watch(hydrated, (ready) => {
  if (ready && !notes.value.length) void refreshAfterMutation("cycleCountNote", { cycleCountId: props.cycleCountId });
});
```

**Freshness:** "fetch when empty" never refreshes rows already held, and `upsertMany` never drops
rows the server deleted. For data that changes, refetch every time the screen opens (cached rows show
at once, the live read updates when the fetch lands), and store the parent's slice with
`snapshotReplace(rows, { field: "cycleCountId", value: cycleCountId })` so removed rows go too
(Company's `dataManagerErrorRecordDomain.ts` does this per log, and skips the download while its
rows are under two hours old). Fetch
these with `pageAll({ …, requireComplete: true })` ([worker-remote-api.md](worker-remote-api.md)).

### A record built from several calls

- Write **one** fetch-and-assemble function and call it from both `sync` and `refetchOne`.
  `refreshAfterMutation` goes through `refetchOne`, so a second assembly drops
  fields after every write (`organizationDomain.ts` shares `fetchOrganization`).
- Shape the row with nested fields on the entity and pass the raw assembled record to
  `upsertMany` / `snapshotReplace`; the entity decides what is kept.
- Bound the fan-out (Company fetches details 8 at a time).
- A class B `sync` skips when `appDb.client().syncedThisLogin(name)` (unless `options.force`) and
  calls `markSyncedThisLogin(name)` after it writes.

### What a hand-written domain may use

- `const rows = appDb.entity(appDb.tables.x)` at module scope (it resolves the live database on each
  call). Writes: `rows.upsertMany(raw)` (projects through the entity, returns rows written),
  `rows.snapshotReplace(raw, scope?)` (replaces the whole table, or only the `{ field, value }`
  slice, pruning what is missing; returns `{ written, pruned }`), `rows.remove(key)`. Reads: `get`, `getMany`, `all`, `query`,
  `first`, `count(options)`, `newestCursor(field, scope)`. Other tables the same way
  (`appDb.entity(appDb.tables.productStores).all()`); never `.live()` in a worker.
- `appDb.client()`: `syncedThisLogin(name)` / `markSyncedThisLogin(name)` for class B.
- HTTP: `pageAll` (every page), `pageNewestFirst` (newest first, up to `total`), `workerGet`,
  `workerPost` from `@common/core/workerRemoteApi`. All take `ctx` first. A `pageAll` result you
  `snapshotReplace` needs `requireComplete: true`; options and edge cases in
  [worker-remote-api.md](worker-remote-api.md).
- `sync(ctx, args, options)` and `refetchOne(ctx, pk, args)` both take the context **first**; `args`
  are the activation's. Return the number of rows written.
- A `refetchOne` that throws makes `refreshAfterMutation` reject with `CacheReconciliationError`; one
  that returns `0` makes it resolve `0`. Throw when the fetch failed, return `0` only when there is
  honestly nothing to write.

### Register them and start the worker

```ts
// src/workers/appSyncDomains.ts
import type { SyncDomain } from "@common/db/types";
import { commonDomains } from "@common/db/seed/seedDomains";
import { appDb } from "@/db/appDb";
import { cycleCountDomain } from "./domains/cycleCountDomain";
import { cycleCountItemDomain } from "./domains/cycleCountItemDomain";

const OVERRIDDEN_SEED_TABLES = new Set<string>([]);   // seed tables filled by your own domain instead
const appSeedDomains = Object.values(commonDomains).filter((d) =>
  d.table && appDb.seedTables.has(d.table) && !OVERRIDDEN_SEED_TABLES.has(d.table));
export const appSyncDomains: SyncDomain[] = [...appSeedDomains, cycleCountDomain, cycleCountItemDomain];
```

```ts
// src/workers/appSync.worker.ts
import { exposeWorkerHarness } from "@common/db/sync/pollingWorkerHarness";
import { registerDomains } from "@common/db/sync/syncRegistry";
import { appDb } from "@/db/appDb";
import { appSyncDomains } from "./appSyncDomains";

registerDomains(appSyncDomains);
exposeWorkerHarness((omsInstance) => {
  appDb.setOmsInstanceResolver(() => omsInstance);     // the worker is its own JS realm
  return appDb.get(omsInstance);
});
```

### The main-thread facade

```ts
// src/db/appDbSync.ts — deep imports, like the rest of src/db
import { setupAppDbSync } from "@common/db/sync/setupAppDbSync";
import { createSyncService } from "@common/db/sync/syncService";
import { appDb } from "@/db/appDb";
import workerUrl from "../workers/appSync.worker.ts?worker&url";

export const {
  startAppDbSync, stopAppDbSync, refreshAfterMutation, resyncDomain, resyncReferenceData,
  syncService, bootstrapState,
  // only with class A domains:
  activateSyncDomains, deactivateSyncDomains, createSyncDomainOwner, syncDomainsReady, syncDomainsError, syncNow,
} = setupAppDbSync({
  db: appDb,
  getWorkerUrl: () => new URL(workerUrl, import.meta.url),
  createSyncService,
});
```

Every other file imports sync functions from `@/db/appDbSync`, never from `@common/db/sync/*`. The worker
URL import stays relative: a `?worker&url` suffix on an `@/` path fails the apps' alias-import check.

`src/db/` holds only the database objects, the schema, this facade and any app-local Dexie store.
There is no `src/services/`: API calls live in worker domains, stores and composables, and pure logic
in `src/utils/`.

### Lifecycle

```ts
// src/App.vue — a reload restores the session without postLogin, so the watch starts the sync too.
watch(useAuth().isAuthenticated, (authenticated) => {
  if (authenticated) void startAppDbSync();
}, { immediate: true });

// src/store/user.ts
async postLogin() {
  await stopAppDbSync().catch((error) => logger.error("Failed to clear the local database on login", error));
  // … profile, permissions …
  void startAppDbSync();
},
async postLogout() {
  await stopAppDbSync().catch(() => { /* never block logout on cleanup */ });
},
```

A page that shows class A data activates its domains in `onIonViewWillEnter` and deactivates them
with its own owner in `onIonViewDidLeave`. The full page recipe (one list per page, owners, loading
and empty states, Refresh, re-scoping) is the **accxui-page-sync** skill.

## Testing

**The wiring spec** (every app), from `@common/db/testing/appDbWiring`:

```ts
// tests/db/appDbWiring.spec.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkDomainWiring, checkSyncLifecycle } from "@common/db/testing/appDbWiring";
import { appDb } from "@/db/appDb";
import { appSyncDomains } from "@/workers/appSyncDomains";

const source = (path: string) => readFileSync(resolve(process.cwd(), "src", path), "utf8");

it("fills every table from a registered domain", () => {
  expect(checkDomainWiring({
    tables: Object.keys(appDb.tables),
    domains: appSyncDomains,
    filledBy: {},     // table → the domain that fills it besides its own `table`
    unfilled: {},     // table → why nothing fills it (prefer removing the table)
  })).toEqual([]);
});

it("wires the sync lifecycle", () => {
  expect(checkSyncLifecycle({ appVue: source("App.vue"), userStore: source("store/user.ts") })).toEqual([]);
});
```

**A domain:** import it and call `sync` / `refetchOne` with a fake context; mock the HTTP helpers and
the app db, then assert what was requested and written (`apps/company/tests/workers/organizationDomain.spec.ts`):

```ts
const state = vi.hoisted(() => ({ calls: [] as any[], upserts: [] as any[][], response: [] as any }));

vi.mock("@common/core/workerRemoteApi", () => ({
  workerGet: vi.fn(async (_ctx: any, url: string, params: any) => { state.calls.push({ url, params }); return state.response; }),
}));
vi.mock("@/db/appDb", () => ({
  appDb: {
    tables: new Proxy({}, { get: (_target, table) => table }) as any,
    entity: () => ({ upsertMany: vi.fn(async (rows: any[]) => { state.upserts.push(rows); return rows.length; }) }),
  },
}));

import { cycleCountNoteDomain } from "@/workers/domains/cycleCountNoteDomain";
const ctx = { maargUrl: "https://example.test", token: "t" } as any;

it("stamps the parent id onto each note", async () => {
  state.response = [{ noteId: "N1" }];
  expect(await cycleCountNoteDomain.refetchOne!(ctx, { cycleCountId: "C1" })).toBe(1);
  expect(state.upserts).toEqual([[{ noteId: "N1", cycleCountId: "C1" }]]);
});
```

A class B domain that checks `syncedThisLogin` also needs `client: () => ({ syncedThisLogin,
markSyncedThisLogin, count })` on the mocked `appDb`. A composable that calls `refreshAfterMutation` mocks
`@/db/appDbSync`.

**A factory domain** (`defineSnapshotDomain`, `defineCursorDomain`) doesn't write through
`appDb.entity(...)`: it resolves the database through the registry, so the mock above never sees its
writes. Follow Company's `tests/workers/carrierReferenceDomains.spec.ts`: mock `@/db/<app>Db` with a
Dexie-shaped stub as `get` / `raw`, then per test `vi.resetModules()`, import the app db,
`setAppDb(appDb)` from `@common/db/schema/appDbRegistry`, and import the domain module after it.

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| `@common` / `@common/db` / `commonUtil` in `src/db` or `src/workers` | worker chunk breaks or bundles Vue | deep imports; resolver in `main.ts` |
| Schema changed, `version` not bumped | old row shapes survive, fields `undefined` | bump + comment |
| Field the screen reads not in `fields` | row exists, field `undefined` | declare it (or `rename`) |
| Redeclaring / fetching statuses, facilities, enums… | duplicate data path | `commonSchema.pick` + `useSeedData` |
| Domain not in `appSyncDomains` | table stays empty, no error | add it; `checkDomainWiring` names the table |
| `api()` or `fetch` inside a domain | fails in the worker | `@common/core/workerRemoteApi` |
| Writing the POST response into the table | drifts from the server | `refreshAfterMutation` / `resyncDomain` after the write |
| A composable fetching a record and `upsertMany`-ing it | a second writer; lint rejects it | `refreshAfterMutation` + a domain `refetchOne` |
| `sync` and `refetchOne` assembling a record differently | the row loses fields after every write | one shared fetch-and-assemble function |
| A class C domain with no `refetchOne` | `refreshAfterMutation` fails | give it one; `checkDomainWiring` reports it |
| A class B snapshot with no `byPk` / `refetchScope` / `fanOut` | `refreshAfterMutation` resolves `0`, row stays stale | add the option that fits the API, or `resyncDomain` after writes |
| Overriding a seed domain under a new name, or without `OVERRIDDEN_SEED_TABLES` | two domains fill one table, or callers name the wrong one | the seed domain's name, and drop the seed one |
| `extendEntities` to change a pk or a field kind | throws at load | declare your own table under that name instead of picking it |
| Copying a seed entity into `appSchema` to add a field | `mergeSchemas` throws (two schemas claim it), or the table loses its seed domain | `pick(...).extendEntities(...)` |
| Activating a class B domain from a page | needless re-fetch, worker churn | class B runs at login |
| Sync started only in `postLogin` | nothing syncs after a reload | the `isAuthenticated` watch in `App.vue`; `checkSyncLifecycle` reports it |
| A second `defineAppDb` or Dexie instance for app data | bypasses sync; lint fails | one `appDb`, more tables in `appSchema` |

## Before you finish

- [ ] Every new table is declared, indexed for each query, and `version` is bumped with a comment.
- [ ] Every new domain is in `appSyncDomains`; class C domains have a `refetchOne`.
- [ ] `tests/db/appDbWiring.spec.ts` passes (new second tables listed in `filledBy`).
- [ ] Domain specs cover what each new domain requests and writes.
- [ ] `pnpm build` (lints first) and `pnpm test:unit` pass in the app.
- [ ] In the browser, after login, DevTools → Application → IndexedDB shows `{oms}-<suffix>` with the table filled.
