# Sync Layer Unification — Phase A (Framework Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land steps 0–3 of the sync-layer unification — fix the shared worker transport, promote Company's contract, registry, fetch layer and domain builders into `@common/db`, and repair Company's four stale spec files — without either app having to migrate yet.

**Architecture:** Every change in this plan is *additive* to the framework. No existing framework export is deleted and no app is asked to move. Order Manager keeps using `startDbBootstrap` + `exposeWorkerHarness`; Company keeps its own harness and service. The migration that retires those is Phase B, planned separately once this lands.

**Tech Stack:** TypeScript, Dexie 4, Comlink, Vitest 1.3, Vite. Three separate git repositories.

## Global Constraints

- **Three separate git repos.** `accxui` (root, the framework), `apps/order-manager`, `apps/company`. A framework change and its app-side consumer change can **never** be one commit. Tasks state their repo explicitly.
- **Additive only.** Nothing in this plan may delete a framework export that an app still imports. Deletions happen in Phase B step 6.
- **Worker bundle constraint.** Any module reachable from an app's db module or worker entry must never import `vue`, `commonUtil`, or the `@common` barrel. Vite must emit the worker chunk as a single iife. This rules out the barrel in `common/db/sync/**` and `common/core/workerRemoteApi.ts`.
- **Scope every test command to one repo.** Running `npx vitest run` from the repo root picks up the app suites under the wrong aliases and reports hundreds of bogus failures.
- **Typecheck is pre-broken** in every repo and is not a gate. Tests are the gate. Only assert on typecheck *deltas* for files a task touches.

### Test commands

| Repo | Command |
|---|---|
| `accxui` | `npx vitest run common/tests` (from repo root) |
| `apps/order-manager` | `cd apps/order-manager && npx vitest run` |
| `apps/company` | `cd apps/company && npx vitest run` |
| `apps/inventory-count` | `cd apps/inventory-count && npx vitest run` |

### Baselines (measured 2026-09-09, after the four defect fixes)

| Suite | Pass | Fail | Nature of failures |
|---|---|---|---|
| `common` | 139 | 4 | pre-existing, unrelated: `commonUtil` URL + version parsing, `useSolrSearch` collection error |
| `order-manager` | 517 | 0 | — |
| `company` | 667 | 22 | the four stale spec files, repaired by Tasks 11–14 |
| `inventory-count` | 20 | 12 | pre-existing, unrelated: `useProductFacets`, `CreateCycleCount` |

**A task is done only when its repo's suite is at or better than these numbers.** Never "fix" a baseline failure opportunistically inside another task — it destroys the signal.

---

## File Structure

### Repo A — `accxui` (framework)

| File | Responsibility | Task |
|---|---|---|
| `common/core/workerRemoteApi.ts` | Generic worker HTTP transport. Gains array-aware param serialization and empty-body tolerance. | 1, 2 |
| `common/tests/workerRemoteApi.spec.ts` | **New.** Transport behaviour. | 1, 2 |
| `common/db/sync/workerFetch.ts` | Bind `SyncContext`, page a collection. Loses its local transport workarounds; gains `label` and `pageNewestFirst`. | 3, 6 |
| `common/tests/workerFetch.spec.ts` | Existing. Assertions move from URL-query to `params`. | 3, 6 |
| `common/db/types.ts` | The `SyncDomain` contract. Gains `label`, `syncClass`; `cadenceMs` → `intervalMs`. | 4 |
| `common/db/sync/syncRegistry.ts` | Registry + activation model. | 5 |
| `common/tests/syncRegistry.spec.ts` | **New.** Activation keys and due-domain scheduling. | 5 |
| `common/db/sync/snapshotDomain.ts` | Class-B builder. Derives the fetch label; `getDb` becomes required. Gains cursor-capable entity ops. | 7, 8 |
| `common/tests/snapshotDomain.label.spec.ts` | **New.** Label derivation, including the fan-out leg. | 7 |
| `common/db/sync/cursorDomain.ts` | **New.** Class-A incremental builder. | 9 |
| `common/tests/cursorDomain.spec.ts` | **New.** | 9 |
| `common/db/index.ts` | Barrel. Adds `cursorDomain`. | 9 |

### Repo C — `apps/company`

| File | Responsibility | Task |
|---|---|---|
| `tests/workers/snapshotDomain.wipeGuard.spec.ts` | Repair | 11 |
| `tests/workers/snapshotDomain.refetchEnvelope.spec.ts` | Repair | 12 |
| `tests/workers/snapshotDomain.fanOutScope.spec.ts` | Repair | 13 |
| `tests/workers/carrierReferenceDomains.spec.ts` | Repair | 14 |
| `src/services/appCacheBootstrap.ts` | Stale `domain:` login-marker delete | 15 |

### Not in this plan

Phase B — steps 4–6 of the spec: `createSyncHarness`, `syncService`, the catalog over Comlink, and every deletion. Those require a call-site census in both apps and depend on what this plan produces. They get their own plan.

---

# Repo A — Framework

### Task 1: Expand array query params into repeated keys

`workerRemoteApi` builds its query with `new URLSearchParams(params)`, which **comma-joins** an array: `{a:[1,2]}` becomes `a=1%2C2`. Moqui reads that as one literal value and matches nothing, so the request returns 200 with an empty list and the failure is completely silent. Both `workerFetch` copies carry a local workaround for this; inventory-count's workers do not and have the bug.

**Files:**
- Modify: `common/core/workerRemoteApi.ts`
- Test: `common/tests/workerRemoteApi.spec.ts` (create)

**Interfaces:**
- Consumes: nothing
- Produces: `workerRemoteApi({ url, method?, data?, params?, baseURL?, headers? })` — unchanged signature; `params` values may now be arrays and serialize as repeated keys.

- [ ] **Step 1: Write the failing test**

Create `common/tests/workerRemoteApi.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import workerRemoteApi from "../core/workerRemoteApi";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const ok = (body: unknown = {}) => ({ ok: true, status: 200, json: async () => body });
const requestedUrl = () => new URL(String(fetchMock.mock.calls[0][0]));

describe("workerRemoteApi query serialization", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(ok());
  });

  it("expands an array param into repeated keys", async () => {
    await workerRemoteApi({
      baseURL: "https://x.test/rest/s1/",
      url: "oms/systemMessages",
      params: { systemMessageId: ["A", "B"], statusId: "SENT" },
    });

    const query = requestedUrl().searchParams;
    expect(query.getAll("systemMessageId")).toEqual(["A", "B"]);
    expect(query.get("statusId")).toBe("SENT");
  });

  // Moqui reads a comma-joined value as ONE literal id and matches nothing, so the request
  // succeeds with an empty list. That silence is what made this bug survive so long.
  it("never comma-joins an array", async () => {
    await workerRemoteApi({
      baseURL: "https://x.test/rest/s1/",
      url: "oms/systemMessages",
      params: { systemMessageId: ["A", "B"] },
    });

    expect(String(fetchMock.mock.calls[0][0])).not.toContain("%2C");
  });

  it("drops null and undefined rather than sending them as strings", async () => {
    await workerRemoteApi({
      baseURL: "https://x.test/rest/s1/",
      url: "oms/facilities",
      params: { a: null, b: undefined, c: "keep" },
    });

    const query = requestedUrl().searchParams;
    expect(query.has("a")).toBe(false);
    expect(query.has("b")).toBe(false);
    expect(query.get("c")).toBe("keep");
  });

  it("skips null entries inside an array", async () => {
    await workerRemoteApi({
      baseURL: "https://x.test/rest/s1/",
      url: "oms/facilities",
      params: { facilityId: ["A", null, "B"] },
    });

    expect(requestedUrl().searchParams.getAll("facilityId")).toEqual(["A", "B"]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run common/tests/workerRemoteApi.spec.ts`
Expected: the array tests FAIL — `getAll("systemMessageId")` returns `["A,B"]`, and the URL contains `%2C`.

- [ ] **Step 3: Implement array-aware serialization**

In `common/core/workerRemoteApi.ts`, add above the exported function:

```ts
/**
 * Serialize query params the way Moqui expects, expanding arrays into REPEATED keys:
 *   { id: ["A", "B"], id_op: "in" }  →  id=A&id=B&id_op=in
 *
 * `new URLSearchParams(params)` comma-joins instead — `id=A%2CB` — which Moqui reads as one
 * literal value, so the request 200s with an empty list and the failure is silent. Axios (used on
 * the main thread) expands arrays by default, which is why the same query works from a store and
 * fails from a worker.
 */
function toQueryString(params: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (entry === undefined || entry === null) continue;
        search.append(key, String(entry));
      }
    } else {
      search.append(key, String(value));
    }
  }
  return search.toString();
}
```

Then replace this line:

```ts
    const queryString = new URLSearchParams(params).toString();
```

with:

```ts
    const queryString = toQueryString(params);
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run common/tests/workerRemoteApi.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Confirm no suite regressed**

Run all four suites (see Global Constraints). Expected: exactly the baseline numbers.

- [ ] **Step 6: Commit**

```bash
git add common/core/workerRemoteApi.ts common/tests/workerRemoteApi.spec.ts
git commit -m "fix(core): expand array query params into repeated keys

new URLSearchParams(params) comma-joins arrays, which Moqui reads as one
literal value — the request 200s with an empty list and the failure is
silent. Both workerFetch copies worked around this locally; inventory-count's
workers had the bug with no workaround."
```

---

### Task 2: Tolerate an empty response body

`workerRemoteApi` calls `.json()` unconditionally. Moqui answers some list routes with no body at all when the set is empty (verified previously on `oms/facilityGroups/types` for an instance with no group types), which makes `.json()` throw a `SyntaxError`. Both `workerFetch` copies swallow it locally.

**Files:**
- Modify: `common/core/workerRemoteApi.ts`
- Test: `common/tests/workerRemoteApi.spec.ts` (append)

**Interfaces:**
- Consumes: Task 1's `toQueryString`
- Produces: `workerRemoteApi` resolves `null` for an empty 200 body instead of throwing.

- [ ] **Step 1: Write the failing test**

Append to `common/tests/workerRemoteApi.spec.ts`:

```ts
const emptyBody = () => {
  throw new SyntaxError("Unexpected end of JSON input");
};

