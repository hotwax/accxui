# Using the Local Database — Developer Guide

**Audience:** app developers working in `apps/*`.
**Design of record:** [APP_DB_ARCHITECTURE.md](APP_DB_ARCHITECTURE.md) · diagrams in
[APP_DB_SYNC_FLOWS.md](APP_DB_SYNC_FLOWS.md).
**Last updated:** 2026-10-06 — `seedData` plain object for stores, `.withSync()` on seed list getters, `allowedTransitions` scoped to a status flow (§1a); `QueryOptions` combine `scope` + `equals` and `dateField` orders newest first (§1b); `syncNow` vs `syncAll`, held early activations (§5); `keyDefaults` (§2); refetch with no strategy is a no-op (§4); stop on `postLogin` too (§6). 2026-09-30 — `useSeedData` rewritten around one live query per seed table, with synchronous reactive getters and async `get*` getters (§1a); Company's `useSeed.ts` lookups now wrap it. 2026-09-29 — `common/db` split into `schema/`, `storage/`, `seed/`, `composables/`, `sync/` (deep-import paths in §6–§7); view-scoped activation moved onto `setupAppDbSync`; `useDbSync` removed.

This is the how-to. It answers "I need X on screen — what do I write?", using what Company and Order
Manager actually do. Read the design doc when you need to know *why*; read this to get work done.

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

The rule of thumb: **read from the database, never fetch reference data in a view.**

---

## 1. Choosing a read API

Three ways in. Pick by what the screen needs.

| You need | Use | Shape |
|---|---|---|
| A label, option list or joined lookup for seed data | `useSeedData()` in components; `seedData` in stores and utils | `seed.facilityName(id)` in a template or `computed` |
| A live list or row that re-renders on change | `useDb(table, options?)` | `{ records, first, count, hydrated, error }` |
| Row counts + last-sync per domain (Settings) | `useDbStatus(db, catalog, actions)` | `{ domains, totalRows, refreshAll, … }` |

### 1a. `useSeedData()` — seed lookups

Typed getters over the framework seed tables: labels, option lists and in-memory joins. It takes no
arguments and resolves the active database itself. This is Order Manager's main read path, and
Company's `useSeed.ts` lookups wrap it.

Each seed table is one Dexie `liveQuery`, opened the first time any getter needs it and kept until
sync stops (logout, or the stop at the start of a login). Every caller shares that one read, so a
table is read once per session, and the query re-emits whenever the table changes: the login sync
filling it, a `refreshAfterMutation`, or a resync from Settings. A table nobody asks for is never
read. There is no init step.

Getters come in two kinds, told apart by name:

| Kind | Names | Returns | Use it for |
|---|---|---|---|
| Reactive | no prefix: `statusDescription`, `facilityName`, `enumsByType`, `countries`, `shipmentMethodOptions`, `partyRelationshipTypes`, `allowedTransitions`, … | a value, synchronously | templates and `computed`s |
| Async | `get` prefix: `getFacilities`, `getGeos`, `getProductStores`, `getEnumsByType`, … | a Promise of the table's rows once its first local read lands | code that must act on the rows, such as building a request from them |

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

**In stores, services and utils, use `seedData`, not `useSeedData()`.** It is the same getter set as
a plain object, and it reads the same shared tables, so it answers exactly what the composable does.
Pinia stores never call a composable:

