# AccxUI Local Database & Sync — Flow Diagrams

**Status:** Approved
**Version:** 1.2
**Date:** 2026-09-30
**Companion:** [APP_DB_ARCHITECTURE.md](APP_DB_ARCHITECTURE.md) — the prose design; this document is
the diagram set it references.
**How-to:** [APP_DB_DEVELOPER_GUIDE.md](APP_DB_DEVELOPER_GUIDE.md) — recipes for app developers.

Each flow names the module that realizes it beneath the diagram. Module and symbol names rather
than line numbers, so the references stay true as the code moves.
Bare framework file names live under `common/db/` in `schema/`, `storage/`, `seed/`, `composables/` or
`sync/`; the [file index](APP_DB_ARCHITECTURE.md#9-reference--file-index) gives each one's folder.

| Id | Flow |
|---|---|
| [F-ENT](#f-ent--entity-declaration-and-validation) | Entity declaration and validation |
| [F-SCH](#f-sch--schema-composition) | Schema composition (pick / merge / extendIndexes) |
| [F-DB](#f-db--database-creation-and-oms-scoping) | Database creation and OMS scoping |
| [F-BOOT-M](#f-boot-m--main-thread-module-evaluation) | Main-thread module evaluation |
| [F-BOOT-W](#f-boot-w--worker-module-evaluation-and-registration) | Worker module evaluation and registration |
| [F-START](#f-start--login-to-first-sync) | Login to first sync (full sequence) |
| [F-TICK](#f-tick--harness-tick-and-scheduling) | Harness tick and the scheduling rule |
| [F-SNAP](#f-snap--class-b-snapshot-domain-sync) | Class-B snapshot domain sync |
| [F-FAN](#f-fan--fan-out-snapshot) | Fan-out snapshot |
| [F-CUR](#f-cur--class-a-cursor-domain-sync) | Class-A cursor domain sync |
| [F-PAGE](#f-page--pagination) | Pagination (`pageAll` vs `pageNewestFirst`) |
| [F-PROJ](#f-proj--projection-and-snapshot-replace) | Projection and snapshot-replace |
| [F-MUT](#f-mut--mutation-write-through) | Mutation write-through (`refreshAfterMutation`) |
| [F-CONC](#f-conc--worker-concurrency-queues) | Worker concurrency queues |
| [F-ACT](#f-act--per-view-class-a-activation) | Per-view class-A activation (Company) |
| [F-READ](#f-read--read-paths) | Read paths (`useDb`, `useSeedData`, `useDbStatus`) |
| [F-ERR](#f-err--error-and-status-propagation) | Error and status propagation |
| [F-TOK](#f-tok--token-freshness) | Token freshness |
| [F-TEAR](#f-tear--logout-instance-switch-teardown) | Logout, instance switch, teardown |
| [F-APPS](#f-apps--company-vs-order-manager-wiring) | Company vs Order Manager wiring |

---

## F-ENT — Entity declaration and validation

Every branch below throws at **module-evaluation time**, so a bad declaration fails the app's first
import rather than producing a permanently empty index.

```mermaid
flowchart TD
    A["defineEntity({ primaryKey, fields, indexes?, rename? })"] --> B["split primaryKey on ','<br/>trim, drop empties"]
    B --> C{"any PK field?"}
    C -- no --> X1["THROW: a non-empty primaryKey is required"]
    C -- yes --> D{"PK field repeated?"}
    D -- yes --> X2["THROW: primaryKey repeats field"]
    D -- no --> E{"PK field declared in fields?"}
    E -- no --> X3["THROW: key member that is never stored"]
    E -- yes --> F["keyPath = 1 field ? 'id' : '[a+b+c]'"]
    F --> G{"for each index"}
    G --> H{"duplicate?"}
    H -- yes --> X4["THROW: duplicate index"]
    H -- no --> I{"index === keyPath?"}
    I -- yes --> X5["THROW: restates the primary key"]
    I -- no --> J{"looks like a compound index, i.e. bracketed a+b?"}
    J -- yes --> K{"every member declared?"}
    K -- no --> X6["THROW: compound index names an undeclared field"]
    K -- yes --> G
    J -- no --> L{"index declared in fields?"}
    L -- no --> X7["THROW: index on an unprojected field"]
    L -- yes --> G
    G -- done --> M["Entity {<br/>primaryKey, primaryKeyFields,<br/>fields, fieldNames, indexes, rename,<br/>schema = [keyPath, ...indexes].join(', ')<br/>}"]
```

Source: `common/db/schema/defineEntity.ts`.
Coercion kinds consumed later by `projectRow`: `common/db/storage/projection.ts`.

---

## F-SCH — Schema composition

```mermaid
flowchart TD
    subgraph fw["Framework"]
      CE["29 defineEntity calls"] --> CSD["defineSchema(map, { seed: true })"]
      CSD --> CSCH["commonSchema<br/>entities, stores, seedTables = 29 names"]
    end

    subgraph app["App"]
      AE["app defineEntity calls"] --> ASD["defineSchema(map)"]
      ASD --> ASCH["companySchema<br/>seedTables = empty"]
    end

    CSCH --> P["pick(['productStores', 'statuses', ...17])"]
    P --> PS["AppSchema subset<br/>seedTables = the 17 picked"]
    PS --> MS["mergeSchemas(picked, appSchema)"]
    ASCH --> MS
    MS --> CHK{"table claimed twice?"}
    CHK -- yes --> XT["THROW: table claimed by more than one schema"]
    CHK -- no --> FIN["AppSchema<br/>entities: 17 + 48 = 65<br/>stores: same keys, Dexie strings<br/>seedTables: the 17"]

    FIN -.optional.-> EI["extendIndexes({ table: ['extraIdx'] })<br/>rebuilds via defineEntity,<br/>so F-ENT validation reruns"]
```

Guards, all in `defineSchema.ts`: `"syncMeta"` may not be declared; `pick` and `extendIndexes` throw
on an unknown table; `mergeSchemas` throws on a collision. All three combinators return fresh
objects and never mutate their input.

**Why `seedTables` is provenance and not a name test:** an app may declare its own table under a seed
table's name (Company's `statuses` hits `oms/statuses`, the seed one hits `admin/status`).
`defineSchema.ts`.

---

## F-DB — Database creation and OMS scoping

```mermaid
flowchart TD
    DEF["defineAppDb({ suffix, version, schema })"] --> V{"suffix non-empty?"}
    V -- no --> XS["THROW"]
    V -- yes --> CAT["statusCatalog =<br/>Object.keys(stores)<br/>.filter(t => seedTables.has(t) && t in commonDomainsByTable)<br/>.map(t => name/table/label/syncClass)"]
    CAT --> CLS["class AppDatabase extends BaseDB<br/>super(dbName, stores, version)"]
    CLS --> LC["lateClient = dbClient(raw, schema.entities)<br/>built from the RESOLVER, not a handle"]
    LC --> SET["setAppDb(appDb) into appDbRegistry"]
    SET --> RET["AppDb facade"]

    RET --> G["get(omsInstance)"]
    G --> GN["dbName = omsInstance + '-' + suffix"]
    GN --> GQ{"activeDb?.name === dbName"}
    GQ -- yes --> GR["reuse handle"]
    GQ -- no --> GC["activeDb?.close()<br/>a liveQuery holding it stops serving the old tenant"]
    GC --> GO["activeDb = new AppDatabase(dbName)"]

    RET --> R["raw()"]
    R --> RQ{"resolver registered?"}
    RQ -- no --> XR["THROW: call setOmsInstanceResolver at boot"]
    RQ -- yes --> G
```

`BaseDB` then appends `syncMeta: "key"` and calls `version(n).stores(combined)`
(`baseDb.ts`).

### Database readiness and the version gate

```mermaid
flowchart TD
    ERS["ensureDbReady(db)"] --> EDR["open the database"]
    EDR --> OPQ{"db.isOpen()?"}
    OPQ -- yes --> OK["ready"]
    OPQ -- no --> OPN["db.open()"]
    OPN --> OPE{"threw?<br/>e.g. 'Not yet support for changing primary key'"}
    OPE -- no --> OK
    OPE -- yes --> REB["close + Dexie.delete(name) + open()<br/>REBUILD (data lost, worker refills)"]
    REB --> OK

    OK --> MK["read syncMeta['schemaVersion']"]
    MK --> MQ{"recorded === declaredVersion?"}
    MQ -- yes --> DONE["return"]
    MQ -- no --> CLR["close, Dexie.delete(name), reopen<br/>then record declaredVersion"]
    CLR --> DONE

    NOTE["never throws: a failed shape check must not block boot"] -.-> ERS
```

One rule, one knob: a recorded version that differs from the declared one means the database was
built by another build, so it is dropped and rebuilt rather than migrated. That covers a new store,
a dropped index, a changed key path and a changed projection alike. An absent marker and a *lower*
declared version (a rollback) both count as mismatches.

The check is memoised per database name; the open is not, so a connection closed later is reopened.

Source: `baseDb.ts`.

---

## F-BOOT-M — Main-thread module evaluation

```mermaid
sequenceDiagram
    autonumber
    participant M as main.ts
    participant DBM as db/companyDb.ts
    participant FW as defineAppDb
    participant REG as appDbRegistry
    participant SVC as services/appDbSync.ts

    M->>DBM: import
    DBM->>FW: defineAppDb({ suffix, version, schema })
    FW->>REG: setAppDb(appDb)
    DBM->>DBM: setOmsInstanceResolver(() => "default")  // test fallback
    M->>DBM: setOmsInstanceResolver(() => commonUtil.getOMSInstanceName())
    Note over M,DBM: main.ts replaces the fallback.<br/>Kept out of the db module so commonUtil never reaches the worker chunk.
    M->>SVC: import
    SVC->>SVC: setupAppDbSync({ db, getWorkerUrl, createSyncService })
    Note over SVC: no worker spawned yet — start() does that
```

Company: `apps/company/src/main.ts`, `src/db/companyDb.ts`, `src/services/appDbSync.ts`.
Order Manager: `apps/order-manager/src/main.ts`, `src/services/appDbSync.ts`.

---

## F-BOOT-W — Worker module evaluation and registration

```mermaid
flowchart TD
    W["appSync.worker.ts (separate realm)"] --> I1["import commonDomains<br/>(deep import, never the barrel)"]
    W --> I2["import app domain modules"]
    I2 --> DE["each module runs defineSnapshotDomain /<br/>defineCursorDomain / defineSyncDomain at import time"]
    I2 --> EC["each hand-written module also creates<br/>companyDb.entity('table') in module scope<br/>(late-binding, see F-DB)"]
    W --> I3["import companyDb / orderManagerDb"]
    I3 --> SA["defineAppDb runs again in THIS realm<br/>and calls setAppDb into the worker's own registry"]
    DE --> RD["registerDomains([...])<br/>Map name -> SyncDomain"]
    I1 --> RD
    RD --> EX["exposeWorkerHarness(getDb)<br/>= Comlink expose(createSyncHarness(getDb))"]
    EX --> SUB["subscribeToken(...) — this harness instance's own<br/>BroadcastChannel subscription"]
```

Company additionally rebinds the resolver inside the worker realm, because its hand-written domains
reach the DB through `companyDb.entity(...)` which resolves via `raw()`:

```ts
// apps/company/src/workers/appSync.worker.ts
exposeWorkerHarness((omsInstance) => {
  companyDb.setOmsInstanceResolver(() => omsInstance);
  return companyDb.get(omsInstance);
});
```

Order Manager does not need it — every one of its domains is factory-built and resolves through
`getAppDb().get(omsInstance)`, which takes the instance as a parameter
(`apps/order-manager/src/workers/appSync.worker.ts`).

```mermaid
graph LR
    subgraph MT["Main-thread realm"]
      R1[("appDbRegistry<br/>activeAppDb")]
      D1["domain registry: EMPTY<br/>(no worker entry imported here)"]
    end
    subgraph WK["Worker realm"]
      R2[("appDbRegistry<br/>activeAppDb")]
      D2["domain registry: N domains"]
    end
    IDB[("IndexedDB<br/>{oms}-CompanyDB")]
    R1 --> IDB
    R2 --> IDB
    MT <-. BroadcastChannel + postMessage + Comlink .-> WK
```

---

## F-START — Login to first sync

```mermaid
sequenceDiagram
    autonumber
    participant U as user.ts / App.vue
    participant SAS as setupAppDbSync
    participant SS as createSyncService
    participant WF as WorkerFactory
    participant H as SyncHarness (worker)
    participant DB as IndexedDB
    participant API as Maarg

    U->>SAS: startAppDbSync()
    Note over SAS: idempotent — a second call returns the same in-flight promise
    Note over SAS: generation is bumped on every start and stop
    SAS->>SS: createSyncService({ workerUrl, db: appDb.raw(), onStatus })
    SAS->>SS: start()
    Note over SS: idempotent too — its own starting promise and startGeneration
    SS->>DB: ensureDbReady(db) — version gate
    Note over SS,DB: runs BEFORE the worker exists, so nothing can race it
    SS->>SS: generation check (stop() during the shape check aborts here)
    SS->>WF: createWorker(workerUrl)
    WF-->>SS: { api (Comlink), terminate, worker }
    SS->>SS: worker.onmessage = handleMessage(generation, e)
    SS->>SS: publisher = createTokenPublisher(), then lastToken = commonUtil.getToken()
    SS->>H: api.start({ maargUrl, token, omsInstance, baseTickMs, domains })
    H->>H: ctx = { maargUrl, token, omsInstance, now }
    H->>H: active = payload.domains ?? every registered class-B domain
    H->>DB: ensureDbReady(getDb(omsInstance))
    alt open failed
        H-->>SS: postMessage sync-error { domain: "__start" }
        H-->>SS: throw
    end
    H->>H: clear lastRunAt
    H->>H: await tick()
    loop each due domain
        H-->>SS: sync-start
        H->>API: fetch pages
        H->>DB: write rows
        H-->>SS: sync-end { domain, written, at, retryPending }
        H-->>U: BroadcastChannel domain-synced
    end
    H-->>U: BroadcastChannel sync-complete
    H->>H: timer = setInterval(tick, baseTickMs ?? 5000)
    SS-->>SAS: resolved
    SS->>SS: tokenWatch = setInterval(pushTokenIfChanged, 15000)
    SAS->>SAS: clearDomainErrors("__start"), then onSynced?.()
```

Entry points that call `startAppDbSync()`:

| App | Where |
|---|---|
| Company | `App.vue` (on `isAuthenticated` flipping true), `store/user.ts` (`postLogin`), `useCarriers.ts` (via the `startReferenceSync` alias) |
| Order Manager | `App.vue`, `store/user.ts` |

Both paths are safe to fire together — `startAppDbSync` and `SyncService.start` are each idempotent.
The start is driven off a watcher rather than `onMounted` because `isAuthenticated` is false at mount
and flips true a moment later, which an `onMounted`-only start would miss entirely (`App.vue`).

---

## F-TICK — Harness tick and scheduling

```mermaid
flowchart TD
    T["tick(force?, propagateErrors?)"] --> G{"running || !ctx.token"}
    G -- yes --> RET["return — a tick never overlaps itself,<br/>and never runs tokenless"]
    G -- no --> SET["running = true"]
    SET --> DUE{"force?"}
    DUE -- yes --> ALL["due = active (every activation)"]
    DUE -- no --> CALC["due = dueDomains(active, lastRunAt, now, effectiveInterval)"]
    ALL --> LOOP
    CALC --> LOOP["for each due activation, SEQUENTIALLY"]
    LOOP --> RD["runDomain(entry) via runExclusiveDomainOperation(entry.name)"]
    RD --> EX["executeDomain"]
    EX --> POST1["post sync-start"]
    POST1 --> CALL["domain.sync(ctx, entry.args, { force })"]
    CALL --> OK{"threw?"}
    OK -- no --> COMP["completed = force<br/>|| effectiveInterval !== undefined<br/>|| hasSyncedThisLogin(db, name)"]
    COMP --> STAMP{"completed?"}
    STAMP -- yes --> S1["lastRunAt[activationKey] = now"]
    STAMP -- no --> S2["leave clock unset — retried next tick"]
    S1 --> POST2["post sync-end { written, at, retryPending }"]
    S2 --> POST2
    POST2 --> BC["BroadcastChannel domain-synced"]
    OK -- yes --> ERRS{"has cadence?"}
    ERRS -- yes --> S3["stamp lastRunAt anyway — do not hot-loop a failing class-A domain"]
    ERRS -- no --> S4["leave unset — class B retries next tick"]
    S3 --> POST3["post sync-error"]
    S4 --> POST3
    POST3 --> LOOP
    BC --> LOOP
    LOOP -- done --> DONE["BroadcastChannel sync-complete;<br/>throw an aggregate if propagateErrors and any failed"]
    DONE --> FIN["running = false (finally)"]
```

### The `dueDomains` rule

```mermaid
flowchart LR
    A["activation entry"] --> K["key = activationKey(entry)<br/>= name, or name + stableStringify(args)"]
    K --> L["last = lastRunAt[key]"]
    L --> I{"intervalFor(entry) defined?"}
    I -- no --> N{"last === undefined?"}
    N -- yes --> DUE1["DUE (class-B bootstrap)"]
    N -- no --> ND1["not due — never again this session"]
    I -- yes --> Y{"last === undefined?"}
    Y -- yes --> DUE2["DUE (first run)"]
    Y -- no --> C{"now - last >= interval?"}
    C -- yes --> DUE3["DUE"]
    C -- no --> ND2["not due"]
```

**Why the clock key includes the args** (`syncRegistry.ts`): one page can activate the same domain
several times with different args and different cadences. Keyed on name alone they would share one
clock, and the fastest activation would restamp it on every tick, so a slower one's interval could
never elapse — it would run once on page entry and then never again, with no error, because the
first tick *does* run it.

Source: `pollingWorkerHarness.ts`, `syncRegistry.ts`.

---

## F-SNAP — Class-B snapshot domain sync

```mermaid
flowchart TD
    S["domain.sync(ctx, _args, { force })"] --> DB["db = getDb(ctx.omsInstance)"]
    DB --> PJ["projection = config.projection ?? getAppDb().entities[table]"]
    PJ --> PJQ{"found?"}
    PJQ -- no --> XP["THROW: no entity projection for table"]
    PJQ -- yes --> GUARD{"!force && hasSyncedThisLogin(db, name)?"}
    GUARD -- yes --> Z0["return 0 — once per login"]
    GUARD -- no --> FO{"config.fanOut?"}
    FO -- yes --> FAN["see F-FAN"]
    FO -- no --> PA["pageAll({ url: listUrl, collectionKey, strictCollection,<br/>params: listParams, batchSize ?? 250, unpaged,<br/>keyOf: snapshotKeyOf })"]
    FAN --> UK
    PA --> UK{"records.length > 0<br/>&& isUnkeyableFetch(records, projection)?"}
    UK -- yes --> W1["warn + return 0<br/>GUARD 1: fetched rows, none keyable — do NOT replace"]
    UK -- no --> CNT["currentCount = db.table(table).count()"]
    CNT --> EMPT{"!force && records.length === 0 && currentCount > 0?"}
    EMPT -- yes --> W2["warn + return 0<br/>GUARD 2: refuse to wipe a populated table on an empty auto fetch"]
    EMPT -- no --> REPL["defineCachedEntity(db, table, projection)<br/>.snapshotReplace(records, config.scopeOnSync)"]
    REPL --> MARK{"records.length === 0 || written > 0?"}
    MARK -- yes --> M1["markSyncedThisLogin(db, name)"]
    MARK -- no --> M2["leave unmarked — the harness retries next tick"]
    M1 --> R["return written"]
    M2 --> R
```

Source: `defineSnapshotDomain.ts`.

Both guards stand down for `force`, which is how every manual path arrives — `syncNow`,
`syncDomainNow` and `resyncDomain` all reach the domain as `{ force: true }`.

---

## F-FAN — Fan-out snapshot

For child collections that only exist under a parent (`productStoreFacilities`,
`productStoreFacilityGroups`, `productStoreShipmentMethods`).

```mermaid
sequenceDiagram
    participant D as snapshot domain
    participant DB as IndexedDB
    participant API as Maarg

    D->>DB: read fanOut.parentTable (e.g. productStores)
    DB-->>D: parent rows
    D->>D: parentIds = unique(row[parentKeyField]).filter(Boolean)
    loop for each parentId
        D->>API: pageAll(urlFor(parentId))
        API-->>D: child rows
        D->>D: stamp each child with { [parentKeyField]: parentId }
        Note over D: the parent key is stamped client-side,<br/>because the child endpoint does not echo it
    end
    D->>DB: snapshotReplace(all stamped rows)
```

`refetchOne` on a fan-out domain without a `byPk` takes a narrower path: re-list **that one parent**
and snapshot-replace only `{ field: parentKeyField, value: parentId }`, so one store's slice is
refreshed and pruned without touching the others (`defineSnapshotDomain.ts`).

---

## F-CUR — Class-A cursor domain sync

```mermaid
flowchart TD
    S["domain.sync(ctx, args)"] --> P["projection = config.projection ?? getAppDb().entities[table]"]
    P --> E["entity = defineCachedEntity(db, table, projection)"]
    E --> SC["scope  = scopeOf?.(args)    // the partition<br/>narrow = narrowOf?.(args)   // extra equality filter"]
    SC --> CT["cached = entity.count(scope, narrow)"]
    CT --> SH{"cached < total (default 100)?"}

    SH -- yes --> DEEP["SHALLOW: cursor = undefined<br/>fetch total rows from page 0, no lower bound"]
    SH -- no --> INC["AT DEPTH: cursor = entity.newestCursor(cursorField, scope, narrow)<br/>fetch batchSize rows"]

    DEEP --> REQ
    INC --> REQ["pageNewestFirst({<br/>params: paramsOf(args) + narrow<br/>+ (cursor ? { [cursorParam]: ISO(cursor) } : {})<br/>+ orderByField: '-' + cursorField,<br/>keep: cursor ? keepNewerThan(page, cursorField, cursor) : undefined })"]
    REQ --> UP["entity.upsertMany(records)<br/>NO prune — a soft failure can never empty the table"]
    UP --> R["return written"]
```

**Why the window is deepened rather than topped up** (`defineCursorDomain.ts`,
`dataManagerLogDomain.ts`): `cursorParam` plus `keep` stops paging at the first already-cached row
— page 0, every tick — as soon as anything is cached. Without the deepening pass, `total` would only
ever apply to an *empty* scope and raising it later would have no effect, so a window seeded shallow
stays shallow. A screen that joins two such windows then sees no overlap between them at all.

Contrast with F-SNAP:

| | class B (`defineSnapshotDomain`) | class A (`defineCursorDomain`) |
|---|---|---|
| Fetch | complete set (`pageAll`) | newest slice (`pageNewestFirst`) |
| Write | `snapshotReplace` — upsert + prune | `upsertMany` — upsert only |
| Cadence | none (bootstrap once) | `intervalMs` |
| Empty response | guarded; refuses to wipe | writes nothing, harmless |
| Activation | default: all registered class-B | explicit `activateSyncDomains` from a view |

---

## F-PAGE — Pagination

```mermaid
flowchart TD
    subgraph pa["pageAll — complete set (class B)"]
      A0{"unpaged || batchSize === 0?"}
      A0 -- yes --> A1["one request with pageSize=viewSize=250<br/>(Moqui defaults to 20 and would truncate silently)"]
      A0 -- no --> A2["pageIndex = 0"]
      A2 --> A3["GET with pageIndex/pageSize + viewIndex/viewSize"]
      A3 --> A4{"strictCollection?"}
      A4 -- yes --> A5["assertCollectionShape — THROW on an unexpected envelope"]
      A4 -- no --> A6["unwrapCollection"]
      A5 --> A6
      A6 --> A7{"rows empty?"}
      A7 -- yes --> AEND["stop"]
      A7 -- no --> A8["dedupe by keyOf into seenKeys; count newKeys"]
      A8 --> A9{"rows.length < batchSize?"}
      A9 -- yes --> AEND
      A9 -- no --> A10{"newKeys === 0?"}
      A10 -- yes --> AWARN["requireComplete ? THROW : warn — endpoint ignores pageIndex"]
      A10 -- no --> A11["pageIndex++"]
      A11 --> A12{"pageIndex >= maxPages (40)?"}
      A12 -- yes --> AWARN2["requireComplete ? THROW : warn — TRUNCATED at the backstop"]
      A12 -- no --> A3
    end

    subgraph pn["pageNewestFirst — newest slice (class A)"]
      B1["collected = []; pageIndex = 0"]
      B1 --> B2{"pageIndex < maxPages && collected.length < total"}
      B2 -- no --> BEND["return collected.slice(0, total)"]
      B2 -- yes --> B3["GET pageSize=batchSize, pageIndex"]
      B3 --> B4{"page empty?"}
      B4 -- yes --> BEND
      B4 -- no --> B5{"keep provided?"}
      B5 -- yes --> B6["fresh = keep(page); push fresh"]
      B6 --> B7{"fresh.length < page.length?"}
      B7 -- yes --> BEND2["crossed into already-cached rows — stop"]
      B7 -- no --> B8
      B5 -- no --> B8{"page.length < batchSize?"}
      B8 -- yes --> BEND
      B8 -- no --> B2
    end
```

Two request-shaping details in `workerRemoteApi.ts` worth keeping visible:

- **Array params expand into repeated keys:** `{ id: ["A","B"] }` becomes `id=A&id=B`.
  `new URLSearchParams(params)` comma-joins instead, which Moqui reads as one literal value, so the
  request 200s with an empty list and the failure is silent. Axios (main thread) expands by default,
  which is why the same query works from a store and fails from a worker.
- **An empty 200 is not an error:** some Moqui list routes answer with no body at all, and
  `response.json()` throws `SyntaxError: unexpected end of input`. Only that exact message is
  swallowed; a real parse failure (an HTML error page) still propagates.

Base-URL rewriting: `oms/` and `shippingGateways/` prefixes are routed to `/rest/s1/`,
everything else to `/api/`.

---

## F-PROJ — Projection and snapshot-replace

```mermaid
flowchart TD
    RAW["raw server record"] --> LOOP["for each declared field"]
    LOOP --> SRC{"raw[field] !== undefined?"}
    SRC -- yes --> USE1["source = field"]
    SRC -- no --> USE2["source = rename[field] ?? field"]
    USE1 --> CO["COERCE[kind](raw[source])"]
    USE2 --> CO
    CO --> KEEP{"value !== undefined?"}
    KEEP -- yes --> PUT["row[field] = value"]
    KEEP -- no --> SKIP["omit the field entirely"]
    PUT --> LOOP
    SKIP --> LOOP
    LOOP -- done --> PK{"every PK member present?"}
    PK -- no --> NULL["return null — record is UNKEYABLE and cannot be stored"]
    PK -- yes --> ROW["{ ...row, syncedAt: now }"]
```

```mermaid
flowchart TD
    SR["defineCachedEntity.snapshotReplace(rawRows, scope?)"] --> PR["rows = projectRows(rawRows, entity, Date.now())"]
    PR --> TX["db.transaction('rw', [table, 'syncMeta'])"]
    TX --> EX{"scope given?"}
    EX -- yes --> E1["existingKeys = keys of rows where scope.field === scope.value"]
    EX -- no --> E2["existingKeys = table.toCollection().primaryKeys()"]
    E1 --> DF
    E2 --> DF["freshKeys = keysOfRows(rows)<br/>stale = diffStaleKeys(existing, fresh)<br/>compared via canonicalKey (NUL-joined),<br/>but the ORIGINAL key form is returned"]
    DF --> DEL{"stale.length > 0?"}
    DEL -- yes --> D1["bulkRemove(stale)"]
    DEL -- no --> D2["skip"]
    D1 --> PUT
    D2 --> PUT{"rows.length > 0?"}
    PUT -- yes --> P1["bulkPut(rows)"]
    PUT -- no --> P2["skip"]
    P1 --> END["{ written, pruned } — prune and write in ONE transaction"]
    P2 --> END
```

`canonicalKey` joins on NUL rather than `|` because `|` occurs in real OFBiz ids, which would make
`["A","B"]` and the single id `"A|B"` indistinguishable (`projection.ts`).

Source: `projection.ts`, `cachedEntity.ts`.

---

## F-MUT — Mutation write-through

```mermaid
sequenceDiagram
    autonumber
    participant V as View / composable
    participant API as Maarg (main thread, axios)
    participant SAS as setupAppDbSync
    participant SS as syncService
    participant H as Harness (worker)
    participant WAPI as Maarg (worker, fetch)
    participant DB as IndexedDB

    V->>API: POST/PUT the mutation
    API-->>V: 200 — the server change is COMMITTED
    V->>SAS: refreshAfterMutation(domain, pk)
    SAS->>SAS: whenReady() — await `starting`, or start now
    alt bootstrapState.errors.__start set
        SAS-->>V: throw CacheReconciliationError
    end
    alt no service
        SAS->>SAS: recordSyncError(domain, msg, cacheScopeKey(pk))
        SAS-->>V: throw CacheReconciliationError
    end
    SAS->>SS: service.refetchOne(domain, pk)
    SS->>H: Comlink refetchOne({ domain, pk })
    H->>H: scope = scopeKeyOf(pk) (sorted k=v joined by '|')
    H->>H: queue on refetchQueues[domain:scope]<br/>and runSharedDomainOperation(domain)
    H->>H: ctx.now = Date.now()
    alt domain has byPk
        H->>WAPI: GET byPk(pk).url
        alt record returned
            H->>DB: upsertMany([raw])
        else nothing returned
            H->>DB: remove(entityKeyOf(pk))
        end
    else domain has refetchScope
        H->>WAPI: pageAll(listUrl, { ...listParams, ...scopeParams })
        H->>DB: snapshotReplace(rows, scope) — prunes that slice too
    else fanOut without byPk
        H->>WAPI: pageAll(urlFor(parentId))
        H->>DB: snapshotReplace(stamped, { parentKeyField, parentId })
    end
    H-->>SS: postMessage refetch-end { domain, scope, written }
    SS->>SS: clearScopeError(domain, scope)
    DB-->>V: liveQuery emits the new row
    Note over H,SS: on failure classifyError yields auth-error (401/unauthorized) or sync-error
    Note over H,SS: both carry the scope, and the error is then rethrown
```

**Choosing `refetchScope` over `byPk`** — the strategy follows the endpoint and the row shape, as
`referenceDomains.ts` records per domain:

- `systemMessageRemote`: `GET oms/systemMessageRemotes/{id}` answers 405 for every id, so there is no
  by-PK route to call. The list route *does* filter by id, so re-listing that one id and
  snapshot-replacing its scope gives the same one-row refresh, and still prunes if the server no
  longer returns it.
- `inventoryEventDocument`: the stored row is (document, feed) while a mutation only knows the
  document. Re-listing that document and pruning its slice is what makes attach/detach correct — a
  plain upsert would leave behind the row for the feed the document just left.
- `serviceJob` uses `byPk` **with** `byPkRecordKey: "jobDetail"`, because the by-PK route wraps the
  job in a different envelope from the list route. Without the key the envelope itself is stored, its
  `jobName` is undefined, and the row is silently dropped.

**Why the error type is distinct** (`reconciliation.ts`): the mutation *committed*.
`mutationCommitted = true` keeps that stage explicit so a retry cannot duplicate a create or replay
a date-effective association write.

---

## F-CONC — Worker concurrency queues

A poll tick and a post-mutation refetch can target the same domain at the same time. Three
structures order them.

```mermaid
flowchart TD
    subgraph legend["Ordering rules"]
      L1["sync (EXCLUSIVE): waits for the domain's prior exclusive<br/>AND every in-flight shared op"]
      L2["refetchOne (SHARED): waits only for the prior exclusive;<br/>siblings run concurrently"]
      L3["same-PK refetches serialize via refetchQueues[domain:scope]"]
    end
```

```mermaid
sequenceDiagram
    participant S1 as sync A (exclusive)
    participant R1 as refetch pk=A (shared)
    participant R2 as refetch pk=B (shared)
    participant R3 as refetch pk=A again
    participant S2 as sync B (exclusive)

    S1->>S1: runs
    R1-->>S1: awaits prior exclusive
    R2-->>S1: awaits prior exclusive
    S1->>S1: done
    par shared ops run together
        R1->>R1: runs
    and
        R2->>R2: runs
    end
    R3-->>R1: awaits refetchQueues["domain:pk=A"]
    R1->>R1: done
    R3->>R3: runs
    S2-->>R2: awaits ALL shared tails
    S2-->>R3: awaits ALL shared tails
    S2->>S2: runs
```

Queue tails are stored as `.then(ok, err) => undefined` so a rejection never poisons the chain, and
each entry deletes itself in `finally` only if it is still the current tail — so a slow op cannot
clear a newer one's queue.

Source: `pollingWorkerHarness.ts`.

---

## F-ACT — Per-view class-A activation (Company)

The activation API lives on `setupAppDbSync` and is re-exported by `src/services/appDbSync.ts`.
Views and composables import `activateSyncDomains`, `deactivateSyncDomains` and
`createSyncDomainOwner` from there (the former `useDbSync` composable has been deleted).

```mermaid
sequenceDiagram
    autonumber
    participant Vw as ShopifyProductSync.vue
    participant S as setupAppDbSync (services/appDbSync)
    participant SS as syncService()
    participant H as Harness (worker)

    Vw->>S: SYNC_OWNER = createSyncDomainOwner("shopifyProductSyncView")
    Note over Vw,S: once per screen INSTANCE, e.g. "shopifyProductSyncView:3"
    Vw->>Vw: productSyncPageDomains(jobNames) builds ActiveDomain[]
    Note over Vw: systemMessage per feature type,<br/>dataManagerLog per import config,<br/>syncRun spine, serviceJobRun scoped to displayed jobs,<br/>productUpdateHistory { shopIds: [id] }
    Vw->>S: onIonViewWillEnter: activateSyncDomains(domains, SYNC_OWNER)
    S->>S: generation = ++activationGeneration<br/>activeOwner = SYNC_OWNER, activeSyncDomains = domains
    S->>S: clearDomainErrors(each activated domain)
    alt no service (failed start / test double)
        S->>S: syncDomainsReady = true, return
    end
    S->>SS: setDomains(domains)
    SS->>H: Comlink setDomains(domains)
    H->>H: active = domains
    H->>H: drop lastRunAt keys not in the new activation set
    S->>S: if generation still current: syncDomainsReady = true
    loop every baseTick
        H->>H: dueDomains(active, lastRunAt, now, effectiveInterval)
        H->>H: run whichever are due, at each activation's own cadence
    end
    Vw->>S: onIonViewDidLeave: deactivateSyncDomains(SYNC_OWNER)
    alt activeOwner !== SYNC_OWNER
        S-->>Vw: return — another screen holds the worker now
    else still the holder
        S->>S: activeOwner = null, set = [], ready = false, activationGeneration++
        S->>SS: setDomains([])
        SS->>H: Comlink setDomains([])
        Note over H: the activation set empties, and the timer finds nothing due
    end
    Note over H: rows already written stay, so a revisit paints instantly
```

### Why the owner guard exists — Ionic transition order

Ionic fires `willLeave(A)`, then `willEnter(B)`, then `didEnter(B)`, then `didLeave(A)`. The
outgoing view's teardown runs **last**, after the incoming view has already activated its own
domains.

```mermaid
sequenceDiagram
    participant A as View A (owner "a:1")
    participant B as View B (owner "b:2")
    participant S as setupAppDbSync

    A->>S: activateSyncDomains(domainsA, "a:1")
    Note over S: activeOwner = "a:1"
    Note over A,B: navigate A to B
    B->>S: willEnter: activateSyncDomains(domainsB, "b:2")
    Note over S: activeOwner = "b:2", worker polls domainsB
    A->>S: didLeave: deactivateSyncDomains("a:1")
    S-->>A: ignored — "a:1" no longer holds the worker
    Note over S: domainsB keep polling
```

Without the guard, step 3 would call `setDomains([])` and B would poll nothing until some unrelated
watcher re-activated it.

- **Keyed on the owner, not the set.** A screen's set changes while it is open
  (`ShopifyProductSync` re-activates as job names resolve), so comparing sets would reject that
  screen's own teardown and leave its polling running.
- **Owners are per instance.** Three routes share the `ShopifyInventorySync` component and navigate
  between each other, and two order-sync sessions share one feature id. A shared owner string would
  match the departing instance and wipe the arriving one's domains.
- **The generation counter** covers the RPC gap. `setDomains` is asynchronous, so an activation
  whose RPC resolves after a newer activation or an accepted deactivation must not flip
  `syncDomainsReady` back on.
- `deactivateSyncDomains()` with **no owner** keeps the unconditional clear, for a hard reset or a
  test.

Activation has three kinds of trigger at the call sites, and all three go through
`activateSyncDomains`: view enter, a `watch` on the scope key (`productStoreId`, `shopId`), and
imperative re-activation after a mutation or a data load.

`ActiveDomain` is `{ name, intervalMs?, args? }` (`syncRegistry.ts`). `intervalMs` overrides the
domain's declared cadence; `args` are handed to `sync(ctx, args)` and participate in `activationKey`.

**One active set.** Two features that must poll on one screen compose one domain list and activate
it once. `useShopify` does this for its sync sessions, which keeps each feature's `intervalMs`
cadence on one activation. Two separate activations would overwrite each other.

Order Manager has **no** activation call sites — the harness default (every registered class-B
domain) is its entire policy.

---

## F-READ — Read paths

```mermaid
flowchart TD
    subgraph a["useDb(table, options) — reactive list"]
      A1["resolve db: getAppDb().raw() or the passed BaseDB"]
      A1 --> A2["resolvedOptions = computed(options)"]
      A2 --> A3["watch(resolvedOptions, immediate, deep)"]
      A3 --> A4["unsubscribe previous, then<br/>dbClient(db).entity(table).live(opts).subscribe()"]
      A4 --> A5["next: records = rows; emitted = true; error = null"]
      A4 --> A6["error: log, set error, emitted = true"]
      A5 --> A7["hydrated = emitted && (records.length > 0 || !serviceState.running)"]
      A3 --> A8["onUnmounted: unsubscribe"]
    end

    subgraph b["useSeedData() — shared live seed tables"]
      B1["getter needs a table: seedTable(table)"]
      B1 --> B2{"entry for dbName/table<br/>in the module map?"}
      B2 -- "no (first use)" --> B3["rows = shallowRef([])<br/>entity(table).live({}).subscribe()<br/>store entry { rows, loaded, subscription }"]
      B2 -- yes --> B4["reuse it: no new read"]
      B3 --> B5["next: rows.value = all; loaded settles<br/>re-emits on any write to the table:<br/>login sync, refreshAfterMutation, resync"]
      B3 --> B6["error: warn, drop the entry<br/>(the next use opens a fresh one)"]
      B4 --> B7["reactive getter: reads rows.value<br/>(tracked by the calling template / computed)<br/>raw id or [] until the first emission"]
      B5 --> B7
      B4 --> B8["async get*: await loaded,<br/>then return the current rows.value"]
      B5 --> B8
      B7 --> B9["labels: first non-empty of description, enumName,<br/>name, groupName, facilityName, storeName — else the raw id<br/>joins in memory: statesForCountry (GAT_REGIONS), enumsByParentType, ..."]
    end

    subgraph c["useDbStatus(db, catalogSource, actions) — status card"]
      C1{"catalogSource is an array?"}
      C1 -- yes --> C2["resolvedCatalog = it; catalogLoaded = true"]
      C1 -- no --> C3["await it (worker catalog over Comlink)"]
      C3 --> C4["on success: items.length ? items : DEFAULT_COMMON_SYNC_CATALOG"]
      C3 --> C5["on failure: DEFAULT_COMMON_SYNC_CATALOG (worker may not be up yet)"]
      C2 --> C6["liveQuery(computeRows).subscribe()"]
      C4 --> C6
      C5 --> C6
      C6 --> C7["computeRows: ensureDbReady; read syncMeta;<br/>parse 'domain:' then 'loginSync:' markers;<br/>count() each catalog table"]
      C7 --> C8["status = count > 0 ? success<br/>: (syncedAt || syncClass === 'A') ? empty : none"]
      C6 --> C9["BroadcastChannel(DB_SYNC_CHANNEL).onmessage -> recompute"]
      C6 --> C10["watch(resolvedCatalog): re-subscribe when it goes empty -> populated"]
      C8 --> C11["refreshDomain -> actions.resyncDomain; refreshAll -> actions.resyncAll"]
    end
```

The two live reads differ in lifetime. A `useDb` subscription belongs to the component that opened
it and closes on unmount. A `useSeedData` table is opened by whichever caller needs it first, is
shared by every later caller, and stays open until logout (`clearSeedTables` in F-TEAR). That is at
most one subscription per seed table, and it re-runs only when that table is written
(`useSeedData.ts`).

Catalog source per app:

| App | Source | Line |
|---|---|---|
| Company | `async () => (await syncService()?.catalog()) ?? []` — the worker registry | `views/Settings.vue` |
| Order Manager | `orderManagerDb.statusCatalog` — derived at `defineAppDb` time | `views/Settings.vue` |

Actions are **injected, not imported**, because a status card must refresh through the same
main-thread service that owns its worker (`useDbStatus.ts`).

---

## F-ERR — Error and status propagation

```mermaid
flowchart TD
    W["worker postMessage"] --> HM["syncService.handleMessage(generation, event)"]
    HM --> GEN{"generation === startGeneration?"}
    GEN -- no --> DROP["DROP — a terminated attempt's last queued message"]
    GEN -- yes --> TY{"data.type"}

    TY -- auth-error --> AE["pushTokenIfChanged() immediately<br/>recordSyncError(domain, message, scope?)<br/>then opts.onAuthError(message)"]
    TY -- sync-end --> SE["serviceState.written[domain] = written<br/>serviceState.syncedAt[domain] = at<br/>lastSyncAt = now<br/>clearDomainErrors(domain)"]
    TY -- refetch-end --> RW["serviceState.written[domain] = written<br/>serviceState.syncedAt[domain] = at ?? now"]
    RW --> RE{"scope present?"}
    RE -- yes --> RE1["clearScopeError(domain, scope)"]
    RE -- no --> RE2["clear nothing — a scopeless message<br/>cannot prove another scope recovered"]
    TY -- sync-error --> ER["recordSyncError(domain, message, scope?)"]

    AE --> FWD
    SE --> FWD
    RE1 --> FWD
    RE2 --> FWD
    ER --> FWD["opts.onStatus(data) -> setupAppDbSync's listener<br/>repeats the same bookkeeping (idempotent),<br/>so a test double's statuses are still recorded"]
    FWD --> SDE["syncDomainsError = last error among the<br/>ACTIVATED domains, in activation order"]
```

```mermaid
flowchart LR
    subgraph vis["updateVisibleError(domain)"]
      D{"domainErrors.has(domain)?"}
      D -- yes --> V1["errors[domain] = the domain-level message"]
      D -- no --> S{"scopedDomainErrors[domain] non-empty?"}
      S -- yes --> V2["errors[domain] = the NEWEST scoped message"]
      S -- no --> V3["delete errors[domain]"]
    end
```

- A **full snapshot** verifies the whole domain, so `sync-end` clears the domain *and* every scope
  behind it.
- A **targeted refetch** verifies only its own PK scope.
- `bootstrapState.errors` and `serviceState.errors` are the same object, so the app facade and the
  service always agree on what is visible.
- A screen reads `syncDomainsError`, not `serviceState.errors` directly. It is scoped to the
  screen's activated set, so a background domain's failure cannot light that screen's banner, and
  `activateSyncDomains` clears those domains' errors first so a newly opened screen starts clean.
- A repeated scoped failure is re-inserted at the end of the map so the visible message reflects the
  newest failure — unless it is the duplicate the service's own `catch` records after the worker
  already posted it, which would otherwise reorder the visible diagnostic
  (`syncService.ts`).

Source: `syncService.ts`, `setupAppDbSync.ts`.

---

## F-TOK — Token freshness

```mermaid
sequenceDiagram
    participant CU as commonUtil (main)
    participant SS as syncService (main)
    participant BC as BroadcastChannel<br/>"accxui:polling-auth-token"
    participant H as Harness (worker)

    Note over SS: at start()
    SS->>CU: getToken()
    SS->>H: api.start({ token, ... })  // initial value only
    loop every tokenWatchMs (15s)
        SS->>CU: getToken()
        alt changed and non-empty
            SS->>BC: publish({ token })
            BC->>H: onmessage
            H->>H: ctx = { ...ctx, token: next }
        end
    end
    Note over H: a tick with no token returns immediately (tick guard)
    H-->>SS: auth-error
    SS->>CU: getToken()
    SS->>BC: publish immediately (the token may have just rotated)
```

The worker is a separate realm and cannot call `commonUtil.getToken()`. Snapshotting the token once
at `start()` would go stale on rotation, so the token is **held and pushed**, never frozen
(`channels.ts`). `subscribeToken` is called inside `createSyncHarness`, not at module
scope, so each harness instance owns its own subscription (`pollingWorkerHarness.ts`).

---

## F-TEAR — Logout, instance switch, teardown

```mermaid
flowchart TD
    subgraph lo["Logout — user.ts postLogout"]
      L1["stopAppDbSync()"] --> L2["startGeneration++ — invalidate any in-flight start"]
      L2 --> L3["service.stop()"]
      L3 --> L4["clearInterval(tokenWatch)"]
      L4 --> L5["publisher.close()"]
      L5 --> L6["terminate() — kills the worker AND its timer"]
      L6 --> L7["serviceState.running = false"]
      L7 --> L8["clearSeedTables()<br/>unsubscribe every useSeedData live table, empty the map"]
      L8 --> L9["clearDatabaseTables(db.raw())<br/>rw txn over every table, keeps syncMeta['schemaVersion'],<br/>never blocks logout"]
    end

    subgraph sw["OMS instance switch"]
      S1["resolver now returns a different instance"]
      S1 --> S2["next raw()/get() computes a new dbName"]
      S2 --> S3["activeDb.close() — a liveQuery holding it stops serving the old tenant"]
      S3 --> S4["new AppDatabase(newName) — a DIFFERENT IndexedDB database"]
      S4 --> S5["late-binding clients follow automatically;<br/>a captured handle would now throw DatabaseClosedError"]
    end

    subgraph vs["View exit (class A)"]
      V0["onIonViewDidLeave -> deactivateSyncDomains(owner)"]
      V0 --> VQ{"owner still holds the worker?"}
      VQ -- no --> VN["no-op — the next screen already activated (F-ACT)"]
      VQ -- yes --> V1["setDomains([]); syncDomainsReady = false"]
      V1 --> V2["harness `active` empties; timer still ticks, nothing is due"]
      V2 --> V3["rows stay — a revisit paints instantly from the DB"]
    end
```

Logout does **not** clear the error maps behind `serviceState.errors`. Stale entries are cleared
per domain, by the next successful `sync-end` or by `activateSyncDomains`.

Also available: `deleteLegacyCaches()` (`baseDb.ts`) drops the superseded fixed-name databases
`DataManagerLogCacheDB` and `CompanyCacheDB`.

---

## F-APPS — Company vs Order Manager wiring

```mermaid
graph TB
    subgraph co["Company"]
      CSCHEMA["companySchema.ts — 48 entities"]
      CPICK["commonSchema.pick(17)"]
      CDB["companyDb = defineAppDb('CompanyDB', v3)"]
      CSCHEMA --> CDB
      CPICK --> CDB
      CW["appSync.worker.ts"]
      CSEED["24 commonDomains (5 deliberately omitted)"]
      CHAND["22 hand-written domains (19 class A, 3 class B)"]
      CREF["26 referenceDomains — Company-specific class-B domains and seed overrides"]
      CSEED --> CW
      CHAND --> CW
      CREF --> CW
      CDB --> CW
      CW --> CRES["worker re-registers setOmsInstanceResolver<br/>(hand-written domains resolve via raw())"]
      CSVC["services/appDbSync.ts"]
      CDB --> CSVC
      CSVC --> CVIEW["activateSyncDomains(ActiveDomain[], owner) per view<br/>deactivateSyncDomains(owner) on didLeave"]
      CSVC --> CSET["Settings.vue -> useDbStatus(async worker catalog)"]
      CSVC --> CMUT["~80 refreshAfterMutation call sites"]
    end

    subgraph om["Order Manager"]
      OSCH["commonSchema — all 29, no own tables"]
      ODB["orderManagerDb = defineAppDb('OrderManagerDB', v1)"]
      OSCH --> ODB
      OW["appSync.worker.ts"]
      OSEED["registerDomains(Object.values(commonDomains)) — all 29"]
      OSEED --> OW
      ODB --> OW
      OSVC["services/appDbSync.ts"]
      ODB --> OSVC
      OSVC --> ODEF["no activation — harness default:<br/>every registered class-B domain"]
      OSVC --> OSET["Settings.vue -> useDbStatus(static statusCatalog)"]
      ODB --> OREAD["useSeedData() in ~30 files"]
    end
```

The five seed domains Company deliberately does **not** register — `carrier`,
`carrierShipmentMethod`, `shopifyShop`, `facilityGroup`, `status` — are re-declared in
`referenceDomains.ts` with app-specific `listParams`, `strictCollection`, `refetchScope` or `byPk`,
while the *tables* still come from `commonSchema.pick(...)`. The `seedTables` provenance set is what
keeps the two facts from contradicting each other (`appSync.worker.ts`,
`referenceDomains.ts`).

---

## Legend

| Symbol | Meaning |
|---|---|
| `THROW` | Fails loudly. For `defineEntity` / `defineSchema` this is at module evaluation. |
| `GUARD` | A deliberate refusal to write, protecting existing rows. |
| Dashed arrow | `BroadcastChannel` or `postMessage` (cross-realm, fire-and-forget). |
| Solid arrow in a sequence | direct call, or Comlink RPC across the worker boundary. |