describe("workerRemoteApi empty body handling", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("resolves null for a successful response with no body", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: emptyBody });

    await expect(
      workerRemoteApi({ baseURL: "https://x.test/rest/s1/", url: "oms/facilityGroups/types" }),
    ).resolves.toBeNull();
  });

  it("still throws for a failed response with no body, carrying the status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: emptyBody });

    await expect(
      workerRemoteApi({ baseURL: "https://x.test/rest/s1/", url: "oms/facilities" }),
    ).rejects.toThrow(/502/);
  });

  // The existing contract: a failure WITH a parsed body throws that body, because callers
  // classify auth errors by sniffing its message. Do not turn this into an Error.
  it("still throws the parsed body for a failed response that has one", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ errors: "User is not authorized" }),
    });

    await expect(
      workerRemoteApi({ baseURL: "https://x.test/rest/s1/", url: "oms/facilities" }),
    ).rejects.toEqual({ errors: "User is not authorized" });
  });

  it("rethrows a genuine parse error, which is not the same as an empty body", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError("Unexpected token < in JSON at position 0"); },
    });

    await expect(
      workerRemoteApi({ baseURL: "https://x.test/rest/s1/", url: "oms/facilities" }),
    ).rejects.toThrow(/Unexpected token/);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run common/tests/workerRemoteApi.spec.ts`
Expected: the first two FAIL — the empty-body case rejects with the `SyntaxError` instead of resolving `null`.

- [ ] **Step 3: Implement empty-body tolerance**

In `common/core/workerRemoteApi.ts`, add above the exported function:

```ts
/**
 * An empty 200 is not an error. Moqui answers some list routes with no body at all when the set
 * is empty, and `response.json()` throws a SyntaxError on it. A genuine parse failure (an HTML
 * error page, say) has a different message and must still propagate.
 */
function isEmptyBodyError(err: unknown): boolean {
  if (!(err instanceof SyntaxError)) return false;
  return /unexpected end of (json )?input/i.test(String((err as Error).message ?? ""));
}
```

Then replace these lines:

```ts
  const response = await fetch(fullUrl, fetchOptions);
  const result = await response.json();

  if (!response.ok) {
    throw result;
  }
  return result;
```

with:

```ts
  const response = await fetch(fullUrl, fetchOptions);

  let result: any = null;
  try {
    result = await response.json();
  } catch (err) {
    if (!isEmptyBodyError(err)) throw err;
    result = null;
  }

  if (!response.ok) {
    // A parsed error body is thrown as-is: callers classify auth failures by sniffing its
    // message, and wrapping it would break that. Only a bodyless failure becomes an Error.
    throw result ?? new Error(`Request failed with status ${response.status}`);
  }
  return result;
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run common/tests/workerRemoteApi.spec.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Confirm no suite regressed**

Run all four suites. Expected: baseline numbers.

- [ ] **Step 6: Commit**

```bash
git add common/core/workerRemoteApi.ts common/tests/workerRemoteApi.spec.ts
git commit -m "fix(core): treat an empty response body as null, not a parse error

Moqui answers some list routes with no body when the set is empty, and
.json() throws on it. A failure with a parsed body still throws that body
unchanged, because callers classify auth errors from its message."
```

---

### Task 3: Delete the framework fetch layer's transport workarounds

With Tasks 1 and 2 landed, `common/db/sync/workerFetch.ts` no longer needs its own `toQueryString` or `isEmptyBodyError`. It can hand `params` to the transport instead of pre-building a query string into the URL.

Company's copy (`apps/company/src/workers/domains/workerFetch.ts`) keeps its own for now — that whole file is deleted in Phase B.

**Files:**
- Modify: `common/db/sync/workerFetch.ts`
- Modify: `common/tests/workerFetch.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 and 2
- Produces: `workerGet(ctx, url, params)` now passes `params` to `workerRemoteApi` as an object rather than embedding a query string in `url`. **Tests that inspect the outgoing request must read `call[0].params`, not parse `call[0].url`.**

- [ ] **Step 1: Update the existing spec's request inspector to fail against current code**

In `common/tests/workerFetch.spec.ts`, replace:

```ts
const queryOf = (call: number) => new URLSearchParams(workerRemoteApi.mock.calls[call][0].url.split("?")[1] ?? "");
```

with:

```ts
/** The params handed to the transport. `workerGet` no longer embeds a query string in the URL. */
const paramsOf = (call: number): Record<string, any> => workerRemoteApi.mock.calls[call][0].params ?? {};
```

Then update every assertion that used it. There are five:

```ts
    expect(paramsOf(0).pageSize).toBe(250);
    expect(paramsOf(0).viewSize).toBe(250);
```
```ts
    expect(paramsOf(0).roleTypeId).toBe("CARRIER");
    expect(paramsOf(0).pageSize).toBe(500);
```
```ts
    expect(paramsOf(0).pageIndex).toBe(0);
    expect(paramsOf(1).pageIndex).toBe(1);
```

Note the values are now **numbers**, not the strings a URL query yields.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run common/tests/workerFetch.spec.ts`
Expected: FAIL — `paramsOf(0)` is `{}` because `workerGet` currently passes no `params`.

- [ ] **Step 3: Simplify `workerGet` and `workerPost`**

In `common/db/sync/workerFetch.ts`, delete the `toQueryString` function and the `isEmptyBodyError` function entirely, then replace the bodies of `workerGet` and `workerPost` with:

```ts
export async function workerGet(
  ctx: SyncContext,
  url: string,
  params: Record<string, unknown> = {},
): Promise<any> {
  // Array params and empty bodies are the transport's problem now — see common/core/workerRemoteApi.
  return workerRemoteApi({
    baseURL: (ctx.maargUrl as string) || "",
    url,
    params,
    method: "GET",
    headers: { Authorization: `Bearer ${ctx.token}` },
  });
}

export async function workerPost(
  ctx: SyncContext,
  url: string,
  data: Record<string, unknown> = {},
): Promise<any> {
  return workerRemoteApi({
    baseURL: (ctx.maargUrl as string) || "",
    url,
    data,
    method: "POST",
    headers: { Authorization: `Bearer ${ctx.token}` },
  });
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run common/tests/workerFetch.spec.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Confirm no suite regressed**

Run all four suites. Order Manager is the one to watch — it is the only app on this fetch layer today. Expected: 517/517.

- [ ] **Step 6: Commit**

```bash
git add common/db/sync/workerFetch.ts common/tests/workerFetch.spec.ts
git commit -m "refactor(db): hand params to the transport instead of pre-building a query

toQueryString and isEmptyBodyError were working around bugs that now live
fixed in workerRemoteApi. workerFetch is left with its two real concerns:
bind the SyncContext, page the collection."
```

---

### Task 4: Put `label` and `syncClass` on the domain contract

These two fields are what make the status catalog derivable from the registry in Phase B. They land here as **optional**, so nothing breaks; they become required in Phase B step 6.

`cadenceMs` is renamed to `intervalMs` to match the activation model arriving in Task 5. Its only reader is the dead `dueDomains(entries, now)` deleted in that task.

**Files:**
- Modify: `common/db/types.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  ```ts
  interface SyncDomain {
    name: string;
    label?: string;
    syncClass?: "A" | "B" | "C";
    intervalMs?: number;
    sync: (ctx: SyncContext, args?: unknown, options?: { force?: boolean }) => Promise<number | void>;
    refetchOne?: (ctx: SyncContext, pk: Record<string, unknown>, args?: unknown) => Promise<number | void>;
  }
  ```

- [ ] **Step 1: Confirm nothing reads `cadenceMs`**

Run: `grep -rn "cadenceMs" common apps/company/src apps/order-manager/src`
Expected: matches only in `common/db/types.ts` and `common/db/sync/syncRegistry.ts`. If any app matches, STOP — the rename is not safe and `cadenceMs` must be kept as a deprecated alias instead.

- [ ] **Step 2: Update the contract**

In `common/db/types.ts`, replace the `SyncDomain` interface with:

```ts
export interface SyncDomain {
  name: string;
  /**
   * Status-card text. Optional during Phase A, required from Phase B step 6 — a domain that
   * cannot say how it appears is a domain the catalog has to be told about separately, which is
   * the drift this design exists to remove.
   */
  label?: string;
  /**
   * A: cadenced, polled while a view that needs it is open.
   * B: reference/config — once per login, then only on mutation.
   * C: write-through only — never ticked, but still listed and still refetchable.
   */
  syncClass?: "A" | "B" | "C";
  /** Poll cadence for class A. Omit for B and C. `ActiveDomain.intervalMs` overrides it. */
  intervalMs?: number;
  sync: (ctx: SyncContext, args?: unknown, options?: { force?: boolean }) => Promise<number | void>;
  /**
   * Refetch one record after a mutation.
   *
   * Context FIRST, like `sync` — a harness holds one context and hands it to whichever domain is
   * due, and it cannot tell a factory-built domain from a hand-written one. When the two orders
   * disagree the mismatch is silent: the domain reads its key fields off the context (all
   * `undefined`) and issues the request with the primary key where the token belongs, while the
   * mutation that triggered it has already succeeded.
   */
  refetchOne?: (
    ctx: SyncContext,
    pk: Record<string, unknown>,
    args?: unknown,
  ) => Promise<number | void>;
}
```

- [ ] **Step 3: Fix the one reader of the old field name**

In `common/db/sync/syncRegistry.ts`, inside the existing `dueDomains(entries, now)`, change `entry.domain.cadenceMs` to `entry.domain.intervalMs`. (This function is deleted in Task 5; the edit only keeps the tree compiling in between.)

- [ ] **Step 4: Run the suites**

Run all four suites. Expected: baseline numbers. No test asserts on these fields yet — this task is a contract widening, verified by the absence of regression.

- [ ] **Step 5: Commit**

```bash
git add common/db/types.ts common/db/sync/syncRegistry.ts
git commit -m "feat(db): add label and syncClass to SyncDomain; rename cadenceMs to intervalMs

Both optional for now. They become required in Phase B, where the status
catalog starts deriving from the registry instead of a parallel list."
```

---

### Task 5: Promote the activation model into the framework registry

Company's scheduler keys a domain's last-run clock on **name plus arguments**, not name alone. Keyed on name alone, one page that activates the same domain twice with different args and different cadences makes the two share a clock: the 10s activation restamps it every 10s, the 60s activation's interval therefore never elapses, and it runs exactly once per page entry and then never again. Silent, because the first tick does run.

The framework's own `dueDomains(entries, now)` is deleted here — nothing ever wrote the `lastRanAt` / `running` fields it reads, so it is unreachable code.

**Files:**
- Modify: `common/db/sync/syncRegistry.ts`
- Test: `common/tests/syncRegistry.spec.ts` (create)

**Interfaces:**
- Consumes: Task 4's `SyncDomain.intervalMs`
- Produces:
  ```ts
  interface ActiveDomain { name: string; intervalMs?: number; args?: any }
  function activationKey(active: ActiveDomain): string
  function effectiveInterval(active: ActiveDomain, domain: SyncDomain | undefined): number | undefined
  function dueDomains(
    active: readonly ActiveDomain[],
    lastRunAt: Readonly<Record<string, number>>,
    now: number,
    intervalFor: (active: ActiveDomain) => number | undefined,
  ): ActiveDomain[]
  ```
  `registerSyncDomain`, `getSyncDomain`, `getAllSyncDomains`, `registeredDomainNames`, `unregisterSyncDomain`, `clearSyncRegistry` keep their current signatures.

