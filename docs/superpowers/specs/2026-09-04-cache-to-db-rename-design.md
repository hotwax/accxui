# Rename the `cache` vocabulary to `db`

- **Date:** 2026-09-04
- **Branch:** `remove_cache_naming` (cut from `local_db_naming` in **both** `accxui` and `order-manager`)
- **Repos:** `accxui` (framework, `common/`) and `order-manager` (consumer, nested at `apps/order-manager`)
- **Status:** approved

## Problem

`common/cache` is not a cache. A cache is a discardable copy with eviction, where a miss falls
through to the origin. What the directory actually holds is a durable local database:

- `BaseCacheDB` extends Dexie and opens a real IndexedDB database, named per OMS instance
  (`${oms}-OrderManagerCacheDB`).
- A polling web worker (`pollingWorkerHarness`) fills it from Maarg; the UI reads it reactively
  through `liveQuery`.
- There is no eviction and no fallthrough. After `initSeedCache`, the UI treats these rows as the
  source of truth — a miss renders as absent data, not as a fetch.

Calling it a cache misleads every reader about the durability and authority of the data. `db` is
the honest word, and it matches the naming already used by the sibling stack
(`services/productDb.ts`, `getOrderManagerDb`, `orderManagerDbName`).

## Scope

Two repos, three tiers. Tier A and B rename; Tier C deliberately keeps `cache` because those
things genuinely are caches.

