# Sync Layer Unification in AccxUI

**Status:** Approved
**Date:** 2026-09-09
**Supersedes:** Phases 2–5 of `2026-09-07-declarative-app-db-design.md` §10

---

## 1. Overview

### 1.1 Objective

Give AccxUI **one** local-database sync layer. Phase 1 unified how an app *declares* its database;
this unifies how an app *fills* it. After this work an app owns its schema declaration, its own
domain definitions, and its views. Every sync primitive — registry, scheduler, harness, main-thread
service, fetch layer, domain builders, status catalog — lives in `@common/db`.

### 1.2 Problem statement

The declaration layer converged. The sync layer forked instead, and the fork is load-bearing in
production.

Order Manager consumes the framework end to end: `defineAppDb` → `registerSeedDomains` →
`exposeWorkerHarness` → `startDbBootstrap`. One registry, one harness, one catalog, all derived
from one declaration. It is green (517/517).

Company adopted the declaration layer and forked everything below it. It uses the framework's
entity, schema, projection and snapshot factory, and its own registry semantics, harness, fetch
layer, entity-ops layer and catalog. The seam between the two produced four live defects, all
fixed on 2026-09-09 and all of the same shape — **two implementations of one contract, with
nothing checking that they agree**:

| Defect | Cause | Symptom |
|---|---|---|
| `refetchOne` argument order | framework `(pk, ctx)` vs Company `(ctx, pk, args)` | `admin/serviceJobs/undefined`; every write-through refetch across 22 domains |
| Seed registration had no fetch target | the `SEED_DOMAINS` *entry* passed where its `.source` was expected | 12 seed domains registered, then paged against `undefined` |
| `strictCollection` accepted and ignored | declared in the framework config, implemented only in Company's fetch layer | carrier domains lost their envelope guard |
| Settings refresh was a no-op | `useDbStatus` hard-wired to a bootstrap Company does not use | both buttons resolved successfully having synced nothing |

None of these were caught by a type, because the two sides were bridged by an `as` cast, an
optional parameter, and a shared registry that accepts either shape.

### 1.3 Success criteria

- One `SyncDomain` contract, one registry, one scheduler, one harness, one main-thread service,
  one fetch layer. No app declares a sync primitive.
- A registered domain is in the status catalog and is activated, because both derive from the
  registry. The "registered but not listed" class of bug becomes unrepresentable.
- Company runs **one** worker realm, not N+1.
- The framework gains a class-A (cursor/incremental) domain builder, so it serves apps beyond
  seed reference data.
- Both apps' suites stay green at every landing. Company's 22 stale specs are repaired, not deleted.

---

## 2. Scope

### 2.1 In scope

The sync layer: `common/db/sync/**`, `common/core/workerRemoteApi.ts`, `common/db/types.ts`,
`common/db/useDbStatus.ts`, and the corresponding app-side modules in Company and Order Manager.

### 2.2 Out of scope

- **The read layer.** `common/db/projection.ts`, `dbClient`, `useDb`, `useSeedData`, and Company's
  parallel `utils/db/cacheProjection.ts` + `utils/db/appCacheDb.ts` stay as they are. Company's
  index-aware query planner is a real capability the framework lacks, and reconciling it touches
  every read call site in both apps. It is its own project.
- **The `status` endpoint disagreement.** Common fetches `admin/status`, Company fetches
  `oms/statuses`. Company keeps `statuses` as its own domain until an API decision is made.
- **`apps/inventory-count`.** Its `services/commonDatabase.ts` is an unrelated raw-Dexie stack. It
  is touched only by §7 step 0, which fixes a transport bug it currently suffers from.

---

## 3. Decisions

Six decisions were open. Each is recorded with what was chosen, why, and what was rejected.

### D1 — Direction of convergence: Company's model upward

The framework's sync model is a strict subset of Company's. Company has cadenced class-A domains,
per-activation clocks, view-scoped activation, scoped error state and operation ordering; the
framework has a tick-everything loop. Promote Company's model into `@common/db` and migrate Order
Manager onto it.

The 2026-09-07 spec rated this "risk: high — Order Manager's sync path changes." Measured, it is
not: all 29 of Order Manager's domains are cadence-less, and the promoted model treats a
cadence-less domain as "bootstrap once on activation", which is exactly today's behaviour. The
migration is mechanical.