- [ ] **Step 1: Write the failing test**

Create `common/tests/syncRegistry.spec.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  type ActiveDomain,
  activationKey,
  clearSyncRegistry,
  dueDomains,
  effectiveInterval,
  getAllSyncDomains,
  registerSyncDomain,
} from "../db/sync/syncRegistry";
import type { SyncDomain } from "../db/types";

const domain = (name: string, intervalMs?: number): SyncDomain => ({
  name,
  label: name,
  syncClass: intervalMs ? "A" : "B",
  ...(intervalMs ? { intervalMs } : {}),
  sync: async () => 0,
});

describe("activationKey", () => {
  it("is the bare name when there are no args", () => {
    expect(activationKey({ name: "systemMessage" })).toBe("systemMessage");
  });

  /**
   * The bug this exists to prevent: the connection-details page activates `systemMessage` for
   * product-sync types at the idle cadence and again for order-sync types at the active one.
   * Keyed on name alone they share one clock, the 10s activation restamps it every 10s, the 60s
   * activation never becomes due, and the screen stops updating after its first tick.
   */
  it("separates two activations of one domain that do different work", () => {
    const a = activationKey({ name: "systemMessage", args: { type: "order" } });
    const b = activationKey({ name: "systemMessage", args: { type: "product" } });

    expect(a).not.toBe(b);
  });

  it("gives two genuinely identical activations the same key", () => {
    const a = activationKey({ name: "systemMessage", args: { type: "order", total: 50 } });
    const b = activationKey({ name: "systemMessage", args: { total: 50, type: "order" } });

    expect(a).toBe(b);
  });

  it("ignores undefined-valued args, which are not a difference in work", () => {
    const a = activationKey({ name: "d", args: { type: "order", extra: undefined } });
    const b = activationKey({ name: "d", args: { type: "order" } });

    expect(a).toBe(b);
  });
});

describe("effectiveInterval", () => {
  it("prefers the activation's override over the domain default", () => {
    expect(effectiveInterval({ name: "d", intervalMs: 10_000 }, domain("d", 60_000))).toBe(10_000);
  });

  it("falls back to the domain default", () => {
    expect(effectiveInterval({ name: "d" }, domain("d", 60_000))).toBe(60_000);
  });

  it("is undefined for a domain with no cadence", () => {
    expect(effectiveInterval({ name: "d" }, domain("d"))).toBeUndefined();
  });
});

describe("dueDomains", () => {
  const intervalFor = (active: ActiveDomain) => active.intervalMs;

  it("runs everything on the first pass", () => {
    const active: ActiveDomain[] = [{ name: "a" }, { name: "b", intervalMs: 1000 }];

    expect(dueDomains(active, {}, 5_000, intervalFor)).toEqual(active);
  });

  // Class B bootstraps once on activation and then stays idle until a mutation asks for it.
  it("does not re-run a cadence-less domain that has already run", () => {
    expect(dueDomains([{ name: "a" }], { a: 1_000 }, 9_999_999, intervalFor)).toEqual([]);
  });

  it("re-runs a cadenced domain once its interval has elapsed", () => {
    const active: ActiveDomain[] = [{ name: "a", intervalMs: 1000 }];

    expect(dueDomains(active, { a: 5_000 }, 5_999, intervalFor)).toEqual([]);
    expect(dueDomains(active, { a: 5_000 }, 6_000, intervalFor)).toEqual(active);
  });

  it("gives two activations of one domain independent clocks", () => {
    const fast: ActiveDomain = { name: "m", intervalMs: 10_000, args: { type: "order" } };
    const slow: ActiveDomain = { name: "m", intervalMs: 60_000, args: { type: "product" } };
    // The fast activation ran just now; the slow one ran a full minute ago.
    const lastRunAt = { [activationKey(fast)]: 100_000, [activationKey(slow)]: 40_000 };

    const due = dueDomains([fast, slow], lastRunAt, 100_001, (a) => a.intervalMs);

    expect(due).toEqual([slow]);
  });
});

describe("registry", () => {
  beforeEach(() => clearSyncRegistry());

  it("returns the domain it registered, so a caller can hold on to it", () => {
    const d = domain("a");
    expect(registerSyncDomain(d)).toBe(d);
    expect(getAllSyncDomains()).toEqual([d]);
  });

  it("keeps registration order, which is fan-out parent order", () => {
    registerSyncDomain(domain("parent"));
    registerSyncDomain(domain("child"));

    expect(getAllSyncDomains().map((d) => d.name)).toEqual(["parent", "child"]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run common/tests/syncRegistry.spec.ts`
Expected: FAIL to import — `activationKey` and `effectiveInterval` are not exported, and `dueDomains` has a different arity.

- [ ] **Step 3: Rewrite the registry**

Replace the whole of `common/db/sync/syncRegistry.ts` with:

```ts
/**
 * Sync domain registry and the pure scheduling rule.
 *
 * One worker serves every domain rather than one worker per domain. Each domain declares its own
 * cadence; a single base tick runs whichever activations are due.
 */

import type { SyncDomain } from "../types";

const registry = new Map<string, SyncDomain>();

export function registerSyncDomain(domain: SyncDomain): SyncDomain {
  registry.set(domain.name, domain);
  return domain;
}

export function unregisterSyncDomain(name: string): void {
  registry.delete(name);
}

export function getSyncDomain(name: string): SyncDomain | undefined {
  return registry.get(name);
}

export function getAllSyncDomains(): SyncDomain[] {
  return Array.from(registry.values());
}

export function registeredDomainNames(): string[] {
  return Array.from(registry.keys());
}

export function clearSyncRegistry(): void {
  registry.clear();
}

/** A domain the caller has switched on, with its per-activation arguments. */
export interface ActiveDomain {
  name: string;
  /** Overrides the domain's default cadence when present. */
  intervalMs?: number;
  /** Domain-specific arguments (filters, configId, watched job names, …). */
  args?: any;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * The key a domain's last-run clock is stored under.
 *
 * NOT the domain name. One page can activate the SAME domain several times with different args and
 * different cadences. Keyed on name alone those share one clock: the fastest activation restamps it
 * every tick, so a slower one's interval never elapses and it runs exactly once per page entry and
 * then never again. Silent, because the first tick does run it.
 *
 * Key order is stabilised so an equivalent activation built in a different order maps to one clock.
 */
export function activationKey(active: ActiveDomain): string {
  const args = active.args;
  if (args === undefined || args === null) return active.name;
  return `${active.name}:${stableStringify(args)}`;
}

/** The effective cadence for an activation: explicit override, else the domain default. */
export function effectiveInterval(
  active: ActiveDomain,
  domain: SyncDomain | undefined,
): number | undefined {
  return active.intervalMs ?? domain?.intervalMs;
}

/**
 * Which activated domains are due to run now.
 *
 * - No cadence (class B): due only if it has never run — activation bootstrap.
 * - A cadence: due when the interval has elapsed since that ACTIVATION last ran.
 *
 * Pure, so the scheduling rule is testable without a worker or a timer.
 */
export function dueDomains(
  active: readonly ActiveDomain[],
  lastRunAt: Readonly<Record<string, number>>,
  now: number,
  intervalFor: (active: ActiveDomain) => number | undefined,
): ActiveDomain[] {
  return active.filter((entry) => {
    const last = lastRunAt[activationKey(entry)];
    const interval = intervalFor(entry);
    if (interval === undefined) return last === undefined;
    if (last === undefined) return true;
    return now - last >= interval;
  });
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run common/tests/syncRegistry.spec.ts`
Expected: PASS (13 tests)

- [ ] **Step 5: Confirm no suite regressed**

Run all four suites. Company imports `getAllSyncDomains` / `clearSyncRegistry` / `registeredDomainNames` from the barrel and re-exports them — those signatures are unchanged, so Company must stay at 667/22.

Expected: baselines. If Company's `domainRegistration.spec.ts` fails, the `SyncRegistrationEntry` removal broke something that was reading `.domain` off a registry value — check `getAllSyncDomains` call sites.

- [ ] **Step 6: Commit**

```bash
git add common/db/sync/syncRegistry.ts common/tests/syncRegistry.spec.ts
git commit -m "feat(db): promote the per-activation scheduling model into the registry

ActiveDomain, activationKey, effectiveInterval and the real dueDomains come
up from Company. The framework's own dueDomains is deleted: nothing ever
wrote the lastRanAt/running fields it read, so it was unreachable."
```

---

### Task 6: Promote `label`, the no-progress guard and `pageNewestFirst`

Company's `pageAll` reports which **domain** failed, not just which URL; it warns when an endpoint ignores `pageIndex` instead of looping; and it warns rather than truncating silently at the page backstop. Company also has `pageNewestFirst`, which Task 9's cursor builder needs.

**Files:**
- Modify: `common/db/sync/workerFetch.ts`
- Modify: `common/tests/workerFetch.spec.ts`

**Interfaces:**
- Consumes: Task 3's simplified `workerGet`
- Produces:
  - `pageAll` gains `label?: string` (defaults to `url`), used in the strict-collection error and both warnings.
  - ```ts
    pageNewestFirst(options: {
      ctx: SyncContext; url: string; collectionKey?: string | null;
      params: Record<string, unknown>; total: number; batchSize: number;
      keep?: (page: any[]) => any[];
    }): Promise<any[]>
    ```

- [ ] **Step 1: Write the failing test**

First widen the existing import at the top of `common/tests/workerFetch.spec.ts`:

```ts
import { pageAll, pageNewestFirst } from "../db/sync/workerFetch";
```

Then append:

