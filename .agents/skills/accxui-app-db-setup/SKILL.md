---
name: accxui-app-db-setup
description: Use when an AccxUI app under apps/* needs local IndexedDB storage it does not have yet, or a new table, sync domain or seed table in its app database. Triggers include a new app that should "store / cache / sync data locally", "work like Company / Order Manager", defineAppDb, defineEntity, defineSchema, mergeSchemas, commonSchema.pick, extendEntities, defineSnapshotDomain, defineSyncDomain, defineCursorDomain, pageNewestFirst, refetchOne, refreshRecord, a class C / on-request table, registerDomains, exposeWorkerHarness, setupAppDbSync, appSync.worker.ts, startAppDbSync / stopAppDbSync, checkDomainWiring, a schema version bump, or a table that stays empty.
---

# Setting up the AccxUI app database

Every app gets **one IndexedDB database per OMS instance**, filled by a **background sync worker**.
This skill builds it: tables, the database, sync domains, the worker and the login wiring. Reading
and writing the data afterwards is the **accxui-data-access** skill.

`appDb` / `appSchema` stand for the app's names (`companyDb`, `companySchema`). Working references:
`apps/company` (own and seed tables, class A, B and C domains) and `apps/order-manager` (seed tables
only). Full reference: `docs/APP_DB_DEVELOPER_GUIDE.md`.

## Rules

1. **Worker code uses deep imports only.** `src/db/**` and `src/workers/**` run in the sync worker:
   import `@common/db/schema/*`, `@common/db/seed/*`, `@common/db/sync/*`, `@common/db/types`,
   `@common/core/workerRemoteApi`. Never `@common`, `@common/db`, `commonUtil`, `api()`, stores or
   composables. *Why:* the barrel pulls in Vue and the worker chunk breaks or bloats.
2. **Only sync domains write the app db.** A screen missing a record calls `refreshRecord`; a server
   write reconciles with `refreshAfterMutation` / `resyncDomain`. If no domain fits, add one (class C
   if it is fetched only on request). *Why:* one writer keeps one row shape.
3. **Every table is filled by a registered domain**, and every domain is in `appSyncDomains`.
   *Why:* `define*Domain` does not register anything; a missing domain fails silently and the table
   stays empty. `checkDomainWiring` catches it.
4. **`fields` is a whitelist.** Whatever a screen reads must be declared (or renamed into place).
5. **Every schema change bumps `version`.** *Why:* the database is rebuilt only on a version change;
   nothing detects a forgotten bump, and old-shaped rows stay.
6. **Domain HTTP goes through `@common/core/workerRemoteApi`** (`pageAll`, `pageNewestFirst`,
   `workerGet`, `workerPost`). Never `api()` or `fetch` in a domain.
7. **Wire the lifecycle exactly:** `App.vue` starts the sync when `isAuthenticated` turns true;
   `postLogin` stops it, then starts it; `postLogout` stops it (which clears the tables).
   `checkSyncLifecycle` catches a mistake.
8. **Class B is never activated from a page; class A always is,** and the page deactivates it with
   the same owner in `onIonViewDidLeave`.
9. **Seed tables are picked, not redeclared.** Statuses, facilities, enums and the other reference
   tables come from `commonSchema`; labels come from `useSeedData()` in the pages that show them
   (never `App.vue`, which lint rejects) and `loadSeedData()` in stores.

## Which sync class

| Data | Class | Build it with | Company reference |
|---|---|---|---|
| Reference / config from one list endpoint | **B**: once per login, then after writes | `defineSnapshotDomain` | `workers/domains/referenceDomains.ts` |
| Reference data needing several calls or assembly | **B** | `defineSyncDomain` with `sync` + `refetchOne` | `workers/domains/organizationDomain.ts` |
| Live, append-mostly; polled only while a screen is open | **A** | `defineSyncDomain` with a cursor read, or `defineCursorDomain` | `dataManagerLogDomain.ts`, `systemMessageDomain.ts` |
| One record at a time, when a screen asks; never polled | **C** | `defineSyncDomain`: `sync` returns `0`, `refetchOne` fetches | `systemMessageErrorDomain.ts`, `shopifyBulkOperationDomain.ts` |

## Files, in build order

| # | File | Contains |
|---|---|---|
| 1 | `src/db/appSchema.ts` | `defineSchema({ table: defineEntity({...}) })` for the app's own tables (omit if none) |
| 2 | `src/db/appDb.ts` | `defineAppDb({ suffix, version, schema: mergeSchemas(commonSchema.pick([...SEED]), appSchema) })` |
| 3 | `src/workers/domains/<thing>Domain.ts` | one sync domain per file |
| 4 | `src/workers/appSyncDomains.ts` | the single list: seed domains for the picked tables + own domains |
| 5 | `src/workers/appSync.worker.ts` | `registerDomains(appSyncDomains)` + `exposeWorkerHarness(...)`, nothing else |
| 6 | `src/services/appDbSync.ts` | `setupAppDbSync({...})` once; re-export its functions |
| 7 | `src/main.ts` | `appDb.setOmsInstanceResolver(() => commonUtil.getOMSInstanceName())` |
| 8 | `src/App.vue` + `src/store/user.ts` | the lifecycle wiring (below) |
| 9 | `eslint.config.js` | `import { dbConfig } from "../../eslint.config.js"; export default [...dbConfig]`; `"build": "eslint src && vite build"` |
| 10 | `tests/db/appDbWiring.spec.ts` | `checkDomainWiring` + `checkSyncLifecycle` (below) |
| opt | `src/views/Settings.vue` | status card: `useDbStatus(appDb.client(), async () => catalogFrom((await import("@/workers/appSyncDomains")).appSyncDomains), { resyncDomain, resyncAll: resyncReferenceData })`; class C rows read "fetched when opened" with no Refresh (copy Company's) |

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
- Seed tables (declared in `common/db/seed/seedSchema.ts`, filled by `seedDomains.ts`) include
  productStores, statuses, enums, enumTypes, facilities, facilityTypes, facilityGroups, geos,
  carriers, shipment/payment method types, return types, roleTypes, shopifyShops,
  shopifyShopLocations, productStore* associations and more. Check the seed domain's `listUrl` /
  `collectionKey` match your API before relying on one.
  - More fields on a seed row: `commonSchema.pick([...]).extendEntities({ facilities: { fields: {...}, rename: {...} } })`.
  - A different endpoint: keep the seed **table**, write your own domain with the seed domain's
    **name**, and leave the seed one out via `OVERRIDDEN_SEED_TABLES` in `appSyncDomains.ts`.

### Class B, one endpoint

```ts
// src/workers/domains/cycleCountDomain.ts
import { defineSnapshotDomain } from "@common/db/sync/defineSnapshotDomain";

export const cycleCountDomain = defineSnapshotDomain({
  name: "cycleCount",                 // what refreshAfterMutation / resyncDomain / refreshRecord name
  label: "Cycle counts",              // shown on the Settings status card
  syncClass: "B",
  table: "cycleCounts",
  listUrl: "oms/cycleCounts",
  collectionKey: null,                // null = bare array; "cycleCountList" = resp.cycleCountList
  byPk: (pk) => ({ url: `oms/cycleCounts/${encodeURIComponent(String(pk.cycleCountId))}` }),
});
```

It fetches the whole set and **prunes** rows it didn't get back, so get `collectionKey` right.
Give it a refetch path for writes (`byPk`, `refetchScope` or `fanOut`); without one,
`refreshAfterMutation` does nothing and you must `resyncDomain`. Every option (`strictCollection`,
`listParams`, `unpaged`, `scopeOnSync`, `fanOut`, `byPkRecordKey`, `refetchScope`) is in the
guide's §3 table.

### Class A, polled with a cursor

`defineCursorDomain` covers the plain case (`listUrl`, `cursorField`, `cursorParam`, `total`,
`scopeOf`, `paramsOf`) when the endpoint honours its cursor param. Hand-write it when you need
client-side scoping or a refresh of in-flight rows, as every Company class A domain does:

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

The screen side stays cache-first and only reads; `pk` may carry more than the key when the fetch
needs it:

```ts
let rows = await appDb.entity(appDb.tables.cycleCountNotes).query({ equals: { cycleCountId } });
if (!rows.length) {
  await refreshRecord("cycleCountNote", { cycleCountId });   // the domain fetches and stores
  rows = await appDb.entity(appDb.tables.cycleCountNotes).query({ equals: { cycleCountId } });
}
```

### A record built from several calls

- Write **one** fetch-and-assemble function and call it from both `sync` and `refetchOne`.
  `refreshAfterMutation` and `refreshRecord` go through `refetchOne`, so a second assembly drops
  fields after every write (`organizationDomain.ts` shares `fetchOrganization`).
- Shape the row with nested fields on the entity and pass the raw assembled record to
  `upsertMany` / `snapshotReplace`; the entity decides what is kept.
- Bound the fan-out (Company fetches details 8 at a time).
- A class B `sync` skips when `appDb.client().syncedThisLogin(name)` (unless `options.force`) and
  calls `markSyncedThisLogin(name)` after it writes.

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
// src/services/appDbSync.ts
import { createSyncService, setupAppDbSync } from "@common/db";
import { appDb } from "@/db/appDb";
import workerUrl from "@/workers/appSync.worker.ts?worker&url";

export const {
  startAppDbSync, stopAppDbSync, refreshAfterMutation, refreshRecord, resyncDomain, resyncReferenceData,
  syncService, bootstrapState,
  // only with class A domains:
  activateSyncDomains, deactivateSyncDomains, createSyncDomainOwner, syncDomainsReady, syncDomainsError, syncNow,
} = setupAppDbSync({
  db: appDb,
  getWorkerUrl: () => new URL(workerUrl, import.meta.url),
  createSyncService,
});
```

Every other file imports sync functions from `@/services/appDbSync`, never from `@common/db/sync/*`.

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

A page with class A domains: `const owner = createSyncDomainOwner("cycleCountPage")` in setup,
`activateSyncDomains([{ name, intervalMs, args }], owner)` in `onIonViewWillEnter`,
`deactivateSyncDomains(owner)` in `onIonViewDidLeave`. When its args change, activate again with the
same owner; it is idempotent.

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
markSyncedThisLogin, count })` on the mocked `appDb`. A composable that calls `refreshRecord` mocks
`@/services/appDbSync`.

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
| A composable fetching a record and `upsertMany`-ing it | a second writer; lint rejects it | `refreshRecord` + a domain `refetchOne` |
| `sync` and `refetchOne` assembling a record differently | the row loses fields after every write | one shared fetch-and-assemble function |
| A class C domain with no `refetchOne` | `refreshRecord` fails | give it one; `checkDomainWiring` reports it |
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