```ts
import { seedData } from "@common/db";

const parentTypeId = seedData.facilityType(seedData.facility(facilityId)?.facilityTypeId)?.parentTypeId;
```

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
// Order Manager's AddContactModal: "no states" only once geos have synced (SG, HK have none).
const countryStates = computed(() => seed.statesForCountry.withSync(form.countryGeoId));
const isLoadingStates = computed(() => !!form.countryGeoId && !countryStates.value.synced);
```

`synced` stays false if that domain's sync fails, so a screen that must not spin forever also
accepts "first read landed and `serviceState.running` is false" (Order Manager's
`OrderTimeline.vue` does this).

**The async `get*` getters wait for the first local read, not for the sync.** Use them when the rows
must be in hand before you continue, such as code that stamps a looked-up value permanently
(`buildAddressState` in Order Manager's `BadAddressTaskCard.vue` awaits `getGeos()`). On a fresh
login they can still resolve `[]`, so they do not tell "not synced yet" from "empty". Use
`.withSync()` or `useDb`'s `hydrated` for that.

Label getters accept a missing id (`undefined` or `null`) and answer `""`; list getters answer `[]`.
Countries come from `geoTypeEnumId === "GEOT_COUNTRY"`; a country's states follow its `GAT_REGIONS`
associations only, so group memberships such as DBIC never appear as states.

`allowedTransitions(statusId, statusFlowId?)` reads one status flow, `Default` unless you name
another, as OMS does for an order with none. Flows reuse status ids, so reading every flow would mix
their transitions. Rows come in `transitionSequence` order with `toStatusDescription` added, and
carry `transitionName` and `conditionExpression`.

### 1b. `useDb()` — reactive reads

One entry point, always a list, backed by a Dexie `liveQuery`. Most of Company's read composables
are built on it; its seed lookups in `useSeed.ts` wrap `useSeedData` instead.

Pick `useSeedData` for read-only seed lookups: labels, dropdown options, names by id. Pick `useDb`
when the screen queries a table (`equals`, `scope`, `filter`, a date range), needs `hydrated` for
its loading and empty states, or reads one of the app's own tables. Each `useDb` call is its own
subscription, closed on unmount; `useSeedData`'s are shared and live for the session.

```ts
import { useDb } from "@common/db";

// Whole table, live.
const { records, hydrated } = useDb<any>("statuses");

// One row: `equals` on the primary key is an index lookup, and `first` is the row.
const { first: shop, hydrated } = useDb<any>("shopifyShops", () => ({ equals: { shopId: props.id } }));

// A scoped slice.
const { records } = useDb<any>("productStoreFacilities", { scope: { field: "productStoreId", value: id } });
```

Pass a **function** when the options depend on reactive state — it re-subscribes when they change,
and until the new query's first emit `records` is empty and `hydrated` is false, so shop A's rows
never render under shop B. Pass a plain object when they're static.

For a single-row read whose id may not be known yet, return `{ filter: () => false }` rather than
`{}` while it is missing: `{}` reads the whole table, and `first` would be some other row.

`useDb(table, options?)` reads the signed-in app database; `useDb(db, table, options?)` takes an
explicit Dexie handle.

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
const { domains, totalRows, lastSyncedAt, refreshDomain, refreshAll } = useDbStatus(
  orderManagerDb.raw(),
  orderManagerDb.statusCatalog,              // or: async () => catalogFrom(yourRegisteredDomains)
  { resyncDomain, resyncAll: resyncReferenceData },
);
```

Actions are injected rather than imported, because the card must refresh through the same service
that owns your app's worker.

---

## 2. Adding a table to your app

Four steps. Miss the last one and existing installs keep the old row shape.

**1. Declare the entity.** In your app's schema module (`src/db/companySchema.ts`):

