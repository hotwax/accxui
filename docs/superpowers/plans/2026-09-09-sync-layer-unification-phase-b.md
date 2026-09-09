# Sync Layer Unification — Phase B (Migration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land steps 4–6 of the sync-layer unification — one worker harness, one main-thread service, one registry-derived status catalog — and delete every superseded path in both the framework and Company.

**Architecture:** Phase A promoted the contract, registry, fetch layer and domain builders into `@common/db` additively, leaving both apps on their old sync paths. Phase B migrates them off and removes what they leave behind. Framework additions stay additive until both apps have moved (Tasks 1–5), the apps migrate (6–11), and only then is the dead code deleted (12).

**Tech Stack:** TypeScript, Dexie 4, Comlink, Vitest 1.3, Vite. Three separate git repositories.

## Global Constraints

- **Three separate git repos.** `accxui` (root, the framework), `apps/order-manager`, `apps/company`. A framework change and its app-side consumer change can **never** be one commit. Tasks state their repo.
- **Additive until Task 12.** No framework export may be deleted while either app still imports it.
- **Worker bundle constraint.** Any module reachable from an app's db module or worker entry must never import `vue`, `commonUtil`, or the `@common` barrel. Vite must emit the worker chunk as a single iife. This binds everything in `common/db/sync/**` except `syncService.ts`, which is main-thread-only and may import `vue`.
- **Public surfaces that must NOT change**, because their call sites are out of scope:
  - `@/services/appCacheBootstrap` — `refreshAfterMutation` (19 files), `resyncDomain` (16), `startReferenceSync` (4), `resyncReferenceData` (2), `stopReferenceSync` (2), `bootstrapState` (2), `referenceDomainNames` (1). Its internals change; its exports do not.
  - `useCacheSync()` — returns `{ ready, busy, error, domainStatus, lastSyncAt, activeDomains, registeredDomains, start, syncNow, afterMutation, stop }`. Five views destructure `{ start, stop }`.
- **Scope every test command to one repo.** A bare `npx vitest run` from the root picks up app suites under the wrong aliases and reports hundreds of bogus failures.
- **Typecheck and lint are pre-broken** and are not a gate. Tests are the gate. Assert only on typecheck *deltas* for files a task touches.

### Test commands

| Repo | Command |
|---|---|
| `accxui` | `npx vitest run common/tests` (from repo root) |
| `apps/order-manager` | `cd apps/order-manager && npx vitest run` |
| `apps/company` | `cd apps/company && npx vitest run` |
| `apps/inventory-count` | `cd apps/inventory-count && npx vitest run` |

### Baselines (end of Phase A, verified)

| Suite | Pass | Fail |
|---|---|---|
| `common` | 189 | 4 — pre-existing: `commonUtil` URL + version parsing, `useSolrSearch` |
| `order-manager` | 517 | 0 |
| `company` | 690 | 0 |
| `inventory-count` | 20 | 12 — pre-existing: `useProductFacets`, `CreateCycleCount` |

**A task is done only when its repo's suite is at or better than these numbers.**

### Carried in from Phase A

One parked Minor, fixed in Task 12: `pageNewestFirst` has a `label` parameter that is destructured but never used, because that function emits no diagnostics. Task 12 gives it the diagnostics that make the parameter real.

---

## File Structure

### Repo A — `accxui`

| File | Responsibility | Task |
|---|---|---|
| `common/db/sync/pollingWorkerHarness.ts` | Becomes `createSyncHarness` — per-activation clocks, `setDomains`, `catalog()`, operation ordering. `exposeWorkerHarness` retained, delegating. | 1, 2 |
| `common/tests/syncHarness.spec.ts` | **New.** Lifecycle, clocks, class-C exclusion, catalog. | 1 |
| `common/tests/syncHarness.ordering.spec.ts` | **New.** Snapshot/refetch interleaving, auth errors. | 2 |
| `common/db/sync/syncService.ts` | **New.** The one main-thread service. | 3, 4 |
| `common/tests/syncService.spec.ts` | **New.** | 3, 4 |
| `common/db/useDbStatus.ts` | Async catalog source. | 5 |
| `common/db/index.ts` | Barrel: add `syncService`. | 3 |

### Repo B — `apps/order-manager`

| File | Task |
|---|---|
| `src/services/appDbSync.ts` — onto `syncService` | 6 |
| `src/views/Settings.vue` — async catalog | 6 |

### Repo C — `apps/company`

| File | Task |
|---|---|
| `src/workers/appSync.worker.ts` — framework harness | 7 |
| `src/workers/domains/*.ts` — retarget imports off the local registry | 7 |
| Delete: `src/workers/pollingWorkerHarness.ts` (315), `src/workers/syncRegistry.ts` (128), `src/workers/domains/workerFetch.ts` (248), `src/workers/domains/registerSeedDomains.ts` (42) | 7 |
| `src/workers/domains/*.ts` — declare `label` + `syncClass` | 8 |
| `src/services/appCacheBootstrap.ts` — adapter over `syncService` | 9 |
| `src/composables/useCacheSync.ts` — `setDomains` wrapper | 10 |
| `src/composables/useCacheStatus.ts`; delete `src/utils/db/cacheDomainCatalog.ts` (89) | 11 |

### Deleted in Task 12 (Repo A)

`common/db/sync/pollingService.ts` (105), `common/db/sync/appDbBootstrap.ts` (178), `DEFAULT_COMMON_SYNC_CATALOG`, `AppDb.statusCatalog`, the `getDb` fallback in `registerSnapshotDomain`.

---

# Repo A — Framework (additive)

### Task 1: `createSyncHarness` — lifecycle, activation clocks, catalog

Port `apps/company/src/workers/pollingWorkerHarness.ts` into the framework. That file is the working implementation; the framework's current harness ticks every registered domain with no cadence concept and must be replaced by it.

**Two structural changes during the port**, because Company's version is a module of top-level `let`s that imports `companyDb` directly:

1. Wrap its state in a closure returned by `createSyncHarness(getDb)`. The framework's existing `createPollingWorkerHarness` already shows this shape.
2. Replace `companyDb.setOmsInstanceResolver(...)` in `start()` with nothing — the `getDb` closure already carries the database, and the resolver registration becomes the app's job at its worker entry.

Defer to Task 2: the exclusive/shared operation queues and `refetchOne`. Port `start`, `tick`, `syncNow`, `syncDomainNow`, `setDomains`, `stop`, `domains`, and add `catalog`.

**Files:**
- Modify: `common/db/sync/pollingWorkerHarness.ts`
- Test: `common/tests/syncHarness.spec.ts` (create)

**Interfaces:**
- Consumes: `ActiveDomain`, `activationKey`, `effectiveInterval`, `dueDomains`, `getAllSyncDomains`, `getSyncDomain` from `./syncRegistry`; `SyncDomain` from `../types`
- Produces:
  ```ts
  export interface HarnessStartPayload {
    maargUrl: string; token: string; omsInstance: string;
    baseTickMs?: number; domains?: ActiveDomain[];
  }
  export interface CatalogItem { name: string; label: string; syncClass: "A" | "B" | "C"; }
  export interface SyncHarness {
    start: (payload: HarnessStartPayload) => Promise<void>;
    syncNow: () => Promise<void>;
    syncDomainNow: (domain: string) => Promise<number>;
    refetchOne: (request: { domain: string; pk: Record<string, unknown> }) => Promise<number>;
    setDomains: (domains: ActiveDomain[]) => void;
    stop: () => void;
    domains: () => string[];
    catalog: () => CatalogItem[];
  }
  export function createSyncHarness(getDb: (omsInstance: string) => BaseDB): SyncHarness
  export function exposeWorkerHarness(getDb: (omsInstance: string) => BaseDB): void
  ```
  `exposeWorkerHarness` keeps its current signature and now `expose()`s a `createSyncHarness` instance. Order Manager's worker entry therefore needs no change in this task.

- [ ] **Step 1: Write the failing test**