```ts
describe("pageAll diagnostics", () => {
  beforeEach(() => {
    workerRemoteApi.mockReset();
  });

  it("names the domain, not just the URL, when a strict collection is wrong", async () => {
    workerRemoteApi.mockResolvedValueOnce({ partyList: [] });

    await expect(
      pageAll({
        ctx,
        url: "oms/shippingGateways/carrierParties/FEDEX/facilities",
        collectionKey: null,
        strictCollection: true,
        label: "carrierFacility:FEDEX",
        keyOf,
      }),
    ).rejects.toThrow("carrierFacility:FEDEX");
  });

  it("falls back to the URL when no label is given", async () => {
    workerRemoteApi.mockResolvedValueOnce({ nope: [] });

    await expect(
      pageAll({ ctx, url: "oms/returnTypes", collectionKey: null, strictCollection: true, keyOf }),
    ).rejects.toThrow("oms/returnTypes");
  });

  // An endpoint that ignores pageIndex returns page 0 forever. Stopping is right; stopping
  // SILENTLY is not — a half-filled table then looks like a complete one.
  it("warns when an endpoint ignores pageIndex", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    workerRemoteApi.mockResolvedValue(rows(0, 250));

    await pageAll({ ctx, url: "oms/roleTypes", label: "roleType", keyOf });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("roleType"));
    warn.mockRestore();
  });
});

describe("pageNewestFirst", () => {
  beforeEach(() => {
    workerRemoteApi.mockReset();
  });

  it("stops once it has collected the requested total", async () => {
    workerRemoteApi.mockResolvedValue(rows(0, 25));

    const result = await pageNewestFirst({
      ctx, url: "admin/dataManager/details", params: {}, total: 25, batchSize: 25,
    });

    expect(result).toHaveLength(25);
    expect(workerRemoteApi).toHaveBeenCalledTimes(1);
  });

  it("stops on a short page", async () => {
    workerRemoteApi.mockResolvedValueOnce(rows(0, 10));

    const result = await pageNewestFirst({
      ctx, url: "admin/dataManager/details", params: {}, total: 100, batchSize: 25,
    });

    expect(result).toHaveLength(10);
  });

  // `keep` narrowing a page means we have crossed into records already held — stop, don't page on.
  it("stops when keep() drops part of a page", async () => {
    workerRemoteApi
      .mockResolvedValueOnce(rows(0, 25))
      .mockResolvedValueOnce(rows(25, 25));

    const result = await pageNewestFirst({
      ctx, url: "admin/dataManager/details", params: {}, total: 100, batchSize: 25,
      keep: (page) => page.slice(0, 5),
    });

    expect(result).toHaveLength(5);
    expect(workerRemoteApi).toHaveBeenCalledTimes(1);
  });

  it("never returns more than the requested total", async () => {
    workerRemoteApi.mockResolvedValue(rows(0, 25));

    const result = await pageNewestFirst({
      ctx, url: "x", params: {}, total: 10, batchSize: 25,
    });

    expect(result).toHaveLength(10);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run common/tests/workerFetch.spec.ts`
Expected: FAIL — `pageNewestFirst` is not exported, `label` is not a `pageAll` option.

- [ ] **Step 3: Add `label`, the warning, and `pageNewestFirst`**

In `common/db/sync/workerFetch.ts`:

Add `label?: string;` to `pageAll`'s options type, and destructure it with `label = url`.

Change both `assertCollectionShape(resp, collectionKey, url)` calls to `assertCollectionShape(resp, collectionKey, label)`.

Replace the paging loop's exit conditions:

```ts
    if (rows.length < batchSize || newKeysCount === 0) break;
    pageIndex++;
```

with:

```ts
    // Server ignored pageIndex (the same page came back) — stop instead of looping, and say so:
    // a silently half-filled table is indistinguishable from a complete one.
    if (newKeysCount === 0) {
      console.warn(
        `[db] ${label}: page ${pageIndex} returned no new records — the endpoint appears to ignore pageIndex; stopping with ${all.length}.`,
      );
      break;
    }
    if (rows.length < batchSize) break; // last page
    pageIndex++;
```

The `while (pageIndex < maxPages)` block and its closing brace are unchanged — this replaces only the two lines inside it. Then, immediately **after** the closing brace of that `while` block and before `return all;`, insert:

```ts
  // The loop increments pageIndex on a normal iteration, so reaching maxPages here means the walk
  // was cut short rather than finished. Warn — a silently truncated set looks like a complete one.
  if (pageIndex >= maxPages) {
    console.warn(
      `[db] ${label}: stopped at the ${maxPages}-page backstop after ${all.length} records — the set may be TRUNCATED.`,
    );
  }
```

Append `pageNewestFirst`:

```ts
/**
 * Page a newest-first list endpoint until `total` records are collected, a short page arrives, or
 * `keep` says the page has crossed into records already held.
 *
 * The class-A counterpart to `pageAll`: `pageAll` fetches a COMPLETE set and the caller replaces
 * it; this fetches the newest slice and the caller upserts it.
 */
export async function pageNewestFirst(options: {
  ctx: SyncContext;
  url: string;
  collectionKey?: string | null;
  params: Record<string, unknown>;
  total: number;
  batchSize: number;
  /** Narrow a page to the records worth keeping; returning fewer than given stops paging. */
  keep?: (page: any[]) => any[];
}): Promise<any[]> {
  const { ctx, url, collectionKey, params, total, batchSize, keep } = options;
  const collected: any[] = [];

  for (let pageIndex = 0; collected.length < total; pageIndex++) {
    const resp = await workerGet(ctx, url, { ...params, pageSize: batchSize, pageIndex });
    const page: any[] = unwrapCollection(resp, collectionKey);
    if (!page.length) break;

    if (keep) {
      const fresh = keep(page);
      collected.push(...fresh);
      if (fresh.length < page.length) break; // crossed into already-cached records
    } else {
      collected.push(...page);
    }

    if (page.length < batchSize) break; // last page
  }

  return collected.slice(0, total);
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run common/tests/workerFetch.spec.ts`
Expected: PASS (16 tests)

- [ ] **Step 5: Confirm no suite regressed**

Run all four suites. Expected: baselines.

- [ ] **Step 6: Commit**

```bash
git add common/db/sync/workerFetch.ts common/tests/workerFetch.spec.ts
git commit -m "feat(db): add fetch labels, a no-progress warning, and pageNewestFirst

A fan-out issues N requests to N URLs, so a failure has to name the domain
and the parent to be actionable. pageNewestFirst is the class-A counterpart
to pageAll and is what the cursor domain builder needs."
```

---

### Task 7: Derive the fetch label in `snapshotDomain`; require an explicit `getDb`

Domains should not hand-write a label at 22 registration sites — `snapshotDomain` already knows the domain name and the fan-out parent.

`getDb` becomes required in the type. The runtime fallback to `getAppDb()` stays for one more step with a deprecation warning, because Company's `referenceDomains.ts` omits it at 22 sites and cannot be changed in this repo's commit. It is deleted in Phase B step 6.

**Files:**
- Modify: `common/db/sync/snapshotDomain.ts`
- Test: `common/tests/snapshotDomain.label.spec.ts` (create)

**Interfaces:**
- Consumes: Task 6's `label` option
- Produces: `registerSnapshotDomain(config, getDb)` — `getDb` typed as required; omitting it still works at runtime but warns.

- [ ] **Step 1: Write the failing test**

Create `common/tests/snapshotDomain.label.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const workerRemoteApi = vi.hoisted(() => vi.fn());
vi.mock("../core/workerRemoteApi", () => ({ default: workerRemoteApi }));

import { defineEntity } from "../db/defineEntity";
import { registerSnapshotDomain } from "../db/sync/snapshotDomain";
import { clearSyncRegistry } from "../db/sync/syncRegistry";
import type { SyncContext } from "../db/types";

const ctx = {
  token: "t", maargUrl: "https://x.test/rest/s1/", omsInstance: "demo", now: 0,
} as unknown as SyncContext;

const stubDb = (parents: any[] = []) => ({
  table: () => ({
    count: async () => 0,
    toArray: async () => parents,
    toCollection: () => ({ primaryKeys: async () => [], toArray: async () => parents }),
    where: () => ({ equals: () => ({ toArray: async () => [] }) }),
    bulkPut: async () => {},
    bulkDelete: async () => {},
    delete: async () => {},
  }),
  transaction: async (_m: any, _t: any, fn: () => Promise<any>) => fn(),
  syncMeta: { get: async () => undefined, put: async () => {}, delete: async () => {} },
}) as any;

const carrierFacility = defineEntity({
  primaryKey: "partyId,facilityId",
  fields: { partyId: "text", facilityId: "text" },
});

describe("snapshot domain fetch labels", () => {
  beforeEach(() => {
    clearSyncRegistry();
    workerRemoteApi.mockReset();
  });

  it("labels a plain list failure with the domain name", async () => {
    workerRemoteApi.mockResolvedValueOnce({ partyList: [] });

    const domain = registerSnapshotDomain({
      name: "carrier",
      table: "carriers",
      projection: defineEntity({ primaryKey: "partyId", fields: { partyId: "text" } }),
      listUrl: "oms/shippingGateways/carrierParties",
      collectionKey: null,
      strictCollection: true,
    }, () => stubDb());

    await expect(domain.sync(ctx, undefined, { force: true })).rejects.toThrow(/\bcarrier\b/);
  });

  /**
   * A fan-out issues one request per parent. Reporting only the URL leaves an operator to work
   * out which domain and which parent that was; the label carries both.
   */
  it("labels a fan-out failure with the domain name and the parent id", async () => {
    workerRemoteApi.mockResolvedValueOnce({ carrierFacilityList: [] });

    const domain = registerSnapshotDomain({
      name: "carrierFacility",
      table: "carrierFacilities",
      projection: carrierFacility,
      listUrl: "oms/shippingGateways/carrierParties",
      collectionKey: null,
      strictCollection: true,
      fanOut: {
        parentTable: "carriers",
        parentKeyField: "partyId",
        urlFor: (id) => `oms/shippingGateways/carrierParties/${id}/facilities`,
      },
    }, () => stubDb([{ partyId: "FEDEX" }]));

    await expect(domain.sync(ctx, undefined, { force: true }))
      .rejects.toThrow("carrierFacility:FEDEX");
  });

  it("labels a scoped refetch with the domain name", async () => {
    workerRemoteApi.mockResolvedValueOnce({ unexpected: [] });

    const domain = registerSnapshotDomain({
      name: "systemMessageRemote",
      table: "systemMessageRemotes",
      projection: defineEntity({
        primaryKey: "systemMessageRemoteId",
        fields: { systemMessageRemoteId: "text" },
      }),
      listUrl: "oms/systemMessageRemotes",
      collectionKey: null,
      strictCollection: true,
      refetchScope: (pk) => ({
        params: { systemMessageRemoteId: pk.systemMessageRemoteId },
        scope: { field: "systemMessageRemoteId", value: pk.systemMessageRemoteId },
      }),
    }, () => stubDb());

    await expect(domain.refetchOne!(ctx, { systemMessageRemoteId: "SHOPIFY_1" }))
      .rejects.toThrow("systemMessageRemote");
  });
});

describe("snapshot domain database resolution", () => {
  beforeEach(() => {
    clearSyncRegistry();
    workerRemoteApi.mockReset();
  });

  it("warns when getDb is omitted, because the domain then writes to whichever db registered last", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    registerSnapshotDomain({
      name: "legacy",
      table: "carriers",
      projection: defineEntity({ primaryKey: "partyId", fields: { partyId: "text" } }),
      listUrl: "oms/x",
      collectionKey: null,
    } as any);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("legacy"));
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run common/tests/snapshotDomain.label.spec.ts`
Expected: FAIL — errors carry the URL, not the domain name; no deprecation warning is emitted.