*Rejected:* keeping the framework's simpler model as the core and leaving Company's harness as an
app-level extension. It makes the fork permanent, and the class-A cursor model — the thing that
makes the framework useful beyond seed data — never becomes available to another app.

*Rejected:* a minimal shared core with each app owning its harness. Honest about today, but every
new app rebuilds scheduling from scratch.

### D2 — Scheduling lives in the framework

`ActiveDomain`, `activationKey`, `effectiveInterval` and `dueDomains(active, lastRunAt, now,
intervalFor)` move into `common/db/sync/syncRegistry.ts`. The framework's existing
`dueDomains(entries, now)` is deleted — nothing ever wrote the `lastRanAt` / `running` fields it
reads, so it is unreachable.

The per-activation clock is the load-bearing part. Keyed on domain name alone, a page that
activates one domain at two cadences lets the fast activation restamp the shared clock, so the slow
one never becomes due: it runs once on entry and then silently stops.

### D3 — One harness, one worker per app

`createSyncHarness(getDb)` in the framework, with `exposeWorkerHarness(getDb)` unchanged as the
worker entry point. Company's harness is deleted.

Company today spawns a fresh worker per `createSyncService` call — once app-wide for class B, and
again per view for that view's class-A domains — so N+1 realms hold the same database open
concurrently, each with its own token subscription and its own OMS-resolver registration. This
collapses to one worker whose active set is swapped with `setDomains`.

*Rejected:* keeping N+1 realms with the framework owning their lifecycle. It preserves a very
simple teardown (terminate the worker, the timer dies with it) but keeps the concurrent-handle and
per-realm-resolver costs and hands them to every future app.

*Rejected:* a dedicated second worker for cadenced class-A work. Only worth it if head-of-line
blocking on the single tick is observed; it is not.

### D4 — One fetch layer, and the transport bugs go down a level

`common/db/sync/workerFetch.ts` is the one fetch layer; Company's copy is deleted. But two things
currently in *both* copies do not belong there at all.

`workerRemoteApi` builds its query with `new URLSearchParams(params)`, which comma-joins arrays —
verified: `{a:[1,2]}` → `a=1%2C2`. Moqui reads that as one literal value and matches nothing, so
the request returns 200 with an empty list and the failure is completely silent. Company's copy
records the live diagnosis (comma form → `systemMessagesCount: 0`, repeated form → rows) and a note
that it was worked around locally "because that package is shared with the other apps". Separately,
`workerRemoteApi` calls `.json()` unconditionally, so a legitimately empty 200 throws a
`SyntaxError` both copies have to swallow.

Both fixes move into `common/core/workerRemoteApi.ts`, and `toQueryString` / `isEmptyBodyError`
are deleted from the sync layer. `workerFetch` is then exactly two concerns: bind the
`SyncContext`, page the collection.

`pageAll` and `unwrapCollection` stay in `db/sync` and are **not** merged into `workerRemoteApi`:
paging, envelope shapes and `SyncContext` are sync semantics, `workerRemoteApi` is a generic worker
transport with non-sync callers (inventory-count's `lockHeartbeatWorker` and
`backgroundAggregation`, ~8 sites), and folding them down would make `core` depend on `db` types.

### D5 — The implicit global stays for reads, goes for writes

`defineAppDb` keeps calling `setAppDb`, and `useDb("statuses")` / `useSeedData()` keep resolving the
active database implicitly. That is main-thread code, one app per realm, and the ergonomics carry
hundreds of call sites.

`registerSnapshotDomain` and `registerCursorDomain` require an explicit `getDb`. Worker realms are
exactly where the global bit: registration order matters, and a test that resets modules gets a
fresh, empty registry. All 22 of Company's currently-failing specs fail on `getAppDb()` returning
null after `vi.resetModules()`.

*Rejected:* removing it entirely. Churns every read call site in both apps for ergonomic loss on
the side that was never broken.

### D6 — The catalog derives from the registry, read over Comlink

Each domain declares `label` and `syncClass` at registration. The harness exposes
`catalog(): { name, label, syncClass, table }[]` built from the registry; `syncService.catalog()`
proxies it; `useDbStatus` consumes it.