Create `common/tests/syncHarness.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("comlink", () => ({ expose: () => {} }));

import { createSyncHarness } from "../db/sync/pollingWorkerHarness";
import { clearSyncRegistry, registerSyncDomain } from "../db/sync/syncRegistry";
import type { SyncDomain } from "../db/types";

const stubDb = () => ({
  syncMeta: { get: async () => undefined, put: async () => {}, delete: async () => {} },
  table: () => ({ count: async () => 0 }),
  isOpen: () => true,
  open: async () => {},
  name: "test-db",
}) as any;

const START = {
  maargUrl: "https://x.test/rest/s1/",
  token: "t",
  omsInstance: "demo",
} as const;

function domain(over: Partial<SyncDomain> & { name: string }): SyncDomain {
  const calls: any[] = [];
  const d: any = {
    label: over.name,
    syncClass: "B",
    sync: vi.fn(async () => 1),
    ...over,
  };
  d.calls = calls;
  return d as SyncDomain;
}

describe("createSyncHarness lifecycle", () => {
  beforeEach(() => clearSyncRegistry());

  it("runs every activated domain on the first tick", async () => {
    const a = domain({ name: "a" });
    const b = domain({ name: "b" });
    registerSyncDomain(a); registerSyncDomain(b);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START, domains: [{ name: "a" }, { name: "b" }] });

    expect(a.sync).toHaveBeenCalledTimes(1);
    expect(b.sync).toHaveBeenCalledTimes(1);
    harness.stop();
  });

  it("does nothing until a token is supplied", async () => {
    const a = domain({ name: "a" });
    registerSyncDomain(a);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START, token: "", domains: [{ name: "a" }] });

    expect(a.sync).not.toHaveBeenCalled();
    harness.stop();
  });

  // Class B bootstraps once on activation, then waits for a mutation.
  it("does not re-run a cadence-less domain on a later tick", async () => {
    const a = domain({ name: "a" });
    registerSyncDomain(a);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START, domains: [{ name: "a" }] });
    await harness.syncNow();

    // syncNow forces, so it runs again — the point is the CLOCK was set, checked below.
    expect(a.sync).toHaveBeenCalledTimes(2);
    harness.stop();
  });

  /**
   * Write-through-only domains are registered and listed but must never be ticked. "Activate
   * everything" therefore has to mean "everything of class A or B", or a class-C domain would be
   * polled against an endpoint that only exists to answer a single refetch.
   */
  it("never ticks a class-C domain, even when domains are omitted", async () => {
    const b = domain({ name: "b", syncClass: "B" });
    const c = domain({ name: "c", syncClass: "C" });
    registerSyncDomain(b); registerSyncDomain(c);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START });

    expect(b.sync).toHaveBeenCalledTimes(1);
    expect(c.sync).not.toHaveBeenCalled();
    harness.stop();
  });

  it("activates every class A and B domain when domains are omitted", async () => {
    const a = domain({ name: "a", syncClass: "A", intervalMs: 10_000 });
    const b = domain({ name: "b", syncClass: "B" });
    registerSyncDomain(a); registerSyncDomain(b);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START });

    expect(a.sync).toHaveBeenCalledTimes(1);
    expect(b.sync).toHaveBeenCalledTimes(1);
    harness.stop();
  });
});

describe("createSyncHarness setDomains", () => {
  beforeEach(() => clearSyncRegistry());

  /**
   * The teardown guarantee. A view used to get its own worker, so exit killed the timer outright.
   * With one shared worker, exit must remove the activation or the domain keeps polling unattended.
   */
  it("stops ticking a domain once its activation is removed", async () => {
    const a = domain({ name: "a", syncClass: "A", intervalMs: 1 });
    registerSyncDomain(a);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START, domains: [{ name: "a" }] });
    const afterStart = (a.sync as any).mock.calls.length;

    harness.setDomains([]);
    await harness.syncNow();

    expect((a.sync as any).mock.calls.length).toBe(afterStart);
    harness.stop();
  });

  it("bootstraps a newly added activation on the next tick", async () => {
    const a = domain({ name: "a" });
    registerSyncDomain(a);
    const harness = createSyncHarness(stubDb);

    await harness.start({ ...START, domains: [] });
    expect(a.sync).not.toHaveBeenCalled();

    harness.setDomains([{ name: "a" }]);
    await harness.syncNow();

    expect(a.sync).toHaveBeenCalledTimes(1);
    harness.stop();
  });
});

describe("createSyncHarness catalog", () => {
  beforeEach(() => clearSyncRegistry());

  /**
   * The anti-drift assertion. The catalog and the activated set both come from the registry, so a
   * registered domain cannot be missing from the status card — the failure this whole design
   * exists to make unrepresentable.
   */
  it("lists exactly the registered domains, with their declared label and class", () => {
    registerSyncDomain(domain({ name: "a", label: "Alpha", syncClass: "A", intervalMs: 1000 }));
    registerSyncDomain(domain({ name: "c", label: "Gamma", syncClass: "C" }));
    const harness = createSyncHarness(stubDb);

    expect(harness.catalog()).toEqual([
      { name: "a", label: "Alpha", syncClass: "A" },
      { name: "c", label: "Gamma", syncClass: "C" },
    ]);
  });

  it("falls back to the domain name when no label is declared", () => {
    registerSyncDomain({ name: "bare", sync: async () => 0 } as SyncDomain);
    const harness = createSyncHarness(stubDb);

    expect(harness.catalog()[0]).toMatchObject({ name: "bare", label: "bare" });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run common/tests/syncHarness.spec.ts`
Expected: FAIL — `createSyncHarness` is not exported.

- [ ] **Step 3: Port the harness**

Rewrite `common/db/sync/pollingWorkerHarness.ts`. Read `apps/company/src/workers/pollingWorkerHarness.ts` and port it, with these changes:

- Wrap all module state (`ctx`, `active`, `baseTickMs`, `timer`, `running`, `lastRunAt`) in the `createSyncHarness(getDb)` closure.
- Drop the `companyDb.setOmsInstanceResolver` call and the `@/db/companyDb` import; use `getDb(ctx.omsInstance)`.
- Drop `subscribeToken` at module scope — keep it, but call it inside the closure so each harness instance owns its subscription.
- Replace the `hasSyncedThisLogin(name)` import from `@/utils/db/appCacheDb` with the framework's `hasSyncedThisLogin(db, name)` from `../baseDb`, passing the resolved db.
- `start()` with `domains` omitted activates every registered domain whose `syncClass` is not `"C"`:
  ```ts
      active = payload.domains ?? getAllSyncDomains()
        .filter((d) => d.syncClass !== "C")
        .map((d) => ({ name: d.name }));
  ```
- Add:
  ```ts
    catalog(): CatalogItem[] {
      return getAllSyncDomains().map((d) => ({
        name: d.name,
        label: d.label ?? d.name,
        syncClass: d.syncClass ?? "B",
      }));
    },
  ```
- Keep the `DB_SYNC_CHANNEL` broadcast on `domain-synced` / `sync-complete` from the framework's current harness — Company's version posts status over `self.postMessage` instead, and both are needed: the channel feeds main-thread liveQuery listeners, the postMessage feeds the service's status routing.
- Carry over the **existing** framework `refetchOne` unchanged for now:

  ```ts
    async refetchOne({ domain: domainName, pk }: { domain: string; pk: Record<string, unknown> }) {
      const domain = getSyncDomain(domainName);
      if (!domain?.refetchOne) return 0;
      ctx.now = Date.now();
      return (await domain.refetchOne(ctx, pk)) ?? 0;
    },
  ```

  Task 2 replaces this with the ordered version. It must not be left unimplemented or throwing: Order Manager reaches this method through `refreshAfterMutation` (`src/services/orderIdentification.ts:19`), so a stub would be a live regression for the duration of one task, and its Comlink proxy means no test would catch it at compile time.

Replace `exposeWorkerHarness` with:

```ts
export function exposeWorkerHarness(getDb: (omsInstance: string) => BaseDB): void {
  expose(createSyncHarness(getDb));
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run common/tests/syncHarness.spec.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Confirm no suite regressed**

Run all four suites. Order Manager is the one at risk — it uses `exposeWorkerHarness` and its worker now runs the ported harness. Expected: 517/517.

- [ ] **Step 6: Commit**

```bash
git add common/db/sync/pollingWorkerHarness.ts common/tests/syncHarness.spec.ts
git commit -m "feat(db): promote Company's worker harness into the framework

Per-activation clocks, setDomains without respawn, and a registry-derived
catalog. Omitting the domain set now activates every class A and B domain,
so a registered domain cannot be missing from what actually syncs.
refetchOne lands in the next commit with its ordering guarantees."
```

---

### Task 2: Harness operation ordering and `refetchOne`

The part of Company's harness that is easy to lose and expensive to lose: a full snapshot must never interleave with a targeted refetch of the same domain, while different PK scopes stay concurrent; and same-scope refetches must preserve call order, or an older response lands after a newer one and prunes the newer state.

**Files:**
- Modify: `common/db/sync/pollingWorkerHarness.ts`
- Test: `common/tests/syncHarness.ordering.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1's `createSyncHarness`
- Produces: `refetchOne({ domain, pk })` implemented; `syncDomainNow` and `refetchOne` mutually ordered per domain.

- [ ] **Step 1: Write the failing test**

