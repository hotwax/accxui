---
name: accxui-app-db-setup
description: Use when an AccxUI app under apps/* needs local IndexedDB storage it does not have yet, or a new table, sync domain or seed table in its app database. Triggers include a new app that should "store / cache / sync data locally", "work like Company / Order Manager", defineAppDb, defineEntity, defineSchema, mergeSchemas, commonSchema.pick, extendEntities, defineSnapshotDomain, defineSyncDomain, defineCursorDomain, pageNewestFirst, refetchOne, refreshRecord, a class C / on-request table, registerDomains, exposeWorkerHarness, setupAppDbSync, appSync.worker.ts, startAppDbSync / stopAppDbSync, a schema version bump, or a table that stays empty.
---

# Setting up the AccxUI app database

Every AccxUI app gets **one IndexedDB database per OMS instance**, filled by a **background sync
worker**, from four kinds of declaration: tables (schema), the database (seed tables + own tables +
version), sync domains (how each table is filled) and a main-thread facade. App code never touches
Dexie. Reading and writing the data once it exists is the **accxui-data-access** skill; this one
covers building it.

Real, working references: `apps/company` (own tables + seed tables, class A and B domains) and
`apps/order-manager` (seed tables only, no own tables). Full guide:
`docs/APP_DB_DEVELOPER_GUIDE.md` (§2 tables, §3 domains, §4 `mutate`, §5 polling, §6 new app,
§9 folder structure). Below, `appDb` / `appSchema` stand for the app's names (`companyDb`,
`companySchema`).

## The worker-safety rule (breaks the build silently otherwise)

`src/db/**` and `src/workers/**` run inside the sync worker. They use **deep imports only**:
`@common/db/schema/defineEntity`, `@common/db/schema/defineSchema`, `@common/db/schema/defineAppDb`,
`@common/db/seed/seedSchema`, `@common/db/seed/seedDomains`, `@common/db/sync/*`,
`@common/db/types`, `@common/core/workerRemoteApi`. **Never** `@common`, `@common/db` (the barrel
pulls in `vue`), `commonUtil`, `api()`, Pinia stores or `useX()` composables there. The barrel
`@common/db` is for `src/services/appDbSync.ts`, components and composables.

## Files, in build order

| # | File | Contains |
|---|---|---|
| 1 | `src/db/appSchema.ts` | `defineSchema({ table: defineEntity({...}) })` for the app's own tables. Omit if none |
| 2 | `src/db/appDb.ts` | `defineAppDb({ suffix, version, schema: mergeSchemas(commonSchema.pick([...SEED]), appSchema) })` + `appDb.setOmsInstanceResolver(() => "default")` |
| 3 | `src/workers/domains/<thing>Domain.ts` | one sync domain per file |
| 4 | `src/workers/appSyncDomains.ts` | the single list: seed domains for picked tables + own domains |
| 5 | `src/workers/appSync.worker.ts` | `registerDomains(list)` + `exposeWorkerHarness(...)`, nothing else |
| 6 | `src/services/appDbSync.ts` | `setupAppDbSync({...})` once; re-export its functions |
| 7 | `src/main.ts` | `appDb.setOmsInstanceResolver(() => commonUtil.getOMSInstanceName())` |
| 8 | `src/App.vue` | `watch(useAuth().isAuthenticated, (on) => { if (on) void startAppDbSync() }, { immediate: true })` |
| 9 | `src/store/user.ts` | `postLogin`: `await stopAppDbSync().catch(log)` first, `void startAppDbSync()` after profile/permissions. `postLogout`: `await stopAppDbSync().catch(() => {})` |
| 10 | `eslint.config.js` | `import { dbConfig } from "../../eslint.config.js"; export default [...dbConfig]`, and `"build": "eslint src && vite build"` in package.json |
| 11 | `tests/db/domainTables.spec.ts` | every registered domain's `table` exists in `appDb.tables` |
| opt | `src/views/Settings.vue` | status card: `useDbStatus(appDb.client(), async () => catalogFrom((await import("@/workers/appSyncDomains")).appSyncDomains), { resyncDomain, resyncAll: resyncReferenceData })`. Label class C rows "fetched when opened" and give them no Refresh (their `sync` does nothing); copy Company's `Settings.vue` rows |

### 1–2. Tables and database

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
    primaryKey: "cycleCountId,itemSeqId",             // compound key: comma-separated, no synthetic key needed
    fields: { cycleCountId: "text", itemSeqId: "text", productId: "text", quantity: "count", lastUpdatedStamp: "date" },
    indexes: ["[cycleCountId+lastUpdatedStamp]"],     // scope + cursor, for the class-A domain below
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

- `fields` is a **whitelist**: undeclared fields are dropped. Kinds: `text`, `count`, `date`
  (stored as epoch millis), `structured` (as-is); nested `{...}` and `[...]` shapes are allowed (guide §2).
- **List fields** are indexed with `*`: `items: [{ productId: "text" }]` + index `"*items.productId"`,
  then query `equals: { "items.productId": pid }`. Dotted paths index nested objects: `"carrier.partyId"`.
- **Seed tables** are already declared in `common/db/seed/seedSchema.ts` and synced by
  `common/db/seed/seedDomains.ts`: productStores, statuses, enums, enumTypes, facilities,
  facilityTypes, facilityGroups, geos, geoAssocs, carriers, shipmentMethodTypes, paymentMethodTypes,
  returnReasons, returnTypes, returnItemTypes, roleTypes, orderAdjustmentTypes,
  contactMechPurposeTypes, communicationEventTypes, partyRelationshipTypes, shopifyShops,
  shopifyShopLocations, groupFacilities, carrierShipmentMethods, statusFlowTransitions,
  productStoreFacilities, productStoreFacilityGroups, productStoreShipmentMethods,
  productStoreEmailSettings. Pick them; don't redeclare or fetch them. Check that the seed domain's
  `listUrl` / `collectionKey` / fields match your API before relying on one.
  - More fields on a seed row: `commonSchema.pick([...]).extendEntities({ facilities: { fields: {...}, rename: {...} } })`.
  - Different endpoint or envelope: keep the seed **table**, write your own domain with the seed
    domain's **name** (e.g. `defineSnapshotDomain({ name: "returnReason", table: "returnReasons", listUrl, collectionKey: "returnReasonList" })`)
    and leave the seed domain out via `OVERRIDDEN_SEED_TABLES` in `appSyncDomains.ts` (see Company's).
- **Version:** a different version drops and rebuilds the database. Nothing detects a forgotten
  bump; old-shaped rows just stay.

### 3. Sync domains: pick a class

| Data | Class | How to build it | Company reference |
|---|---|---|---|
| Reference / config from one list endpoint | **B**: once per login, then on mutation | `defineSnapshotDomain` | `workers/domains/referenceDomains.ts` |
| Reference data that needs several calls or assembly | **B** | `defineSyncDomain` with `sync` + `refetchOne` | `workers/domains/organizationDomain.ts` |
| Live, append-mostly; polled only while a screen is open | **A** | `defineSyncDomain` with a cursor read (below) | `workers/domains/dataManagerLogDomain.ts`, `systemMessageDomain.ts` |
| One record at a time, only when a screen asks; never polled | **C** | `defineSyncDomain`: `sync` returns `0`, `refetchOne` fetches; screens call `refreshRecord` | `workers/domains/systemMessageErrorDomain.ts`, `shopifyBulkOperationDomain.ts` |

**Every table has exactly one writer: its domain.** Composables, stores and pages never call
`upsertMany` / `snapshotReplace` / `put` / `remove` on the app db. A screen missing a record calls
`refreshRecord(domain, pk)`; a server change goes through `mutate`. If no domain fits, add one
(class C if it is fetched only on request) rather than writing from app code.

**Class B, one endpoint:**

```ts
// src/workers/domains/cycleCountDomain.ts
import { defineSnapshotDomain } from "@common/db/sync/defineSnapshotDomain";

export const cycleCountDomain = defineSnapshotDomain({
  name: "cycleCount",                 // what refreshAfterMutation / resyncDomain / mutate name
  label: "Cycle counts",              // shown on the Settings status card
  syncClass: "B",
  table: "cycleCounts",
  listUrl: "oms/cycleCounts",
  collectionKey: null,                // null = bare array; "cycleCountList" = resp.cycleCountList
  byPk: (pk) => ({ url: `oms/cycleCounts/${encodeURIComponent(String(pk.cycleCountId))}` }),
});
```

It fetches the whole set and **prunes** stored rows it didn't get back, so get `collectionKey`
right (`strictCollection: true` fails loudly instead). Give it a refetch path for writes: `byPk`
(a by-id route), `refetchScope` (the list filters by id) or `fanOut`. Without one,
`refreshAfterMutation` silently does nothing; use `resyncDomain` then.

`defineSnapshotDomain` options beyond the example:

| Option | Use it when |
|---|---|
| `collectionKey` | the list is wrapped: `"cycleCountList"` reads `resp.cycleCountList`; `null` for a bare array |
| `strictCollection: true` | a missing envelope key should throw rather than snapshot to `[]` |
| `listParams` | the list needs fixed server params (a type filter); also sent by `refetchScope` |
| `batchSize` / `unpaged: true` | page size (default 250) / the route ignores paging: one request, still asks for a full page |
| `scopeOnSync: { field, value }` | the table holds more than this list returns: prune only rows in that partition |
| `fanOut: { parentTable, parentKeyField, urlFor, collectionKey? }` | rows come per parent (one URL per id in an already-synced parent table); the parent id is stamped on each row, and `refetchOne` re-reads that parent's rows |
| `byPk` (+ `byPkRecordKey`) | a by-id route exists; `byPkRecordKey` unwraps `{ <key>: record }`. An empty answer **removes** the stored row |
| `refetchScope: (pk) => ({ params, scope? })` | no by-id route, but the list filters by key: re-read that slice and prune within `scope` |

Each sync refuses to replace a populated table with an empty fetch (unless forced), and skips
rows it cannot key. An entity whose key member the server may legitimately omit declares
`keyDefaults: { feedId: "" }` on `defineEntity`, so those rows are kept instead of dropped.

**Class A, polled with a cursor.** Keep the newest stored date per scope, ask the server only for
rows after it, and deepen the window while it is short of `total`. `defineCursorDomain`
(`@common/db/sync/defineCursorDomain`, guide §3) packages the plain case (`listUrl`,
`cursorField`, `cursorParam`, `total`, `scopeOf`, `paramsOf`). No app uses it yet: Company's
class A domains are hand-written like this, because each needs its own refresh of in-flight rows
or client-side scoping. Use `defineCursorDomain` when the endpoint honours its cursor param and
nothing else is needed; hand-write it otherwise:

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
        // Server filter: what the request is scoped to. The local `scope` above is never sent.
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

- The `args` are what the page passes to `activateSyncDomains([{ name: "cycleCountItem", args }])`.
- Index `[scopeField+cursorField]` (here `[cycleCountId+lastUpdatedStamp]`) so the count and cursor
  lookups hit an index.
- **Probe the endpoint** before trusting `<field>_from`: filter support differs per route (see the
  comments in Company's `dataManagerLogDomain.ts` and `systemMessageDomain.ts`). `keep` covers an
  ignored param, but you then pay for a full page every tick.

**Class C, fetched on request.** A table a screen fills one record at a time (an error list
for the message being inspected, a Shopify object by id). Nothing polls it; its rows arrive when a
screen calls `refreshRecord`:

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

The screen side (a composable) stays cache-first and only reads:

```ts
const notes = appDb.entity(appDb.tables.cycleCountNotes);
let rows = await notes.query({ equals: { cycleCountId } });
if (!rows.length) {
  await refreshRecord("cycleCountNote", { cycleCountId });   // the domain fetches and stores
  rows = await notes.query({ equals: { cycleCountId } });
}
```

`refreshRecord` waits only for the worker to be open (not the login sync), and rejects with the
domain's own error. `pk` may carry more than the key when the fetch needs it (Company's bulk
operation passes `systemMessageRemoteId` next to `id`).

**A record built from several calls.** When a row needs data from more than one endpoint (a role
list plus each party's detail, an order plus its identifications), the domain assembles it:

- Write **one** function that fetches and assembles a record, and call it from both `sync` and
  `refetchOne`. `mutate` and `refreshRecord` reconcile through `refetchOne`, so if it assembles
  differently the row loses the other parts after every write. See `organizationDomain.ts`
  (`fetchOrganization` is shared by both).
- Shape the row with **nested fields** on the entity (`customer: { partyId: "text", … }`,
  `identifications: [{ idValue: "text" }]`), so the assembled object is stored, coerced and
  indexed like any other field. Pass the raw assembled record to `upsertMany` / `snapshotReplace`;
  the entity decides what is kept.
- Bound the fan-out (Company fetches details 8 at a time) so a large tenant does not burst one
  request per row.

**Hand-written domain rules (any class):** HTTP only through `@common/core/workerRemoteApi`
(`pageAll`, `pageNewestFirst`, `workerGet`, `workerPost`), never `api()`. Tables through
`appDb.entity(appDb.tables.x)` held in module scope (`get`, `query`, `count`, `newestCursor`,
`upsertMany`, `snapshotReplace`, `remove`). A class-B `sync` returns early when
`appDb.client().syncedThisLogin(name)` is true (unless `options.force`), and calls
`markSyncedThisLogin(name)` after it writes; see `organizationDomain.ts`.

### 4–5. Register them

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

`define*Domain` only builds a domain; it does **not** register it. A domain missing from
`appSyncDomains` never runs and raises no error.

### 6. The main-thread facade

```ts
// src/services/appDbSync.ts
import { api, commonUtil } from "@common";
import { createSyncService, setupAppDbSync } from "@common/db";
import { appDb } from "@/db/appDb";
import workerUrl from "@/workers/appSync.worker.ts?worker&url";

export const {
  startAppDbSync, stopAppDbSync, mutate, refreshAfterMutation, refreshRecord, resyncDomain, resyncReferenceData,
  syncService, bootstrapState,
  // only with class-A domains:
  activateSyncDomains, deactivateSyncDomains, createSyncDomainOwner, syncDomainsReady, syncDomainsError, syncNow,
} = setupAppDbSync({
  db: appDb,
  getWorkerUrl: () => new URL(workerUrl, import.meta.url),
  createSyncService,
  api,                                                 // mutate sends writes through it
  isError: (resp) => commonUtil.hasError(resp),
});
```

Every other file imports sync functions from `@/services/appDbSync`, never from `@common/db/sync/*`.

## Then use it (accxui-data-access skill)

- On screen: `useLiveEntity<any>(appDb.tables.cycleCounts, () => ({ equals: { facilityId } }))`.
- One-shot read: `await appDb.entity(appDb.tables.cycleCounts).get(id)`.
- A record the db is missing: `await refreshRecord("cycleCount", { cycleCountId })`, then read it.
  Never `api()` it and `upsertMany` it from app code.
- Labels from seed tables: `useSeedData()` → `seed.facilityName(id)`, `seed.statusDescription(id)`;
  not `useLiveEntity` on the seed table plus a hand-built map.
- Writes: `await mutate({ url: "oms/cycleCounts", method: "post", data }, { resync: ["cycleCount"] })`.
  Use `refresh: [["cycleCount", { cycleCountId }]]` only when you know the key (from the request,
  or from a response shape you've verified). Company's existing writes use the two-call form,
  `api(...)` then `refreshAfterMutation("cycleCount", { cycleCountId })` or `resyncDomain("cycleCount")`;
  both reconcile through the domain's refetch path.
- **Class B needs no page code.** It syncs at login (`startAppDbSync`); never activate it from a page.
- **Class A** is off until a page turns it on: `createSyncDomainOwner` in setup,
  `activateSyncDomains([{ name, intervalMs, args }], owner)` in `onIonViewWillEnter`,
  `deactivateSyncDomains(owner)` in `onIonViewDidLeave` (guide §5). The login (class-B) set keeps
  running alongside, so list only the page's class-A domains. When the args change (another store
  selected), call `activateSyncDomains` again with the same owner; it is idempotent. Gate that
  `watch` on a "page visible" flag set in `willEnter` and cleared in `didLeave`.

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| `@common` / `@common/db` / `commonUtil` imported in `src/db` or `src/workers` | worker chunk breaks or bundles Vue | deep imports; resolver in `main.ts` |
| Schema changed, `version` not bumped | old row shapes survive, fields `undefined` | bump + comment |
| Field the screen reads not in `fields` | row exists, field `undefined` | declare it (or `rename`) |
| Redeclaring / fetching statuses, facilities, enums… | duplicate data path | `commonSchema.pick` + `useSeedData` |
| Domain not in `appSyncDomains` | table stays empty, no error | add it; the `domainTables` spec catches it |
| `api()` or `fetch` inside a domain | fails in the worker | `@common/core/workerRemoteApi` |
| Writing the POST response into the table | drifts from the server | `mutate(..., { refresh / resync })` |
| A composable fetching a record and `upsertMany`-ing it | a second writer with its own row shape | `refreshRecord` + a domain `refetchOne` (class C if nothing polls it) |
| `sync` and `refetchOne` assembling a record differently | the row loses fields after every write | one shared fetch-and-assemble function |
| A class C domain with no `refetchOne` | `refreshRecord` fails: "domain has no refetchOne" | give it one; its `sync` returns `0` |
| Activating a class-B domain from a page | needless re-fetch / worker churn | class B runs at login; activate class A only |
| Sync started only in `postLogin` | nothing syncs after a page reload | also the `isAuthenticated` watch in `App.vue` |
| A second `defineAppDb` or Dexie instance for app data | bypasses sync, lint fails | one `appDb`, more tables in `appSchema` |

## Testing a domain

Domains are plain objects: import one and call `sync` / `refetchOne` with a fake context. Mock the
HTTP helpers and the app db, then assert what was requested and what was written. Pattern from
`apps/company/tests/workers/organizationDomain.spec.ts`:

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

A class B domain that checks `syncedThisLogin` also needs `client: () => ({ syncedThisLogin, markSyncedThisLogin, count })`
on the mocked `appDb`. Keep `tests/db/domainTables.spec.ts` asserting that every registered
domain's table exists. A composable that calls `refreshRecord` mocks `@/services/appDbSync`.

## Check your work

```bash
pnpm --filter <app> build
```

The build lints first, and the data-access rules reject the usual mistakes: Dexie or `dbClient` in app
code, `appDb.client()` outside workers, string table names, app db writes outside `src/workers/**`
and `src/db/**`, and a page that activates domains without deactivating them. Then run `vitest` in the app (see `apps/company/tests/db/*` for spec
patterns), and in the browser confirm DevTools → Application → IndexedDB shows `{oms}-<suffix>` with
filled tables after login.