`DEFAULT_COMMON_SYNC_CATALOG`, `appDb.statusCatalog` and Company's 55-entry
`CACHE_DOMAIN_CATALOG` are all deleted. Settings then asks the worker what it will actually sync,
which is the structural fix for the original drift bug.

*Rejected:* a shared metadata module imported by both realms. Keeps the catalog synchronous and
avoids a Comlink round trip, but nothing forces a registered domain to appear in it — the drift is
narrowed, not closed.

*Rejected:* schema-derived for seed plus app-declared extras. Company's 38 app-table entries stay
hand-maintained, which is the half that actually drifts.

---

## 4. Target architecture

```
common/db/
  defineEntity · defineSchema · defineAppDb · domains/     declaration  (shipped, unchanged)
  projection · dbClient · useDb · useSeedData              read         (unchanged, out of scope)
  sync/
    syncRegistry.ts          registry + activation model + dueDomains
    snapshotDomain.ts        class-B builder (explicit getDb)
    cursorDomain.ts          class-A builder                              NEW
    workerFetch.ts           bind context, page collection
    pollingWorkerHarness.ts  the one harness
    syncService.ts           the one main-thread service                  NEW
common/core/
    workerRemoteApi.ts       generic worker transport (param + empty-body fixes)
```

Deleted when the migration completes:

| File | Why |
|---|---|
| `common/db/sync/pollingService.ts` | superseded by `syncService`; today it is typed against Company's harness and does not compile against the framework's |
| `common/db/sync/appDbBootstrap.ts` | superseded by `syncService` |
| `apps/company/src/workers/pollingWorkerHarness.ts` | promoted |
| `apps/company/src/workers/domains/workerFetch.ts` | promoted |
| `apps/company/src/workers/domains/registerSeedDomains.ts` | the two registries are one; the adapter has no purpose |
| `apps/company/src/workers/syncRegistry.ts` | becomes a re-export, then goes |
| `apps/company/src/utils/db/cacheDomainCatalog.ts` | catalog derives from the registry |
| framework `dueDomains(entries, now)` | unreachable |

---

## 5. Components

### 5.1 The contract

```ts
export interface SyncDomain {
  name: string;
  /** Status-card text. Required, so a domain cannot register without saying how it appears. */
  label: string;
  /** A: cadenced. B: once per login, then on mutation. C: write-through only, never ticked. */
  syncClass: "A" | "B" | "C";
  /** Poll cadence for class A. Omit for B and C. */
  intervalMs?: number;
  sync: (ctx: SyncContext, args?: unknown, options?: { force?: boolean }) => Promise<number>;
  refetchOne?: (ctx: SyncContext, pk: Record<string, unknown>, args?: unknown) => Promise<number>;
}
```

`label` and `syncClass` being required is what makes D6 possible, and costs no app churn:
`SEED_DOMAINS` already carries `label`, and every seed domain is class B, so `registerSeedDomains`
supplies both.

