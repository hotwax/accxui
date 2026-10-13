# AccxUI Local Database — Sync Flows

**Version:** 2.1 · **Date:** 2026-10-13

What happens to the APP's local database over a session: boot, login and database construction,
the one-time domain sync, the worker tick, reading data, mutation refresh, page-level sync, and
logout. The structure these flows run on (the access layer over Dexie, schema preparation, domains,
sync runtime) is in [APP_DB_ARCHITECTURE.md](APP_DB_ARCHITECTURE.md). Recipes:
[APP_DB_DEVELOPER_GUIDE.md](APP_DB_DEVELOPER_GUIDE.md).

Names: `appDb` (`src/db/appDb.ts`), database `{oms}-AppDB`, `appDbSync`
(`src/services/appDbSync.ts`), worker `src/workers/appSync.worker.ts`.

| # | Flow |
|---|---|
| 1 | [Boot: modules load, nothing opens](#1-boot-modules-load-nothing-opens) |
| 2 | [Login: database construction and one-time sync](#2-login-database-construction-and-one-time-sync) |
| 3 | [The worker tick](#3-the-worker-tick) |
| 4 | [Reading data back](#4-reading-data-back) |
| 5 | [Mutation → refresh → screen updates](#5-mutation--refresh--screen-updates) |
| 6 | [Page-level sync](#6-page-level-sync) |
| 7 | [Logout and teardown](#7-logout-and-teardown) |

---

## 1. Boot: modules load, nothing opens

```mermaid
sequenceDiagram
    autonumber
    participant M as main.ts
    participant APP as App.vue
    participant SVC as services/appDbSync.ts
    participant DB as db/appDb.ts

    M->>APP: import
    APP->>SVC: import
    SVC->>DB: import → defineAppDb(...) → setAppDb(appDb)
    Note over DB: schema composed, appDb.tables ready.<br/>No IndexedDB opened yet.
    SVC->>SVC: setupAppDbSync({ db: appDb, getWorkerUrl, createSyncService })
    Note over SVC: no service, no worker yet
    M->>DB: appDb.setOmsInstanceResolver(() => commonUtil.getOMSInstanceName())
    M->>M: initialiseConfig({ postLogin, postLogout, ... })
    APP->>APP: watch(isAuthenticated) → startAppDbSync() when true
```

The resolver is registered in `main.ts`, not in `appDb.ts`, so `commonUtil` stays out of the worker
bundle. On a page reload with a live session, the `isAuthenticated` watcher starts the sync
directly (§2.2), without going through `postLogin`.

---

## 2. Login: database construction and one-time sync

### 2.1 What login does

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant AUTH as useAuth.login
    participant US as user store
    participant SAS as appDbSync

    U->>AUTH: credentials
    AUTH->>AUTH: token stored
    AUTH->>US: postLogin()
    US->>SAS: await stopAppDbSync()
    Note over SAS: start from an EMPTY database:<br/>the last session may have expired without a logout (§7)
    US->>US: fetch profile, permissions
    US->>SAS: void startAppDbSync()
    Note over SAS: idempotent: App.vue's watcher may call it too.<br/>A start that arrives mid-wipe waits for the wipe.
```

### 2.2 How the database is constructed and the sync starts

```mermaid
sequenceDiagram
    autonumber
    participant SAS as appDbSync (setupAppDbSync)
    participant SS as syncService
    participant C as appDb.client() (dbClient)
    participant DB as BaseDB / IndexedDB
    participant H as Harness (worker)

    SAS->>SS: createSyncService({ workerUrl, db: appDb.client() })
    SAS->>SS: start()
    SS->>C: ready()
    C->>C: resolver → "acme" → appDb.get("acme")
    C->>DB: new BaseDB("acme-AppDB", stores + syncMeta, version)
    C->>DB: ensureDbReady: open, compare syncMeta.schemaVersion
    alt version differs or missing
        DB->>DB: delete, reopen, record version
    end
    Note over SS,DB: the database is ready BEFORE the worker exists
    SS->>H: spawn appSync.worker.ts (Comlink)
    Note over H: worker imports: registerDomains(appSyncDomains),<br/>its own appDb copy, exposeWorkerHarness
    opt a page already activated domains (deep link)
        SS->>H: setDomains(pageDomains)
    end
    SS->>H: start({ maargUrl, token, omsInstance })
    H->>H: appDb.setOmsInstanceResolver(() => omsInstance)<br/>db = appDb.get(omsInstance)
    H->>DB: ready() (worker realm's own check)
    H->>H: baseDomains = every registered class-B domain
    H->>H: tick() now, then every 5 s (§3)
    SS->>SS: token watch: push the token to the worker every 15 s if changed
```

### 2.3 The one-time domain sync

The first tick finds every class-B domain due, and runs them one at a time:

```mermaid
sequenceDiagram
    autonumber
    participant H as Harness (worker)
    participant D as Snapshot domain
    participant API as Maarg
    participant DB as IndexedDB
    participant SS as syncService (main)

    loop each class-B domain, sequentially
        H-->>SS: sync-start { domain }
        H->>D: sync(ctx)
        D->>DB: syncedThisLogin(domain)? (loginSync:{domain})
        alt marker present
            D-->>H: 0 (skip)
        else not synced yet
            D->>API: pageAll(listUrl), or one request per parent (fan-out)
            API-->>D: records
            D->>D: guards: nothing keyable, or empty over a filled table → write nothing
            D->>DB: snapshotReplace: project rows, upsert + prune, ONE transaction
            D->>DB: markSyncedThisLogin(domain)
        end
        H-->>SS: sync-end { domain, written }
        H-->>H: BroadcastChannel domain-synced
    end
    H-->>H: BroadcastChannel sync-complete
```

"Once per login" is the `loginSync:{domain}` marker in `syncMeta`. Later ticks skip a domain that
has it. A class-B domain runs again only when:

- a mutation asks for it (§5),
- the status card's **Refresh** (`resyncDomain`) or **Refresh all** (`resyncReferenceData`) clears
  the marker, or
- the next login, which starts from an empty database.

A domain that failed or wrote nothing is not marked; the harness retries it after 30 s.

---

## 3. The worker tick

One timer in the worker, every 5 s. Two domain sets:

- **`baseDomains`** (login set): every registered class-B domain, set by `start()`.
- **`viewDomains`** (page set): what the open page activated (§6), set by `setDomains()`.

```mermaid
flowchart TD
    T["tick()"] --> TK{"token held?"}
    TK -- no --> X["return"]
    TK -- yes --> D["dueDomains(base ∪ view)"]
    D --> R{"per activation"}
    R -- "no interval (class B)" --> B1["due only if never run this session"]
    R -- "intervalMs (class A)" --> B2["due when its interval has elapsed"]
    B1 & B2 --> RUN["run due domains one by one<br/>post sync-start / sync-end / sync-error"]
    RUN --> BC["BroadcastChannel: domain-synced, sync-complete"]
```

- A class-A pass fetches rows newer than the newest stored one and **upserts**; it never prunes.
- A `401` is posted as `auth-error`; the main thread pushes the latest token straight away.
- Manual passes: `syncNow()` forces the page set; `resyncReferenceData()` clears every marker and
  forces both sets; `resyncDomain(name)` forces one domain.

---

## 4. Reading data back

Every worker write lands in IndexedDB; Dexie notices and re-runs every live query that read that
table, so screens update without any message from the worker.

```mermaid
sequenceDiagram
    autonumber
    participant P as Page
    participant L as useLiveEntity
    participant C as appDb.client() → EntityClient
    participant DB as IndexedDB
    participant H as Worker

    P->>L: useLiveEntity(appDb.tables.facilities, () => ({ equals: { facilityId } }))
    L->>C: entity("facilities").live(opts)
    C->>DB: ensureDbReady, then liveQuery(runQuery)
    DB-->>L: rows → records, hydrated
    L-->>P: template renders
    H->>DB: snapshotReplace / upsertMany on facilities
    DB-->>L: liveQuery re-emits
    L-->>P: re-render
    P->>L: facilityId changes → re-subscribe
    P->>L: unmount → unsubscribe
```

| Need | Use | Re-renders? |
|---|---|---|
| Rows on screen | `useLiveEntity(appDb.tables.x, opts)` | yes |
| A value now, or a write | `appDb.entity(appDb.tables.x).get / query / …` | no |
| Seed labels and lists | `useSeedData()` / `seedData` (shared live query per seed table) | yes |

Use `hydrated` (or `.withSync()` on seed lists) to tell "not loaded yet" from "really empty".

---

## 5. Mutation → refresh → screen updates

The server is the source of truth. APP code never writes the server's response into a table itself:
it sends the mutation, then asks the worker to re-read the affected record.

```mermaid
sequenceDiagram
    autonumber
    participant V as Composable / store
    participant API as Maarg (main thread)
    participant SAS as appDbSync
    participant H as Harness (worker)
    participant WAPI as Maarg (worker)
    participant DB as IndexedDB
    participant L as useLiveEntity / seedData

    V->>API: POST / PUT mutation
    API-->>V: 200 (change committed)
    V->>SAS: refreshAfterMutation("facility", { facilityId })
    SAS->>H: refetchOne(domain, pk)
    alt fanOut
        H->>WAPI: re-list that parent's children
        H->>DB: snapshotReplace(that parent's slice)
    else byPk
        H->>WAPI: GET one record
        H->>DB: upsert it, or remove it if gone
    else refetchScope
        H->>WAPI: re-list one filtered slice
        H->>DB: snapshotReplace(that slice)
    end
    H-->>SAS: refetch-end { domain, scope, written }
    DB-->>L: liveQuery re-emits
    L-->>V: screen updates
```

- `refreshAfterMutation` takes a **domain name**, not a table name. `resyncDomain(name)`
  re-snapshots the whole domain.
- A failure throws `CacheReconciliationError` (`mutationCommitted = true`): the server write already
  succeeded, so **warn, don't retry the mutation**.
- A refetch and a scheduled sync of the same domain never interleave: the worker queues them.

---

## 6. Page-level sync

Class-A data (logs, job runs, sync histories) is polled **only while a page that shows it is
open**, with that page's arguments and cadence.

```mermaid
sequenceDiagram
    autonumber
    participant P as Page (e.g. JobMonitor.vue)
    participant SAS as appDbSync
    participant H as Harness (worker)
    participant DB as IndexedDB

    P->>SAS: OWNER = createSyncDomainOwner("jobMonitorView")
    Note over P: once per page INSTANCE → "jobMonitorView:3"
    P->>SAS: onIonViewWillEnter: activateSyncDomains(domains, OWNER)
    Note over P,SAS: domains = [{ name, intervalMs?, args? }, ...]
    SAS->>SAS: clear stale errors for newly activated domains
    SAS->>H: setDomains(domains) → viewDomains
    H->>H: run the newly due ones immediately
    loop every tick while the page is open
        H->>DB: each activation at its own interval
        DB-->>P: useLiveEntity re-emits
    end
    P->>SAS: scope changed (watch productStoreId) → activateSyncDomains again
    P->>SAS: refresh button → syncNow() (forces viewDomains only)
    P->>SAS: onIonViewDidLeave: deactivateSyncDomains(OWNER)
    alt OWNER still holds the worker
        SAS->>H: setDomains([]) → viewDomains empty
    else the next page already activated
        SAS-->>P: ignored
    end
    Note over DB: rows stay, so a revisit paints instantly
```

- **One page set.** Activating replaces the previous page's set; the login set keeps running
  alongside. Two features on one page compose a single list and activate it once.
- **Why owners.** Ionic fires the old page's `didLeave` *after* the new page's `willEnter`; the
  owner check stops the old page from wiping the new page's domains.
- **Deep link before the worker exists.** The activation is held and sent ahead of `start()`.
- **Page state:** `syncDomainsReady`, `syncDomainsError` (errors of the activated domains only),
  `serviceState.syncedAt[domain]` ("has *my* domain finished a pass yet?").

---

## 7. Logout and teardown

`stopAppDbSync()` is the only teardown. It runs on **logout** (`postLogout`) and at the **start of
every login** (`postLogin`), because a session can end silently (closed tab, sleeping laptop)
without a logout.

```mermaid
sequenceDiagram
    autonumber
    participant AUTH as useAuth.logout
    participant US as user store
    participant SAS as appDbSync
    participant SS as syncService
    participant H as Worker
    participant SD as useSeedData tables
    participant C as appDb.client()
    participant DB as IndexedDB

    AUTH->>AUTH: server logout, clear token
    AUTH->>US: postLogout()
    US->>SAS: stopAppDbSync()
    SAS->>SAS: bump startGeneration (drops any in-flight start)
    SAS->>SS: stop()
    SS->>SS: stop token watch, ignore late messages
    SS->>H: terminate() (worker and its timer gone)
    SAS->>SD: clearSeedTables() (close every shared seed live query)
    SAS->>C: clearAllTables()
    C->>DB: one rw transaction: clear every data table,<br/>delete every syncMeta key EXCEPT schemaVersion
    Note over DB: empty database, same schema.<br/>The next login re-runs the one-time sync.
```

- `schemaVersion` survives so the next login's worker does not take the emptied database for an old
  build and rebuild it under rows the main thread has just written.
- A wipe failure is logged and never blocks logout.
- The open page's `useLiveEntity` subscriptions simply re-emit empty; they close on unmount.
- **OMS instance switch:** the resolver returns a new instance, so the next `client()` call opens
  `{newOms}-AppDB` and closes the old handle. The late-binding client follows automatically.