- [ ] **Step 3: Derive the label and warn on the missing `getDb`**

In `common/db/sync/snapshotDomain.ts`, change the signature:

```ts
export function registerSnapshotDomain(
  config: SnapshotDomainConfig,
  getDb: (omsInstance: string) => BaseDB,
): SyncDomain {
  if (!getDb) {
    // Phase A transitional: Company's referenceDomains.ts omits this at 22 sites and lives in a
    // different repo, so it cannot be fixed in the same commit. Removed in Phase B step 6.
    console.warn(
      `[db] registerSnapshotDomain("${config.name}") was called without a getDb; falling back to the ` +
      "active AppDb global. Pass an explicit getDb — a domain should name the database it writes to.",
    );
  }
  const resolveDb = getDb ?? ((omsInstance: string) => getAppDb().get(omsInstance));
```

Then add `label` to all four `pageAll` call sites:

- the plain list in `sync`: `label: config.name,`
- the fan-out leg in `sync`: `label: \`${config.name}:${parentId}\`,`
- the fan-out leg in `refetchOne`: `label: \`${config.name}:${parentId}\`,`
- the `refetchScope` path in `refetchOne`: `label: config.name,`

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run common/tests/snapshotDomain.label.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Confirm no suite regressed**

Run all four suites. Company will now emit 22 deprecation warnings during its worker specs — noisy but not failing. Expected: Company 667/22.

- [ ] **Step 6: Commit**

```bash
git add common/db/sync/snapshotDomain.ts common/tests/snapshotDomain.label.spec.ts
git commit -m "feat(db): derive the fetch label from the domain; deprecate the implicit db

A fan-out failure now reports carrierFacility:FEDEX rather than a bare URL,
without 22 registration sites hand-writing a label. getDb is typed required;
the global fallback warns and is removed in Phase B."
```

---

### Task 8: Give `defineCachedEntity` the operations a cursor domain needs

The class-A builder in Task 9 needs `count` and `newestCursor`. Today only Company's read-layer `appCacheDb` has them, and the read layer is explicitly out of scope. But `defineCachedEntity` lives in `snapshotDomain.ts` — it is a **sync-layer** construct — so extending it stays inside this project's boundary.

Company's `rowsMissing` (the "still in flight, re-check it" set) is deliberately **not** promoted here: nothing in Phase A uses it. It lands in Phase B, when Company's `dataManagerLog` domain migrates onto `cursorDomain` and actually needs it.

**Files:**
- Modify: `common/db/sync/snapshotDomain.ts`
- Test: `common/tests/cachedEntity.spec.ts` (create)

**Interfaces:**
- Consumes: Task 7's `snapshotDomain`
- Produces, added to `defineCachedEntity(db, table, entity)`'s return:
  ```ts
  count(scope?: { field: string; value: unknown }): Promise<number>
  newestCursor(dateField: string, scope?: { field: string; value: unknown }): Promise<number | undefined>
  ```

- [ ] **Step 1: Write the failing test**

Create `common/tests/cachedEntity.spec.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defineEntity } from "../db/defineEntity";
import { defineCachedEntity } from "../db/sync/snapshotDomain";

const logs = defineEntity({
  primaryKey: "logId",
  fields: { logId: "text", configId: "text", createdDate: "date", finishDateTime: "date" },
  indexes: ["configId", "createdDate"],
});

/** An in-memory stand-in for one Dexie table, enough for the read paths under test. */
function stubDb(rows: any[]) {
  const collection = (subset: any[]) => ({
    toArray: async () => subset,
    primaryKeys: async () => subset.map((r) => r.logId),
    count: async () => subset.length,
    filter: (fn: (r: any) => boolean) => collection(subset.filter(fn)),
    limit: (n: number) => collection(subset.slice(0, n)),
    reverse: () => collection([...subset].reverse()),
  });

  return {
    table: () => ({
      ...collection(rows),
      toCollection: () => collection(rows),
      where: (field: string) => ({
        equals: (value: unknown) => collection(rows.filter((r) => r[field] === value)),
      }),
      bulkPut: async () => {},
      bulkDelete: async () => {},
      delete: async () => {},
    }),
    transaction: async (_m: any, _t: any, fn: () => Promise<any>) => fn(),
  } as any;
}

const ROWS = [
  { logId: "L1", configId: "C1", createdDate: 300, finishDateTime: 350 },
  { logId: "L2", configId: "C1", createdDate: 500 },
  { logId: "L3", configId: "C2", createdDate: 900 },
];

describe("defineCachedEntity cursor operations", () => {
  it("counts every row when no scope is given", async () => {
    const entity = defineCachedEntity(stubDb(ROWS), "dataManagerLogs", logs);

    expect(await entity.count()).toBe(3);
  });

  it("counts only the scoped partition", async () => {
    const entity = defineCachedEntity(stubDb(ROWS), "dataManagerLogs", logs);

    expect(await entity.count({ field: "configId", value: "C1" })).toBe(2);
  });

  it("finds the newest cursor value in a scope", async () => {
    const entity = defineCachedEntity(stubDb(ROWS), "dataManagerLogs", logs);

    expect(await entity.newestCursor("createdDate", { field: "configId", value: "C1" })).toBe(500);
  });

  // An empty scope must be undefined, NOT 0: a 0 cursor would be sent as a real lower bound and
  // the first sync would fetch only rows after the epoch boundary instead of seeding the window.
  it("returns undefined for an empty scope rather than zero", async () => {
    const entity = defineCachedEntity(stubDb([]), "dataManagerLogs", logs);

    expect(await entity.newestCursor("createdDate")).toBeUndefined();
  });

  it("ignores rows whose cursor field is absent", async () => {
    const entity = defineCachedEntity(
      stubDb([{ logId: "L9", configId: "C1" }, { logId: "L8", configId: "C1", createdDate: 42 }]),
      "dataManagerLogs",
      logs,
    );

    expect(await entity.newestCursor("createdDate", { field: "configId", value: "C1" })).toBe(42);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run common/tests/cachedEntity.spec.ts`
Expected: FAIL — `entity.count is not a function`.

- [ ] **Step 3: Add the three operations**

In `common/db/sync/snapshotDomain.ts`, inside the object `defineCachedEntity` returns, add after `remove`:

```ts
    /** Rows in the table, or in one scoped partition. The shallow-window test for a cursor sync. */
    async count(scope?: { field: string; value: unknown }) {
      if (!scope) return tableRef.count();
      return tableRef.where(scope.field).equals(scope.value as any).count();
    },

    /**
     * The newest stored value of `dateField`, optionally scoped — the incremental-poll cursor.
     *
     * Undefined for an empty scope, never 0: a 0 would be sent as a genuine lower bound and the
     * first sync would seed nothing.
     */
    async newestCursor(dateField: string, scope?: { field: string; value: unknown }) {
      const rows = scope
        ? await tableRef.where(scope.field).equals(scope.value as any).toArray()
        : await tableRef.toCollection().toArray();

      let newest: number | undefined;
      for (const row of rows) {
        const value = (row as Record<string, unknown>)[dateField];
        if (typeof value === "number" && (newest === undefined || value > newest)) newest = value;
      }
      return newest;
    },
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run common/tests/cachedEntity.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Confirm no suite regressed**

Run all four suites. Expected: baselines.

- [ ] **Step 6: Commit**

```bash
git add common/db/sync/snapshotDomain.ts common/tests/cachedEntity.spec.ts
git commit -m "feat(db): add count and newestCursor to defineCachedEntity

The two operations a class-A cursor domain needs. defineCachedEntity is a
sync-layer construct, so this stays clear of the read layer that Phase 5
defers."
```

---

### Task 9: Add the class-A cursor domain builder

Only Company has an incremental domain today, hand-written per entity. This is the framework primitive, and it is what lets the framework serve anything beyond seed reference data.

The subtle rule it encodes: **a shallow window is deepened, not just topped up.** A cursor plus a stop-on-first-known-row means paging stops at page 0 on every tick once anything is cached, so `total` would only ever apply to an empty scope and raising it later would do nothing.

**Files:**
- Create: `common/db/sync/cursorDomain.ts`
- Modify: `common/db/index.ts`
- Test: `common/tests/cursorDomain.spec.ts` (create)

**Interfaces:**
- Consumes: Task 6's `pageNewestFirst`, Task 8's `count` / `newestCursor`, `keepNewerThan` from `common/db/projection.ts`
- Produces:
  ```ts
  interface CursorDomainConfig {
    name: string; label: string; table: string; projection: Entity;
    syncClass?: "A"; intervalMs?: number;
    listUrl: string; collectionKey?: string | null;
    cursorField: string;            // stored date field that advances
    cursorParam: string;            // server lower-bound param, e.g. "createdDate_from"
    orderByField?: string;          // default: `-${cursorField}`
    total?: number; batchSize?: number;
    scopeOf?: (args: any) => { field: string; value: unknown } | undefined;
    paramsOf?: (args: any) => Record<string, unknown>;
  }
  function registerCursorDomain(
    config: CursorDomainConfig,
    getDb: (omsInstance: string) => BaseDB,
  ): SyncDomain
  ```

- [ ] **Step 1: Write the failing test**

Create `common/tests/cursorDomain.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const workerRemoteApi = vi.hoisted(() => vi.fn());
vi.mock("../core/workerRemoteApi", () => ({ default: workerRemoteApi }));

import { defineEntity } from "../db/defineEntity";
import { registerCursorDomain } from "../db/sync/cursorDomain";
import { clearSyncRegistry } from "../db/sync/syncRegistry";
import type { SyncContext } from "../db/types";

const ctx = {
  token: "t", maargUrl: "https://x.test/rest/s1/", omsInstance: "demo", now: 0,
} as unknown as SyncContext;

const logs = defineEntity({
  primaryKey: "logId",
  fields: { logId: "text", configId: "text", createdDate: "date" },
  indexes: ["configId", "createdDate"],
});

const written: any[] = [];

function stubDb(existing: any[]) {
  const collection = (subset: any[]) => ({
    toArray: async () => subset,
    count: async () => subset.length,
    primaryKeys: async () => subset.map((r) => r.logId),
  });
  return {
    table: () => ({
      ...collection(existing),
      toCollection: () => collection(existing),
      where: (field: string) => ({
        equals: (value: unknown) => collection(existing.filter((r) => r[field] === value)),
      }),
      bulkPut: async (rows: any[]) => { written.push(...rows); },
      bulkDelete: async () => {},
      delete: async () => {},
    }),
    transaction: async (_m: any, _t: any, fn: () => Promise<any>) => fn(),
  } as any;
}