`sync` returns rows written rather than `number | void`, so the harness always has something to
report. `refetchOne` takes context first, matching `sync` — a harness holds one context and hands
it to whichever domain is due, and cannot tell a factory-built domain from a hand-written one.
Naming settles on `intervalMs` (Company's), because `ActiveDomain.intervalMs` overrides it and the
two should read alike.

### 5.2 Registry

A `Map<string, SyncDomain>`. Clocks live in the harness, which is the thing that ticks, so the
`SyncRegistrationEntry` wrapper goes. Promoted alongside: `ActiveDomain { name, intervalMs?, args? }`,
`activationKey()` with `stableStringify`, `effectiveInterval()`, `dueDomains()`.

One inconsistency fixed here: `markSyncedThisLogin` writes `loginSync:<domain>`, but Company's
`resyncDomain` deletes `domain:<domain>`, so a per-domain resync never clears the once-per-login
guard — it only works because `syncDomainNow` passes `force: true`. Unify on the prefix that is
actually written (`loginSync:`) and fix the delete, rather than changing the prefix and
invalidating every existing marker.

### 5.3 Harness

Company's logic in the framework's shape: Company's is a module of top-level `let`s that imports
`companyDb` directly, while the framework's already closes over `getDb`.

Carried up from Company, and none of it optional: per-activation clocks; `setDomains` without
respawn; the exclusive/shared operation queues, so a full snapshot never interleaves with a
targeted refetch of the same domain while different PK scopes stay concurrent; the per-`(domain,
scope)` refetch queue that preserves call order so an older response cannot land after a newer one
and prune it; auth-error classification; class-B completion detected from the **durable login
marker** rather than the in-memory clock, so a domain that refused a destructive snapshot stays
unclocked and retries next tick; and forced work propagating failure instead of resolving 0.

Kept from the framework: the `getDb` closure, and the `DB_SYNC_CHANNEL` broadcast on
`domain-synced` / `sync-complete` that main-thread status listeners subscribe to.

Added: `catalog()`.

### 5.4 Main-thread service

`sync/syncService.ts` absorbs all three of today's: the framework's `pollingService` (worker spawn
via `WorkerFactory`, token push over `BroadcastChannel`, status routing, auth hook), the
framework's `appDbBootstrap` (row-shape marker, `clearLocalDb`), and Company's `appCacheBootstrap`
(once-per-login bootstrap, the `starting`/generation guard, the per-domain **and** per-scope error
map, `CacheReconciliationError`).

```ts
createSyncService({ workerUrl, domains?, baseTickMs?, onStatus?, onAuthError? })
  → { start, setDomains, syncNow, syncDomainNow, refetchOne, catalog, stop }
```

`domains` omitted means every registered domain of class A or B. Order Manager omits it. Company
passes a set derived from `catalog()`.

Two couplings this creates, recorded rather than discovered later:

- `useDb`'s `hydrated` reads `bootstrapState.running` to distinguish "still seeding" from
  "genuinely empty". That reactive state moves from `appDbBootstrap` to `syncService`. The read
  layer already depended on the sync layer for this; it is a rename, not a new coupling.
- `useCacheSync` stops spawning and becomes a view-lifecycle wrapper over `setDomains`. Today a
  view exit terminates the worker, so class-A polling **cannot** leak. With one shared worker the
  guarantee weakens from "the thread died" to "we called the right function". `setDomains` already
  drops run history for deactivated keys, but this needs an explicit test (§7).

### 5.5 Fetch layer and builders

`workerFetch`: Company's `pageAll` promoted whole — `strictCollection`, `label`, the `maxPages`
backstop warning, the no-progress guard. The framework's `unpaged` branch stays (Order Manager uses
it) with the strict check applied there too.

The `label` is **derived, not passed**: `snapshotDomain` builds it from the domain name, plus the
parent id on a fan-out leg. This restores `carrierFacility:FEDEX response must be a bare array.`
without asking 22 registration sites to hand-write a label. It closes the diagnostic gap left by
the 2026-09-09 `strictCollection` fix, which could only report the URL.

`snapshotDomain`: explicit `getDb` (D5). Keeps the populated-table wipe guard, fan-out,
`byPk` / `byPkRecordKey`, and `refetchScope`.

`cursorDomain` — new, promoted from Company's `systemMessage` / `dataManagerLog` pattern: fetch only
rows newer than a stored cursor, per-scope cursors resolved through the `[scope+date]` compound
indexes, and per-type windows so a high-volume type cannot starve a quiet one out of a shared
newest-N window. Only Company has this today, and it is what the framework needs to serve anything
beyond seed reference data.

### 5.6 Catalog and status

`useDbStatus(db, { catalog, resyncDomain, resyncAll })`. The catalog source is async. Class C
domains appear in it and are never ticked — which is why "all registered" must mean "all A and B",
and why `syncClass` belongs on the domain rather than in a side table.

---

## 6. Landing order

The apps are separate git repositories, so a framework change and its app migration can never be
one commit. Every framework landing is therefore **additive**: the old export survives until both
apps are off it, and only then is it deleted.

`A` = `accxui` (framework), `B` = `order-manager`, `C` = `company`.