Create `common/tests/syncHarness.ordering.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("comlink", () => ({ expose: () => {} }));

import { createSyncHarness } from "../db/sync/pollingWorkerHarness";
import { clearSyncRegistry, registerSyncDomain } from "../db/sync/syncRegistry";
import type { SyncDomain } from "../db/types";

const stubDb = () => ({
  syncMeta: { get: async () => undefined, put: async () => {}, delete: async () => {} },
  table: () => ({ count: async () => 0 }),
  isOpen: () => true,
  open: async () => {},
  name: "test-db",
}) as any;

const START = { maargUrl: "https://x.test/", token: "t", omsInstance: "demo" } as const;

/** A deferred promise, so a test can hold an operation open and observe what overtakes it. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

describe("harness operation ordering", () => {
  beforeEach(() => clearSyncRegistry());

  /**
   * A snapshot replaces the whole scope; a refetch replaces one record. Interleaved, the snapshot's
   * prune can delete a row the refetch just wrote, or the refetch can write a row the snapshot is
   * about to prune. They must serialize per domain.
   */
  it("does not start a refetch while a snapshot of the same domain is in flight", async () => {
    const order: string[] = [];
    const gate = deferred();
    registerSyncDomain({
      name: "d", label: "d", syncClass: "B",
      sync: async () => { order.push("sync:start"); await gate.promise; order.push("sync:end"); return 1; },
      refetchOne: async () => { order.push("refetch"); return 1; },
    } as SyncDomain);

    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    const syncing = harness.syncDomainNow("d");
    const refetching = harness.refetchOne({ domain: "d", pk: { id: "1" } });
    gate.resolve();
    await Promise.all([syncing, refetching]);

    expect(order).toEqual(["sync:start", "sync:end", "refetch"]);
    harness.stop();
  });

  it("keeps same-scope refetches in call order", async () => {
    const order: string[] = [];
    const first = deferred();
    let call = 0;
    registerSyncDomain({
      name: "d", label: "d", syncClass: "B",
      sync: async () => 0,
      refetchOne: async (_ctx, pk) => {
        const n = ++call;
        order.push(`start:${n}`);
        if (n === 1) await first.promise;
        order.push(`end:${n}`);
        return 1;
      },
    } as SyncDomain);

    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    const a = harness.refetchOne({ domain: "d", pk: { id: "same" } });
    const b = harness.refetchOne({ domain: "d", pk: { id: "same" } });
    first.resolve();
    await Promise.all([a, b]);

    expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
    harness.stop();
  });

  it("runs refetches of different scopes concurrently", async () => {
    const started: string[] = [];
    const gate = deferred();
    registerSyncDomain({
      name: "d", label: "d", syncClass: "B",
      sync: async () => 0,
      refetchOne: async (_ctx, pk) => { started.push(String(pk.id)); await gate.promise; return 1; },
    } as SyncDomain);

    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    const a = harness.refetchOne({ domain: "d", pk: { id: "A" } });
    const b = harness.refetchOne({ domain: "d", pk: { id: "B" } });
    await vi.waitFor(() => expect(started).toHaveLength(2));
    gate.resolve();
    await Promise.all([a, b]);

    harness.stop();
  });

  /**
   * The HTTP write has already succeeded when a refetch fails. Resolving 0 would let the mutation
   * UI report success while its cache stays stale, so the rejection has to propagate.
   */
  it("rejects rather than resolving zero when a refetch fails", async () => {
    registerSyncDomain({
      name: "d", label: "d", syncClass: "B",
      sync: async () => 0,
      refetchOne: async () => { throw new Error("refetch failed"); },
    } as SyncDomain);

    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    await expect(harness.refetchOne({ domain: "d", pk: { id: "1" } })).rejects.toThrow("refetch failed");
    harness.stop();
  });

  it("rejects a refetch for a domain that has none", async () => {
    registerSyncDomain({ name: "d", label: "d", syncClass: "B", sync: async () => 0 } as SyncDomain);
    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    await expect(harness.refetchOne({ domain: "d", pk: {} })).rejects.toThrow(/refetchOne/);
    harness.stop();
  });

  it("propagates failure from a forced domain sync", async () => {
    registerSyncDomain({
      name: "d", label: "d", syncClass: "B",
      sync: async () => { throw new Error("sync failed"); },
    } as SyncDomain);
    const harness = createSyncHarness(stubDb);
    await harness.start({ ...START, domains: [] });

    await expect(harness.syncDomainNow("d")).rejects.toThrow("sync failed");
    harness.stop();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run common/tests/syncHarness.ordering.spec.ts`
Expected: FAIL — `refetchOne` throws "not implemented until Task 2".

- [ ] **Step 3: Port the ordering machinery**

From `apps/company/src/workers/pollingWorkerHarness.ts`, port into the `createSyncHarness` closure, unchanged in logic:

- `runExclusiveDomainOperation(domain, action)` and `runSharedDomainOperation(domain, action)`, plus their `domainExclusiveQueues` / `domainSharedOperations` maps. Read the doc comments on both and carry them over — they explain why the exclusive tail is installed *before* the operation starts.
- `refetchQueues`, keyed `${domain}:${scope}`, and `runTargetedRefetch`.
- `classifyError` and the `auth-error` / `sync-error` status posting.
- `runDomain` wrapping `executeDomain` in the exclusive operation.

For the scope key, Company uses `cacheScopeKey(pk)` from `@/utils/db/cacheScopeKey`. That helper is app-local and must not be imported. Inline an equivalent in the framework:

```ts
/** A stable string for one PK, so two refetches of the same record share a queue. */
function scopeKeyOf(pk: Record<string, unknown>): string {
  return Object.keys(pk).sort().map((k) => `${k}=${String(pk[k])}`).join("|");
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run common/tests/syncHarness.ordering.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Confirm no suite regressed**

Run all four suites. Expected: baselines.

- [ ] **Step 6: Commit**

```bash
git add common/db/sync/pollingWorkerHarness.ts common/tests/syncHarness.ordering.spec.ts
git commit -m "feat(db): port the harness's per-domain operation ordering

A snapshot never interleaves with a targeted refetch of the same domain,
same-scope refetches keep call order so an older response cannot land after
a newer one and prune it, and different PK scopes stay concurrent."
```

---

### Task 3: `syncService` — the one main-thread service

Merges three implementations: the framework's `pollingService` (worker spawn via `WorkerFactory`, token push, status routing, auth hook), the framework's `appDbBootstrap` (row-shape marker, `clearLocalDb`), and Company's `appCacheBootstrap` (once-per-login bootstrap, the `starting`/generation guard).

Error state lands in Task 4.

**Files:**
- Create: `common/db/sync/syncService.ts`
- Modify: `common/db/index.ts`
- Test: `common/tests/syncService.spec.ts` (create)

**Interfaces:**
- Consumes: Task 1's `SyncHarness`/`CatalogItem`, `WorkerFactory` from `../../core/workerFactory`, `createTokenPublisher` from `./pollingTokenChannel`
- Produces:
  ```ts
  export interface SyncServiceOptions {
    workerUrl: string | URL;
    domains?: ActiveDomain[];
    baseTickMs?: number;
    onStatus?: (status: Record<string, any>) => void;
    onAuthError?: (message: string) => void;
    tokenWatchMs?: number;
    /**
     * The app's database, for the row-shape check. Optional: an app that does not version its
     * stored row shape omits it. Order Manager passes it — `appDbBootstrap` runs this check today
     * and Task 6 moves Order Manager off that module, so without it here the check is silently
     * lost and a future DB_SHAPE_VERSION bump would not clear stale rows.
     */
    db?: BaseDB;
  }
  export interface SyncService {
    start: () => Promise<void>;
    setDomains: (domains: ActiveDomain[]) => Promise<void>;
    syncNow: () => Promise<void>;
    syncDomainNow: (domain: string) => Promise<number>;
    refetchOne: (domain: string, pk: Record<string, unknown>) => Promise<number>;
    catalog: () => Promise<CatalogItem[]>;
    registeredDomains: () => Promise<string[]>;
    stop: () => void;
  }
  export const serviceState: { running: boolean; lastSyncAt: number; written: Record<string, number> }
  export function createSyncService(opts: SyncServiceOptions): SyncService
  ```
  `serviceState` is a Vue `reactive`. This module is main-thread only and may import `vue`; it must NOT be imported by `common/db/sync/pollingWorkerHarness.ts` or anything a worker entry reaches.

- [ ] **Step 1: Write the failing test**

Create `common/tests/syncService.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const harnessStub = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  setDomains: vi.fn(async () => {}),
  syncNow: vi.fn(async () => {}),
  syncDomainNow: vi.fn(async () => 3),
  refetchOne: vi.fn(async () => 1),
  domains: vi.fn(async () => ["a", "b"]),
  catalog: vi.fn(async () => [{ name: "a", label: "Alpha", syncClass: "B" }]),
  stop: vi.fn(),
}));
const terminate = vi.hoisted(() => vi.fn());
const workerStub = vi.hoisted(() => ({ onmessage: null as any }));

vi.mock("../core/workerFactory", () => ({
  WorkerFactory: { createWorker: () => ({ api: harnessStub, terminate, worker: workerStub }) },
}));
vi.mock("../utils/commonUtil", () => ({
  commonUtil: {
    getToken: () => "tok",
    getMaargURL: () => "https://x.test/",
    getOMSInstanceName: () => "demo",
  },
}));
vi.mock("../db/sync/pollingTokenChannel", () => ({
  createTokenPublisher: () => ({ publish: vi.fn(), close: vi.fn() }),
}));

import { createSyncService } from "../db/sync/syncService";