```ts
widgets: defineEntity({
  primaryKey: "widgetId",              // comma-separate for a compound key: "shopId,widgetId"
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

A row missing **any** primary-key member is dropped as unkeyable. If the server legitimately omits
a key member (a document attached to no feed), give it a stand-in with `keyDefaults: { feedId: "" }`.
Each key in `keyDefaults` must be a primary-key field. Use it only where the absence is a real state,
never to cover a wrong field name.

> ⚠️ **`fields` is a whitelist, and it is the only thing stored.** A field you don't declare is
> dropped at write time — it is not tucked away anywhere. If a screen needs it, declare it. This is
> the single most common cause of "the row is in IndexedDB but my field is undefined".

**2. Add an index for every way you query it.** A `scope`, `equals` or `dateField` with no index
still works, but it reads the whole table and filters or sorts in memory. A two-part question ("this
shop's widgets, newest first") wants a compound index `[shopId+createdDate]`, not two single-field
ones: the read then comes back filtered and ordered from the index alone.

**3. Bump the version** in your app's db module:

```ts
export const companyDb = defineAppDb({
  suffix: "CompanyDB",
  version: 4,                          // ← was 3
  schema: mergeSchemas(commonSchema.pick([...COMPANY_SEED_TABLES]), companySchema),
});
```

**4. Give it a domain** so something fills it — §3.

### Why the version bump is not optional

A database recording a different version than the build declares is **dropped and rebuilt** on first
use, and the worker refills it. That is the only migration mechanism: there is no in-place upgrade.

Bump it for *any* schema change — new table, added or removed index, changed primary key, changed
`fields`, changed `rename` or `keyDefaults`. **Nothing detects a forgotten bump.** The app will run, and rows written
by the previous build will still be there with their old shape — a `date` field still holding an ISO
string, a renamed field still absent. Treat bumping as part of the change, not a step afterwards.

### Picking seed tables

Take only what you read:

```ts
const COMPANY_SEED_TABLES = ["productStores", "statuses", "enums", "facilities", /* … */] as const;
mergeSchemas(commonSchema.pick([...COMPANY_SEED_TABLES]), companySchema)
```

Order Manager reads all of them, so it just passes `commonSchema`. An app picking seven gets seven
tables, not 29.

Two ways to fill a seed table differently from the framework:

- **Same table, your own domain.** Pick the seed table, and register a domain with the seed domain's
  **name** and your endpoint, leaving the seed one out of `registerDomains`. Company does this for
  `statuses`: it picks the seed table, but registers `{ name: "status", listUrl: "oms/statuses" }`
  from `referenceDomains.ts` instead of the seed `admin/status` one, and filters it out through
  `OVERRIDDEN_SEED_TABLES` in `workers/appSyncDomains.ts`. Company's status card is built from that
  same list (`catalogFrom(appSyncDomains)`), so it shows the domain that actually runs. Don't ask the
  worker for it (`syncService()?.catalog()`): before the worker is up, or after it failed to start,
  that is empty, and the card loses the per-domain Refresh exactly when it is the way back.
- **Your own table under a seed name.** Declare it in your own schema and don't `pick` the seed one.
  The framework tracks provenance, so `appDb.statusCatalog` leaves it out instead of pointing it at
  the seed endpoint.

---

## 3. Filling a table: pick a sync class

| Class | Meaning | Cadence | Use |
|---|---|---|---|
| **B** | Reference / config. Rarely changes. | Once per login, then only on mutation | `defineSnapshotDomain` |
| **A** | Live, append-mostly. Transactional. | `intervalMs`, only while a view needs it | `defineCursorDomain`, or hand-written |
| **C** | Write-through only. | Never polled | hand-written |

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
  scopeOf: (args) => (args.shopId ? { field: "shopId", value: args.shopId } : undefined),
})
```

⚠️ **Probe the endpoint before trusting a cursor param.** Filter support is per-route, not a Moqui
convention. `admin/dataManager/details` honours `_from` but ignores `_op`; `admin/systemMessages`
ignores both and silently returns the unfiltered page. If the server ignores your param the `keep`
predicate still trims client-side, but you pay for the full page every tick.

**Then register it** in your worker entry (`src/workers/appSync.worker.ts`):

```ts
registerDomains([...companySeedDomains, widgetDomain, /* … */]);
```

A domain that isn't registered never runs, with no error. There's a test for this in Company
(`tests/db/domainTables.spec.ts`) asserting every registered domain's table is declared — worth
copying if you add domains.

---

## 4. Keeping the database fresh after a write

Mutations go to the server first, then you reconcile the local row. Never write the server's
response into the table yourself.

```ts
import { refreshAfterMutation } from "@/services/appDbSync";

const response = await api({ url: "oms/widgets", method: "post", data: { widgetId, widgetName } });
// ...check the response however your app does (Company has a local `hasError` / `assertSuccessful`)
// and only reconcile once the write is known to have landed:
await refreshAfterMutation("widget", { widgetId });   // domain name + primary key
```

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

