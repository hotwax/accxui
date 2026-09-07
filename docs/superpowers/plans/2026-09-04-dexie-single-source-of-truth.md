# Dexie as the Single Source of Truth — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Dexie the only source of Order Manager seed data — one thin operations layer (`dbClient`), one module of lazily built lookup slices fed only from Dexie (`useSeedData.ts`), one reactive composable (`useDb`) — and delete the seed Pinia store with its parallel REST fetchers.

**Architecture:** The sync worker becomes the only fetcher of seed data. `dbClient` wraps Dexie with plain async ops usable from the worker, services, stores and composables. `useSeedData.ts` is a single plain module (not Pinia, not a composable) holding one reactive slice per table, **created lazily on first access** and kept fresh by a debounced `liveQuery`; it serves the synchronous lookups Vue computeds and non-component code require, and exports `useSeedData()` for components. There is no boot hydration and no index config. Lazy loading means a stamped-into-data lookup could keep a cold raw id, so the module also exports `ensureLoaded(tables)` for the six sites that stamp. Stored rows drop their `raw` payload copy, so the projection becomes the contract.

**Tech Stack:** Vue 3 (`<script setup>`, Composition API), Pinia, Dexie 4 (`liveQuery`), Comlink web worker, Vitest + jsdom, `fake-indexeddb` (new), pnpm workspace with catalog protocol.

## Global Constraints

- **Two git repos, both already on branch `seed-data-read`:** `accxui` at the workspace root (owns `common/`) and `apps/order-manager` (a nested repo). Commit to each separately. A task touching both commits in both.
- **The sync worker must never import `commonUtil` or the `@common` barrel.** Vite emits the worker chunk as a single iife; pulling in the barrel breaks the build. `dbClient` therefore takes `BaseDB` as a parameter and never resolves the active OMS itself.
- **No composables inside Pinia stores.** Shared logic goes in a plain module. This is why `useSeedData.ts` exposes plain functions alongside its composable, and why stores import the plain ones.
- **Tests for `common/db` code live in `apps/order-manager/tests/db/`.** The root repo has no working vitest config — `npx vitest` from the workspace root fails to collect — and `common/tests/` is orphaned (never runs; several specs already fail). The order-manager runner resolves `@common` → `../../common` via `vite.config.js:46`, so tests placed there exercise the real `common/db` source.
- **Test baseline to preserve: 89 files / 462 tests passing** in `apps/order-manager`. The full suite takes ~15 minutes. Run targeted files during a task (`npx vitest run tests/db/dbClient.spec.ts`) and the full suite only at the commit step of each task.
- **Typecheck and lint are pre-broken repo-wide.** Do not treat existing `vue-tsc`/`eslint` failures as regressions; only ensure you add no new ones in files you touch.
- **Do not touch** the `order`, `orderDetail`, `customer` or `productCache` Pinia stores beyond the specific seed call sites listed in Tasks 7–10. Do not touch `inventory-count` or `company`. Do not touch `DEFAULT_COMMON_SYNC_CATALOG`.
- **Uncommitted `.gitignore` and `pnpm-lock.yaml` edits pre-exist this work.** Leave them alone; never `git add -A` at the workspace root.

### Getter mapping — old store API to new API

Every migration task uses this table. Components call these through `useSeedData()`; stores, services and utils import the same names as plain functions from the same file, `@/db/useSeedData`.

| Old (`useSeedStore()`) | New | Notes |
| --- | --- | --- |
| `describe(id)` | `describe(id)` | unchanged |
| `statusDescription(id)` · `status(id)` · `statusAge(id)` | same names | unchanged |
| `enumDescription(id)` | `enumDescription(id)` | unchanged |
| `getStatusItemsByType(t)` · `getEnumsByType(t)` · `getEnumsByParentType(p)` | same names | unchanged |
| `productStore(id)` · `productStoreName(id)` | same names | unchanged |
| `facility(id)` · `facilityName(id)` · `facilityType(id)` | same names | unchanged |
| `shipmentMethod(id)` · `shipmentMethodDescription(id)` | same names | unchanged |
| `carrier(id)` · `carrierName(id)` · `shippingMethodsByCarrier(p)` | same names | unchanged |
| `paymentMethodDescription(id)` · `returnReasonDescription(id)` · `orderAdjustmentTypeDescription(id)` | same names | unchanged |
| `orderIdentificationTypeDescription(id)` | same name | unchanged |
| `geoName(id)` · `getGeoIdByCode(c)` · `getStatesForCountry(c)` | same names | unchanged |

**Bare getters that become functions — every call site needs `()` added.** In Pinia these were properties; in `useSeedData.ts` they are plain functions:

| Old | New |
| --- | --- |
| `seed.getCountries` | `seed.getCountries()` |
| `seed.getStates` | `seed.getStates()` |
| `seed.getShipmentMethodOptions` | `seed.getShipmentMethodOptions()` |
| `seed.orderIdentificationTypeOptions` | `seed.orderIdentificationTypeOptions()` |

These are **every** such call site in the app. Two are inside templates, where a missing `()`
renders a function object instead of a list and fails silently — check those first.

| File:line | Getter | Task |
| --- | --- | --- |
| `src/components/AddressModal.vue:80` | `getCountries` | 8 |
| `src/components/AddContactModal.vue:238` | `getCountries` | 8 |
| `src/components/AddContactModal.vue:329` | `getStates` | 8 |
| `src/views/BadAddressOrders.vue:125` | `getShipmentMethodOptions` | 8 |
| `src/views/BadAddressOrders.vue:128` | `getCountries` | 8 |
| `src/components/OrderQueueList.vue:230` | `getShipmentMethodOptions` | 9 |
| `src/views/SwapOrders.vue:161` | `getShipmentMethodOptions` | 9 |
| `src/views/OrderSearch.vue:242` | `getShipmentMethodOptions` | 9 |
| `src/views/HoldOrders.vue:145` | `getShipmentMethodOptions` | 9 |
| `src/views/OrderDetail.vue:806` | `getCountries` — **in template** | 10 |
| `src/views/OrderDetail.vue:962` | `getCountries` — **in template** | 10 |
| `src/views/OrderDetail.vue:2818` | `getStates` | 10 |
| `src/components/orders/ManageOrderIdentificationsModal.vue:161` | `orderIdentificationTypeOptions` | 10 |

Re-run this before declaring Task 10 done — it must return nothing but `()`-suffixed calls:

```bash
cd apps/order-manager
grep -rnE "\.(getCountries|getStates|getShipmentMethodOptions|orderIdentificationTypeOptions)\b[^(]" src
```
| `allowedTransitions(id)` | `allowedTransitions(id)` | unchanged |
| `productStores.byId[id]` | `productStore(id)` | |
| `facilities` (dataset) | `facilities()` | returns `Row[]` |
| `carriers.ids/.byId` | `carriers()` | returns `Row[]` |
| `shipmentMethodTypes.ids/.byId` | `shipmentMethodTypes()` | returns `Row[]` |
| `shopifyShops.ids/.byId` | `shopifyShops()` | returns `Row[]` |
| `shopifyShopLocations.byId` | `shopifyShopLocations()` | returns `Row[]` |
| `partyRelationshipTypes.ids/.byId` | `partyRelationshipTypes()` | returns `Row[]` |
| `roleTypes.ids/.byId` | `roleTypes()` | returns `Row[]` |
| `productStoreFacilitiesByStoreId[id].byId` | `productStoreFacilities(id)` | returns `Row[]` |
| `geoAssocStatus(c)` | **deleted** | geoAssocs are fully synced; use `ready()` if a gate is needed |
| `loadFacilities()` · `loadGeos()` · `loadGeoAssocs(c)` · `loadShopifyShops()` · `loadEnumType(t)` · `loadEnumsByParentType(p)` · `loadProductStoreSeedData(id)` · `loadInitialSeedData(ids)` | **deleted — remove the call** | the worker syncs all of it |
| `initSeedDb()` · `populateFromDb()` · `subscribeToDbUpdates()` | **deleted** — slices are lazy, there is no boot step |
| `resetSeedData()` | `resetSeedData()` from `@/db/useSeedData` | logout and OMS switch only |
| `createOrderIdentificationType(p)` | `createOrderIdentificationType(p)` in `@/services/orderIdentification` | moves to a service |

**Getters with zero call sites — do not port:** `contactPurposeDescription`, `communicationEventTypeDescription`, `returnTypeDescription`, `returnItemTypeDescription`, `roleTypeDescription`, `getCarrierOptions`, `getProductStoreShipmentMethodOptions`. Their tables stay indexed because `describe()` falls back through them.

## File Structure

**accxui repo (`common/`)**

| File | Responsibility |
| --- | --- |
| `common/db/dbClient.ts` *(create)* | Thin async ops over one `BaseDB`. No Vue, no app knowledge. |
| `common/db/useDb.ts` *(create)* | Single Vue composable over `dbClient.live`. Replaces `useDbList.ts`. |
| `common/db/useDbList.ts` *(delete)* | Zero consumers. |
| `common/db/baseDb.ts` *(modify)* | Remove `defineDbEntity`. Keep `BaseDB`, `clearDatabaseTables`, `ensureDbReady`, login markers. |
| `common/db/types.ts` *(modify)* | `DbRow` loses `raw`. Remove `DbEntity`. Rename `LiveQueryOptions` → `QueryOptions` with a back-compat alias. |
| `common/db/projection.ts` *(modify)* | `projectRow` stops emitting `raw`. |
| `common/db/useDbStatus.ts` *(modify)* | `SyncDomainCatalogItem` unchanged in shape; only the file's export list moves if needed. |
| `common/db/sync/appDbBootstrap.ts` *(modify)* | `shapeVersion` check before the worker starts. |
| `common/db/sync/snapshotDomain.ts` *(modify)* | Drop the dead `parent.raw?.[...]` fan-out fallback. |
| `common/db/domains/commonSeedEntities.ts` *(modify)* | Projection audit: `+myshopifyDomain`, `+domain` on shopify; `−wellKnownText` on geo. |
| `common/db/index.ts` *(modify)* | Export `dbClient`, `useDb`; stop exporting `useDbList`. |

**order-manager repo (`apps/order-manager/`)**

| File | Responsibility |
| --- | --- |
| `src/db/useSeedData.ts` *(create)* | The whole seed layer in one module: lazy reactive slices, secondary indexes, plain sync getters, `ensureLoaded`, `resetSeedData`, and the `useSeedData()` composable. |
| `src/db/orderManagerDb.ts` *(modify)* | Add the `omDb()` convenience wrapper. |
| `src/config/appSyncConfig.ts` *(modify)* | Add `shopifyShop`, `shopifyShopLocation`. |
| `src/services/orderIdentification.ts` *(create)* | `createOrderIdentificationType` — the one seed write. |
| `src/store/seed.ts` *(delete)* | |
| `src/App.vue` · `src/store/user.ts` *(modify)* | Boot wiring. |
| 40 consumer files *(modify)* | Tasks 7–10. |
| `tests/db/*.spec.ts` *(create)* | Tests for `dbClient`, `useDb`, `useSeedData`, projection. |
| `tests/store/seed.spec.ts` *(delete)* | Replaced by `tests/db/syncDomainUrls.spec.ts`. |

---

### Task 1: `dbClient` — thin async ops over Dexie

**Files:**
- Create: `common/db/dbClient.ts`
- Modify: `common/db/index.ts`
- Modify: `apps/order-manager/package.json` (add `fake-indexeddb` devDependency)
- Test: `apps/order-manager/tests/db/dbClient.spec.ts`

**Interfaces:**
- Consumes: `BaseDB` from `common/db/baseDb.ts`; `LiveQueryOptions` from `common/db/types.ts`.
- Produces: `dbClient(db: BaseDB): DbClient` with methods `get`, `getMany`, `all`, `query`, `first`, `count`, `put`, `bulkPut`, `remove`, `bulkRemove`, `clear`, `transaction`, `live`, `tableNames`, `raw`. Tasks 2, 6 and 7 depend on these exact names.

- [ ] **Step 1: Add the test dependency**

```bash
cd apps/order-manager
pnpm add -D fake-indexeddb
```

- [ ] **Step 2: Write the failing test**

Create `apps/order-manager/tests/db/dbClient.spec.ts`:

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { BaseDB, dbClient } from '@common/db';

const SCHEMA = { widgets: 'widgetId, kind', gadgets: 'gadgetId' };