describe("createSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workerStub.onmessage = null;
  });

  it("starts the worker with the current token, url and instance", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });

    await service.start();

    expect(harnessStub.start).toHaveBeenCalledWith(
      expect.objectContaining({ token: "tok", maargUrl: "https://x.test/", omsInstance: "demo" }),
    );
    service.stop();
  });

  // Idempotent: App.vue mounts can race, and a second worker would double every poll.
  it("does not spawn a second worker when start is called twice", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });

    await Promise.all([service.start(), service.start()]);

    expect(harnessStub.start).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it("swaps the activated set without respawning", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();

    await service.setDomains([{ name: "x" }]);

    expect(harnessStub.setDomains).toHaveBeenCalledWith([{ name: "x" }]);
    expect(harnessStub.start).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it("routes an auth-error status to the app's hook", async () => {
    const onAuthError = vi.fn();
    const service = createSyncService({ workerUrl: "/w.js", onAuthError });
    await service.start();

    workerStub.onmessage!({ data: { type: "auth-error", message: "401" } } as MessageEvent);

    expect(onAuthError).toHaveBeenCalledWith("401");
    service.stop();
  });

  it("forwards every status message to the app's listener", async () => {
    const onStatus = vi.fn();
    const service = createSyncService({ workerUrl: "/w.js", onStatus });
    await service.start();

    workerStub.onmessage!({ data: { type: "sync-end", domain: "a", written: 4 } } as MessageEvent);

    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ type: "sync-end", domain: "a" }));
    service.stop();
  });

  it("proxies the catalog from the worker", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();

    await expect(service.catalog()).resolves.toEqual([{ name: "a", label: "Alpha", syncClass: "B" }]);
    service.stop();
  });

  it("terminates the worker on stop, so its timer dies with it", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();

    service.stop();

    expect(terminate).toHaveBeenCalled();
  });

  it("can be restarted after stop", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();
    service.stop();

    await service.start();

    expect(harnessStub.start).toHaveBeenCalledTimes(2);
    service.stop();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run common/tests/syncService.spec.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the service**

Create `common/db/sync/syncService.ts`. Read all three sources before writing: `common/db/sync/pollingService.ts`, `common/db/sync/appDbBootstrap.ts`, and `apps/company/src/services/appCacheBootstrap.ts`.

Required behaviour:

- **Spawn** through `WorkerFactory.createWorker<SyncHarness>(url)`; keep `terminate` and set `worker.onmessage`.
- **Idempotent `start()`**: hold the in-flight promise in a `starting` variable and return it on re-entry. Carry Company's `startGeneration` counter so a terminated attempt's late status message is ignored.
- **Token push**: `createTokenPublisher()`, seed `lastToken` from `commonUtil.getToken()`, and an interval (`tokenWatchMs`, default 15s) that publishes on change. On `auth-error`, push immediately before invoking `onAuthError` — the token may have just rotated.
- **Status routing**: forward every message to `onStatus`; update `serviceState.written[domain]` and `lastSyncAt` on `sync-end`; set `serviceState.running` across the first pass.
- **Row shape**: before starting the worker, when `opts.db` is given, run the shape check. Do not copy `ensureRowShape` out of `appDbBootstrap` — **move** it, with `DB_SHAPE_VERSION`, into `common/db/baseDb.ts` and export both. `clearDatabaseTables` already lives there, it is a database concern rather than a service one, and both `appDbBootstrap` (until Task 12) and `syncService` then call the same implementation instead of drifting copies.
- **`stop()`**: clear the interval, close the publisher, terminate the worker, null the harness. Must leave the service restartable.

`pollingService.ts` and `appDbBootstrap.ts` stay in place until Task 12.

- [ ] **Step 4: Export from the barrel**

In `common/db/index.ts`, add after the `pollingService` export:

```ts
export * from "./sync/syncService";
```

Both `pollingService` and `syncService` export a type named `SyncService`. Until Task 12 deletes the former, alias on export to avoid a barrel collision:

```ts
export { createSyncService as createSyncServiceV2, serviceState } from "./sync/syncService";
export type { SyncService as SyncServiceV2, SyncServiceOptions as SyncServiceOptionsV2 } from "./sync/syncService";
```

Task 12 removes the aliases along with the old module.

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run common/tests/syncService.spec.ts`
Expected: PASS (8 tests)

- [ ] **Step 6: Confirm no suite regressed**

Run all four suites. Expected: baselines.

- [ ] **Step 7: Commit**

```bash
git add common/db/sync/syncService.ts common/db/index.ts common/tests/syncService.spec.ts
git commit -m "feat(db): add the unified main-thread sync service

Merges pollingService's worker lifecycle and token push, appDbBootstrap's
shape marker, and Company's idempotent once-per-login bootstrap. Exported
under V2 aliases until Task 12 removes the modules it replaces."
```

---

### Task 4: Per-domain and per-scope error state

Company tracks sync errors per domain **and** per PK scope, because one domain can have several independently-refetched scopes in flight (one carrier party per detail screen) and a failure on one must not overwrite the visible diagnostic for another.

**Files:**
- Modify: `common/db/sync/syncService.ts`
- Test: `common/tests/syncService.spec.ts` (append)

**Interfaces:**
- Consumes: Task 3's `createSyncService`
- Produces: `serviceState.errors: Record<string, string>` (one visible message per domain); `service.clearDomainError(domain: string): void`

- [ ] **Step 1: Write the failing test**

Append to `common/tests/syncService.spec.ts`:

```ts
import { serviceState } from "../db/sync/syncService";

describe("syncService error state", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    workerStub.onmessage = null;
    for (const key of Object.keys(serviceState.errors)) delete serviceState.errors[key];
  });

  it("records a domain error from a sync-error status", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();

    workerStub.onmessage!({ data: { type: "sync-error", domain: "a", message: "boom" } } as MessageEvent);

    expect(serviceState.errors.a).toBe("boom");
    service.stop();
  });

  it("clears a domain's error on its next successful sync", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();
    workerStub.onmessage!({ data: { type: "sync-error", domain: "a", message: "boom" } } as MessageEvent);

    workerStub.onmessage!({ data: { type: "sync-end", domain: "a", written: 2 } } as MessageEvent);

    expect(serviceState.errors.a).toBeUndefined();
    service.stop();
  });

  /**
   * One domain, several PK scopes in flight. A failure on one scope must not replace the visible
   * message for another, and clearing one scope must not clear the other's.
   */
  it("keeps scoped failures independent", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();

    workerStub.onmessage!({ data: { type: "sync-error", domain: "d", scope: "id=1", message: "one" } } as MessageEvent);
    workerStub.onmessage!({ data: { type: "sync-error", domain: "d", scope: "id=2", message: "two" } } as MessageEvent);
    workerStub.onmessage!({ data: { type: "refetch-end", domain: "d", scope: "id=2" } } as MessageEvent);

    expect(serviceState.errors.d).toBe("one");
    service.stop();
  });

  it("drops the domain error once its last scope succeeds", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();
    workerStub.onmessage!({ data: { type: "sync-error", domain: "d", scope: "id=1", message: "one" } } as MessageEvent);

    workerStub.onmessage!({ data: { type: "refetch-end", domain: "d", scope: "id=1" } } as MessageEvent);

    expect(serviceState.errors.d).toBeUndefined();
    service.stop();
  });

  it("surfaces the newest scoped failure when several are open", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();

    workerStub.onmessage!({ data: { type: "sync-error", domain: "d", scope: "id=1", message: "one" } } as MessageEvent);
    workerStub.onmessage!({ data: { type: "sync-error", domain: "d", scope: "id=2", message: "two" } } as MessageEvent);

    expect(serviceState.errors.d).toBe("two");
    service.stop();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run common/tests/syncService.spec.ts -t "error state"`
Expected: FAIL — `serviceState.errors` is undefined.

- [ ] **Step 3: Port the error map**

From `apps/company/src/services/appCacheBootstrap.ts`, port `domainErrors`, `scopedDomainErrors`, `updateVisibleError`, `recordSyncError`, `clearDomainErrors` and `clearScopeError` into `syncService.ts`, writing into `serviceState.errors`. Carry the doc comments: they record why a repeated scoped failure is moved to the end of the map rather than left in place.

Wire them to the status messages: `sync-error` records (scoped when `data.scope` is present), `sync-end` clears the domain's errors, `refetch-end` clears that scope's.

Add `clearDomainError(domain)` to the returned service.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run common/tests/syncService.spec.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Confirm no suite regressed**

Run all four suites. Expected: baselines.

- [ ] **Step 6: Commit**

```bash
git add common/db/sync/syncService.ts common/tests/syncService.spec.ts
git commit -m "feat(db): track sync errors per domain and per PK scope

One domain can have several scopes refetching independently; a failure on
one must not overwrite another's visible diagnostic, and clearing one must
not clear the rest."
```

---

### Task 5: `useDbStatus` takes an async catalog source

The catalog now comes from the worker over Comlink, so it arrives asynchronously.

**Files:**
- Modify: `common/db/useDbStatus.ts`
- Test: `common/tests/useDbStatus.spec.ts` (create)

**Interfaces:**
- Consumes: Task 3's `CatalogItem`
- Produces:
  ```ts
  useDbStatus(
    db: BaseDB,
    catalogSource: SyncDomainCatalogItem[] | (() => Promise<CatalogItem[]>),
    actions?: DbStatusActions,
  )
  ```
  An array keeps working (Order Manager passes one until Task 6, Company until Task 11). A function is awaited once on setup and its result drives the rows.

- [ ] **Step 1: Write the failing test**

Create `common/tests/useDbStatus.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("dexie", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, liveQuery: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) };
});

import { useDbStatus } from "../db/useDbStatus";

const stubDb = () => ({
  syncMeta: { toArray: async () => [] },
  table: () => ({ count: async () => 0 }),
}) as any;

const actions = { resyncDomain: vi.fn(async () => {}), resyncAll: vi.fn(async () => {}) };