---

## 5. Polling while a view is open (class A)

Class-A domains are off by default. A view switches on what it reads, with args, and switches them
off when it leaves. The three functions come from your app's `services/appDbSync.ts`, which
re-exports them from `setupAppDbSync`:

```ts
import { activateSyncDomains, createSyncDomainOwner, deactivateSyncDomains } from "@/services/appDbSync";

// Once per screen instance, at setup — never a shared constant.
const SYNC_OWNER = createSyncDomainOwner("widgetView");

const widgetSyncDomains = () => [
  { name: "widgetEvent", intervalMs: 15_000, args: { shopId: props.id } },
  { name: "systemMessage", args: { types: [{ systemMessageTypeId: "WidgetSync" }] } },
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
- always deactivate in `onIonViewDidLeave`. There is no `onUnmounted` fallback, so a view that
  forgets leaves its domains polling.

**What the screen can read back:**

| From `services/appDbSync` | Use |
|---|---|
| `syncDomainsReady` | `Ref<boolean>` — the worker has accepted this activation |
| `syncDomainsError` | `ComputedRef<string>` — an error from one of the *activated* domains, else `""`. Drive the screen's warning banner from this |
| `syncNow()` | Force a pass over **this screen's** activated domains (a "refresh" button). Not the login seed set, and it clears no markers. Called mid-pass, it queues a fresh pass instead of resolving against the running one |
| `serviceState.syncedAt[domain]` (from `@common/db`) | When that domain last finished a pass **for its current activation**. Use it to tell "nothing for this shop" from "not fetched yet". It is removed when the screen leaves or re-scopes the domain, and cleared on logout |

**One screen, one set.** There is one worker and one active set. If two features on one screen
both need polling, build one combined list and activate it once, the way `useShopify` composes its
sync sessions. Two separate `activateSyncDomains` calls overwrite each other. The login set (class
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
  which is usually not what your screen needs. Declare a scope (this shop's remotes, this config)
  so the window is about your data. Company encodes this policy in `src/config/appSyncConfig.ts`.

`NetSuite.vue` is the smallest complete example; `ShopifyProductSync.vue` is the fullest.

Leaving the view stops the polling but keeps the rows, so a revisit paints instantly.

---

## 6. Standing up a database for a new app

Six files. Copy Order Manager if your app only reads seed data; copy Company if it has its own tables.

```ts
// 1. src/db/myAppDb.ts — DEEP imports only, never "@common/db" (the worker reaches this file)
import { defineAppDb } from "@common/db/schema/defineAppDb";
import { commonSchema } from "@common/db/seed/seedSchema";

export const myAppDb = defineAppDb({ suffix: "MyAppDB", version: 1, schema: commonSchema });
myAppDb.setOmsInstanceResolver(() => "default");        // test fallback; main.ts replaces it
```

```ts
// 2. src/workers/appSync.worker.ts — deep imports; registration happens here
import { commonDomains } from "@common/db/seed/seedDomains";
import { exposeWorkerHarness } from "@common/db/sync/pollingWorkerHarness";
import { registerDomains } from "@common/db/sync/syncRegistry";
import { myAppDb } from "@/db/myAppDb";

registerDomains(Object.values(commonDomains));
exposeWorkerHarness((omsInstance) => myAppDb.get(omsInstance));
```

```ts
// 3. src/services/appDbSync.ts — the main-thread facade (barrel import is fine here)
import { createSyncService, setupAppDbSync } from "@common/db";
import { myAppDb } from "@/db/myAppDb";
import workerUrl from "@/workers/appSync.worker.ts?worker&url";