| # | Repo | Change |
|---|---|---|
| 0 | A | Transport: array params → repeated keys, empty body → `null`, in `workerRemoteApi` |
| 1 | A | Contract + registry: `label` / `syncClass` (optional at this step), `ActiveDomain`, `activationKey`, `effectiveInterval`, `dueDomains` |
| 2 | A | Fetch layer: `pageAll` promoted, `label` derived in `snapshotDomain`, local helpers deleted |
| 3 | A, then C | `snapshotDomain` requires explicit `getDb` (old fallback deprecated one step); `cursorDomain` added; the 22 stale specs repaired |
| 4 | A, then B, then C | `createSyncHarness` + `catalog()`; Order Manager migrates; Company deletes its harness |
| 5 | A, then B, then C | `syncService`; Order Manager off `startDbBootstrap`; Company off `appCacheBootstrap` and per-view worker spawning |
| 6 | A, B, C | Catalog wired; three lists deleted; `label` / `syncClass` made required; every deprecated fallback and dead path removed |

Step 0 lands as its own commit with its own test: it touches a transport shared by three apps, and
the reason it was deferred originally was fear of exactly that blast radius. The risk is smaller
than it looks — nothing can depend on the comma-joined form, because against Moqui it silently
matches nothing — but it deserves its own revert boundary.

Step 5 is the one to watch. It is where Company goes from N+1 workers to one, and where the
class-A teardown guarantee changes character.

---

## 7. Verification

Every landing gates on all four suites. Baselines as of 2026-09-09, after the four defect fixes:

| Suite | Baseline |
|---|---|
| `common` | 139 pass / 4 fail — pre-existing, unrelated (`commonUtil` URL + version parsing, `useSolrSearch` collection error) |
| `order-manager` | 517 / 517 |
| `company` | 667 pass / 22 fail — the stale specs repaired in step 3 |
| `inventory-count` | 20 pass / 12 fail — pre-existing, unrelated (`useProductFacets`, `CreateCycleCount`); no sync coverage, so step 0 needs a new transport test rather than an existing one |

New coverage the design requires. Each is a **silent** failure mode — none of them crashes, which
is why each needs a test rather than a runtime guard:

- two activations of one domain at different cadences each fire on their own clock
- a view's activations are gone after teardown (the leak step 5 introduces)
- a class-C domain never ticks but does appear in `catalog()`
- `catalog()` equals the registered domain set
- a fan-out `strictCollection` failure names the parent (`carrierFacility:FEDEX`)
- array query params serialize as repeated keys; an empty 200 body returns `null`
- a full snapshot never interleaves with a same-domain targeted refetch, while different PK scopes
  stay concurrent

Two observed checks no unit test covers, to be run against a live instance after step 6:

- Company's Settings refresh actually refetches (the 2026-09-09 fix, previously a silent no-op)
- Company's 12 seed domains fetch on first login, and `productStoreFacility` fans out over a
  populated `productStores` — registration order has never been exercised, because until the
  2026-09-09 fix neither table was filling

---

## 8. Risks

| Risk | Mitigation |
|---|---|
| Step 0 changes a transport shared by three apps | Own commit, own test, own revert boundary. The old behaviour silently matched nothing, so nothing can depend on it. |
| Class-A polling leaks after view exit (step 5) | Explicit test that activations are removed on teardown; `setDomains` already drops run history for deactivated keys. |
| Company's 22 specs are repaired into passing-but-meaningless | Repair means retargeting mocks and asserting projected rows — the label assertions must survive, since losing them is how the diagnostic regression would be hidden. |
| A framework landing breaks the app that has not migrated yet | Every `A` step is additive; the old export is deleted only in step 6. |
| Company's first real seed sync misbehaves | The two observed checks in §7 run before step 6 is considered done. |

---

## 9. References

- `docs/superpowers/specs/2026-09-07-declarative-app-db-design.md` — Phase 1, and §10 whose
  Phases 2–5 this supersedes
- `docs/superpowers/plans/2026-09-07-declarative-app-db.md` — Phase 1 implementation plan
- 2026-09-09 defect fixes: `common/db/types.ts`, `common/db/sync/snapshotDomain.ts`,
  `common/db/sync/pollingWorkerHarness.ts`, `common/db/sync/workerFetch.ts`,
  `common/db/useDbStatus.ts`, `apps/company/src/workers/domains/seedRegistrations.ts`,
  `apps/company/src/composables/useCacheStatus.ts`