Out of scope entirely — unrelated senses of the word, none of which change:
`axios-cache-adapter` / `setupCache` / `axiosCache` / `VITE_CACHE_MAX_AGE` (HTTP response cache),
`actions/cache` and `cache: 'pnpm'` in `.github/workflows/*` (CI), `/.sass-cache` and `.cache` in
`.gitignore` / `vite.config.js` (build artifacts), `localesCache` in `eslint.config.js`
(in-process memo), `cache: "no-store"` fetch options in `common/core/*` and `common/vite/*`,
and the generic template heading `docs/DESIGN_DOCUMENT_GUIDE.md:43` ("Local Storage/Caching
strategy").

### Tier A — `accxui` / `common` framework

Directory and files:

| current | new |
| --- | --- |
| `common/cache/` | `common/db/` |
| `common/cache/db.ts` | `common/db/baseDb.ts` |
| `common/cache/useCachedList.ts` | `common/db/useDbList.ts` |
| `common/cache/useCacheStatus.ts` | `common/db/useDbStatus.ts` |
| `common/cache/sync/appCacheBootstrap.ts` | `common/db/sync/appDbBootstrap.ts` |

Unchanged filenames, moved with the directory: `types.ts`, `projection.ts`, `index.ts`,
`domains/commonSeedDomains.ts`, `domains/commonSeedEntities.ts`,
`sync/{syncRegistry,workerFetch,snapshotDomain,pollingWorkerHarness}.ts`.

Exported API:

| current | new |
| --- | --- |
| `BaseCacheDB` | `BaseDB` |
| `CachedRow` | `DbRow` |
| `CachedEntity` | `DbEntity` |
| `defineCachedEntity` | `defineDbEntity` |
| `CacheSchemaDefinition` | `DbSchemaDefinition` |
| `COMMON_CACHE_SCHEMA` | `COMMON_DB_SCHEMA` |
| `ensureCacheReady` | `ensureDbReady` |
| `useCachedList` | `useDbList` |
| `useCachedRecord` | `useDbRecord` |
| `CachedList` | `DbList` |
| `CachedRecordResult` | `DbRecordResult` |
| `useCacheStatus` | `useDbStatus` |
| `CacheDomainCatalogItem` | `SyncDomainCatalogItem` |
| `CacheDomainStatus` | `SyncDomainStatus` |
| `DEFAULT_COMMON_CACHE_CATALOG` | `DEFAULT_COMMON_SYNC_CATALOG` |
| `startCacheBootstrap` | `startDbBootstrap` |
| `clearAllCaches` | `clearLocalDb` |
| `cachedAt` (field on every stored row) | `syncedAt` |

Casing follows the existing convention: `DB` as a type/class suffix (`BaseDB`, `OrderManagerDB`),
`Db` inside camelCase identifiers (`getOrderManagerDb`, `baseDb.ts`).

Two names move toward `Sync…` rather than `Db…` on purpose: `CacheDomainCatalogItem` and
`CacheDomainStatus` describe sync domains and their sync state, not the database.
`clearAllCaches` → `clearLocalDb` also corrects a factual error in the old name — it stops the
worker and clears the tables of exactly one database, not "all caches".

Import specifier: `@common/cache` → `@common/db`. The re-export at `common/index.ts:69`
(`export * from './cache'`) becomes `'./db'`.

Log prefixes inside `common/db/`: `[cache]` → `[db]` (11 sites), `[cache-bootstrap]` →
`[db-bootstrap]` (1), `[cache-worker]` → `[db-worker]` (1).

`common/composables/useProducts.ts:15` — prose "durable Dexie cache" → "durable Dexie DB".

### Tier B — `order-manager`

| current | new |
| --- | --- |
| `src/cache/` | `src/db/` |
| `src/cache/appCacheDb.ts` | `src/db/orderManagerDb.ts` |
| `tests/cache/appCacheDb.spec.ts` | `tests/db/orderManagerDb.spec.ts` |
| `src/services/appCacheSync.ts` | `src/services/appDbSync.ts` |
| `OrderManagerCacheDB` | `OrderManagerDB` |
| `startAppCacheSync` | `startAppDbSync` |
| `getCacheSyncToken` | `getSyncToken` |
| `ORDER_MANAGER_CACHE_CATALOG` | `ORDER_MANAGER_SYNC_CATALOG` |
| `subscribeToCacheUpdates` | `subscribeToDbUpdates` |
| `initSeedCache` | `initSeedDb` |
| `populateFromCache` | `populateFromDb` |
| `cacheSubtitle` (`views/Settings.vue`) | `syncSubtitle` |
| `CachedProduct` (Dexie row type, `services/productDb.ts`) | `ProductRecord` |

`getOrderManagerDb` and `orderManagerDbName` already read correctly and do not change.

The one log prefix in this repo, at `src/cache/appCacheDb.ts:23`, becomes
`[db] Cannot open the Order Manager database: no OMS instance.`

User-facing copy in `views/Settings.vue`, passed through `translate()`:

| current | new |
| --- | --- |
| `translate("Local cache")` | `translate("Local database")` |
| `translate("Cache not synced yet")` | `translate("Database not synced yet")` |

No locale JSON file contains either string, so `translate()` falls back to the key and no
translation catalogue needs editing. The visible label changes from "Local cache" to
"Local database" — intended, since the panel reports IndexedDB row counts.

Prose in `docs/*.md` (7 files: `Compromises.md`, `OrderAllocationSummary.md`,
`OrderCloneDesign.md`, `OrderDetailDataBinding.md`, `OrderDetailStore.md`, `ProductData.md`,
`UnifiedFacilityInventoryModal.md`) updates only where it names a renamed identifier or calls the
IndexedDB layer a cache. One exception stays verbatim:
`UnifiedFacilityInventoryModal.md:329` mentions `facilityCache` in a "before" column describing
an approach that no longer exists — historical record, not current naming.

### Tier C — keeps `cache`, by design

These are genuinely caches: in-memory, evictable, and backed by a refetch or a durable layer
underneath. Renaming them would make the vocabulary less accurate, not more.

| thing | why it stays |
| --- | --- |
| `store/order.ts` — `this.cache`, `cacheOrders` | in-memory map of fetched orders; a miss refetches from the search service |
| `store/productCache.ts` — `useProductCacheStore`, `productCache` | reactive in-memory mirror **over** `services/productDb.ts`; the mirror is the cache, `productDb` is the DB. The pair already names both halves correctly |
| `components/orders/RejectItemsModal.vue` — `cachedReasons` | local `const` memo inside one function |
| `composables/useProductMaster.ts` — `cacheReady` | readiness of the in-memory mirror |
| `views/OrderDetail.vue:2368` — `uncached` (comment) | prose about the in-memory mirror |

`CachedProduct` is the one exception pulled out of this tier and into Tier B: it is the Dexie row
type declared in `productDb.ts`, so it names persisted shape, not the mirror. Because
`store/productCache.ts` declares `export type { CachedProduct, ProductIdentification }`, that file
is edited for the type rename even though the store, its id (`defineStore("productCache")`), and
`useProductCacheStore` all keep their names. Its consumers —
`composables/useProductMaster.ts`, `components/inventory/ProductInventoryModal.vue`,
`components/orders/CloneOrderModal.vue`, and the other import sites — change only the type name.

## Two cross-cutting runtime changes

These are behaviour changes, not renames, and each needs its own care.

### 1. The IndexedDB database name

`orderManagerDbName()` returns `${omsInstance}-OrderManagerCacheDB`; it becomes
`${omsInstance}-OrderManagerDB`.

Every existing client opens a new, empty database and re-syncs from Maarg on next login. The old
database is orphaned, not deleted. This is acceptable and deliberate: the base branch
`local_db_naming` is already changing database names by introducing the `oms` prefix, so the
re-sync cost is already being paid once in this line of work.

No Dexie `version()` bump is required — a different database name is a different database.

### 2. The BroadcastChannel name

The literal `"hotwax-cache-sync"` is duplicated in three files across both repos:
`common/cache/useCacheStatus.ts:101`, `common/cache/sync/pollingWorkerHarness.ts:36`, and
`order-manager/src/store/seed.ts:469`. A checkout where one repo has renamed the string and the
other has not silently stops seed updates propagating from the worker to the UI — no error, just
stale rows.

Fix the duplication rather than just the string: export

```ts
export const DB_SYNC_CHANNEL = "hotwax-db-sync";
```

from `@common/db` and have all three sites import it. `order-manager/src/store/seed.ts` then
cannot drift from `common`, because a stale checkout fails to resolve the import instead of
succeeding with the wrong value.

## Constraints to preserve

- **`cachedAt` needs no schema migration.** It is written by `projection.ts:59` and declared in
  `types.ts:11`, but appears in no Dexie schema string in `COMMON_CACHE_SCHEMA` — it is not an
  index. Nothing reads it; the only other reference is an assertion in
  `common/tests/projection.spec.ts:52`. Rows already persisted keep a `cachedAt` key until the
  next sync overwrites them, which is harmless because no code reads either name.
- **The sync worker's bundle must stay clean.** `src/workers/appSync.worker.ts` imports
  `@common/cache` as a deep path, never the `@common` barrel, and never `commonUtil` — Vite must
  emit this worker as a single IIFE. The rename must keep the deep specifier (`@common/db`) and
  must not let `src/db/orderManagerDb.ts` acquire a barrel or `commonUtil` import.
- **`common/tests/*.spec.ts` is orphaned.** `projection.spec.ts` and `workerFetch.spec.ts` import
  `../cache/*` and must be updated, but these specs do not run in CI and some already fail, so
  nothing will catch a missed edit. Verify by hand.

## Execution and merge order

`order-manager` consumes `common` through a tsconfig path alias (`../../common/*`), not a
published package, so the two repos are only ever correct when checked out together. There is no
version boundary to stage the change across.

Consequences:

1. Land both branches together. Neither compiles against the other's old state: renaming
   `@common/cache` breaks all seven `order-manager` import sites immediately.
2. Within each repo, do the whole rename in one commit per repo. A partial rename leaves the
   `BroadcastChannel` literal or the DB name half-migrated.
3. Announce the DB-name change with the merge, since every developer's local database resets.

## Verification

- `git grep -in 'cach' -- common` in `accxui` returns only the out-of-scope senses listed above.
- `git grep -in 'cach' -- src tests` in `order-manager` returns only Tier C entries,
  `VITE_CACHE_MAX_AGE`, and `.cache` in `vite.config.js`.
- `git grep -n 'hotwax-cache-sync'` returns nothing in either repo; `git grep -n DB_SYNC_CHANNEL`
  returns one definition and three import sites.
- `pnpm test` in `order-manager` passes, including the moved `tests/db/orderManagerDb.spec.ts`.
- Both `common/tests/projection.spec.ts` and `workerFetch.spec.ts` are read by hand to confirm the
  `../db/*` specifiers and the `syncedAt` assertion.
- Run the app: log in, confirm a fresh `${oms}-OrderManagerDB` appears in the browser's IndexedDB
  inspector and fills, and confirm Settings shows "Local database" with a non-zero row count and a
  recent sync time.
- Confirm the worker still bundles as a single chunk with no `commonUtil` in it.

## Not doing

- No behaviour, projection, sync-cadence, or schema change beyond the two runtime renames above.
- No Dexie version bump.
- No touching `inventory-count`; it does not import `@common/cache` at all.
- No sweep of Tier C, and no unrelated refactoring of the sync framework.