export const {
  startAppDbSync, stopAppDbSync, refreshAfterMutation,
  resyncDomain, resyncReferenceData, syncService, bootstrapState,
  // Only if the app has class-A domains (§5):
  activateSyncDomains, deactivateSyncDomains, createSyncDomainOwner,
  syncDomainsReady, syncDomainsError, syncNow,
} = setupAppDbSync({ db: myAppDb, getWorkerUrl: () => new URL(workerUrl, import.meta.url), createSyncService });
```

```ts
// 4. src/main.ts — register the real resolver, keeping commonUtil out of the worker chunk
myAppDb.setOmsInstanceResolver(() => commonUtil.getOMSInstanceName());
```

```ts
// 5. src/App.vue — start on login. WATCH, don't check once.
watch(useAuth().isAuthenticated, (authed) => { if (authed) void startAppDbSync() }, { immediate: true });
```

```ts
// 6. src/store/user.ts — stop and clear at the start of postLogin, and again on logout
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

If your app's domains reach the database through `myAppDb.entity(...)` rather than the factories,
the worker must also register the resolver — see how Company does it inside `exposeWorkerHarness`.

---

## 7. Rules that will bite you

**Never import `@common/db` (the barrel) from anything the worker reaches.** It re-exports modules
that import `vue`, and Vite must emit the worker chunk as a single iife. Use deep imports in your db
module, your schema module, and every domain file. The barrel is fine in components, composables and
`services/appDbSync.ts`.

Deep imports follow the folder layout of `common/db`:

| Folder | What you import from it | Worker-safe |
|---|---|---|
| `@common/db/types` | `DbRow`, `DbKey`, `FieldKind`, `SyncContext`, `SyncDomain` | yes |
| `@common/db/schema/*` | `defineEntity`, `defineSchema` / `mergeSchemas`, `defineAppDb`, `appDbRegistry` | yes |
| `@common/db/storage/*` | `baseDb` (`hasSyncedThisLogin`, …), `dbClient` (`EntityClient`), `projection` (`toMillis`, `canonicalKey`, …) | yes |
| `@common/db/seed/*` | `seedSchema` (`commonSchema`), `seedDomains` (`commonDomains`) | yes |
| `@common/db/sync/*` | `defineSyncDomain`, `defineSnapshotDomain`, `syncRegistry`, `pollingWorkerHarness` | yes, except `syncService` and `setupAppDbSync` |
| `@common/db/composables/*` | `useDb`, `useSeedData`, `useDbStatus` | **no** — main thread only; import them from the barrel |

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

**A hand-written `liveQuery` needs an `async` querier that awaits inside it.** Dexie tracks which
tables a querier read only across the awaits of an `async` function; a plain arrow that returns a
promise loses the tracking at its first await, so the query never re-runs when the table changes.
`useDb` and `useSeedData` already do this.

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
| Table stays empty, no error | Domain not registered, or the table name differs between domain and schema | Worker entry; copy Company's `domainTables.spec.ts` |
| Table empty and the status card says "none" | Class-B domain never ran — check `syncMeta` for its `loginSync:` marker | Force via `resyncDomain(name)` |
| Snapshot wiped rows that still exist server-side | Envelope mis-declared, so the response unwrapped to `[]` | `collectionKey`; add `strictCollection: true` |
| Rows stop updating after switching OMS instance | A captured Dexie handle instead of the late-binding client | Use `appDb.entity()` / `appDb.client()`, never a stored `raw()` |
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

## 9. Where things live

| | Company | Order Manager |
|---|---|---|
| Own schema | `src/db/companySchema.ts` (48 tables) | none — takes all 29 seed tables |
| Database | `src/db/companyDb.ts` | `src/db/orderManagerDb.ts` |
| Worker entry | `src/workers/appSync.worker.ts` | `src/workers/appSync.worker.ts` |
| Own domains | `src/workers/domains/*.ts` | none |
| Sync policy | `src/config/appSyncConfig.ts` | none — harness default |
| Main-thread facade | `src/services/appDbSync.ts` | `src/services/appDbSync.ts` |
| Per-view activation | `activateSyncDomains` / `deactivateSyncDomains` from `src/services/appDbSync.ts` | none |
| Read examples | `src/composables/useSeed.ts` (seed lookups wrap `useSeedData`) | `useSeedData()` reactive getters throughout; `seedData` in `src/store/orderDetail.ts` |