const CONFIG = {
  name: "dataManagerLog",
  label: "Data Manager Logs",
  table: "dataManagerLogs",
  projection: logs,
  intervalMs: 10_000,
  listUrl: "admin/dataManager/details",
  collectionKey: "dataManagerLogs",
  cursorField: "createdDate",
  cursorParam: "createdDate_from",
  total: 100,
  batchSize: 25,
  scopeOf: (args: any) => (args?.configId ? { field: "configId", value: args.configId } : undefined),
};

const page = (from: number, count: number) =>
  ({ dataManagerLogs: Array.from({ length: count }, (_, i) => ({
    logId: `L${from + i}`, configId: "C1", createdDate: from + i,
  })) });

describe("cursor domain", () => {
  beforeEach(() => {
    clearSyncRegistry();
    workerRemoteApi.mockReset();
    written.length = 0;
  });

  it("registers as a class-A domain carrying its label and cadence", () => {
    const domain = registerCursorDomain(CONFIG, () => stubDb([]));

    expect(domain.name).toBe("dataManagerLog");
    expect(domain.label).toBe("Data Manager Logs");
    expect(domain.syncClass).toBe("A");
    expect(domain.intervalMs).toBe(10_000);
  });

  it("sends no lower bound on an empty scope", async () => {
    workerRemoteApi.mockResolvedValueOnce(page(1, 5));
    const domain = registerCursorDomain(CONFIG, () => stubDb([]));

    await domain.sync(ctx, { configId: "C1" });

    expect(workerRemoteApi.mock.calls[0][0].params).not.toHaveProperty("createdDate_from");
  });

  /**
   * The bug this encodes: with a cursor AND stop-on-first-known-row, paging halts at page 0 every
   * tick once anything is cached. `total` would then only ever apply to an empty scope, and raising
   * it later would silently do nothing. Below target, page from zero with no cursor to DEEPEN.
   */
  it("deepens a shallow window instead of topping it up", async () => {
    workerRemoteApi.mockResolvedValue(page(1, 25));
    const shallow = Array.from({ length: 10 }, (_, i) => ({ logId: `E${i}`, configId: "C1", createdDate: i }));
    const domain = registerCursorDomain(CONFIG, () => stubDb(shallow));

    await domain.sync(ctx, { configId: "C1" });

    expect(workerRemoteApi.mock.calls[0][0].params).not.toHaveProperty("createdDate_from");
  });

  it("sends the cursor as a lower bound once the window is at target", async () => {
    workerRemoteApi.mockResolvedValueOnce(page(200, 1));
    const full = Array.from({ length: 100 }, (_, i) => ({ logId: `E${i}`, configId: "C1", createdDate: i + 1 }));
    const domain = registerCursorDomain(CONFIG, () => stubDb(full));

    await domain.sync(ctx, { configId: "C1" });

    expect(workerRemoteApi.mock.calls[0][0].params.createdDate_from)
      .toBe(new Date(100).toISOString());
  });

  /**
   * Moqui's `_from` is INCLUSIVE, so the boundary row comes back on every quiet poll. Dropping it
   * client-side is what makes a quiet tick write nothing at all.
   */
  it("drops the inclusive boundary row so a quiet tick writes nothing", async () => {
    workerRemoteApi.mockResolvedValueOnce({
      dataManagerLogs: [{ logId: "E99", configId: "C1", createdDate: 100 }],
    });
    const full = Array.from({ length: 100 }, (_, i) => ({ logId: `E${i}`, configId: "C1", createdDate: i + 1 }));
    const domain = registerCursorDomain(CONFIG, () => stubDb(full));

    const count = await domain.sync(ctx, { configId: "C1" });

    expect(count).toBe(0);
    expect(written).toHaveLength(0);
  });

  it("upserts projected rows and reports how many it wrote", async () => {
    workerRemoteApi.mockResolvedValueOnce(page(1, 3));
    const domain = registerCursorDomain(CONFIG, () => stubDb([]));

    const count = await domain.sync(ctx, { configId: "C1" });

    expect(count).toBe(3);
    expect(written).toHaveLength(3);
    expect(written[0]).toHaveProperty("syncedAt");
  });

  it("merges caller params into the request", async () => {
    workerRemoteApi.mockResolvedValueOnce(page(1, 1));
    const domain = registerCursorDomain(
      { ...CONFIG, paramsOf: (args: any) => ({ statusId: args.statusId }) },
      () => stubDb([]),
    );

    await domain.sync(ctx, { configId: "C1", statusId: "SUCCESS" });

    expect(workerRemoteApi.mock.calls[0][0].params.statusId).toBe("SUCCESS");
    expect(workerRemoteApi.mock.calls[0][0].params.configId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run common/tests/cursorDomain.spec.ts`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Implement the builder**

Create `common/db/sync/cursorDomain.ts`:

```ts
/**
 * Factory for class-A (live, append-mostly) incremental sync domains.
 *
 * The counterpart to `snapshotDomain`: that one fetches a COMPLETE set and replaces it; this one
 * fetches the slice newer than what is already stored and upserts it. Nothing is ever pruned here,
 * so a soft failure cannot empty a table.
 *
 * Imports no `vue` and not the `@common/db` barrel — worker chunks must stay a single iife.
 */

import type { BaseDB } from "../baseDb";
import type { Entity } from "../defineEntity";
import { keepNewerThan } from "../projection";
import type { SyncContext, SyncDomain } from "../types";
import { defineCachedEntity } from "./snapshotDomain";
import { registerSyncDomain } from "./syncRegistry";
import { pageNewestFirst } from "./workerFetch";

export interface CursorDomainConfig {
  name: string;
  label: string;
  table: string;
  projection: Entity;
  intervalMs?: number;
  listUrl: string;
  collectionKey?: string | null;
  /** The stored date field that advances — the cursor. */
  cursorField: string;
  /** Server param that lower-bounds the cursor. Sent as an ISO string. */
  cursorParam: string;
  /** Server sort. Defaults to newest-first on the cursor field. */
  orderByField?: string;
  /** Rows to hold per scope. The window is DEEPENED to this before incremental reads begin. */
  total?: number;
  batchSize?: number;
  /** Resolve the partition from the activation args. */
  scopeOf?: (args: any) => { field: string; value: unknown } | undefined;
  /** Extra server-side params from the activation args. */
  paramsOf?: (args: any) => Record<string, unknown>;
}

export function registerCursorDomain(
  config: CursorDomainConfig,
  getDb: (omsInstance: string) => BaseDB,
): SyncDomain {
  const target = config.total ?? 100;
  const batchSize = config.batchSize ?? 25;

  const domain: SyncDomain = {
    name: config.name,
    label: config.label,
    syncClass: "A",
    ...(config.intervalMs ? { intervalMs: config.intervalMs } : {}),

    async sync(ctx: SyncContext, args: any = {}) {
      const db = getDb(ctx.omsInstance);
      const entity = defineCachedEntity(db, config.table, config.projection);
      const scope = config.scopeOf?.(args);

      /**
       * A SHALLOW WINDOW IS DEEPENED, NOT TOPPED UP.
       *
       * A cursor plus `keep` stops paging at the first already-stored row — page 0, every tick,
       * once anything is cached. So `total` would only ever apply to an EMPTY scope and raising it
       * later would do nothing. Below target: page from zero with no cursor until the scope holds
       * `total`. At target: the normal one-page incremental read.
       */
      const cached = await entity.count(scope);
      const isShallow = cached < target;
      const cursor = isShallow ? undefined : await entity.newestCursor(config.cursorField, scope);

      const records = await pageNewestFirst({
        ctx,
        url: config.listUrl,
        collectionKey: config.collectionKey,
        total: isShallow ? target : batchSize,
        batchSize,
        params: {
          ...(config.paramsOf?.(args) ?? {}),
          // Moqui's `_from` is INCLUSIVE, so the boundary row returns on every quiet poll; the
          // client-side cutoff in `keep` drops it and a quiet tick writes nothing.
          ...(cursor !== undefined ? { [config.cursorParam]: new Date(cursor).toISOString() } : {}),
          orderByField: config.orderByField ?? `-${config.cursorField}`,
        },
        keep: cursor === undefined
          ? undefined
          : (page) => keepNewerThan(page, config.cursorField, cursor),
      });

      return entity.upsertMany(records);
    },

    async refetchOne(ctx: SyncContext, pk: Record<string, unknown>) {
      const db = getDb(ctx.omsInstance);
      const entity = defineCachedEntity(db, config.table, config.projection);
      const keyField = config.projection.primaryKeyFields[0];
      const id = pk?.[keyField];
      if (!id) return 0;

      const records = await pageNewestFirst({
        ctx,
        url: config.listUrl,
        collectionKey: config.collectionKey,
        total: 1,
        batchSize: 1,
        params: { [keyField]: id },
      });

      return entity.upsertMany(records);
    },
  };

  return registerSyncDomain(domain);
}
```

- [ ] **Step 4: Export it from the barrel**

In `common/db/index.ts`, add after the `snapshotDomain` export:

```ts
export * from "./sync/cursorDomain";
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `npx vitest run common/tests/cursorDomain.spec.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Confirm no suite regressed**

Run all four suites. Expected: baselines.

- [ ] **Step 7: Commit**

```bash
git add common/db/sync/cursorDomain.ts common/db/index.ts common/tests/cursorDomain.spec.ts
git commit -m "feat(db): add the class-A cursor domain builder

Fetches the slice newer than what is stored and upserts it; never prunes, so
a soft failure cannot empty a table. Encodes the deepen-don't-top-up rule:
below target it pages from zero with no cursor, because a cursor plus
stop-on-known-row halts at page 0 forever once anything is cached."
```

---

### Task 10: Verify the framework additions did not move either app

A checkpoint task with no code. Tasks 1–9 changed a shared transport, a registry, a fetch layer and a domain factory that both apps import. This confirms neither app moved before the Company spec repairs begin, so any later failure is attributable.

**Files:** none

- [ ] **Step 1: Run every suite and record the numbers**

```bash
cd /Users/ravi/ofbiz_dev/hc/my_workspace/accxui && npx vitest run common/tests
cd apps/order-manager && npx vitest run
cd ../company && npx vitest run
cd ../inventory-count && npx vitest run
```

Expected: `common` **182 pass / 4 fail** (139 baseline + 43 new: 8 transport, 13 registry, 7 fetch, 4 label, 4 cached-entity, 7 cursor) · `order-manager` 517/0 · `company` 667/22 · `inventory-count` 20/12.

- [ ] **Step 2: Confirm the framework typecheck did not regress on touched files**

Run: `npx vue-tsc --noEmit -p tsconfig.json 2>&1 | grep -E "^common/(db|core)"`
Expected: no new errors in `workerRemoteApi.ts`, `syncRegistry.ts`, `workerFetch.ts`, `snapshotDomain.ts`, `cursorDomain.ts`, `types.ts`. Pre-existing errors in `dbClient.ts`, `pollingService.ts`, `useSeedData.ts` and `appDbBootstrap.ts` are baseline and stay.

- [ ] **Step 3: If anything moved, stop**

Do not proceed to Task 11. Bisect the commit from Tasks 1–9 that moved it and fix it before continuing — the Company spec repairs assume a stable framework underneath.

---

# Repo C — `apps/company`

> All Task 11–15 commands run from `apps/company`, which is **its own git repository**. Do not commit these from the root repo.

The four spec files below were written against Company's own `snapshotDomain`, which no longer exists — `referenceDomains.ts` now uses `@common/db/sync/snapshotDomain`. Each has already been partly repaired (they mock `@common/db/sync/workerFetch` alongside the old targets). Three problems remain:

1. **The db is resolved from a module-scope `setAppDb`**, but `register()` calls `vi.resetModules()`, which creates a fresh `appDbRegistry` whose `activeAppDb` is null. `fanOutScope.spec.ts` already fixed this by moving `setAppDb` inside `register()`; the others have not.
2. **They mock `@/utils/db/appCacheDb`'s `defineCachedEntity`**, which the framework's `snapshotDomain` does not use — it has its own. The mock is inert, so real projection runs and assertions written against raw records fail.
3. **Assertions expect raw server records.** Stored rows are projected: coerced by declared kind and carrying `syncedAt`.

The repair for each: pass an explicit `getDb` (Task 7 made it a real parameter), drop the dead `appCacheDb` mock, and assert projected rows against the Dexie stub.

---

### Task 11: Repair `snapshotDomain.wipeGuard.spec.ts`

Four tests. It pins that an automatic snapshot never empties a populated table on a zero-row fetch — `snapshotReplace` prunes whatever the fetch did not return, and a zero-row fetch is exactly what a soft failure looks like from inside.

**Files:**
- Modify: `tests/workers/snapshotDomain.wipeGuard.spec.ts`

**Interfaces:**
- Consumes: `registerSnapshotDomain(config, getDb)` from Task 7

- [ ] **Step 1: Replace the mocks and the register helper**

Delete the `vi.mock("@/utils/db/appCacheDb", …)` block and the module-scope `setAppDb(mockDb as any)` call.

Replace the `mockRaw` / `mockDb` definitions and `register()` with:

```ts
const stubDb = () => ({
  table: () => ({
    count: async () => state.cachedCount,
    toArray: async () => [],
    toCollection: () => ({ primaryKeys: async () => [], toArray: async () => [] }),
    where: () => ({ equals: () => ({ toArray: async () => [] }) }),
    bulkPut: async (rows: any[]) => { state.snapshotCalls.push(rows); },
    bulkDelete: async () => {},
    put: async () => {},
    delete: async () => {},
  }),
  transaction: async (_mode: any, _tables: any, fn: () => Promise<any>) => fn(),
  syncMeta: { get: async () => undefined, put: async () => {}, delete: async () => {} },
}) as any;

async function register() {
  vi.resetModules();
  const { registerSnapshotDomain } = await import("@common/db/sync/snapshotDomain");
  // Explicit getDb: the module-scope global does not survive vi.resetModules().
  return registerSnapshotDomain(CONFIG as any, () => stubDb());
}
```

Note `register()` now returns the domain directly — `registerSnapshotDomain` returns it — so the `getSyncDomain` lookup is no longer needed.

Keep the `@common/db/baseDb` mock that supplies `hasSyncedThisLogin` / `markSyncedThisLogin`; that is what the `state.marked` assertions read.

- [ ] **Step 2: Point the fetch mock at the framework module only**

Replace both `vi.mock("@/workers/domains/workerFetch", …)` and `vi.mock("./workerFetch", …)` with a single:

```ts
vi.mock("@common/db/sync/workerFetch", () => ({
  pageAll: vi.fn(async () => state.fetched),
  pageNewestFirst: vi.fn(async () => []),
  workerGet: vi.fn(async () => null),
  workerPost: vi.fn(async () => null),
  unwrapCollection: (resp: any) => (Array.isArray(resp) ? resp : []),
}));
```

- [ ] **Step 3: Assert projected rows, not raw records**

In "snapshots normally when the fetch returns rows", the stored row is projected, so change:

```ts
    expect(state.snapshotCalls).toHaveLength(1);
```

to also assert the shape:

```ts
    expect(state.snapshotCalls).toHaveLength(1);
    expect(state.snapshotCalls[0][0]).toMatchObject({ productStoreId: "STORE_1" });
    expect(state.snapshotCalls[0][0]).toHaveProperty("syncedAt");
```

- [ ] **Step 4: Run the file and confirm all four pass**

Run: `npx vitest run tests/workers/snapshotDomain.wipeGuard.spec.ts`
Expected: PASS (4 tests). The four behaviours must all still be pinned: refuses an empty snapshot over a populated table; allows one over an empty table; lets `force` clear deliberately; snapshots normally when rows come back.

- [ ] **Step 5: Run the Company suite**

Run: `npx vitest run`
Expected: 671 pass / 18 fail.

- [ ] **Step 6: Commit**

```bash
git add tests/workers/snapshotDomain.wipeGuard.spec.ts
git commit -m "test(db): repair the wipe-guard spec against the framework snapshot domain

Explicit getDb instead of a global that vi.resetModules() discards, the
framework's workerFetch as the only mock target, and assertions on projected
rows. The dead @/utils/db/appCacheDb mock is removed."
```

---

### Task 12: Repair `snapshotDomain.refetchEnvelope.spec.ts`

Four tests, pinning two bugs QA found on the live app: `serviceJob`'s by-PK route answers a single-record envelope (`{ jobDetail: … }`) while its list answers `{ serviceJobList: [ … ] }`; and `systemMessageRemote` has no working by-PK route at all, so it re-lists one id via `refetchScope`.

**Files:**
- Modify: `tests/workers/snapshotDomain.refetchEnvelope.spec.ts`

**Interfaces:**
- Consumes: `registerSnapshotDomain(config, getDb)` from Task 7

- [ ] **Step 1: Collapse the three fetch mocks into the framework one**

Replace the three `vi.mock(...)` calls for `@/workers/domains/workerFetch`, `./workerFetch` and `@common/db/sync/workerFetch` with a single mock of `@common/db/sync/workerFetch` using the existing `mockWorkerFetch` factory, extended with `pageNewestFirst: vi.fn(async () => [])` and `workerPost: vi.fn(async () => null)`.

Add `lastScope: undefined as any` to the hoisted `state` object, and reset it in the existing `beforeEach` alongside the other fields.

- [ ] **Step 2: Replace the db wiring**

Delete the module-scope `setAppDb(mockDb as any)` and the `vi.mock("@/utils/db/appCacheDb", …)` block. Replace `mockRaw` / `mockDb` and `register` with:

```ts
const stubDb = () => ({
  table: () => ({
    count: async () => 1,
    toArray: async () => [],
    toCollection: () => ({ primaryKeys: async () => [], toArray: async () => [] }),
    // Record the scope a prune was narrowed to; the refetchScope tests assert on it.
    where: (field: string) => ({
      equals: (value: unknown) => {
        state.lastScope = { field, value };
        return { toArray: async () => [] };
      },
    }),
    put: async (record: any) => { state.upserted.push(record); },
    bulkPut: async (rows: any[]) => {
      state.upserted.push(...rows);
      state.snapshots.push({ rows, scope: state.lastScope ?? null });
      state.lastScope = undefined;
    },
    delete: async (key: string) => { state.removed.push(key); },
    bulkDelete: async () => {},
  }),
  transaction: async (_mode: any, _tables: any, fn: () => Promise<any>) => fn(),
  syncMeta: { get: async () => undefined, put: async () => {}, delete: async () => {} },
}) as any;

async function register(config: any) {
  vi.resetModules();
  const { registerSnapshotDomain } = await import("@common/db/sync/snapshotDomain");
  return registerSnapshotDomain(config, () => stubDb());
}
```

- [ ] **Step 3: Assert projected rows**

The "stores the RECORD, not the envelope" test must assert the projected row rather than the raw job object:

```ts
    expect(written).toBe(1);
    expect(state.upserted).toHaveLength(1);
    expect(state.upserted[0].jobName).toBe("queue_ShopifyOrderSync_99992");
    // The point of the test: the ENVELOPE would have had no jobName and been dropped.
    expect(state.upserted[0]).toHaveProperty("syncedAt");
```

Note the projection declares only `jobName`, so `paused` and `cronExpression` are correctly absent from the stored row — do not assert on them.

- [ ] **Step 4: Run the file and confirm all four pass**

Run: `npx vitest run tests/workers/snapshotDomain.refetchEnvelope.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the Company suite**

Run: `npx vitest run`
Expected: 675 pass / 14 fail.

- [ ] **Step 6: Commit**

```bash
git add tests/workers/snapshotDomain.refetchEnvelope.spec.ts
git commit -m "test(db): repair the refetch-envelope spec against the framework snapshot domain"
```

---

### Task 13: Repair the two remaining tests in `snapshotDomain.fanOutScope.spec.ts`

Two of four already pass — this file's `register()` correctly calls `setAppDb` after `vi.resetModules()`. The two failures are the snapshot-path tests, which read `state.snapshots` populated by the inert `appCacheDb` mock.

**Files:**
- Modify: `tests/workers/snapshotDomain.fanOutScope.spec.ts`

- [ ] **Step 1: Remove the dead mock and pass an explicit `getDb`**

Delete the `vi.mock("@/utils/db/appCacheDb", …)` block. In `register()`, replace the `setAppDb` dance with an explicit `getDb`:

```ts
async function register() {
  vi.resetModules();
  const { companyDb } = await import("@/db/companyDb");
  const { registerSnapshotDomain } = await import("@common/db/sync/snapshotDomain");
  return registerSnapshotDomain(CONFIG as any, () => (companyDb as any).raw());
}
```

- [ ] **Step 2: Record the scope on the stub, not through the dead mock**

In the `@/db/companyDb` mock's `mockRaw`, replace the `where` stub so a scoped prune is observable, and record scope alongside rows:

```ts
      where: (field: string) => ({
        equals: (value: unknown) => {
          state.snapshots.push({ rows: [], scope: { field, value } });
          return { toArray: async () => [] };
        },
      }),
```

and keep `bulkPut` pushing `{ rows, scope: null }`.

- [ ] **Step 3: Update the two failing assertions to projected rows**

Both tests assert the child row carries the authoritative parent id. Change them to read the last `bulkPut` batch:

```ts
    const put = state.snapshots.filter((s) => s.rows.length).at(-1)!;
    expect(put.rows[0].productStoreId).toBe(AUTHORITATIVE_STORE);
    expect(put.rows[0]).toHaveProperty("syncedAt");
```

- [ ] **Step 4: Run the file and confirm all four pass**

Run: `npx vitest run tests/workers/snapshotDomain.fanOutScope.spec.ts`
Expected: PASS (4 tests). The invariant being pinned: a fan-out child's parent id comes from the **fan-out scope**, overriding whatever the child record claims, and it is stamped before paging dedup so two children of different parents cannot collide on one key.

- [ ] **Step 5: Run the Company suite**

Run: `npx vitest run`
Expected: 677 pass / 12 fail.

- [ ] **Step 6: Commit**

```bash
git add tests/workers/snapshotDomain.fanOutScope.spec.ts
git commit -m "test(db): repair the fan-out scope spec's two snapshot-path tests"
```

---

### Task 14: Repair `carrierReferenceDomains.spec.ts`

Twelve tests — the largest file, and the one that exercises real `referenceDomains.ts` configuration rather than a synthetic config. It covers `carrier`, `carrierShipmentMethod`, `carrierFacility` and `productStoreShippingMethod`: their list params, their fan-out scoping, their scoped refetch pruning, and their `strictCollection` envelope rejection.

**Files:**
- Modify: `tests/workers/carrierReferenceDomains.spec.ts`

**Interfaces:**
- Consumes: Task 6's `label` option, Task 7's derived labels

- [ ] **Step 1: Point the fetch mock at the framework module and honour the label**

Replace the `vi.mock("@/workers/domains/workerFetch", …)` block with:

```ts
vi.mock("@common/db/sync/workerFetch", () => ({
  pageAll: vi.fn((options: any) => {
    state.pageCalls.push(options);
    const response = state.responses[options.url] ?? [];
    // The framework derives the label from the domain (and the fan-out parent); the strict
    // message must name it, not the URL.
    if (options.strictCollection && !Array.isArray(response)) {
      return Promise.reject(new Error(`[db] ${options.label}: response must be a bare array.`));
    }
    return Promise.resolve(response);
  }),
  pageNewestFirst: vi.fn(async () => []),
  workerGet: vi.fn(async () => null),
  workerPost: vi.fn(async () => null),
  unwrapCollection: (response: any, collectionKey?: string | null) => {
    if (Array.isArray(response)) return response;
    if (collectionKey && Array.isArray(response?.[collectionKey])) return response[collectionKey];
    return [];
  },
}));
```

- [ ] **Step 2: Record snapshot writes on the db stub**

Delete the `vi.mock("@/utils/db/appCacheDb", …)` block. Extend the `@/db/companyDb` mock's `raw()` so writes and scopes are observable:

```ts
      raw: () => ({
        table: (table: string) => ({
          count: async () => 0,
          toArray: async () => state.parentRows[table] ?? [],
          toCollection: () => ({
            toArray: async () => state.parentRows[table] ?? [],
            primaryKeys: async () => [],
          }),
          where: (field: string) => ({
            equals: (value: unknown) => {
              state.lastScope = { field, value };
              return { toArray: async () => [] };
            },
          }),
          bulkPut: async (rows: any[]) => {
            state.snapshots.push({ table, rows, scope: state.lastScope });
            state.lastScope = undefined;
          },
          bulkDelete: async () => {},
          put: async () => {},
          delete: async () => {},
        }),
        transaction: async (_m: any, _t: any, fn: () => Promise<any>) => fn(),
        syncMeta: { get: async () => undefined, put: async () => {}, delete: async () => {} },
      }),
```

Add `lastScope: undefined as any` to the hoisted `state` object and reset it in each `beforeEach`.

- [ ] **Step 3: Give the domains an explicit db**

`referenceDomains.ts` registers with no `getDb`, so it falls back to the global. Set the global once inside `registeredDomain()` after the reset:

```ts
async function registeredDomain(name: string) {
  vi.resetModules();
  const { companyDb } = await import("@/db/companyDb");
  const { setAppDb } = await import("@common/db/appDbRegistry");
  setAppDb(companyDb as any);
  await import("@/workers/domains/referenceDomains");
  const { getSyncDomain } = await import("@/workers/syncRegistry");
  return getSyncDomain(name);
}
```

This file must keep using the global, because the whole point is to exercise the real
`referenceDomains.ts` registrations rather than synthetic configs.

- [ ] **Step 4: Update the row assertions to projected rows**

Every `expect(state.snapshots[n].rows).toEqual([...raw...])` must become a `toMatchObject` on the projected fields. For example, the carrier snapshot:

```ts
    expect(state.snapshots[0].rows).toHaveLength(1);
    expect(state.snapshots[0].rows[0]).toMatchObject({
      partyId: "FEDEX", groupName: "FedEx", roleTypeId: "CARRIER",
    });
```

`partyTypeId` is not in the `carriers` projection and must be dropped from the expectation. Check each entity in `commonSchema.ts` / `companySchema.ts` before writing the expectation — asserting a field the projection does not store is how these tests would pass while proving nothing.

For `carrierShipmentMethod`, note `sequenceNumber` is declared `count`, so the raw `"10"` is stored as the number `10`.

- [ ] **Step 5: Run the file and confirm all twelve pass**

Run: `npx vitest run tests/workers/carrierReferenceDomains.spec.ts`
Expected: PASS (12 tests). All four envelope-rejection tests must fail with a message naming the domain — and the two fan-out ones with the parent (`carrierFacility:FEDEX`, `productStoreShippingMethod:STORE_1`). If those assertions had to be weakened to a URL, Task 7's label derivation is wrong; go back and fix it there rather than relaxing the test.

- [ ] **Step 6: Run the Company suite**

Run: `npx vitest run`
Expected: **689 pass / 0 fail.**

- [ ] **Step 7: Commit**

```bash
git add tests/workers/carrierReferenceDomains.spec.ts
git commit -m "test(db): repair the carrier reference domain spec

Restores the last of the four stale spec files. The strict-envelope tests now
assert the derived domain label, including the fan-out parent, so losing that
diagnostic would fail the suite rather than pass quietly."
```

---

### Task 15: Fix the stale login-marker prefix

`markSyncedThisLogin` writes `loginSync:<domain>`, but `resyncDomain` deletes `domain:<domain>`. The per-domain resync therefore never clears the once-per-login guard — it only works because `syncDomainNow` passes `force: true`. Any future caller that resyncs without forcing gets a silent no-op.

**Files:**
- Modify: `src/services/appCacheBootstrap.ts`
- Test: `tests/services/appCacheBootstrap.marker.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/services/appCacheBootstrap.marker.spec.ts`:

```ts
import { describe, expect, it, vi } from "vitest";

const deleted: string[] = [];

vi.mock("@/db/companyDb", () => ({
  companyDb: {
    raw: () => ({ syncMeta: { delete: async (key: string) => { deleted.push(key); } } }),
  },
}));

vi.mock("@common/db", () => ({
  createSyncService: () => ({
    start: async () => {},
    setDomains: async () => {},
    syncNow: async () => {},
    syncDomainNow: async () => 0,
    refetchOne: async () => 0,
    registeredDomains: async () => [],
    stop: () => {},
  }),
}));

/**
 * `markSyncedThisLogin` writes `loginSync:<domain>`. Deleting `domain:<domain>` clears nothing,
 * so a resync that does not also force is a silent no-op.
 */
describe("resyncDomain login marker", () => {
  it("deletes the marker key that markSyncedThisLogin actually writes", async () => {
    deleted.length = 0;
    const { resyncDomain } = await import("@/services/appCacheBootstrap");

    await resyncDomain("carrier").catch(() => {});

    expect(deleted).toContain("loginSync:carrier");
    expect(deleted).not.toContain("domain:carrier");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `npx vitest run tests/services/appCacheBootstrap.marker.spec.ts`
Expected: FAIL — `deleted` contains `domain:carrier`.

- [ ] **Step 3: Fix the prefix**

In `src/services/appCacheBootstrap.ts`, change:

```ts
  await companyDb.raw().syncMeta.delete(`domain:${domain}`);
```

to:

```ts
  // `markSyncedThisLogin` writes this prefix. Deleting `domain:` cleared nothing, so a resync
  // that did not also force was a silent no-op.
  await companyDb.raw().syncMeta.delete(`loginSync:${domain}`);
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `npx vitest run tests/services/appCacheBootstrap.marker.spec.ts`
Expected: PASS

- [ ] **Step 5: Run the Company suite**

Run: `npx vitest run`
Expected: 690 pass / 0 fail.

- [ ] **Step 6: Commit**

```bash
git add src/services/appCacheBootstrap.ts tests/services/appCacheBootstrap.marker.spec.ts
git commit -m "fix(db): delete the login marker key that is actually written

resyncDomain deleted domain:<name> while markSyncedThisLogin writes
loginSync:<name>, so the once-per-login guard was never cleared. It worked
only because syncDomainNow also forces."
```

---

## Definition of Done

- [ ] `common`: **182 / 4** — the 4 pre-existing failures and no others; 43 new tests across six new or extended spec files.
- [ ] `order-manager`: 517 / 517, untouched by this plan.
- [ ] `company`: **690 / 690** — all four stale spec files repaired, nothing deleted or weakened.
- [ ] `inventory-count`: 20 / 12, unchanged, but its workers now get correct array params and empty-body handling for free.
- [ ] No framework export removed. Both apps still on their current sync paths.
- [ ] `registerSnapshotDomain` warns on every call that omits `getDb` — 22 from Company's `referenceDomains.ts`, which Phase B removes.

## Deferred to Phase B

Steps 4–6 of the spec, planned separately once this lands:

- `createSyncHarness` with `catalog()`, replacing both harnesses
- `syncService`, replacing `pollingService`, `appDbBootstrap` and Company's `appCacheBootstrap`
- Company from N+1 worker realms to one, `useCacheSync` becoming a `setDomains` wrapper
- The catalog wired through Comlink; `DEFAULT_COMMON_SYNC_CATALOG`, `appDb.statusCatalog` and `CACHE_DOMAIN_CATALOG` deleted
- `label` / `syncClass` made required; the `getDb` fallback and every deprecated path removed
- Company's `workerFetch`, `pollingWorkerHarness`, `syncRegistry` and `registerSeedDomains` deleted