describe("useDbStatus catalog source", () => {
  it("accepts a static array, unchanged", () => {
    const { domains } = useDbStatus(
      stubDb(),
      [{ name: "a", table: "as", label: "Alpha", syncClass: "B" }],
      actions,
    );

    expect(domains.value).toEqual([]); // not yet emitted; the array is the source, not the rows
  });

  it("accepts an async source and resolves it", async () => {
    const source = vi.fn(async () => [{ name: "a", label: "Alpha", syncClass: "B" as const }]);

    const { catalogLoaded } = useDbStatus(stubDb(), source, actions);
    await vi.waitFor(() => expect(catalogLoaded.value).toBe(true));

    expect(source).toHaveBeenCalledTimes(1);
  });

  /**
   * The worker may not be up when a status view mounts. A rejected catalog must leave the card
   * empty and loaded, not spinning forever.
   */
  it("settles when the async source rejects", async () => {
    const source = vi.fn(async () => { throw new Error("worker not started"); });

    const { catalogLoaded, domains } = useDbStatus(stubDb(), source, actions);
    await vi.waitFor(() => expect(catalogLoaded.value).toBe(true));

    expect(domains.value).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run common/tests/useDbStatus.spec.ts`
Expected: FAIL — `catalogLoaded` is not returned, and a function source is not accepted.

- [ ] **Step 3: Accept both source shapes**

In `common/db/useDbStatus.ts`:

- Widen the second parameter to `SyncDomainCatalogItem[] | (() => Promise<CatalogItem[]>)`.
- Hold the resolved catalog in a `ref`, plus `catalogLoaded = ref(false)`.
- When the source is an array, set both synchronously. When it is a function, call it once, and in both `then` and `catch` set `catalogLoaded.value = true` — a rejection leaves the catalog empty rather than pending.
- Drive the existing `liveQuery` off the resolved catalog ref, and re-subscribe when it changes from empty to populated.
- A `CatalogItem` has no `table`. Where the current code does `db.table(entry.table).count()`, fall back to `entry.table ?? entry.name` and guard a missing table with a `0` count rather than throwing — the registry catalog is domain-keyed, and Task 11 reconciles the naming.
- Return `catalogLoaded` alongside the existing values.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run common/tests/useDbStatus.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Confirm no suite regressed**

Run all four suites. Both apps still pass arrays here. Expected: baselines.

- [ ] **Step 6: Commit**

```bash
git add common/db/useDbStatus.ts common/tests/useDbStatus.spec.ts
git commit -m "feat(db): let useDbStatus take an async catalog source

The catalog now comes from the worker's registry over Comlink. A static
array still works, so neither app has to move in this commit."
```

---

# Repo B — `apps/order-manager`

> Commands run from `apps/order-manager`, its own git repository.

### Task 6: Order Manager onto `syncService` and the registry catalog

Order Manager's whole sync surface is four files, two of which change. Its worker entry needs no change — `exposeWorkerHarness` kept its signature in Task 1.

**Files:**
- Modify: `src/services/appDbSync.ts`
- Modify: `src/views/Settings.vue`

**Interfaces:**
- Consumes: `createSyncServiceV2`, `SyncServiceV2` from `@common/db`
- Produces: `startAppDbSync(token, onSynced?)` keeps its signature — `App.vue` and `store/user.ts` call it and are out of scope.

- [ ] **Step 1: Confirm the current call sites before changing them**

Run: `grep -rn "startAppDbSync\|getSyncToken" src`
Expected: definitions in `src/services/appDbSync.ts` plus calls in `src/App.vue` and `src/store/user.ts`. Those two callers must keep compiling unchanged. If either passes arguments this task does not preserve, STOP and report.

- [ ] **Step 2: Move `appDbSync` onto the service**

Replace the body of `startAppDbSync` in `src/services/appDbSync.ts`:

```ts
import { commonUtil, cookieHelper } from "@common";
import { createSyncServiceV2, type SyncServiceV2 } from "@common/db";
import { useAuth } from "@common/composables/useAuth";
import appSyncWorkerUrl from "../workers/appSync.worker.ts?worker&url";

/** The session token the sync worker should start with, or "" when there is none. */
export function getSyncToken(): string {
  return cookieHelper().get("api_key")
    || cookieHelper().get("token")
    || (useAuth() as any).token?.value
    || "";
}

let service: SyncServiceV2 | null = null;

/** The running service, for the Settings card's catalog. Null before boot. */
export function syncService(): SyncServiceV2 | null {
  return service;
}

/**
 * Start the background database sync. Never rejects — a sync failure must not break boot or login.
 *
 * The domain set is no longer listed here: omitting it activates every registered class A and B
 * domain, so a domain that is registered can no longer be missing from what actually syncs.
 */
export function startAppDbSync(_token: string, onSynced?: () => void): Promise<void> {
  service ??= createSyncServiceV2({
    workerUrl: new URL(appSyncWorkerUrl, import.meta.url),
  });

  return service.start()
    .then(() => { onSynced?.(); })
    .catch((error) => { console.error("[db] Sync start failed:", error); });
}
```

The `token` parameter is retained but unused — the service reads the current token itself. Keep the parameter so `App.vue` and `store/user.ts` compile untouched.

- [ ] **Step 3: Point Settings at the registry catalog**

In `src/views/Settings.vue`, replace the `useDbStatus` call:

```ts
} = useDbStatus(
  getOrderManagerDb(commonUtil.getOMSInstanceName()),
  async () => (await syncService()?.catalog()) ?? [],
);
```

and add `syncService` to the `@/services/appDbSync` import.

- [ ] **Step 4: Run the Order Manager suite**

Run: `npx vitest run`
Expected: 517 / 517. `tests/App.authenticatedBoot.spec.ts` and `tests/main.spec.ts` exercise the boot path — if either fails, `startAppDbSync`'s signature or timing changed; fix that rather than the test.

- [ ] **Step 5: Confirm the framework suite is unmoved**

Run: `cd ../.. && npx vitest run common/tests`
Expected: 189 pass / 4 fail.

- [ ] **Step 6: Commit**

```bash
git add src/services/appDbSync.ts src/views/Settings.vue
git commit -m "refactor(db): move Order Manager onto the unified sync service

The activated domain list is gone: omitting it activates every registered
class A and B domain, so statusCatalog is no longer a second list that can
drift from the registry. Settings reads the catalog from the worker."
```

---

# Repo C — `apps/company`

> Commands run from `apps/company`, its own git repository.

### Task 7: Company onto the framework harness; delete the fork

**Files:**
- Modify: `src/workers/appSync.worker.ts`
- Modify: 8 domain modules that import the local registry
- Delete: `src/workers/pollingWorkerHarness.ts`, `src/workers/syncRegistry.ts`, `src/workers/domains/workerFetch.ts`, `src/workers/domains/registerSeedDomains.ts`

**Interfaces:**
- Consumes: `exposeWorkerHarness` from `@common/db/sync/pollingWorkerHarness`; `registerSyncDomain` and `SyncContext` from `@common/db/sync/syncRegistry` / `@common/db/types`; `pageAll`, `pageNewestFirst`, `workerGet`, `workerPost`, `unwrapCollection` from `@common/db/sync/workerFetch`
- Produces: the worker exposes the framework harness. `apps/company/tests/workers/domainRegistration.spec.ts` must still pass — it imports the real worker entry and asserts registration order.

- [ ] **Step 1: Retarget the domain modules' imports**

These 8 files import `SyncContext` (33 references) and `registerSyncDomain` (18) from `../syncRegistry`:

`syncRunDomain.ts`, `organizationDomain.ts`, `netSuiteOrderPushDomain.ts`, `systemMessageDomain.ts`, `shopifyInventoryMonitoringDomain.ts`, `dataManagerLogDomain.ts`, `serviceJobRunDomain.ts`, `productUpdateHistoryDomain.ts`

In each, replace the local import with deep framework imports — never the `@common/db` barrel, which pulls in `vue` and would break the worker chunk:

```ts
import { registerSyncDomain } from "@common/db/sync/syncRegistry";
import type { SyncContext } from "@common/db/types";
```

Those that import from `./workerFetch` change to `@common/db/sync/workerFetch`. The framework's `pageAll` and `pageNewestFirst` are the promoted versions of Company's, so the call sites need no other change — but `pageAll`'s `label` option is new, and any call that relied on Company's `label` for diagnostics should keep passing it.

- [ ] **Step 2: Point the worker entry at the framework harness**

In `src/workers/appSync.worker.ts`, replace the final import:

Keep every domain-module import above it, in the existing order — `./domains/seedRegistrations` must stay first, because fan-out children registered before their parents tick against an empty parent table.

Company's old harness registered the OMS resolver inside `start()`; the framework harness does not, because it resolves the database through the `getDb` closure instead. Company still needs the resolver registered, though — `companyDb.raw()` is reached by code running in this realm that has no instance parameter. The harness calls `getDb(omsInstance)` on start, so the closure is the right place:

```ts
// The harness must be imported last: it calls expose(), and every domain has to be registered
// by the time the main thread can invoke domains() or start().
import { exposeWorkerHarness } from "@common/db/sync/pollingWorkerHarness";
import { companyDb } from "@/db/companyDb";

// Each worker realm is a separate JS realm with its own module instances, so the resolver has to
// be registered here as well as on the main thread. The harness hands us the instance on start().
exposeWorkerHarness((omsInstance) => {
  companyDb.setOmsInstanceResolver(() => omsInstance);
  return companyDb.get(omsInstance);
});
```

- [ ] **Step 3: Delete the four superseded files**

```bash
git rm src/workers/pollingWorkerHarness.ts \
       src/workers/syncRegistry.ts \
       src/workers/domains/workerFetch.ts \
       src/workers/domains/registerSeedDomains.ts
```

`seedRegistrations.ts` now calls the framework's `registerSeedDomains(companyDb, { exclude })` instead of the deleted adapter. Its `OVERRIDDEN_SEED_DOMAINS` set becomes the `exclude` list.

- [ ] **Step 4: Fix the tests that referenced the deleted modules**

Run: `npx vitest run` and work through the failures. Expected breakage and the correct fix for each:

- Any spec importing `@/workers/syncRegistry` → import from `@common/db/sync/syncRegistry`.
- Any spec mocking `@/workers/domains/workerFetch` → mock `@common/db/sync/workerFetch`.
- `tests/utils/syncRegistry.spec.ts` (9 tests) and `tests/utils/syncRegistry.activationClock.spec.ts` (9 tests) test the deleted local registry. The framework covers this in `common/tests/syncRegistry.spec.ts`. Delete both files rather than retargeting them — keeping duplicates of framework tests in an app is how the two drift apart.
- `tests/workers/pollingWorkerHarness.refetchFailure.spec.ts` (10 tests) tests the deleted local harness; the framework covers it in `common/tests/syncHarness.ordering.spec.ts`. Delete it.

That is **28 tests** deliberately removed from Company because the framework now owns what they covered. Before deleting each file, confirm the framework spec named above actually covers its cases; if you find a case with no framework equivalent, STOP and report it rather than dropping coverage.

**Do not** weaken any assertion to make a spec pass. If a spec fails on behaviour rather than imports, stop and report — that is a real difference between the fork and the framework.

- [ ] **Step 5: Run the Company suite**

Run: `npx vitest run`
Expected: **662 pass / 0 fail** (690 − 28).

- [ ] **Step 6: Confirm the framework suite is unmoved**

Run: `cd ../.. && npx vitest run common/tests`
Expected: 189 pass / 4 fail.

- [ ] **Step 7: Commit**

```bash
git add -A src tests
git commit -m "refactor(db): move Company onto the framework harness and registry

Deletes the forked harness, registry, fetch layer and seed adapter (733
lines). The two registries are now one, so the trap the local adapter
existed to warn about is gone structurally."
```

---

### Task 8: Company domains declare `label` and `syncClass`

The data already exists — `src/utils/db/cacheDomainCatalog.ts` carries a `label` and `syncClass` for every domain. This moves it onto the registrations so the catalog can be derived and that file deleted.

**Files:**
- Modify: 9 domain modules (11 `registerSyncDomain` calls) and `src/workers/domains/referenceDomains.ts` (22 `registerSnapshotDomain` calls)
- Test: `tests/workers/domainRegistration.spec.ts` (extend)

**Interfaces:**
- Consumes: `SyncDomain.label` / `syncClass` from Task 4 of Phase A
- Produces: every Company domain declares both. Seed domains get theirs from `SEED_DOMAINS` automatically.

- [ ] **Step 1: Write the failing test**

Append to `tests/workers/domainRegistration.spec.ts`:

```ts
  it("gives every registered domain a label and a sync class", async () => {
    const { getAllSyncDomains } = await import("@common/db/sync/syncRegistry");

    const missing = getAllSyncDomains()
      .filter((d) => !d.label || !d.syncClass)
      .map((d) => d.name);

    expect(missing).toEqual([]);
  });

  /**
   * The catalog is derived from the registry now, so a label here IS the Settings card's text.
   * The old hand-written catalog is the source of these strings; they must not silently change.
   */
  it("keeps the labels the Settings card already showed", async () => {
    const { getAllSyncDomains } = await import("@common/db/sync/syncRegistry");
    const { CACHE_DOMAIN_CATALOG } = await import("@/utils/db/cacheDomainCatalog");

    const registered = new Map(getAllSyncDomains().map((d) => [d.name, d]));
    const drifted = CACHE_DOMAIN_CATALOG
      .filter((entry) => {
        const domain = registered.get(entry.name);
        return domain && (domain.label !== entry.label || domain.syncClass !== entry.syncClass);
      })
      .map((entry) => entry.name);

    expect(drifted).toEqual([]);
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/workers/domainRegistration.spec.ts`
Expected: FAIL — the first test lists every hand-written domain.

- [ ] **Step 3: Add `label` and `syncClass` to every registration**

Open `src/utils/db/cacheDomainCatalog.ts` and use it as the source. For each entry, add its `label` and `syncClass` to the matching `registerSyncDomain` / `registerSnapshotDomain` call. The registrations to change:

| File | Domains |
|---|---|
| `dataManagerLogDomain.ts` | `dataManagerLog` |
| `netSuiteOrderPushDomain.ts` | `netSuiteOrderPush` |
| `organizationDomain.ts` | `organization` |
| `syncRunDomain.ts` | `syncRun` |
| `shopifyInventoryMonitoringDomain.ts` | `shopifyInventoryEventFeed`, `inventoryChannel`, `shopifyInventoryAdjustmentDetail` |
| `productUpdateHistoryDomain.ts` | `productUpdateHistory` |
| `serviceJobRunDomain.ts` | `serviceJobRun` |
| `systemMessageDomain.ts` | `systemMessage` |
| `referenceDomains.ts` | all 22 |

A domain with an `intervalMs` is class A; the rest are class B unless `cacheDomainCatalog.ts` says C. If a registered domain has no catalog entry, or a catalog entry has no registration, STOP and report it — that mismatch is exactly the drift this design removes, and it should be recorded, not silently resolved.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/workers/domainRegistration.spec.ts`
Expected: PASS

- [ ] **Step 5: Run the Company suite**

Run: `npx vitest run`
Expected: **664 pass / 0 fail** (662 + 2), zero failures.

- [ ] **Step 6: Commit**

```bash
git add src/workers/domains tests/workers/domainRegistration.spec.ts
git commit -m "feat(db): declare label and syncClass on every Company domain

Moves the strings off the hand-written catalog and onto the registrations,
so the status card can derive from the registry. A test pins them against
the old catalog so no label silently changes."
```

---

### Task 9: `appCacheBootstrap` becomes an adapter over `syncService`

Its seven exports are used across 23 files. **None of those call sites change** — this task swaps the internals only.

**Files:**
- Modify: `src/services/appCacheBootstrap.ts`
- Test: `tests/services/appCacheBootstrap.race.spec.ts` (existing, must still pass)

**Interfaces:**
- Consumes: `createSyncServiceV2`, `serviceState` from `@common/db`
- Produces: the seven existing exports unchanged — `startReferenceSync`, `stopReferenceSync`, `resyncDomain`, `resyncReferenceData`, `refreshAfterMutation`, `bootstrapState`, `referenceDomainNames` — **plus one addition**:
  ```ts
  /** The running service, or null before boot. Tasks 10 and 11 read the catalog through it. */
  export function syncService(): SyncServiceV2 | null
  ```
  An addition is safe; the 23 files importing this module are unaffected. Tasks 10 and 11 both depend on this accessor existing, so it must land here.

- [ ] **Step 1: Pin the public surface before touching it**

Create `tests/services/appCacheBootstrap.surface.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@common/db", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    createSyncServiceV2: () => ({
      start: async () => {}, setDomains: async () => {}, syncNow: async () => {},
      syncDomainNow: async () => 0, refetchOne: async () => 0,
      catalog: async () => [], registeredDomains: async () => [], stop: () => {},
    }),
  };
});
vi.mock("@/db/companyDb", () => ({
  companyDb: { raw: () => ({ syncMeta: { delete: async () => {} } }) },
}));

/**
 * 23 files import from this module. Its internals move onto the framework service in this task;
 * its surface must not, or every one of those call sites becomes a change.
 */
describe("appCacheBootstrap public surface", () => {
  it("exports exactly what its consumers import", async () => {
    const mod = await import("@/services/appCacheBootstrap");

    for (const name of [
      "startReferenceSync", "stopReferenceSync", "resyncDomain",
      "resyncReferenceData", "refreshAfterMutation", "referenceDomainNames",
    ]) {
      expect(typeof (mod as any)[name]).not.toBe("undefined");
    }
    expect(mod.bootstrapState).toMatchObject({ running: expect.any(Boolean) });
  });
});
```

- [ ] **Step 2: Run it against the current code**

Run: `npx vitest run tests/services/appCacheBootstrap.surface.spec.ts`
Expected: PASS. This is a characterization test — it passes before and must pass after. If it fails now, the mock is wrong; fix the mock, not the module.

- [ ] **Step 3: Swap the internals**

In `src/services/appCacheBootstrap.ts`, replace `createSyncService` with `createSyncServiceV2` and delete the machinery the framework now owns: `domainErrors`, `scopedDomainErrors`, `updateVisibleError`, `recordSyncError`, `clearDomainErrors`, `clearScopeError`, and the `onStatus` handler feeding them. Point `bootstrapState.errors` at the framework's `serviceState.errors`:

```ts
import { createSyncServiceV2, serviceState, type SyncServiceV2 } from "@common/db";

/** Kept as this module's own name; the state itself now lives in the framework service. */
export const bootstrapState = serviceState;
```

Keep: `startReferenceSync`'s idempotence contract, `whenReady`, `REFERENCE_DOMAINS`, `CacheReconciliationError` and the `resyncDomain` login-marker delete (`loginSync:` — fixed in Phase A Task 15).

`REFERENCE_DOMAINS` still comes from `REFERENCE_DOMAIN_NAMES` until Task 11 replaces it with the catalog.

- [ ] **Step 4: Run the Company suite**

Run: `npx vitest run`
Expected: **665 pass / 0 fail** (664 + 1 surface test), zero failures. `tests/services/appCacheBootstrap.race.spec.ts` is the one to watch — it exercises the generation guard against a terminated attempt's late message.

- [ ] **Step 5: Commit**

```bash
git add src/services/appCacheBootstrap.ts tests/services/appCacheBootstrap.surface.spec.ts
git commit -m "refactor(db): make appCacheBootstrap an adapter over the framework service

Its seven exports are unchanged, so the 23 files importing them are
untouched. The scoped error map it used to own now lives in the framework."
```

---

### Task 10: `useCacheSync` stops spawning workers

This is the riskiest change in Phase B. Today a view exit terminates its worker, so class-A polling **cannot** leak. With one shared worker, exit must remove that view's activations instead — the guarantee weakens from "the thread died" to "we called the right function", which is why it gets an explicit test.

**Files:**
- Modify: `src/composables/useCacheSync.ts`
- Test: `tests/composables/useCacheSync.spec.ts` (create)

**Interfaces:**
- Consumes: the single service from `@/services/appCacheBootstrap`
- Produces: `useCacheSync()` returns the same 11 members. `start(domains, options?)` adds this view's activations; `stop()` removes exactly those and no others.

- [ ] **Step 1: Write the failing test**

Create `tests/composables/useCacheSync.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const setDomains = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("@/services/appCacheBootstrap", () => ({
  referenceDomainNames: ["ref1", "ref2"],
  syncService: () => ({
    start: async () => {}, setDomains, syncNow: async () => {},
    syncDomainNow: async () => 0, refetchOne: async () => 0,
    catalog: async () => [], registeredDomains: async () => [], stop: () => {},
  }),
  startReferenceSync: async () => {},
}));

const activeAfterLastCall = () =>
  (setDomains.mock.calls.at(-1)?.[0] ?? []).map((d: any) => d.name);

describe("useCacheSync view lifecycle", () => {
  it("adds this view's activations without dropping the app-wide ones", async () => {
    setDomains.mockClear();
    const { useCacheSync } = await import("@/composables/useCacheSync");
    const { start } = useCacheSync();

    await start([{ name: "systemMessage", intervalMs: 10_000 }]);

    expect(activeAfterLastCall()).toEqual(expect.arrayContaining(["ref1", "ref2", "systemMessage"]));
  });

  /**
   * The leak this task introduces the risk of. A view used to get its own worker, so exit killed
   * the timer outright. Now exit must remove exactly this view's activations.
   */
  it("removes this view's activations on stop", async () => {
    setDomains.mockClear();
    const { useCacheSync } = await import("@/composables/useCacheSync");
    const { start, stop } = useCacheSync();

    await start([{ name: "systemMessage", intervalMs: 10_000 }]);
    await stop();

    expect(activeAfterLastCall()).not.toContain("systemMessage");
  });

  it("leaves another view's activations alone on stop", async () => {
    setDomains.mockClear();
    const { useCacheSync } = await import("@/composables/useCacheSync");
    const viewA = useCacheSync();
    const viewB = useCacheSync();

    await viewA.start([{ name: "domA", intervalMs: 1000 }]);
    await viewB.start([{ name: "domB", intervalMs: 1000 }]);
    await viewA.stop();

    expect(activeAfterLastCall()).toContain("domB");
    expect(activeAfterLastCall()).not.toContain("domA");
  });

  it("never terminates the shared worker on stop", async () => {
    const { useCacheSync } = await import("@/composables/useCacheSync");
    const { start, stop } = useCacheSync();

    await start([{ name: "domA" }]);
    await stop();

    // A terminated worker would break every other view; stop() may only deactivate.
    expect(setDomains).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/composables/useCacheSync.spec.ts`
Expected: FAIL — `useCacheSync` spawns its own service and never calls a shared `setDomains`.

- [ ] **Step 3: Rewrite the composable**

`useCacheSync` becomes a view-lifecycle wrapper. Requirements:

- A module-level registry of activations by owner: each `useCacheSync()` call gets a unique owner token, and the module holds `Map<ownerToken, ActiveDomain[]>`.
- `start(domains)` records this owner's activations, then calls `setDomains` with the union of the app-wide reference domains and every owner's activations.
- `stop()` deletes this owner's entry and recomputes the same union — never terminating the worker.
- Register `onUnmounted(stop)` so a view that forgets to call `stop` still deactivates. Guard for use outside a component.
- Keep all 11 returned members. `registeredDomains` now comes from `service.registeredDomains()`.

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/composables/useCacheSync.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Run the Company suite**

Run: `npx vitest run`
Expected: **669 pass / 0 fail** (665 + 4), zero failures. The five views using `useCacheSync` have their own specs — `ShopifyInventorySync`, `ShopifyProductSync`, `ShopifyConnectionDetails`, `NetSuite`, `NetSuiteSyncMonitor`. If any fails, the composable's surface changed; restore it rather than editing the view.

- [ ] **Step 6: Commit**

```bash
git add src/composables/useCacheSync.ts tests/composables/useCacheSync.spec.ts
git commit -m "refactor(db): make useCacheSync a setDomains wrapper on one worker

Company drops from N+1 worker realms to one. View exit now removes that
view's activations instead of terminating a worker, so the teardown
guarantee is explicit and tested rather than incidental."
```

---

### Task 11: The catalog derives from the registry; delete the hand-written one

**Files:**
- Modify: `src/composables/useCacheStatus.ts`, `src/services/appCacheBootstrap.ts`
- Delete: `src/utils/db/cacheDomainCatalog.ts`
- Test: `tests/composables/useCacheStatus.spec.ts` (extend)

**Interfaces:**
- Consumes: `service.catalog()` from Task 3
- Produces: `useCacheStatus()` unchanged for `Settings.vue`

- [ ] **Step 1: Write the failing test**

Append to `tests/composables/useCacheStatus.spec.ts`:

```ts
  it("takes its catalog from the worker registry, not a hand-written list", async () => {
    const catalog = vi.fn(async () => [{ name: "carrier", label: "Carriers", syncClass: "B" as const }]);
    vi.doMock("@/services/appCacheBootstrap", () => ({
      resyncDomain: vi.fn(async () => {}),
      resyncReferenceData: vi.fn(async () => {}),
      syncService: () => ({ catalog }),
    }));

    const { useCacheStatus } = await import("@/composables/useCacheStatus");
    useCacheStatus();

    await vi.waitFor(() => expect(catalog).toHaveBeenCalled());
  });
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/composables/useCacheStatus.spec.ts`
Expected: FAIL — `useCacheStatus` passes `CACHE_DOMAIN_CATALOG`.

- [ ] **Step 3: Switch the source and delete the list**

In `src/composables/useCacheStatus.ts`, replace the static catalog with the async source:

```ts
export function useCacheStatus() {
  return useDbStatus(
    companyDb.raw(),
    async () => (await syncService()?.catalog()) ?? [],
    { resyncDomain, resyncAll: resyncReferenceData },
  );
}
```

In `src/services/appCacheBootstrap.ts`, replace `REFERENCE_DOMAIN_NAMES` with the class-B subset of the catalog, resolved after the service starts:

```ts
  // Derived, not listed: activating exactly the class-B domains the registry holds is what makes
  // "registered but never synced" unrepresentable.
  const referenceDomains = (await service.catalog())
    .filter((entry) => entry.syncClass === "B")
    .map((entry) => ({ name: entry.name }));
  await service.setDomains(referenceDomains);
```

Then delete the file and its remaining importers' references:

```bash
git rm src/utils/db/cacheDomainCatalog.ts
```

`referenceDomainNames` stays exported from `appCacheBootstrap` (one consumer) but is now derived.

- [ ] **Step 4: Fix the test from Task 8 that read the deleted file**

`tests/workers/domainRegistration.spec.ts`'s "keeps the labels the Settings card already showed" test imports `CACHE_DOMAIN_CATALOG`. Its job — catching a silent label change during the Task 8 move — is done. Delete that one test and keep the "every domain has a label and a sync class" test, which is the durable invariant.

- [ ] **Step 5: Run the Company suite**

Run: `npx vitest run`
Expected: **669 pass / 0 fail** (one test added, one deleted), zero failures.

- [ ] **Step 6: Commit**

```bash
git add -A src tests
git commit -m "feat(db): derive Company's status catalog from the registry

Deletes the 55-entry hand-written catalog. Settings now asks the worker what
it will actually sync, so a registered domain cannot be missing from the card
and a listed one cannot be absent from the registry."
```

---

# Repo A — Cleanup

### Task 12: Make the contract required and delete every superseded path

Both apps have migrated, so the transitional scaffolding comes out. This also fixes the Minor parked at the end of Phase A.

**Files:**
- Modify: `common/db/types.ts`, `common/db/sync/snapshotDomain.ts`, `common/db/sync/workerFetch.ts`, `common/db/sync/cursorDomain.ts`, `common/db/index.ts`, `common/db/useDbStatus.ts`, `common/db/defineAppDb.ts`
- Delete: `common/db/sync/pollingService.ts`, `common/db/sync/appDbBootstrap.ts`

- [ ] **Step 1: Prove nothing imports what is about to be deleted**

Run from the repo root:

```bash
grep -rn "pollingService\|appDbBootstrap\|startDbBootstrap\|DEFAULT_COMMON_SYNC_CATALOG\|statusCatalog\|createSyncServiceV2" common apps/company/src apps/order-manager/src
```

Expected: matches only inside `common/db/index.ts` (the aliases) and the two files being deleted. **Any match in an app means that app has not finished migrating — STOP and report which.**

- [ ] **Step 2: Give `pageNewestFirst` the diagnostics its label was added for**

`common/db/sync/workerFetch.ts`. The `label` parameter added in Phase A is currently destructured and unused, because the function emits nothing. Add the two guards `pageAll` already has, using `label`:

```ts
  const maxPages = options.maxPages ?? 40;
  ...
    if (pageIndex >= maxPages) {
      console.warn(
        `[db] ${label}: stopped at the ${maxPages}-page backstop after ${collected.length} records — the set may be TRUNCATED.`,
      );
      break;
    }
```

placed at the top of the loop body, and `maxPages?: number` added to its options.

Add a test to `common/tests/workerFetch.spec.ts`:

```ts
  it("warns and stops at the page backstop, naming the domain", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    workerRemoteApi.mockResolvedValue(rows(0, 25));

    await pageNewestFirst({
      ctx, url: "admin/dataManager/details", label: "dataManagerLog",
      params: {}, total: 10_000, batchSize: 25, maxPages: 3,
    });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("dataManagerLog"));
    warn.mockRestore();
  });
```

- [ ] **Step 3: Make `label` and `syncClass` required**

In `common/db/types.ts`, change `label?: string` to `label: string` and `syncClass?: "A" | "B" | "C"` to `syncClass: "A" | "B" | "C"`, updating the doc comments to drop "Optional during Phase A".

This will surface any registration that still omits them, in both apps. Fix the framework ones (`registerSeedDomains` supplies both from `SEED_DOMAINS`; `registerSnapshotDomain` and `registerCursorDomain` must take them from their config and pass them through). App-side omissions mean Task 8 missed one — report rather than defaulting.

- [ ] **Step 3b: Remove the harness's backward-compatibility shims**

Task 1 kept `updateToken`, `resyncDomain`, `resyncAll`, a `string[]`-tolerant `domains` payload, and a two-argument `refetchOne` on the harness, because `appDbBootstrap` speaks that older protocol over a Comlink proxy and Order Manager used it until Task 6. Both apps are now on `syncService`, and `appDbBootstrap` is deleted in Step 5, so the shims have no caller.

Delete from `common/db/sync/pollingWorkerHarness.ts`: the `updateToken`, `resyncDomain` and `resyncAll` methods, the `string[]` branch in `start()`'s domain normalisation, and the two-argument overload of `refetchOne`. Then delete the shim tests in `common/tests/syncHarness.spec.ts` — they pin a protocol that no longer has a speaker.

Verify nothing still calls them:

```bash
grep -rn "updateToken\|resyncAll\|resyncDomain" common apps/company/src apps/order-manager/src
```

Expected after Step 5: matches only in `apps/company/src/services/appCacheBootstrap.ts`, which has its own `resyncDomain` export (a different function — it takes a domain name and routes through the service). Any match on the harness proxy means an app is still on the old protocol; STOP and report.

- [ ] **Step 4: Remove the `getDb` fallback**

In `common/db/sync/snapshotDomain.ts`, delete the `if (!getDb)` warning block and the `?? ((omsInstance) => getAppDb().get(omsInstance))` fallback, leaving `const resolveDb = getDb;`. Remove the now-unused `getAppDb` import.

Then fix `common/tests/snapshotDomain.label.spec.ts`: delete the "warns when getDb is omitted" test — the behaviour it pinned no longer exists — and remove the `(registerSnapshotDomain as any)` cast added in the Phase A fix wave, since every call now passes both arguments.

- [ ] **Step 4b: Rehome the two things `appDbBootstrap` still owns**

Deleting `appDbBootstrap.ts` in the next step would break two live consumers that are nothing to do with the sync worker. Move both first, and run the greps — do not take this list on trust, because it was assembled late.

1. **`bootstrapState` → `serviceState`.** `common/db/useDb.ts:15` imports `bootstrapState` and reads `.running` in its `hydrated` computed, to tell "still seeding" from "genuinely empty". `useDb` is the framework's core read composable used across dozens of files in both apps, so this is the highest-blast-radius edit in Phase B. Repoint the import to `serviceState` from `./sync/syncService`; the `.running` field exists on both, so it is an import change only.

2. **`clearLocalDb` → `syncService.ts`.** `apps/order-manager/src/store/user.ts:185` calls it on logout, via the `@common/db` barrel. Move the function into `syncService.ts` unchanged, adapting it to use this service's own worker reference and `serviceState` instead of the module-level ones it used before. Because the barrel re-exports it either way, Order Manager's import does not change.

Verify both before proceeding:

```bash
grep -rn "bootstrapState\|clearLocalDb" common apps/order-manager/src apps/company/src | grep -v node_modules
```

Expected after the move: `useDb.ts` references `serviceState`, `syncService.ts` defines `clearLocalDb`, Order Manager's `store/user.ts` still imports `clearLocalDb` from `@common/db`, and Company's `appCacheBootstrap.ts` has its own `bootstrapState` export (aliased to `serviceState` in Task 9 — a different binding, leave it). **Any remaining reference to `appDbBootstrap` is a consumer nobody has rehomed; STOP and report it.**

- [ ] **Step 5: Delete the superseded modules and the catalog remnants**

```bash
git rm common/db/sync/pollingService.ts common/db/sync/appDbBootstrap.ts
```

In `common/db/index.ts`: drop both exports, and replace the V2 aliases with plain re-exports:

```ts
export * from "./sync/syncService";
```

In `common/db/useDbStatus.ts`: delete `DEFAULT_COMMON_SYNC_CATALOG` and make the catalog source parameter required.

In `common/db/defineAppDb.ts`: delete `statusCatalog` from `AppDb` and its derivation, plus the now-unused `SEED_SOURCES` import if nothing else uses it.

- [ ] **Step 6: Rename the V2 symbols in both apps**

This spans repos, so it is two more commits after the framework one:

- `apps/order-manager/src/services/appDbSync.ts`: `createSyncServiceV2` → `createSyncService`, `SyncServiceV2` → `SyncService`.
- `apps/company/src/services/appCacheBootstrap.ts`: same.

- [ ] **Step 7: Run every suite**

Expected, and this is the plan's Definition of Done:
- `common`: 4 pre-existing failures, no others
- `order-manager`: 517 / 517
- `company`: **669 / 669**
- `inventory-count`: 20 / 12

- [ ] **Step 8: Commit (three commits, one per repo)**

```bash
# accxui
git add -A common
git commit -m "refactor(db)!: require label and syncClass; delete the superseded sync paths

pollingService, appDbBootstrap, DEFAULT_COMMON_SYNC_CATALOG, AppDb.statusCatalog
and the getDb fallback are gone now that both apps have migrated. pageNewestFirst
gains the backstop warning its label was added for."
```

```bash
# apps/order-manager
git commit -am "refactor(db): drop the V2 alias for the sync service"
```

```bash
# apps/company
git commit -am "refactor(db): drop the V2 alias for the sync service"
```

---

## Definition of Done

- [ ] One harness (`common/db/sync/pollingWorkerHarness.ts`), one main-thread service (`syncService.ts`), one fetch layer, one registry. No app declares a sync primitive.
- [ ] Company runs **one** worker realm. `useCacheSync` deactivates rather than terminating, with a test proving a view's activations are gone after teardown.
- [ ] The status catalog and the activated domain set both derive from the registry in both apps. No hand-written list survives: `CACHE_DOMAIN_CATALOG`, `DEFAULT_COMMON_SYNC_CATALOG` and `AppDb.statusCatalog` are all deleted.
- [ ] `SyncDomain.label` and `syncClass` are required; a class-C domain is listed but never ticked.
- [ ] Deleted: ~733 lines from Company (harness, registry, fetch, seed adapter) and ~283 from the framework (`pollingService`, `appDbBootstrap`), plus the 89-line catalog.
- [ ] Suites: `common` 4 pre-existing failures only · `order-manager` 517/517 · `company` **669 / 669** · `inventory-count` 20/12 unchanged.

  Company's count drops from 690 to 669 on purpose: 28 tests covering the forked registry and harness are deleted in Task 7 because the framework now owns that behaviour, and 7 net new tests are added across Tasks 8–11. A number *higher* than 669 means duplicated coverage was left behind; *lower* means something was dropped without replacement. Either is a finding.
- [ ] The Phase A parked Minor is closed — `pageNewestFirst`'s `label` is used.

## Deferred beyond Phase B

The read layer (spec §2.2, "Phase 5"): `common/db/projection.ts` vs Company's `utils/db/cacheProjection.ts`, and `dbClient`/`useDb` vs Company's `appCacheDb` with its index-aware query planner. Untouched by both phases; its own project.