function makeDb(name: string) {
  return new BaseDB(name, SCHEMA);
}

describe('dbClient', () => {
  let db: BaseDB;
  let client: ReturnType<typeof dbClient>;
  let n = 0;

  beforeEach(async () => {
    db = makeDb(`dbClientTest-${n++}`);
    await db.open();
    client = dbClient(db);
    await client.bulkPut('widgets', [
      { widgetId: 'W1', kind: 'red', syncedAt: 1 },
      { widgetId: 'W2', kind: 'blue', syncedAt: 2 },
      { widgetId: 'W3', kind: 'red', syncedAt: 3 },
    ]);
  });

  it('reads one row by primary key', async () => {
    expect(await client.get('widgets', 'W2')).toEqual({ widgetId: 'W2', kind: 'blue', syncedAt: 2 });
  });

  it('returns undefined for a missing key', async () => {
    expect(await client.get('widgets', 'NOPE')).toBeUndefined();
  });

  it('reads many rows by key', async () => {
    const rows = await client.getMany('widgets', ['W1', 'W3']);
    expect(rows.map((r: any) => r.widgetId)).toEqual(['W1', 'W3']);
  });

  it('reads a whole table', async () => {
    expect(await client.all('widgets')).toHaveLength(3);
  });

  it('filters by an indexed scope', async () => {
    const rows = await client.query('widgets', { scope: { field: 'kind', value: 'red' } });
    expect(rows.map((r: any) => r.widgetId).sort()).toEqual(['W1', 'W3']);
  });

  it('applies an in-memory filter and a limit', async () => {
    const rows = await client.query('widgets', {
      filter: (r: any) => r.widgetId !== 'W2',
      limit: 1,
    });
    expect(rows).toHaveLength(1);
  });

  it('counts rows', async () => {
    expect(await client.count('widgets')).toBe(3);
    expect(await client.count('widgets', { scope: { field: 'kind', value: 'blue' } })).toBe(1);
  });

  it('returns the first match or undefined', async () => {
    const hit = await client.first('widgets', { scope: { field: 'kind', value: 'blue' } });
    expect((hit as any)?.widgetId).toBe('W2');
    expect(await client.first('widgets', { scope: { field: 'kind', value: 'green' } })).toBeUndefined();
  });

  it('puts, removes and clears', async () => {
    await client.put('gadgets', { gadgetId: 'G1' });
    expect(await client.count('gadgets')).toBe(1);
    await client.remove('gadgets', 'G1');
    expect(await client.count('gadgets')).toBe(0);
    await client.bulkPut('gadgets', [{ gadgetId: 'G2' }, { gadgetId: 'G3' }]);
    await client.bulkRemove('gadgets', ['G2']);
    expect(await client.count('gadgets')).toBe(1);
    await client.clear('gadgets');
    expect(await client.count('gadgets')).toBe(0);
  });

  it('lists table names including syncMeta', () => {
    expect(client.tableNames()).toEqual(expect.arrayContaining(['widgets', 'gadgets', 'syncMeta']));
  });

  it('live emits immediately and again after a write', async () => {
    const seen: number[] = [];
    const sub = client.live('widgets').subscribe({ next: (rows: any[]) => seen.push(rows.length) });

    await new Promise((r) => setTimeout(r, 50));
    expect(seen.at(-1)).toBe(3);

    await client.put('widgets', { widgetId: 'W4', kind: 'green', syncedAt: 4 });
    await new Promise((r) => setTimeout(r, 100));
    expect(seen.at(-1)).toBe(4);

    sub.unsubscribe();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd apps/order-manager && npx vitest run tests/db/dbClient.spec.ts
```

Expected: FAIL — `dbClient` is not exported from `@common/db`.

- [ ] **Step 4: Implement `dbClient`**

Create `common/db/dbClient.ts`:

```ts
/**
 * Thin async operations layer over one Dexie database.
 *
 * Takes the BaseDB as a parameter rather than resolving the active OMS itself: the sync
 * worker loads this module and cannot import commonUtil, because that pins the @common
 * barrel into the worker chunk, which Vite must emit as a single iife.
 *
 * Reads return stored rows verbatim. There is no raw/projected distinction — a stored row
 * IS the projected row.
 */

import { liveQuery, type Observable, type Table } from "dexie";
import type { BaseDB } from "./baseDb";
import type { QueryOptions } from "./types";

export interface DbClient {
  get<T = Record<string, any>>(table: string, key: string): Promise<T | undefined>;
  getMany<T = Record<string, any>>(table: string, keys: string[]): Promise<T[]>;
  all<T = Record<string, any>>(table: string): Promise<T[]>;
  query<T = Record<string, any>>(table: string, options?: QueryOptions): Promise<T[]>;
  first<T = Record<string, any>>(table: string, options?: QueryOptions): Promise<T | undefined>;
  count(table: string, options?: QueryOptions): Promise<number>;

  put(table: string, record: unknown): Promise<void>;
  bulkPut(table: string, records: unknown[]): Promise<void>;
  remove(table: string, key: string): Promise<void>;
  bulkRemove(table: string, keys: string[]): Promise<void>;
  clear(table: string): Promise<void>;
  transaction<T>(mode: "r" | "rw", tables: string[], fn: () => Promise<T>): Promise<T>;

  live<T = Record<string, any>>(table: string, options?: QueryOptions): Observable<T[]>;

  tableNames(): string[];
  raw(): BaseDB;
}

/** Build a Dexie Collection for the given options. Mirrors the previous defineDbEntity logic. */
function buildQuery(tableRef: Table<any, string>, options: QueryOptions = {}) {
  let collection: any;

  if (options.scope) {
    collection = tableRef.where(options.scope.field).equals(options.scope.value as any);
  } else if (options.equals && Object.keys(options.equals).length > 0) {
    const [firstKey, firstVal] = Object.entries(options.equals)[0];
    collection = tableRef.where(firstKey).equals(firstVal as any);
  } else if (options.dateField) {
    if (options.since !== undefined && options.until !== undefined) {
      collection = tableRef.where(options.dateField).between(options.since, options.until, true, true);
    } else if (options.since !== undefined) {
      collection = tableRef.where(options.dateField).aboveOrEqual(options.since);
    } else if (options.until !== undefined) {
      collection = tableRef.where(options.dateField).belowOrEqual(options.until);
    } else {
      collection = tableRef.toCollection();
    }
  } else {
    collection = tableRef.toCollection();
  }

  if (options.order === "desc") collection = collection.reverse();
  if (options.filter) collection = collection.filter(options.filter);
  if (options.limit && options.limit > 0) collection = collection.limit(options.limit);

  return collection;
}

export function dbClient(db: BaseDB): DbClient {
  const tableOf = (table: string) => db.table<any, string>(table);

  return {
    async get(table, key) {
      if (!key) return undefined;
      return tableOf(table).get(key);
    },
    async getMany(table, keys) {
      if (!keys.length) return [];
      const rows = await tableOf(table).bulkGet(keys);
      return rows.filter(Boolean) as any[];
    },
    async all(table) {
      return tableOf(table).toArray();
    },
    async query(table, options = {}) {
      return buildQuery(tableOf(table), options).toArray();
    },
    async first(table, options = {}) {
      const rows = await buildQuery(tableOf(table), { ...options, limit: 1 }).toArray();
      return rows[0];
    },
    async count(table, options) {
      if (!options || Object.keys(options).length === 0) return tableOf(table).count();
      return buildQuery(tableOf(table), options).count();
    },

    async put(table, record) {
      await tableOf(table).put(record as any);
    },
    async bulkPut(table, records) {
      if (!records.length) return;
      await tableOf(table).bulkPut(records as any[]);
    },
    async remove(table, key) {
      await tableOf(table).delete(key);
    },
    async bulkRemove(table, keys) {
      if (!keys.length) return;
      await tableOf(table).bulkDelete(keys);
    },
    async clear(table) {
      await tableOf(table).clear();
    },
    transaction(mode, tables, fn) {
      return db.transaction(mode, tables, fn) as Promise<any>;
    },

    live(table, options = {}) {
      return liveQuery(async () => buildQuery(tableOf(table), options).toArray()) as any;
    },

    tableNames() {
      return db.getTableNames();
    },
    raw() {
      return db;
    },
  };
}
```

- [ ] **Step 5: Add `QueryOptions` to types**

In `common/db/types.ts`, rename the interface and keep a back-compat alias so nothing breaks mid-plan:

```ts
export interface QueryOptions {
  /** Filter by an indexed field via where(scope.field).equals(scope.value). */
  scope?: { field: string; value: unknown };
  /** Multiple equalities resolved through an indexed field. */
  equals?: Record<string, unknown>;
  /** Restrict to rows on or after this timestamp millis. */
  since?: number;
  /** Restrict to rows on or before this timestamp millis. */
  until?: number;
  /** Date field to apply since/until bounds to. */
  dateField?: string;
  /** In-memory predicate applied to the matched set. */
  filter?: (row: Record<string, any>) => boolean;
  /** Maximum number of records to return. */
  limit?: number;
  /** Sort order for indexed queries. */
  order?: "asc" | "desc";
}

/** @deprecated Use QueryOptions. Removed once useDbList is gone (Task 2). */
export type LiveQueryOptions = QueryOptions;
```

- [ ] **Step 6: Export from the barrel**

In `common/db/index.ts`, add after the `baseDb` export:

```ts
export * from "./dbClient";
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd apps/order-manager && npx vitest run tests/db/dbClient.spec.ts
```

Expected: PASS, 11 tests.

- [ ] **Step 8: Run the full suite**

```bash
cd apps/order-manager && npx vitest run
```

Expected: 90 files / 473 tests passing (baseline 89/462 plus this file).

- [ ] **Step 9: Commit both repos**

```bash
cd /Users/ravi/ofbiz_dev/hc/my_workspace/accxui
git add common/db/dbClient.ts common/db/types.ts common/db/index.ts
git commit -m "feat(db): add dbClient, a thin async ops layer over Dexie"
cd apps/order-manager
git add package.json tests/db/dbClient.spec.ts
git commit -m "test(db): cover dbClient against fake-indexeddb"
```

---

### Task 2: Single `useDb` composable

**Files:**
- Create: `common/db/useDb.ts`
- Delete: `common/db/useDbList.ts`
- Modify: `common/db/index.ts`, `common/db/types.ts`, `common/db/baseDb.ts`
- Test: `apps/order-manager/tests/db/useDb.spec.ts`

**Interfaces:**
- Consumes: `dbClient` (Task 1), `bootstrapState` from `common/db/sync/appDbBootstrap.ts`.
- Produces: `useDb<T>(db, table, options?) → { records: Ref<T[]>, first: Ref<T|undefined>, count: Ref<number>, hydrated: Ref<boolean>, error: Ref<Error|null> }`. Nothing later in this plan consumes it — it is the sanctioned path for future reactive reads.

- [ ] **Step 1: Write the failing test**

Create `apps/order-manager/tests/db/useDb.spec.ts`:

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';
import { BaseDB, dbClient, useDb } from '@common/db';

const SCHEMA = { widgets: 'widgetId, kind' };
let n = 0;

async function seeded() {
  const db = new BaseDB(`useDbTest-${n++}`, SCHEMA);
  await db.open();
  await dbClient(db).bulkPut('widgets', [
    { widgetId: 'W1', kind: 'red' },
    { widgetId: 'W2', kind: 'blue' },
  ]);
  return db;
}

const flush = () => new Promise((r) => setTimeout(r, 60));

describe('useDb', () => {
  let db: BaseDB;
  beforeEach(async () => { db = await seeded(); });

  it('exposes records, count and first', async () => {
    let api: any;
    const C = defineComponent({ setup() { api = useDb(db, 'widgets'); return () => h('div'); } });
    const w = mount(C);
    await flush();

    expect(api.records.value).toHaveLength(2);
    expect(api.count.value).toBe(2);
    expect(api.first.value.widgetId).toBe('W1');
    expect(api.hydrated.value).toBe(true);
    w.unmount();
  });

  it('first resolves a single record via an equals option', async () => {
    let api: any;
    const C = defineComponent({
      setup() { api = useDb(db, 'widgets', { equals: { widgetId: 'W2' } }); return () => h('div'); },
    });
    const w = mount(C);
    await flush();

    expect(api.first.value.kind).toBe('blue');
    w.unmount();
  });

  it('re-subscribes when reactive options change', async () => {
    const kind = ref('red');
    let api: any;
    const C = defineComponent({
      setup() {
        api = useDb(db, 'widgets', () => ({ scope: { field: 'kind', value: kind.value } }));
        return () => h('div');
      },
    });
    const w = mount(C);
    await flush();
    expect(api.first.value.widgetId).toBe('W1');

    kind.value = 'blue';
    await nextTick();
    await flush();
    expect(api.first.value.widgetId).toBe('W2');
    w.unmount();
  });

  it('reflects writes made after mount', async () => {
    let api: any;
    const C = defineComponent({ setup() { api = useDb(db, 'widgets'); return () => h('div'); } });
    const w = mount(C);
    await flush();

    await dbClient(db).put('widgets', { widgetId: 'W3', kind: 'green' });
    await flush();
    expect(api.count.value).toBe(3);
    w.unmount();
  });

  it('unsubscribes on unmount', async () => {
    let api: any;
    const C = defineComponent({ setup() { api = useDb(db, 'widgets'); return () => h('div'); } });
    const w = mount(C);
    await flush();
    const before = api.count.value;

    w.unmount();
    await dbClient(db).put('widgets', { widgetId: 'W9', kind: 'grey' });
    await flush();
    expect(api.count.value).toBe(before);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/order-manager && npx vitest run tests/db/useDb.spec.ts
```

Expected: FAIL — `useDb` is not exported from `@common/db`.

- [ ] **Step 3: Implement `useDb`**

Create `common/db/useDb.ts`:

```ts
/**
 * The single reactive read composable over a local Dexie database.
 *
 * One entry point and one return shape: always a list, with `first` as a computed for the
 * single-record case. Reading one row through `equals` on the primary key is an index
 * lookup in Dexie, the same work `get()` does, so there is no separate record composable.
 */

import { computed, onUnmounted, ref, shallowRef, watch, type Ref } from "vue";
import type { Subscription } from "dexie";
import type { BaseDB } from "./baseDb";
import { dbClient } from "./dbClient";
import type { QueryOptions } from "./types";
import { bootstrapState } from "./sync/appDbBootstrap";

export interface DbListResult<T = Record<string, any>> {
  records: Ref<T[]>;
  /** The first matching record. Undefined means "no match" OR "not hydrated yet" — check `hydrated`. */
  first: Ref<T | undefined>;
  count: Ref<number>;
  hydrated: Ref<boolean>;
  error: Ref<Error | null>;
}

type OptionsSource = QueryOptions | (() => QueryOptions) | undefined;

export function useDb<T = Record<string, any>>(
  db: BaseDB,
  table: string,
  options?: OptionsSource,
): DbListResult<T> {
  const records = shallowRef<T[]>([]) as Ref<T[]>;
  const emitted = ref(false);
  const error = ref<Error | null>(null);

  const resolvedOptions = computed<QueryOptions>(() =>
    typeof options === "function" ? options() : options ?? {},
  );

  const first = computed(() => records.value[0]);
  const count = computed(() => records.value.length);
  const hydrated = computed(() => emitted.value && (records.value.length > 0 || !bootstrapState.running));

  let subscription: Subscription | null = null;

  function subscribe(currentOptions: QueryOptions) {
    subscription?.unsubscribe();
    subscription = null;

    try {
      subscription = dbClient(db).live<T>(table, currentOptions).subscribe({
        next: (rows) => {
          records.value = rows;
          emitted.value = true;
          error.value = null;
        },
        error: (err: any) => {
          console.error(`[useDb] liveQuery error on ${table}:`, err);
          error.value = err instanceof Error ? err : new Error(String(err));
          emitted.value = true;
        },
      });
    } catch (err: any) {
      console.error(`[useDb] Failed to subscribe to ${table}:`, err);
      error.value = err instanceof Error ? err : new Error(String(err));
      emitted.value = true;
    }
  }

  watch(resolvedOptions, (next) => subscribe(next), { immediate: true, deep: true });

  onUnmounted(() => {
    subscription?.unsubscribe();
    subscription = null;
  });

  return { records, first, count, hydrated, error };
}
```

- [ ] **Step 4: Delete `useDbList` and `defineDbEntity`**

```bash
cd /Users/ravi/ofbiz_dev/hc/my_workspace/accxui
rm common/db/useDbList.ts
```

In `common/db/index.ts` replace the `useDbList` export line with the new one:

```ts
export * from "./useDb";
```

In `common/db/baseDb.ts`, delete the entire `defineDbEntity` function and its now-unused imports. The file's remaining exports are `BaseDB`, `clearDatabaseTables`, `hasSyncedThisLogin`, `markSyncedThisLogin`, `ensureDbReady`. The import line becomes:

```ts
import Dexie, { type Table } from "dexie";
```

In `common/db/types.ts`, delete the `DbEntity` interface and the now-unused `Observable` import, and delete the `LiveQueryOptions` deprecated alias added in Task 1.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/order-manager && npx vitest run tests/db/useDb.spec.ts
```

Expected: PASS, 5 tests.

- [ ] **Step 6: Verify nothing else referenced the deleted symbols**

```bash
cd /Users/ravi/ofbiz_dev/hc/my_workspace/accxui
grep -rn "useDbList\|useDbRecord\|defineDbEntity\|DbEntity\|LiveQueryOptions" common apps --include=*.ts --include=*.vue | grep -v node_modules | grep -v "/dist/"
```

Expected: no output. If `common/tests/projection.spec.ts` appears, ignore it — that suite never runs (see Global Constraints) and is updated in Task 4.

- [ ] **Step 7: Run the full suite and commit**

```bash
cd apps/order-manager && npx vitest run
```

Expected: 91 files / 478 tests passing.

```bash
cd /Users/ravi/ofbiz_dev/hc/my_workspace/accxui
git add common/db/useDb.ts common/db/index.ts common/db/baseDb.ts common/db/types.ts
git rm common/db/useDbList.ts
git commit -m "feat(db): replace useDbList/useDbRecord with a single useDb composable"
cd apps/order-manager
git add tests/db/useDb.spec.ts
git commit -m "test(db): cover useDb subscription, re-subscription and teardown"
```

---

### Task 3: Projection audit

**Files:**
- Modify: `common/db/domains/commonSeedEntities.ts`
- Test: `apps/order-manager/tests/db/projections.spec.ts`

**Interfaces:**
- Consumes: `EntityProjection` from `common/db/types.ts`.
- Produces: `shopifyShopProjection` gains `myshopifyDomain` and `domain`; `geoProjection` loses `wellKnownText`. Task 4 depends on these being correct before `raw` is removed.

- [ ] **Step 1: Write the failing test**

Create `apps/order-manager/tests/db/projections.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ORDER_MANAGER_SYNC_CATALOG,
} from '@/config/appSyncConfig';
import {
  COMMON_DB_SCHEMA,
  geoProjection,
  shopifyShopProjection,
} from '@common/db';

describe('seed projections', () => {
  it('projects the shopify fields OrderDetail reads for the admin link', () => {
    expect(Object.keys(shopifyShopProjection.fields)).toEqual(
      expect.arrayContaining(['shopId', 'productStoreId', 'name', 'myshopifyDomain', 'domain']),
    );
  });

  it('does not project geo polygon geometry', () => {
    expect(Object.keys(geoProjection.fields)).not.toContain('wellKnownText');
  });

  it('projects every geo field the seed getters read', () => {
    expect(Object.keys(geoProjection.fields)).toEqual(
      expect.arrayContaining(['geoId', 'geoName', 'geoCode', 'geoCodeAlpha2', 'geoTypeEnumId']),
    );
  });

  it('every catalog table exists in the schema', () => {
    for (const entry of ORDER_MANAGER_SYNC_CATALOG) {
      expect(COMMON_DB_SCHEMA[entry.table], `missing schema for ${entry.table}`).toBeDefined();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/order-manager && npx vitest run tests/db/projections.spec.ts
```

Expected: FAIL on the shopify and geo assertions.

- [ ] **Step 3: Apply the projection changes**

In `common/db/domains/commonSeedEntities.ts`, update `shopifyShopProjection`:

```ts
export const shopifyShopProjection: EntityProjection = {
  keyField: "shopId",
  fields: {
    shopId: "text",
    productStoreId: "text",
    shopifyShopId: "text",
    name: "text",
    // Read by views/OrderDetail.vue to build the Shopify admin order link.
    myshopifyDomain: "text",
    domain: "text",
    systemMessageRemoteId: "text",
  },
};
```

And remove the `wellKnownText` line from `geoProjection`:

```ts
export const geoProjection: EntityProjection = {
  keyField: "geoId",
  fields: {
    geoId: "text",
    geoTypeEnumId: "text",
    geoName: "text",
    geoCode: "text",
    geoCodeAlpha2: "text",
    geoCodeAlpha3: "text",
  },
};
```

- [ ] **Step 4: Audit the remaining projections against consumer reads**

Run this and confirm every field name it prints is present in the matching projection in `common/db/domains/commonSeedEntities.ts`. Add any missing field with the appropriate `FieldKind` (`text`, `count`, `date`, or `structured`).

```bash
cd apps/order-manager
grep -rnoE "\.(facilityName|facilityTypeId|parentTypeId|storeName|companyName|geoName|geoCode|geoCodeAlpha2|geoTypeEnumId|firstName|lastName|groupName|statusAge|statusTypeId|enumTypeId|enumCode|sequenceNum|transitionSequence|toStatusId|shipmentMethodTypeId|partyId|carrierPartyId|settingValue|myshopifyDomain|domain|shopifyLocationId)\b" src | sed -E 's/.*\.//' | sort -u
```

Already verified as covered during design: `parentTypeId`, `facilityTypeId` (`facilityProjection`), `shopId`/`productStoreId` (`shopifyShopProjection`), `firstName`/`lastName`/`groupName` (`carrierProjection`), `statusAge` (`statusProjection`), `facilityName` (`facilityProjection`), all geo fields above.

- [ ] **Step 5: Run the test to verify it passes**

```bash
cd apps/order-manager && npx vitest run tests/db/projections.spec.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
cd /Users/ravi/ofbiz_dev/hc/my_workspace/accxui
git add common/db/domains/commonSeedEntities.ts
git commit -m "fix(db): project shopify domain fields, drop unread geo geometry"
cd apps/order-manager
git add tests/db/projections.spec.ts
git commit -m "test(db): assert projections cover every field consumers read"
```

---

### Task 4: Drop `raw` from stored rows

**Files:**
- Modify: `common/db/types.ts`, `common/db/projection.ts`, `common/db/sync/snapshotDomain.ts`, `common/db/sync/appDbBootstrap.ts`, `common/tests/projection.spec.ts`
- Test: `apps/order-manager/tests/db/projectRow.spec.ts`

**Interfaces:**
- Consumes: `EntityProjection`, `BaseDB`, `clearDatabaseTables`.
- Produces: `DbRow` = projected fields + `syncedAt`. `projectRow(raw, projection, now)` no longer emits `raw`. `DB_SHAPE_VERSION` constant exported from `common/db/sync/appDbBootstrap.ts`. Task 6 relies on stored rows being flat.

- [ ] **Step 1: Write the failing test**

Create `apps/order-manager/tests/db/projectRow.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { projectRow, projectRows } from '@common/db';
import type { EntityProjection } from '@common/db';

const projection: EntityProjection = {
  keyField: 'transitionKey',
  fields: {
    transitionKey: 'text',
    statusId: 'text',
    toStatusId: 'text',
    transitionSequence: 'count',
  },
  buildKey: (raw: any) =>
    raw?.statusId && raw?.toStatusId ? `${raw.statusId}|${raw.toStatusId}` : undefined,
};

describe('projectRow', () => {
  const raw = {
    statusId: 'ORDER_CREATED',
    toStatusId: 'ORDER_APPROVED',
    transitionSequence: '2',
    unprojectedNoise: { big: 'payload' },
  };

  it('does not store the raw server payload', () => {
    const row = projectRow(raw, projection, 1000) as any;
    expect(row.raw).toBeUndefined();
    expect(row.unprojectedNoise).toBeUndefined();
  });

  it('keeps syncedAt', () => {
    expect((projectRow(raw, projection, 1000) as any).syncedAt).toBe(1000);
  });

  it('keeps the synthetic composite key and coerced fields', () => {
    const row = projectRow(raw, projection, 1000) as any;
    expect(row.transitionKey).toBe('ORDER_CREATED|ORDER_APPROVED');
    expect(row.transitionSequence).toBe(2);
  });

  it('drops records with no usable key', () => {
    expect(projectRow({ toStatusId: 'X' }, projection, 1000)).toBeNull();
    expect(projectRows([raw, { toStatusId: 'X' }], projection, 1000)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/order-manager && npx vitest run tests/db/projectRow.spec.ts
```

Expected: FAIL — `row.raw` is defined.

- [ ] **Step 3: Remove `raw` from the row type**

In `common/db/types.ts`:

```ts
/** A stored row: the projected fields, plus when they were synced. */
export interface DbRow {
  [field: string]: unknown;
  syncedAt: number;
}
```

- [ ] **Step 4: Stop emitting `raw`**

In `common/db/projection.ts`, change the final return of `projectRow`:

```ts
  return { ...row, syncedAt: now } as DbRow;
```

- [ ] **Step 5: Remove the dead fan-out fallback**

In `common/db/sync/snapshotDomain.ts:58`, the parent lookup no longer needs a `raw` fallback:

```ts
          const parentId = String(parent[config.fanOut.parentKeyField] || "");
```

- [ ] **Step 6: Add the one-time shape migration**

In `common/db/sync/appDbBootstrap.ts`, add near the top after the imports:

```ts
/**
 * Bumped whenever the stored row shape changes in a way existing rows cannot satisfy.
 * On mismatch the data tables are cleared once and the worker refills them.
 * v2: `raw` removed from stored rows.
 */
export const DB_SHAPE_VERSION = 2;
const SHAPE_MARKER_KEY = "dbShapeVersion";

async function ensureRowShape(db: BaseDB): Promise<void> {
  try {
    const marker = await db.syncMeta.get(SHAPE_MARKER_KEY);
    if (Number(marker?.version) === DB_SHAPE_VERSION) return;

    console.info(`[db-bootstrap] Row shape changed, clearing local tables for ${db.name}.`);
    await clearDatabaseTables(db);
    await db.syncMeta.put({ key: SHAPE_MARKER_KEY, version: DB_SHAPE_VERSION, timestamp: Date.now() });
  } catch (error) {
    console.warn("[db-bootstrap] Row shape check failed:", error);
  }
}
```

Then call it inside `startDbBootstrap`, before the worker is created:

```ts
export async function startDbBootstrap(config: BootstrapConfig): Promise<void> {
  currentDb = config.db;
  bootstrapState.running = true;
  bootstrapState.error = null;

  try {
    await ensureRowShape(config.db);

    if (!workerInstance) {
      workerInstance = config.workerFactory();
      harnessProxy = wrap<SyncHarness>(workerInstance);
    }
    // …unchanged from here
```

`clearDatabaseTables` is already imported in this file.

- [ ] **Step 7: Update the orphaned common spec**

In `common/tests/projection.spec.ts`, remove the `raw` assertion and the `syncedAt: 12345` fixture's `raw` expectation so the file matches the new shape. This suite is not wired into any runner (see Global Constraints); it is updated for correctness, not because it gates anything.

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd apps/order-manager && npx vitest run tests/db/projectRow.spec.ts tests/db/dbClient.spec.ts
```

Expected: PASS.

- [ ] **Step 9: Run the full suite and commit**

```bash
cd apps/order-manager && npx vitest run
```

Expected: 93 files / 486 tests passing.

```bash
cd /Users/ravi/ofbiz_dev/hc/my_workspace/accxui
git add common/db/types.ts common/db/projection.ts common/db/sync/snapshotDomain.ts common/db/sync/appDbBootstrap.ts common/tests/projection.spec.ts
git commit -m "refactor(db): store projected rows only, drop the raw payload copy"
cd apps/order-manager
git add tests/db/projectRow.spec.ts
git commit -m "test(db): assert stored rows carry no raw payload"
```

---

### Task 5: Add the missing Shopify sync domains

**Files:**
- Modify: `apps/order-manager/src/config/appSyncConfig.ts`
- Test: `apps/order-manager/tests/db/syncCatalog.spec.ts`

**Interfaces:**
- Consumes: `SyncDomainCatalogItem` from `@common/db`.
- Produces: `ORDER_MANAGER_SYNC_CATALOG` with 29 entries. Task 6 hydrates one index slice per entry.

**Context:** `shopifyShop` and `shopifyShopLocation` are registered in `common/db/domains/commonSeedDomains.ts` but absent from the app catalog, so they never sync. `views/CreateOrder.vue:327` and `views/OrderDetail.vue:1163` work today only because the REST loaders fill the store. Without this task, Task 11 breaks those screens.

- [ ] **Step 1: Write the failing test**

Create `apps/order-manager/tests/db/syncCatalog.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ORDER_MANAGER_SYNC_CATALOG } from '@/config/appSyncConfig';

describe('order manager sync catalog', () => {
  const names = ORDER_MANAGER_SYNC_CATALOG.map((d) => d.name);

  it('syncs the shopify domains the order and create-order screens read', () => {
    expect(names).toContain('shopifyShop');
    expect(names).toContain('shopifyShopLocation');
  });

  it('has no duplicate domain names or tables', () => {
    expect(new Set(names).size).toBe(names.length);
    const tables = ORDER_MANAGER_SYNC_CATALOG.map((d) => d.table);
    expect(new Set(tables).size).toBe(tables.length);
  });

  it('gives every entry a label for the Settings screen', () => {
    for (const entry of ORDER_MANAGER_SYNC_CATALOG) {
      expect(entry.label, `missing label for ${entry.name}`).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/order-manager && npx vitest run tests/db/syncCatalog.spec.ts
```

Expected: FAIL — `shopifyShop` not in the catalog.

- [ ] **Step 3: Add the two entries**

At the end of the array in `src/config/appSyncConfig.ts`, before the closing bracket:

```ts
  { name: "shopifyShop", table: "shopifyShops", label: "Shopify Shops", syncClass: "B" },
  { name: "shopifyShopLocation", table: "shopifyShopLocations", label: "Shopify Locations", syncClass: "B" },
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
cd apps/order-manager && npx vitest run tests/db/syncCatalog.spec.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
cd apps/order-manager
git add src/config/appSyncConfig.ts tests/db/syncCatalog.spec.ts
git commit -m "fix(sync): sync the shopify shop and location domains"
```

---

### Task 6: `useSeedData.ts` — lazy reactive slices

**Files:**
- Create: `apps/order-manager/src/db/useSeedData.ts`
- Create: `apps/order-manager/src/services/orderIdentification.ts`
- Modify: `apps/order-manager/src/db/orderManagerDb.ts`, `apps/order-manager/src/store/user.ts`
- Test: `apps/order-manager/tests/db/useSeedData.spec.ts`

**Interfaces:**
- Consumes: `dbClient`, `BaseDB` from `@common/db`; `getOrderManagerDb`.
- Produces: from `@/db/useSeedData` — `useSeedData()`, `ensureLoaded(tables)`,
  `resetSeedData()`, `seedVersionOf(table)`, and every plain getter in the Global
  Constraints mapping table. Also `createOrderIdentificationType` from
  `@/services/orderIdentification`. Tasks 7–11 consume these exact names.

**Design note:** there is no separate index module, no catalog wiring and no boot hydration.
A slice is created the first time something asks for its table: the getter returns the raw
id immediately, an async read starts, and when it lands the slice's `shallowRef` is
replaced, so any computed that read it re-evaluates. Only tables a session touches are ever
loaded. The one rule this imposes is `ensureLoaded`, applied in Task 7.

**Note:** the seed Pinia store still exists and is still wired in after this task. Both paths
run side by side so the slices can be validated before anything depends on them. Task 11
removes the store.

- [ ] **Step 1: Write the failing test**

Create `apps/order-manager/tests/db/useSeedData.spec.ts`:

```ts
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import { BaseDB, COMMON_DB_SCHEMA, dbClient } from '@common/db';
import * as seed from '@/db/useSeedData';
import { useSeedData } from '@/db/useSeedData';

const flush = (ms = 250) => new Promise((r) => setTimeout(r, ms));
let n = 0;
let db: BaseDB;

async function seedDb() {
  db = new BaseDB(`useSeedDataTest-${n++}`, COMMON_DB_SCHEMA);
  await db.open();
  const c = dbClient(db);
  await c.bulkPut('statuses', [
    { statusId: 'ORDER_APPROVED', statusTypeId: 'ORDER_STATUS', description: 'Approved', statusAge: 5, syncedAt: 1 },
    { statusId: 'ORDER_CREATED', statusTypeId: 'ORDER_STATUS', description: 'Created', syncedAt: 1 },
  ]);
  await c.bulkPut('enums', [
    { enumId: 'WEB_CHANNEL', enumTypeId: 'ORDER_SALES_CHANNEL', description: 'Web', syncedAt: 1 },
    { enumId: 'WE_PICK', enumTypeId: 'WePurposeChild', description: 'Picking', syncedAt: 1 },
  ]);
  await c.bulkPut('enumTypes', [{ enumTypeId: 'WePurposeChild', parentTypeId: 'WorkEffortPurposeType', syncedAt: 1 }]);
  await c.bulkPut('facilities', [{ facilityId: 'F1', facilityName: 'Main Warehouse', facilityTypeId: 'WAREHOUSE', syncedAt: 1 }]);
  await c.bulkPut('geos', [
    { geoId: 'USA', geoName: 'United States', geoCodeAlpha2: 'US', geoTypeEnumId: 'GEOT_COUNTRY', syncedAt: 1 },
    { geoId: 'USA_CA', geoName: 'California', geoCode: 'CA', geoTypeEnumId: 'GEOT_STATE', syncedAt: 1 },
  ]);
  await c.bulkPut('geoAssocs', [{ geoAssocKey: 'USA|USA_CA', geoId: 'USA', toGeoId: 'USA_CA', syncedAt: 1 }]);
  await c.bulkPut('roleTypes', [{ roleTypeId: 'CARRIER', description: 'Carrier', syncedAt: 1 }]);
  await c.bulkPut('statusFlowTransitions', [
    { transitionKey: 'ORDER_CREATED|ORDER_APPROVED', statusId: 'ORDER_CREATED', toStatusId: 'ORDER_APPROVED', transitionSequence: 1, syncedAt: 1 },
  ]);
  return c;
}

describe('useSeedData module', () => {
  beforeEach(async () => { await seedDb(); seed.__setDbResolver(() => db); });
  afterEach(() => { seed.resetSeedData(); });

  it('a cold getter returns the raw id, then resolves on the next tick', async () => {
    expect(seed.facilityName('F1')).toBe('F1');
    await flush();
    expect(seed.facilityName('F1')).toBe('Main Warehouse');
  });

  it('ensureLoaded resolves only once the named tables are populated', async () => {
    await dbClient(db).put('syncMeta', { key: 'loginSync:status', synced: true, timestamp: 1 });
    await dbClient(db).put('syncMeta', { key: 'loginSync:facility', synced: true, timestamp: 1 });

    await seed.ensureLoaded(['statuses', 'facilities']);
    expect(seed.statusDescription('ORDER_APPROVED')).toBe('Approved');
    expect(seed.facilityName('F1')).toBe('Main Warehouse');
  });

  it('ensureLoaded waits for the domain to sync, then sees the rows', async () => {
    const empty = new BaseDB(`useSeedDataCold-${n++}`, COMMON_DB_SCHEMA);
    await empty.open();
    seed.__setDbResolver(() => empty);

    let resolved = false;
    const pending = seed.ensureLoaded(['facilities']).then(() => { resolved = true; });

    await flush(80);
    expect(resolved).toBe(false);            // no rows, no marker -> still waiting

    await dbClient(empty).bulkPut('facilities', [{ facilityId: 'LATE', facilityName: 'Late Facility', syncedAt: 9 }]);
    await dbClient(empty).put('syncMeta', { key: 'loginSync:facility', synced: true, timestamp: 9 });

    await pending;
    expect(resolved).toBe(true);
    expect(seed.facilityName('LATE')).toBe('Late Facility');
  });

  it('ensureLoaded gives up after the timeout rather than hanging', async () => {
    const empty = new BaseDB(`useSeedDataStalled-${n++}`, COMMON_DB_SCHEMA);
    await empty.open();
    seed.__setDbResolver(() => empty);

    await seed.ensureLoaded(['facilities']);   // never synced; must still resolve
    expect(seed.facilityName('F1')).toBe('F1');
  }, 10000);

  it('describe falls through statuses, enums then lookup tables', async () => {
    await seed.ensureLoaded(['statuses', 'enums', 'roleTypes']);
    expect(seed.describe('ORDER_APPROVED')).toBe('Approved');
    expect(seed.describe('WEB_CHANNEL')).toBe('Web');
    expect(seed.describe('CARRIER')).toBe('Carrier');
  });

  it('returns the raw id on a genuine miss', async () => {
    await seed.ensureLoaded(['statuses', 'enums', 'facilities']);
    expect(seed.describe('NOT_A_THING')).toBe('NOT_A_THING');
    expect(seed.facilityName('NOPE')).toBe('NOPE');
    expect(seed.describe('')).toBe('');
  });

  it('resolves geos and builds the geoAssoc secondary index', async () => {
    await seed.ensureLoaded(['geos', 'geoAssocs']);
    expect(seed.geoName('USA')).toBe('United States');
    expect(seed.getGeoIdByCode('US')).toBe('USA');
    expect(seed.getCountries().map((g: any) => g.geoId)).toEqual(['USA']);
    expect(seed.getStates().map((g: any) => g.geoId)).toEqual(['USA_CA']);
    expect(seed.getStatesForCountry('USA').map((g: any) => g.geoId)).toEqual(['USA_CA']);
    expect(seed.getStatesForCountry('IND')).toEqual([]);
  });

  it('builds the status and enum type secondary indexes', async () => {
    await seed.ensureLoaded(['statuses', 'enums', 'enumTypes']);
    expect(seed.getStatusItemsByType('ORDER_STATUS')).toHaveLength(2);
    expect(seed.getEnumsByType('ORDER_SALES_CHANNEL')).toHaveLength(1);
    expect(seed.getEnumsByParentType('WorkEffortPurposeType').map((e: any) => e.enumId)).toEqual(['WE_PICK']);
  });

  it('resolves status flow transitions with descriptions', async () => {
    await seed.ensureLoaded(['statuses', 'statusFlowTransitions']);
    const transitions = seed.allowedTransitions('ORDER_CREATED');
    expect(transitions).toHaveLength(1);
    expect(transitions[0].toStatusDescription).toBe('Approved');
  });

  it('replaces a slice when its table changes', async () => {
    await seed.ensureLoaded(['facilities']);
    await dbClient(db).put('facilities', { facilityId: 'F2', facilityName: 'Overflow', syncedAt: 2 });
    await flush();
    expect(seed.facilityName('F2')).toBe('Overflow');
  });

  it('collapses a burst of writes into one rebuild', async () => {
    await seed.ensureLoaded(['facilities']);
    const c = dbClient(db);
    await c.put('facilities', { facilityId: 'A', facilityName: 'A', syncedAt: 2 });
    await c.put('facilities', { facilityId: 'B', facilityName: 'B', syncedAt: 2 });
    await c.put('facilities', { facilityId: 'C', facilityName: 'C', syncedAt: 2 });
    await flush();
    expect(seed.facilityName('C')).toBe('C');
  });

  it('resetSeedData drops slices and stops reacting to writes', async () => {
    await seed.ensureLoaded(['facilities']);
    seed.resetSeedData();
    expect(seed.facilityName('F1')).toBe('F1');

    await dbClient(db).put('facilities', { facilityId: 'F9', facilityName: 'Late', syncedAt: 3 });
    await flush();
    // The slice was dropped, so the write is not observed until something asks again.
    expect(seed.facilityName('F9')).toBe('F9');
  });

  it('a component computed self-corrects when the slice fills', async () => {
    const C = defineComponent({
      setup() {
        const s = useSeedData();
        return () => h('div', s.facilityName('F1'));
      },
    });
    const w = mount(C);
    expect(w.text()).toBe('F1');

    await flush();
    await nextTick();
    expect(w.text()).toBe('Main Warehouse');
    w.unmount();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd apps/order-manager && npx vitest run tests/db/useSeedData.spec.ts
```

Expected: FAIL — `@/db/useSeedData` does not exist.

- [ ] **Step 3: Add the `omDb()` wrapper**

Append to `apps/order-manager/src/db/orderManagerDb.ts`:

```ts
import { commonUtil } from "@common";
import { dbClient, type DbClient } from "@common/db";

/**
 * The dbClient for the signed-in OMS instance. Resolved per call so reads follow an
 * instance switch. Never import this from the sync worker — it pulls in commonUtil.
 */
export function omDb(): DbClient {
  return dbClient(getOrderManagerDb(commonUtil.getOMSInstanceName()));
}
```

- [ ] **Step 4: Implement the module**

Create `apps/order-manager/src/db/useSeedData.ts`:

```ts
/**
 * Seed lookups, backed entirely by the local database.
 *
 * One module owns the state, the subscriptions, the synchronous getters and the composable.
 * There is no separate index module and no boot hydration: a slice is created the first time
 * something asks for its table, so only tables a session actually touches are ever read.
 *
 * A plain module rather than a composable or a store, because `store/order.ts`,
 * `utils/badAddressState.ts` and `services/order.ts` need synchronous lookups outside any
 * component. Components use `useSeedData()`; everything else imports the plain functions.
 *
 * Dexie is the source of truth. These slices are derived and read-only, with exactly one
 * writer: the liveQuery subscription per table. Nothing here fetches from the network.
 */

import { shallowRef, type ShallowRef } from "vue";
import type { Subscription } from "dexie";
import { commonUtil } from "@common";
import type { BaseDB, DbClient } from "@common/db";
import { dbClient, hasSyncedThisLogin } from "@common/db";
import { getOrderManagerDb } from "@/db/orderManagerDb";
import { ORDER_MANAGER_SYNC_CATALOG } from "@/config/appSyncConfig";

type Row = Record<string, any>;

/** Trailing debounce. The enum domain writes in 500-row batches; without this each batch rebuilds. */
const REBUILD_DEBOUNCE_MS = 150;

const slices = new Map<string, ShallowRef<Map<string, Row>>>();
const subscriptions = new Map<string, Subscription>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();
const loading = new Map<string, Promise<void>>();

/** Overridable in tests so a slice can be built against a fixture database. */
let resolveDb: () => BaseDB = () => getOrderManagerDb(commonUtil.getOMSInstanceName());
export function __setDbResolver(resolver: () => BaseDB) { resolveDb = resolver; }

// ── Secondary indexes, rebuilt with their source slice ────────────────────────────────
let statusesByType = new Map<string, Row[]>();
let enumsByType = new Map<string, Row[]>();
let enumChildTypesByParent = new Map<string, string[]>();
let geoAssocsByCountry = new Map<string, string[]>();
let carrierShipmentMethodsByParty = new Map<string, Row[]>();
let transitionsByStatus = new Map<string, Row[]>();

// ── Slice plumbing ────────────────────────────────────────────────────────────────────

function keyFieldOf(db: BaseDB, table: string): string {
  return (db.table(table).schema.primKey.keyPath as string) || "id";
}

function groupBy(rows: Row[], keyField: string): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>();
  for (const row of rows) {
    const key = row[keyField];
    if (!key) continue;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }
  return grouped;
}

/** Rebuild whichever secondary indexes derive from this table. */
function rebuildSecondary(table: string, rows: Row[]) {
  if (table === "statuses") {
    statusesByType = groupBy(rows, "statusTypeId");
  } else if (table === "enums") {
    enumsByType = groupBy(rows, "enumTypeId");
  } else if (table === "enumTypes") {
    const byParent = new Map<string, string[]>();
    for (const type of rows) {
      if (!type.parentTypeId || !type.enumTypeId) continue;
      const bucket = byParent.get(type.parentTypeId);
      if (bucket) { if (!bucket.includes(type.enumTypeId)) bucket.push(type.enumTypeId); }
      else byParent.set(type.parentTypeId, [type.enumTypeId]);
    }
    enumChildTypesByParent = byParent;
  } else if (table === "geoAssocs") {
    const byCountry = new Map<string, string[]>();
    for (const assoc of rows) {
      if (!assoc.geoId || !assoc.toGeoId) continue;
      const bucket = byCountry.get(assoc.geoId);
      if (bucket) { if (!bucket.includes(assoc.toGeoId)) bucket.push(assoc.toGeoId); }
      else byCountry.set(assoc.geoId, [assoc.toGeoId]);
    }
    geoAssocsByCountry = byCountry;
  } else if (table === "carrierShipmentMethods") {
    carrierShipmentMethodsByParty = groupBy(rows, "partyId");
  } else if (table === "statusFlowTransitions") {
    transitionsByStatus = groupBy(rows, "statusId");
  }
}

function applyRows(table: string, keyField: string, rows: Row[]) {
  const next = new Map<string, Row>();
  for (const row of rows) {
    const key = row[keyField];
    if (key) next.set(String(key), row);
  }
  // Replacing the ref's value is what makes dependent computeds re-run.
  slices.get(table)!.value = next;
  rebuildSecondary(table, rows);
}

/** Read the table once, then keep it fresh. Idempotent per table. */
function loadAndSubscribe(table: string): Promise<void> {
  const inFlight = loading.get(table);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const db = resolveDb();
    const client: DbClient = dbClient(db);
    const keyField = keyFieldOf(db, table);

    try {
      applyRows(table, keyField, await client.all(table));
    } catch (error) {
      console.warn(`[seed] Initial read failed for ${table}:`, error);
    }

    if (subscriptions.has(table)) return;

    try {
      const subscription = client.live(table).subscribe({
        next: (rows: Row[]) => {
          const pending = timers.get(table);
          if (pending) clearTimeout(pending);
          timers.set(table, setTimeout(() => {
            timers.delete(table);
            if (slices.has(table)) applyRows(table, keyField, rows);
          }, REBUILD_DEBOUNCE_MS));
        },
        error: (error: any) => console.error(`[seed] liveQuery error on ${table}:`, error),
      });
      subscriptions.set(table, subscription);
    } catch (error) {
      console.warn(`[seed] Failed to subscribe to ${table}:`, error);
    }
  })();

  loading.set(table, promise);
  return promise;
}

/**
 * The rows for a table. Creating the slice on first access is what makes loading lazy.
 * Reading `.value` is also what registers the reactive dependency for a computed.
 */
function sliceOf(table: string): Map<string, Row> {
  let slice = slices.get(table);
  if (!slice) {
    slice = shallowRef(new Map<string, Row>());
    slices.set(table, slice);
    void loadAndSubscribe(table);
  }
  return slice.value;
}

const rowsOf = (table: string): Row[] => [...sliceOf(table).values()];
const rowOf = (table: string, id: string): Row | undefined => (id ? sliceOf(table).get(id) : undefined);

// ── Public lifecycle ──────────────────────────────────────────────────────────────────

/** table -> sync domain name, so ensureLoaded can wait for the right loginSync marker. */
const domainOfTable = new Map(ORDER_MANAGER_SYNC_CATALOG.map((entry) => [entry.table, entry.name]));

/**
 * Resolve once the table's domain has synced at least once this login, or once the bound
 * elapses. Bounded on purpose: a failed or stalled domain must never hang a caller.
 */
async function waitForDomainSync(table: string, timeoutMs = 5000): Promise<void> {
  const domain = domainOfTable.get(table);
  if (!domain) return;

  const db = resolveDb();
  if (await hasSyncedThisLogin(db, domain)) return;

  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { subscription?.unsubscribe(); } catch { /* already closed */ }
      resolve();
    };

    const timer = setTimeout(() => {
      console.warn(`[seed] Timed out waiting for the ${domain} domain to sync.`);
      finish();
    }, timeoutMs);

    const subscription = dbClient(db)
      .live("syncMeta", { equals: { key: `loginSync:${domain}` } })
      .subscribe({ next: (rows: Row[]) => { if (rows.length) finish(); }, error: finish });
  });
}

/**
 * Await the named tables before reading a value that will be STAMPED INTO DATA rather than
 * re-read by a computed. A stamped raw id never self-corrects; a computed does.
 *
 * This waits for the data to EXIST, not merely for a read to finish. On a fresh login the
 * table is empty, so awaiting the read alone would resolve instantly and stamp a raw id
 * permanently.
 */
export async function ensureLoaded(tables: string[]): Promise<void> {
  await Promise.all(tables.map(async (table) => {
    if (!slices.has(table)) slices.set(table, shallowRef(new Map<string, Row>()));
    await waitForDomainSync(table);
    await loadAndSubscribe(table);
  }));
}

/** Drop every slice and subscription. Call on logout and before an OMS switch. */
export function resetSeedData(): void {
  for (const subscription of subscriptions.values()) {
    try { subscription.unsubscribe(); } catch { /* already closed */ }
  }
  subscriptions.clear();

  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();

  loading.clear();
  slices.clear();

  statusesByType = new Map();
  enumsByType = new Map();
  enumChildTypesByParent = new Map();
  geoAssocsByCountry = new Map();
  carrierShipmentMethodsByParty = new Map();
  transitionsByStatus = new Map();
}

// ── Shared helpers ────────────────────────────────────────────────────────────────────

const firstValue = (item: Row | undefined, fields: string[]) =>
  fields.map((field) => item?.[field]).find(Boolean) || "";

function itemDescription(item: Row | undefined, id: string, fields = ["description", "enumName", "name"]) {
  return firstValue(item, fields) || id;
}

const carrierLabel = (carrier: Row) =>
  [carrier.firstName, carrier.lastName].filter(Boolean).join(" ") || carrier.groupName || carrier.partyId;

// ── Statuses and enums ────────────────────────────────────────────────────────────────

export const status = (statusId: string) => rowOf("statuses", statusId);
export const statusDescription = (statusId: string) => itemDescription(rowOf("statuses", statusId), statusId);
export const statusAge = (statusId: string): number => Number(rowOf("statuses", statusId)?.statusAge ?? 0);
export const enumDescription = (enumId: string) => itemDescription(rowOf("enums", enumId), enumId);

export const getStatusItemsByType = (typeId: string): Row[] => {
  sliceOf("statuses");                       // ensure the slice exists and is tracked
  return statusesByType.get(typeId) ?? [];
};
export const getEnumsByType = (typeId: string): Row[] => {
  sliceOf("enums");
  return enumsByType.get(typeId) ?? [];
};
export const getEnumsByParentType = (parentTypeId: string): Row[] => {
  sliceOf("enumTypes");
  return (enumChildTypesByParent.get(parentTypeId) ?? []).flatMap((childTypeId) => getEnumsByType(childTypeId));
};

/** Lookup tables describe() falls through, after statuses and enums. */
const DESCRIBE_FALLBACK_TABLES = [
  "contactMechPurposeTypes", "roleTypes", "paymentMethodTypes", "communicationEventTypes",
  "returnReasons", "returnTypes", "returnItemTypes", "orderAdjustmentTypes",
  "shipmentMethodTypes", "facilityTypes", "partyRelationshipTypes",
];

export function describe(id: string): string {
  if (!id) return "";
  const statusRow = rowOf("statuses", id);
  if (statusRow) return itemDescription(statusRow, id);
  const enumRow = rowOf("enums", id);
  if (enumRow) return itemDescription(enumRow, id);
  for (const table of DESCRIBE_FALLBACK_TABLES) {
    const row = rowOf(table, id);
    if (row) return itemDescription(row, id);
  }
  return id;
}

// ── Product stores and facilities ─────────────────────────────────────────────────────

export const productStores = (): Row[] => rowsOf("productStores");
export const productStore = (productStoreId: string) => rowOf("productStores", productStoreId);
export const productStoreName = (productStoreId: string) =>
  itemDescription(rowOf("productStores", productStoreId), productStoreId, ["storeName", "companyName"]);

export const facilities = (): Row[] => rowsOf("facilities");
export const facility = (facilityId: string) => rowOf("facilities", facilityId);
export const facilityName = (facilityId: string) =>
  itemDescription(rowOf("facilities", facilityId), facilityId, ["facilityName", "facilityId"]);
export const facilityType = (facilityTypeId: string) => rowOf("facilityTypes", facilityTypeId);

export const productStoreFacilities = (productStoreId: string): Row[] =>
  rowsOf("productStoreFacilities").filter((row) => row.productStoreId === productStoreId);

// ── Carriers and shipment methods ─────────────────────────────────────────────────────

export const carriers = (): Row[] => rowsOf("carriers");
export const carrier = (partyId: string) => rowOf("carriers", partyId);
export const carrierName = (partyId: string) => {
  const row = rowOf("carriers", partyId);
  return row ? carrierLabel(row) : partyId;
};

export const shipmentMethodTypes = (): Row[] => rowsOf("shipmentMethodTypes");
export const shipmentMethod = (id: string) => rowOf("shipmentMethodTypes", id);
export const shipmentMethodDescription = (id: string) =>
  itemDescription(rowOf("shipmentMethodTypes", id), id, ["description", "shipmentMethodTypeId"]);
export const getShipmentMethodOptions = (): Array<{ id: string; label: string }> =>
  rowsOf("shipmentMethodTypes").map((row) => ({
    id: row.shipmentMethodTypeId,
    label: itemDescription(row, row.shipmentMethodTypeId, ["description", "shipmentMethodTypeId"]),
  }));

export const shippingMethodsByCarrier = (carrierPartyId: string): Row[] => {
  sliceOf("carrierShipmentMethods");
  return carrierPartyId ? carrierShipmentMethodsByParty.get(carrierPartyId) ?? [] : [];
};

// ── Simple lookup descriptions ────────────────────────────────────────────────────────

export const paymentMethodDescription = (id: string) => itemDescription(rowOf("paymentMethodTypes", id), id);
export const returnReasonDescription = (id: string) => itemDescription(rowOf("returnReasons", id), id);
export const orderAdjustmentTypeDescription = (id: string) => itemDescription(rowOf("orderAdjustmentTypes", id), id);
export const partyRelationshipTypes = (): Row[] => rowsOf("partyRelationshipTypes");
export const roleTypes = (): Row[] => rowsOf("roleTypes");

// ── Order identification ──────────────────────────────────────────────────────────────

export const orderIdentificationTypeDescription = (id: string) => itemDescription(rowOf("enums", id), id);
export const orderIdentificationTypeOptions = (): Array<{ enumId: string; description: string }> =>
  getEnumsByType("ORDER_IDENTITY").map((row) => ({
    enumId: row.enumId,
    description: itemDescription(row, row.enumId),
  }));

// ── Shopify ───────────────────────────────────────────────────────────────────────────

export const shopifyShops = (): Row[] => rowsOf("shopifyShops");
export const shopifyShopLocations = (): Row[] => rowsOf("shopifyShopLocations");

// ── Geography ─────────────────────────────────────────────────────────────────────────

const byGeoName = (left: Row, right: Row) => (left.geoName || "").localeCompare(right.geoName || "");

export const geoName = (geoId: string) => itemDescription(rowOf("geos", geoId), geoId, ["geoName"]);

export const getGeoIdByCode = (code: string): string => {
  if (!code) return "";
  const match = rowsOf("geos").find((geo) => geo.geoCodeAlpha2 === code || geo.geoCode === code);
  return match?.geoId ?? "";
};

export const getCountries = (): Row[] =>
  rowsOf("geos").filter((geo) => geo.geoTypeEnumId === "GEOT_COUNTRY").sort(byGeoName);

export const getStates = (): Row[] =>
  rowsOf("geos")
    .filter((geo) => geo.geoTypeEnumId === "GEOT_STATE" || geo.geoTypeEnumId === "GEOT_PROVINCE")
    .sort(byGeoName);

export const getStatesForCountry = (countryGeoId: string): Row[] => {
  sliceOf("geoAssocs");
  return (geoAssocsByCountry.get(countryGeoId) ?? [])
    .map((geoId) => rowOf("geos", geoId))
    .filter(Boolean)
    .sort(byGeoName) as Row[];
};

// ── Status flow ───────────────────────────────────────────────────────────────────────

export const allowedTransitions = (statusId: string) => {
  sliceOf("statusFlowTransitions");
  return (transitionsByStatus.get(statusId) ?? [])
    .map((transition) => {
      const toStatusDescription = itemDescription(rowOf("statuses", transition.toStatusId), transition.toStatusId);
      return {
        ...transition,
        toStatusDescription,
        toStatusColor: commonUtil.getStatusColor(toStatusDescription),
      };
    })
    .sort((left, right) => {
      const leftSequence = left.transitionSequence ?? Number.MAX_SAFE_INTEGER;
      const rightSequence = right.transitionSequence ?? Number.MAX_SAFE_INTEGER;
      if (leftSequence !== rightSequence) return leftSequence - rightSequence;
      return (left.toStatusId || "").localeCompare(right.toStatusId || "");
    });
};

// ── Component entry point ─────────────────────────────────────────────────────────────

/**
 * The same getters, for components. Reading any of them inside a computed or a render
 * function registers a dependency on the underlying slice ref, so the computed re-runs when
 * that slice fills or changes. Non-component callers import the plain functions above.
 */
export function useSeedData() {
  return {
    describe, status, statusDescription, statusAge, enumDescription,
    getStatusItemsByType, getEnumsByType, getEnumsByParentType,

    productStores, productStore, productStoreName,
    facilities, facility, facilityName, facilityType, productStoreFacilities,

    carriers, carrier, carrierName,
    shipmentMethodTypes, shipmentMethod, shipmentMethodDescription,
    getShipmentMethodOptions, shippingMethodsByCarrier,

    paymentMethodDescription, returnReasonDescription, orderAdjustmentTypeDescription,
    partyRelationshipTypes, roleTypes,

    orderIdentificationTypeDescription, orderIdentificationTypeOptions,
    shopifyShops, shopifyShopLocations,

    geoName, getGeoIdByCode, getCountries, getStates, getStatesForCountry,
    allowedTransitions,

    ensureLoaded,
  };
}
```

- [ ] **Step 5: Move the one seed write to a service**

Create `apps/order-manager/src/services/orderIdentification.ts`:

```ts
/**
 * The single write against seed data: creating an order identification type.
 *
 * The write goes to the server, then the worker refetches the affected row into the local
 * database. The enums slice picks the change up through its liveQuery — nothing reloads.
 */

import { api, logger } from "@common";
import { refreshAfterMutation } from "@common/db";

export async function createOrderIdentificationType(payload: { enumId: string; description: string }): Promise<void> {
  await api({
    url: "admin/enums",
    method: "POST",
    data: { ...payload, enumTypeId: "ORDER_IDENTITY" },
  });

  try {
    await refreshAfterMutation("enum", { enumId: payload.enumId });
  } catch (error) {
    logger.warn("[orderIdentification] Failed to refresh the enum after create:", error);
  }
}
```

- [ ] **Step 6: Reset the slices on logout**

In `apps/order-manager/src/store/user.ts`, add the import:

```ts
import { resetSeedData } from "@/db/useSeedData";
```

and in `postLogout`, immediately before the existing `useSeedStore().resetSeedData();` at
`src/store/user.ts:195`:

```ts
      resetSeedData();
```

No boot wiring is added anywhere — slices build on demand.

- [ ] **Step 7: Run the test to verify it passes**

```bash
cd apps/order-manager && npx vitest run tests/db/useSeedData.spec.ts
```

Expected: PASS, 13 tests. If a timing assertion is flaky, raise the `flush()` delay — do not
lower `REBUILD_DEBOUNCE_MS`. The timeout test runs against the real 5s bound, hence its
`10000` ms vitest timeout; if that proves slow in CI, add an optional second argument to
`ensureLoaded` for the bound and pass a short one from the test.

- [ ] **Step 8: Run the full suite and commit**

```bash
cd apps/order-manager && npx vitest run
```

Expected: 95 files / ~500 tests passing.

```bash
cd apps/order-manager
git add src/db/useSeedData.ts src/db/orderManagerDb.ts src/services/orderIdentification.ts src/store/user.ts tests/db/useSeedData.spec.ts
git commit -m "feat(db): add useSeedData with lazy Dexie-backed lookup slices"
```

---

### Task 7: Migrate stores, services and utils, with `ensureLoaded`

**Files:**
- Modify: `src/store/order.ts:47,56,67`, `src/store/orderDetail.ts:28,726-727`, `src/store/customer.ts:326,374`, `src/store/customerService.ts:1058-1059`, `src/store/productStore.ts:141`, `src/services/order.ts:3,793,798`, `src/utils/badAddressState.ts:24,32-33`, `src/utils/OrderActionValidator.ts:66`
- Test: existing `tests/store/order.spec.ts`, `tests/store/orderDetail.spec.ts`, `tests/services/*.spec.ts`, `tests/utils/badAddressState.spec.ts`

**Interfaces:**
- Consumes: the plain getters and `ensureLoaded` from `@/db/useSeedData` (Task 6).
- Produces: no new interfaces.

**The rule this task applies.** A lookup read inside a computed self-corrects when its slice
fills. A lookup whose result is **stamped into data** is evaluated once and never revisited,
so a cold slice leaves a raw id there permanently. Every stamping site must `await
ensureLoaded([...])` first. Sites that only feed computeds must not — adding awaits there is
pointless work.

**Self-correcting, leave alone:** `orderDetail.ts`'s `adjustmentDisplayLabel` is called only
from the Pinia getters `totals` (`:663`), `adjustmentsByExternalId` (`:578`) and
`itemStatusEventsByOrderId` (`:425`). Pinia getters are computeds, so they re-run when the
slice fills.

- [ ] **Step 1: Migrate `src/store/order.ts` (stamping site)**

Replace the `useSeedStore` import with:

```ts
import { ensureLoaded, productStore as seedProductStore, shipmentMethod as seedShipmentMethod } from "@/db/useSeedData";
```

Delete `const seedStore = useSeedStore();` at `:47` and add the await immediately before the
`docs.map(...)` that follows it:

```ts
  // Stamped onto row data, so it cannot self-correct later — load the slices first.
  await ensureLoaded(["productStores", "shipmentMethodTypes"]);

  const orders = docs.map((doc: any) => {
```

Then rewrite the two decorated fields:

```ts
      productStoreName: (() => {
        const store = seedProductStore(toStringValue(doc.productStoreId));
        return store?.storeName || store?.companyName || toStringValue(doc.productStoreId);
      })(),
```

```ts
      shipmentMethodDesc: (() => {
        const method = seedShipmentMethod(toStringValue(doc.shipmentMethodTypeId));
        return method?.description || toStringValue(doc.shipmentMethodTypeId);
      })(),
```

- [ ] **Step 2: Migrate `src/store/orderDetail.ts` (no await needed)**

```ts
import { orderAdjustmentTypeDescription, shippingMethodsByCarrier } from "@/db/useSeedData";
```

Line 28 becomes `|| orderAdjustmentTypeDescription(adj.orderAdjustmentTypeId)`, and lines
726-727 collapse to:

```ts
        return shippingMethodsByCarrier(carrierPartyId);
```

- [ ] **Step 3: Migrate the remaining non-component files**

| File | Change | `ensureLoaded`? |
| --- | --- | --- |
| `src/store/customer.ts:326` | delete `const seed = useSeedStore();`; `seed.statusAge(x)` → `statusAge(x)`; import from `@/db/useSeedData` | **yes** — `await ensureLoaded(["statuses"])` at the top of `async loadCustomerDashboard` |
| `src/store/customer.ts:374` | same swap | **yes** — `await ensureLoaded(["statuses"])` before the `await Promise.all(result.orders…)` block |
| `src/store/customerService.ts:1058-1059` | `const seedStore = useSeedStore() as any; seedStore.getEnumsByType('PP_SORT_PARAM_TYPE')` → `getEnumsByType('PP_SORT_PARAM_TYPE')` | **yes** — `await ensureLoaded(["enums"])` before the `sortConditions.map(...)` that builds `sortRules` |
| `src/store/productStore.ts:141` | delete the `await useSeedStore().loadProductStoreSeedData(...)` line and the `useSeedStore` import — the worker's fan-out domains already cover every store | no |
| `src/services/order.ts:793,798` | `useSeedStore().facilityType(id)?.parentTypeId` → `facilityType(id)?.parentTypeId`; **delete both `getActivePinia()` guards** (`:792` and `:798`) — there is no Pinia to guard; drop the `getActivePinia` import if unused | **yes** — `await ensureLoaded(["facilityTypes"])` in the async function that calls `allocationDocuments` |
| `src/utils/badAddressState.ts:24,32-33` | delete `const seedStore = useSeedStore();`; `seedStore.getGeoIdByCode(x)` → `getGeoIdByCode(x)` | no — handled at the caller in Task 8 |
| `src/utils/OrderActionValidator.ts:66` | comment-only reference to `productStoreSettingsByStoreId`; update it to note the setting is read from `productStore.ts` | no |

- [ ] **Step 4: Run the affected tests**

```bash
cd apps/order-manager && npx vitest run tests/store/order.spec.ts tests/store/orderDetail.spec.ts tests/store/customer.spec.ts tests/services tests/utils
```

Expected: PASS. Where a spec mocked `@/store/seed`, replace it with
`vi.mock('@/db/useSeedData', () => ({ ensureLoaded: vi.fn(async () => {}), /* …the getters that spec used */ }))`
returning the same values the old mock returned. `ensureLoaded` must always be mocked as an
async no-op, or the store action will hang waiting on a real Dexie read.

- [ ] **Step 5: Confirm no seed-store references remain in non-component code**

```bash
cd apps/order-manager && grep -rn "useSeedStore" src/store src/services src/utils
```

Expected: only `src/store/user.ts` (boot wiring, removed in Task 11) and `src/store/seed.ts`.

- [ ] **Step 6: Run the full suite and commit**

```bash
cd apps/order-manager && npx vitest run
```

Expected: 95 files / ~500 tests passing.

```bash
cd apps/order-manager
git add src/store src/services src/utils
git commit -m "refactor(seed): read lookups from useSeedData in stores, services and utils"
```

---


### Task 8: Migrate geography components and delete the on-demand geo loaders

**Files:**
- Modify: `src/components/AddressModal.vue:67,80-81,90`, `src/components/AddContactModal.vue:197,206,238-259`, `src/components/tasks/BadAddressTaskCard.vue`, `src/views/BadAddressOrders.vue`
- Test: `tests/utils/badAddressState.spec.ts` if present, plus any component specs for these files

**Interfaces:**
- Consumes: `useSeedData()` (Task 7).
- Produces: nothing new.

**Context:** `geoAssocs` is a fully synced domain, so per-country loading disappears. `loadGeoAssocs`, `loadGeos` and `geoAssocStatus` have no replacement — remove the calls and the loading gates they drive.

- [ ] **Step 1: Migrate `src/components/AddressModal.vue`**

Replace the import:

```ts
import { useSeedData } from '@/db/useSeedData';
```

Then:

```ts
const seed = useSeedData();
const countries = computed(() => seed.getCountries());
const states = computed(() => seed.getStatesForCountry(address.value.country));
```

Delete the `useSeedStore().loadGeoAssocs(address.value.country);` call at `:90` and, if that leaves an empty watcher or handler, delete the whole block.

- [ ] **Step 2: Migrate `src/components/AddContactModal.vue`**

Replace `const seed = useSeedStore();` with `const seed = useSeedData();` and drop every `(seed as any)` cast — the functions are typed now:

```ts
const countries = computed(() => seed.getCountries());
const states = computed(() => seed.getStatesForCountry(form.countryGeoId));
```

Delete the loading gate at `:246` and the two loader calls at `:252` and `:258-259`. If the gate drove a spinner, replace the condition with `!seed.ready.value`.

- [ ] **Step 3: Migrate the remaining two files**

| File | Change |
| --- | --- |
| `src/components/tasks/BadAddressTaskCard.vue` | `useSeedStore()` → `useSeedData()`; `carrierName`, `facilityName`, `getStatesForCountry`, `shipmentMethodDescription` keep their names; **delete** both `loadGeoAssocs` calls; **make `hydrate()` async and await `ensureLoaded`** — see the next step |
| `src/views/BadAddressOrders.vue` | `useSeedStore()` → `useSeedData()`; `getEnumsByType` keeps its name |

- [ ] **Step 4: Await the geo slices in `BadAddressTaskCard.vue` (stamping site)**

`buildAddressState(props.task)` resolves geo codes and the result is stamped into the
`addressState` ref at `src/components/tasks/BadAddressTaskCard.vue:170-176`. A stamped raw
id never self-corrects, so the slices must be loaded first. `hydrate()` is already deferred
past first paint in `onMounted`, so making it async changes nothing visible:

```ts
import { ensureLoaded } from '@/db/useSeedData';

async function hydrate() {
  if (addressState.value) return;
  await ensureLoaded(['geos', 'geoAssocs']);
  addressState.value = buildAddressState(props.task);
}
```

The two `seedStore.loadGeoAssocs(...)` calls that sat between `buildAddressState` and the
assignment are deleted — `geoAssocs` is a fully synced domain, so `ensureLoaded` covers it.

Update `tests/utils/badAddressState.spec.ts` if it asserts on resolved geo ids: it calls
`buildAddressState` directly, so it needs `await ensureLoaded(['geos'])` against a seeded
fixture database, or a `vi.mock('@/db/useSeedData')` stubbing `getGeoIdByCode`.

- [ ] **Step 5: Confirm the geo loaders are gone**

```bash
cd apps/order-manager && grep -rn "loadGeoAssocs\|loadGeos\|geoAssocStatus" src
```

Expected: only `src/store/seed.ts` (deleted in Task 11).

- [ ] **Step 6: Run the tests and commit**

```bash
cd apps/order-manager && npx vitest run
```

Expected: 95 files / ~500 tests passing.

```bash
cd apps/order-manager
git add src/components/AddressModal.vue src/components/AddContactModal.vue src/components/tasks/BadAddressTaskCard.vue src/views/BadAddressOrders.vue
git commit -m "refactor(seed): read geo lookups from useSeedData, drop per-country loading"
```

---

### Task 9: Migrate list views

**Files:**
- Modify: `src/views/OpenOrders.vue:151-163`, `src/views/InflightOrders.vue:149-162`, `src/views/PackedOrders.vue`, `src/views/HoldOrders.vue`, `src/views/FraudOrders.vue`, `src/views/SwapOrders.vue`, `src/views/OrderSearch.vue`, `src/views/Returns.vue`, `src/views/Funnel.vue:792`, `src/components/OrderQueueList.vue`

**Interfaces:**
- Consumes: `useSeedData()` (Task 7).
- Produces: nothing new.

- [ ] **Step 1: Migrate the three shipment-method list views**

`OpenOrders.vue`, `InflightOrders.vue` and `PackedOrders.vue` share the same two computeds. In each, replace `useSeedStore()` with `useSeedData()` and rewrite:

```ts
const salesChannelOptions = computed(() =>
  seed.getEnumsByType('ORDER_SALES_CHANNEL').map((enumeration: any) => enumeration.enumId),
);

const shipmentMethodOptions = computed(() =>
  seed.shipmentMethodTypes().map((method: any) => ({
    id: method.shipmentMethodTypeId,
    label: method.description || method.shipmentMethodTypeId,
  })),
);
```

Keep whatever local names those computeds already have; only the bodies change.

- [ ] **Step 2: Migrate the remaining list views**

| File | Getters used | Extra change |
| --- | --- | --- |
| `src/views/HoldOrders.vue` | `getEnumsByType` | **delete** the `loadEnumType` call |
| `src/views/FraudOrders.vue` | `getEnumsByType`, `getStatusItemsByType` | — |
| `src/views/SwapOrders.vue` | `getEnumsByType` | — |
| `src/views/OrderSearch.vue` | `getEnumsByType`, `getStatusItemsByType`, `statusDescription` | — |
| `src/views/Returns.vue` | `describe`, `enumDescription`, `facilityName`, `getEnumsByType`, `getStatusItemsByType`, `statusDescription` | — |
| `src/components/OrderQueueList.vue` | `facility`, `facilityType`, `getEnumsByType` | — |

For each: `useSeedStore()` → `useSeedData()`, imports updated to `@/db/useSeedData`, method names unchanged.

- [ ] **Step 3: Migrate `src/views/Funnel.vue:792`**

```ts
      const shipmentMethod = seed.shipmentMethod(item.shipmentMethodTypeId);
      const label = `${item.deliveryDays}d - ${shipmentMethod?.description || item.shipmentMethodTypeId || 'None'}`;
```

Plus `facilityName` and `getEnumsByType` on the same component, via `useSeedData()`.

- [ ] **Step 4: Run the tests and commit**

```bash
cd apps/order-manager && npx vitest run
```

Expected: 96 files / ~502 tests passing.

```bash
cd apps/order-manager
git add src/views src/components/OrderQueueList.vue
git commit -m "refactor(seed): read list-view lookups from useSeedData"
```

---

### Task 10: Migrate detail views, modals and task cards

**Files:**
- Modify: `src/views/OrderDetail.vue` (35 sites), `src/views/ReturnDetail.vue`, `src/views/CustomerDetail.vue`, `src/views/CreateOrder.vue:318,327`, `src/components/orders/CloneOrderModal.vue:175-176`, `src/components/orders/ManageOrderIdentificationsModal.vue`, `src/components/orders/CreateIdentificationTypeModal.vue`, `src/components/orders/RejectItemsModal.vue`, `src/components/orders/RiskAssessmentModal.vue`, `src/components/fulfillment/EditShippingMethodModal.vue:88-91`, `src/components/fulfillment/FacilityInventoryModal.vue:376,412,414`, `src/components/inventory/ProductInventoryModal.vue:29`, `src/components/swaps/CustomSwapModal.vue`, `src/components/tasks/FraudTaskCard.vue`, `src/components/tasks/SwapTaskCard.vue`, `src/components/tasks/AddOrderTaskModal.vue`, `src/components/AddRelationshipModal.vue:176,192-199`, `src/components/RelationshipHistoryModal.vue:76,109,119`

**Interfaces:**
- Consumes: `useSeedData()` (Task 7), `createOrderIdentificationType` (Task 7).
- Produces: nothing new.

- [ ] **Step 1: Migrate the dataset-shaped call sites**

These read `.ids`/`.byId` today and become accessor calls. `seed` is `useSeedData()` in each file.

| File | Before | After |
| --- | --- | --- |
| `CloneOrderModal.vue:175` | `seed.shopifyShops.ids.map(id => seed.shopifyShops.byId[id])` | `seed.shopifyShops()` |
| `CloneOrderModal.vue:176` | `seed.shopifyShops.byId[shopId.value]?.name \|\| shopId.value` | `seed.shopifyShops().find(s => s.shopId === shopId.value)?.name ?? shopId.value` |
| `OrderDetail.vue:1163` | `seed.shopifyShops.ids.map(...)` | `seed.shopifyShops()` |
| `OrderDetail.vue:1171` | `seed.shopifyShops.byId[shopId]` | `seed.shopifyShops().find(s => s.shopId === shopId)` |
| `CreateOrder.vue:318-321` | `useSeedStore().productStoreFacilitiesByStoreId[id]?.byId` then `Object.values(...)` | `seed.productStoreFacilities(productStoreId)` |
| `CreateOrder.vue:327` | `Object.values(useSeedStore().shopifyShopLocations?.byId \|\| {})` | `seed.shopifyShopLocations()` |
| `EditShippingMethodModal.vue:88` | `seed.carriers.ids.map(id => seed.carriers.byId[id])` | `seed.carriers()` |
| `FacilityInventoryModal.vue:376` | `seedDatasetRecords(seedStore.facilities)` | `seed.facilities()` |
| `FacilityInventoryModal.vue:412` | `seedDatasetRecords(seedStore.productStoreFacilitiesByStoreId[props.productStoreId])` | `seed.productStoreFacilities(props.productStoreId)` |
| `AddRelationshipModal.vue:192` | `(seed as any).partyRelationshipTypes.ids.map(...)` | `seed.partyRelationshipTypes()` |
| `AddRelationshipModal.vue:198` | `(seed as any).roleTypes.ids.map(...)` | `seed.roleTypes()` |

If `seedDatasetRecords` has no remaining callers after this, delete the helper and its import.

- [ ] **Step 2: Migrate the plain getter call sites**

For every remaining file in this task: swap the import to `import { useSeedData } from '@/db/useSeedData';`, change `useSeedStore()` to `useSeedData()`, drop any `(seed as any)` casts, and leave every method name as-is. The getters in play are `describe`, `statusDescription`, `enumDescription`, `facilityName`, `facility`, `facilityType`, `geoName`, `paymentMethodDescription`, `orderAdjustmentTypeDescription`, `orderIdentificationTypeDescription`, `orderIdentificationTypeOptions`, `productStoreName`, `shipmentMethodDescription`, `getEnumsByType`, `getEnumsByParentType`, `allowedTransitions`.

`orderIdentificationTypeOptions` was a bare getter and is now a function — update its call sites in `ManageOrderIdentificationsModal.vue` and `OrderDetail.vue` from `seed.orderIdentificationTypeOptions` to `seed.orderIdentificationTypeOptions()`.

- [ ] **Step 3: Delete the on-demand loader calls**

| File | Delete |
| --- | --- |
| `FacilityInventoryModal.vue` | `loadFacilities()`, `loadProductStoreSeedData()` |
| `CustomSwapModal.vue` | `loadFacilities()` |
| `CloneOrderModal.vue`, `OrderDetail.vue` | `loadShopifyShops()` |
| `RejectItemsModal.vue`, `OrderDetail.vue` | `loadEnumsByParentType()` |
| `AddOrderTaskModal.vue` | `loadEnumType()` |

If deleting a call empties an `onMounted` or a watcher, delete the whole block.

- [ ] **Step 4: Point the one write at the new service**

In `src/components/orders/CreateIdentificationTypeModal.vue`:

```ts
import { createOrderIdentificationType } from '@/services/orderIdentification';
```

and replace `useSeedStore().createOrderIdentificationType(payload)` with `createOrderIdentificationType(payload)`. Remove the `useSeedStore` import.

- [ ] **Step 5: Confirm every consumer is migrated**

```bash
cd apps/order-manager && grep -rn "useSeedStore" src
```

Expected: only `src/store/seed.ts`, `src/App.vue` and `src/store/user.ts` — all handled in Task 11.

- [ ] **Step 6: Run the full suite and commit**

```bash
cd apps/order-manager && npx vitest run
```

Expected: 96 files / ~502 tests passing.

```bash
cd apps/order-manager
git add src/views src/components
git commit -m "refactor(seed): read detail and modal lookups from useSeedData"
```

---

### Task 11: Delete the seed store and verify end to end

**Files:**
- Delete: `apps/order-manager/src/store/seed.ts`, `apps/order-manager/tests/store/seed.spec.ts`
- Modify: `apps/order-manager/src/App.vue`, `apps/order-manager/src/store/user.ts`
- Create: `apps/order-manager/tests/db/syncDomainUrls.spec.ts`

**Interfaces:**
- Consumes: `resetSeedData` (Task 6), `ORDER_MANAGER_SYNC_CATALOG` (Task 5).
- Produces: no `useSeedStore` anywhere in the app.

- [ ] **Step 1: Preserve the bounded-endpoints guarantee**

`tests/store/seed.spec.ts` asserted that seed data never comes from generic entity endpoints. Those URLs now live in the sync domain registry, so the assertion moves there. Create `apps/order-manager/tests/db/syncDomainUrls.spec.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { getAllSyncDomains, registerCommonSeedDomains } from '@common/db';

vi.mock('@common', () => ({
  api: vi.fn(),
  logger: { warn: vi.fn(), error: vi.fn() },
  commonUtil: { getMaargURL: () => 'http://localhost:8080/rest/s1', getStatusColor: () => 'medium' },
}));

describe('seed sync domains', () => {
  registerCommonSeedDomains(() => ({}) as any);
  const names = getAllSyncDomains().map((d) => d.name);

  it('registers a domain for every seed dataset the app reads', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'productStore', 'status', 'enum', 'enumType', 'facility', 'facilityType',
        'geo', 'geoAssoc', 'carrier', 'shipmentMethodType', 'carrierShipmentMethod',
        'statusFlowTransition', 'shopifyShop', 'shopifyShopLocation',
      ]),
    );
  });

  it('never fetches seed data through a generic entity endpoint', () => {
    const urls = JSON.stringify(getAllSyncDomains());
    expect(urls).not.toContain('oms/entityData');
    expect(urls).not.toContain('oms/dataDocumentView');
  });
});
```

- [ ] **Step 2: Run it to verify it passes against the current code**

```bash
cd apps/order-manager && npx vitest run tests/db/syncDomainUrls.spec.ts
```

Expected: PASS, 2 tests. If `registerCommonSeedDomains` throws on the stub db, pass `() => getOrderManagerDb('test')` with `fake-indexeddb/auto` imported instead.

- [ ] **Step 3: Remove the store from boot**

In `src/App.vue`, delete the `useSeedStore` import, the `await useSeedStore().initSeedDb();` line, the `useSeedStore().loadInitialSeedData(productStoreIds).catch(...)` block at `:83-88` (including the now-unused `productStoreIds` computation), and change the sync start at `:73` to drop the callback:

```ts
      startAppDbSync(token)
        .catch((err) => {
          console.warn("Background database bootstrap notice:", err);
        });
```

In `src/store/user.ts`, delete the `useSeedStore` import, `await useSeedStore().initSeedDb();`, the `loadInitialSeedData` block at `:186-188`, and `useSeedStore().resetSeedData();` at `:195`. Change the sync start at `:175` the same way:

```ts
        startAppDbSync(getSyncToken())
          .catch((err) => {
            logger.warn("Database background sync notice:", err);
          });
```

The `resetSeedData()` call added in Task 6 stays exactly where it is. Nothing replaces
`initSeedDb()` — slices build on demand, so there is no boot step at all.

- [ ] **Step 4: Delete the store and its spec**

```bash
cd apps/order-manager
git rm src/store/seed.ts tests/store/seed.spec.ts
```

- [ ] **Step 5: Confirm nothing references the store**

```bash
cd apps/order-manager && grep -rn "useSeedStore\|store/seed" src tests
```

Expected: no output.

- [ ] **Step 6: Run the full suite**

```bash
cd apps/order-manager && npx vitest run
```

Expected: 96 files passing, with `tests/store/seed.spec.ts` gone and the six new `tests/db/` files present. No failures.

- [ ] **Step 7: Manual verification**

```bash
cd apps/order-manager && pnpm dev
```

Walk through each of these and confirm labels render as words, not raw ids:

1. **Fresh login** (clear IndexedDB first via devtools → Application → IndexedDB → delete `*-OrderManagerDB`). Labels may briefly show raw ids, then resolve as domains land. This is the accepted behaviour change from the spec.
2. **Reload** an authenticated session — labels must be correct on first paint.
3. **Order list** (Open Orders): sales channel filter options, shipment method filter options, store names.
4. **Order Detail**: status labels, timeline reasons, adjustment types, allowed transitions, facility names, the Shopify admin link (needs `myshopifyDomain` from Task 3 and the `shopifyShop` domain from Task 5).
5. **Create Order**: facility list is filtered by Shopify shop locations (needs the `shopifyShopLocation` domain from Task 5).
6. **Bad Address task card / Address modal**: country and state dropdowns populate, and switching country changes the state list.
7. **Settings**: all 29 domains listed with sync status and counts.
8. **Logout then log in as a different OMS instance**: labels reflect the new tenant, with no rows leaking from the previous one.

- [ ] **Step 8: Commit both repos**

```bash
cd apps/order-manager
git add src/App.vue src/store/user.ts tests/db/syncDomainUrls.spec.ts
git commit -m "refactor(seed): delete the seed Pinia store, Dexie is the only source"
cd /Users/ravi/ofbiz_dev/hc/my_workspace/accxui
git status --short   # expect only the pre-existing .gitignore / pnpm-lock.yaml edits
```

---

## Self-review notes

**Spec coverage.** Every section of the spec maps to a task: `dbClient` → 1; single `useDb` → 2; projection audit and `wellKnownText` → 3; drop `raw` and `shapeVersion` → 4; catalog and the Shopify domains → 5; `useSeedData.ts`, `ensureLoaded`, `resetSeedData` and the `createOrderIdentificationType` write → 6; the 42 consumer files → 7–10; store deletion, the moved bounded-endpoint assertion and manual verification → 11. The spec's execution order is preserved, with its consumer-migration step split across Tasks 7–10 so each cluster is independently reviewable.

**Deliberate deviations from the spec.** None — the spec was updated to match this plan before it was written. Both describe lazy slices inside a single `useSeedData.ts`, with no index config, no catalog-driven indexing and no boot hydration. `wellKnownText` is removed from the projection itself in Task 3 rather than omitted at index time.

**Known risk.** Task 4 clears every local database once on first load after deploy. Users will see a brief re-sync. This is intentional and is the only way to evict stale `raw` blobs without a Dexie version bump.
