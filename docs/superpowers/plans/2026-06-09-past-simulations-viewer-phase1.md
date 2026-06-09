# Past Simulations Viewer — Phase 1 (backend-fetch + cache) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Past simulations" experience to the Simulate tab — list persisted runs, open any one to view results in the existing `SimulationResults.vue` — layered with a stale-while-revalidate list cache and an immutable cache-first detail cache so it's instant and survives refresh.

**Architecture:** A new Pinia `pastSimulationStore` owns SWR orchestration over two plain modules: `SimulationHistoryCache` (localStorage, bounded, injectable storage) and read-only functions added to `SimulationService` (GET R1 list / R2 detail). A pure `persistedSimulationAdapter` maps the persisted detail into the `{ baseline, variants, partial, simulationRan }` shape `SimulationResults.vue` already renders. Until the backend ships R1/R2 the service reads a dev mock.

**Tech Stack:** Vue 3.5 + Ionic 8 + Pinia (options API), TypeScript. Pure logic tested with `npx tsx` + `node:assert`; store with `vitest` + `vi.mock`; views verified in the running app. App repo: `apps/order-routing` (own git repo, branch `feat/simulation-outcome-metrics`).

---

## Spec coverage map

| Spec section | Task |
|---|---|
| `persistedSimulationAdapter` (R2 → results shape) | 1 |
| `SimulationHistoryCache` (SWR list cache + detail LRU + prune) | 2 |
| `SimulationService` read fns (R1/R2) + dev mock | 3 |
| `pastSimulationStore` (SWR orchestration) | 4 |
| `SimulationHome` segment + route + `PastSimulationsList` | 5 |
| `PastSimulationDetail` reusing `SimulationResults` | 6 |
| Deep-link (`lastSimulationId` from R3 + "View saved result") | 7 |

## Conventions (read once)

- Run a pure test: `npx tsx tests/<name>.test.ts` — prints `… tests passed` and exits non-zero on assertion failure.
- Run a vitest: `npx vitest run tests/<name>.test.ts`.
- Type-check (gate before final commit): `npx vue-tsc --noEmit -p tsconfig.json` — expect **0 app-source errors** (a single pre-existing error in `../../common/components/ImageModal.vue` is unrelated and allowed).
- All work happens inside `apps/order-routing`. Commit there.
- The simulation API base URL comes from `simApiBaseUrl()` (already in `SimulationService.ts`); read endpoints reuse it.

---

## Task 1: `persistedSimulationAdapter` (pure)

Maps the R2 detail response (header + `variants[]` from the backend request) into the
`{ baseline, variants, partial, simulationRan }` object `toRows`/`SimulationResults` consume.

**Files:**
- Create: `src/util/persistedSimulationAdapter.ts`
- Test: `tests/persistedSimulationAdapter.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/persistedSimulationAdapter.test.ts
import assert from "assert";
import { persistedSimulationAdapter } from "../src/util/persistedSimulationAdapter";

// VARIATION run: baseline + one variant; diffJson as a JSON string.
{
  const raw = {
    simulationId: "SIM_1", runType: "VARIATION", statusId: "COMPLETE",
    partial: "N", simulationRan: "Y",
    attemptedItemCount: 100, brokeredItemCount: 80, queuedItemCount: 20,
    variants: [
      { variantSeqId: 0, label: "baseline", isBaseline: "Y", failed: "N",
        attemptedItemCount: 100, brokeredItemCount: 80, queuedItemCount: 20, diffJson: null },
      { variantSeqId: 1, label: "Tighter distance", isBaseline: "N", failed: "N",
        attemptedItemCount: 100, brokeredItemCount: 90, queuedItemCount: 10,
        diffJson: '{"routingBrokeredDelta":10}' },
    ],
  };
  const out = persistedSimulationAdapter(raw);
  assert.deepStrictEqual(out.baseline, { brokeredItemCount: 80, attemptedItemCount: 100, queuedItemCount: 20, outcomes: null }, "baseline counts from isBaseline variant");
  assert.strictEqual(out.variants.length, 1, "one non-baseline variant");
  assert.strictEqual(out.variants[0].label, "Tighter distance");
  assert.deepStrictEqual(out.variants[0].groupRun, { brokeredItemCount: 90, attemptedItemCount: 100, queuedItemCount: 10, outcomes: null });
  assert.deepStrictEqual(out.variants[0].diff, { routingBrokeredDelta: 10 }, "diffJson string parsed");
  assert.strictEqual(out.variants[0].failed, false);
  assert.strictEqual(out.partial, false);
  assert.strictEqual(out.simulationRan, true);
}

// diffJson already an object (backend may return parsed) — accepted as-is.
{
  const raw = { runType: "VARIATION", statusId: "COMPLETE", partial: "N", simulationRan: "Y",
    variants: [
      { variantSeqId: 0, isBaseline: "Y", failed: "N", brokeredItemCount: 1, attemptedItemCount: 1, queuedItemCount: 0 },
      { variantSeqId: 1, label: "V", isBaseline: "N", failed: "N", brokeredItemCount: 1, attemptedItemCount: 1, queuedItemCount: 0, diffJson: { routingBrokeredDelta: 0 } },
    ] };
  assert.deepStrictEqual(persistedSimulationAdapter(raw).variants[0].diff, { routingBrokeredDelta: 0 }, "diffJson object passthrough");
}

// SINGLE run: only synthetic baseline → variants empty, baseline from it.
{
  const raw = { runType: "SINGLE", statusId: "COMPLETE", partial: "N", simulationRan: "Y",
    variants: [{ variantSeqId: 0, isBaseline: "Y", failed: "N", brokeredItemCount: 5, attemptedItemCount: 6, queuedItemCount: 1 }] };
  const out = persistedSimulationAdapter(raw);
  assert.deepStrictEqual(out.baseline, { brokeredItemCount: 5, attemptedItemCount: 6, queuedItemCount: 1, outcomes: null });
  assert.deepStrictEqual(out.variants, []);
}

// partial = header.partial OR any variant.failed; failed flag mapped; failureReason carried.
{
  const raw = { runType: "VARIATION", statusId: "COMPLETE", partial: "N", simulationRan: "Y",
    variants: [
      { variantSeqId: 0, isBaseline: "Y", failed: "N", brokeredItemCount: 0, attemptedItemCount: 0, queuedItemCount: 0 },
      { variantSeqId: 1, label: "Boom", isBaseline: "N", failed: "Y", failureReason: "timeout", brokeredItemCount: 0, attemptedItemCount: 0, queuedItemCount: 0 },
    ] };
  const out = persistedSimulationAdapter(raw);
  assert.strictEqual(out.partial, true, "partial true when a variant failed");
  assert.strictEqual(out.variants[0].failed, true);
  assert.strictEqual(out.variants[0].failureReason, "timeout");
}

// missing/null counts default to 0; simulationRan=N honored; corrupt diffJson → undefined diff (no throw).
{
  const raw = { runType: "SINGLE", statusId: "COMPLETE", partial: "N", simulationRan: "N",
    variants: [{ variantSeqId: 0, isBaseline: "Y", failed: "N", diffJson: "{not json" }] };
  const out = persistedSimulationAdapter(raw);
  assert.deepStrictEqual(out.baseline, { brokeredItemCount: 0, attemptedItemCount: 0, queuedItemCount: 0, outcomes: null });
  assert.strictEqual(out.simulationRan, false);
}

console.log("persistedSimulationAdapter tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/persistedSimulationAdapter.test.ts`
Expected: FAIL — `Cannot find module '../src/util/persistedSimulationAdapter'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/util/persistedSimulationAdapter.ts
// Maps the persisted past-simulation detail (backend R2: header + variants[]) into the
// { baseline, variants, partial, simulationRan } shape SimulationResults.vue / toRows() render.
// Pure — no runtime imports, safe under `npx tsx`. The single seam absorbing persisted-vs-live
// differences (chiefly diffJson string-vs-object). NOTE: persisted variants carry counts but no
// `outcomes` object, so outcomes is null here; the richer outcome-metric panels degrade to their
// empty state until backend aggregates (Phase 2) supply them.

const yes = (v: any): boolean => v === "Y" || v === true;
const num = (v: any): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function counts(v: any): { brokeredItemCount: number; attemptedItemCount: number; queuedItemCount: number; outcomes: any } {
  return {
    brokeredItemCount: num(v?.brokeredItemCount),
    attemptedItemCount: num(v?.attemptedItemCount),
    queuedItemCount: num(v?.queuedItemCount),
    outcomes: v?.outcomes ?? null,
  };
}

/** Parse a JSON-string field to an object; pass an object through; undefined on null/blank/corrupt. */
function parseJson(v: any): any {
  if (v == null || v === "") return undefined;
  if (typeof v === "object") return v;
  try { return JSON.parse(v); } catch { return undefined; }
}

export interface AdaptedResults {
  baseline: any;
  variants: Array<{ label: string; groupRun: any; diff: any; failed: boolean; failureReason?: string }>;
  partial: boolean;
  simulationRan: boolean;
}

export function persistedSimulationAdapter(raw: any): AdaptedResults {
  const all = Array.isArray(raw?.variants) ? raw.variants : [];
  const baselineVariant = all.find((v: any) => yes(v?.isBaseline)) ?? null;
  const nonBaseline = all.filter((v: any) => !yes(v?.isBaseline));

  const anyFailed = all.some((v: any) => yes(v?.failed));
  return {
    baseline: baselineVariant ? counts(baselineVariant) : counts(raw),
    variants: nonBaseline.map((v: any) => ({
      label: v?.label ?? "",
      groupRun: counts(v),
      diff: parseJson(v?.diffJson),
      failed: yes(v?.failed),
      ...(v?.failureReason ? { failureReason: v.failureReason } : {}),
    })),
    partial: yes(raw?.partial) || anyFailed,
    simulationRan: raw?.simulationRan !== "N" && raw?.simulationRan !== false,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/persistedSimulationAdapter.test.ts`
Expected: PASS — prints `persistedSimulationAdapter tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/util/persistedSimulationAdapter.ts tests/persistedSimulationAdapter.test.ts
git commit -m "feat(sim): persistedSimulationAdapter — map persisted detail to results shape"
```

---

## Task 2: `SimulationHistoryCache` (localStorage, bounded)

localStorage persistence: the default-view list (latest 50 headers), a detail LRU (25), 30-day
prune. `@common`-free with an injectable `StorageLike`, exactly like `SimulationJobStore`.

**Files:**
- Create: `src/services/SimulationHistoryCache.ts`
- Test: `tests/simulationHistoryCache.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/simulationHistoryCache.test.ts
import assert from "assert";
import * as Cache from "../src/services/SimulationHistoryCache";

// In-memory StorageLike for headless testing.
function mem(): Cache.StorageLike & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => { map.set(k, v); },
    removeItem: (k) => { map.delete(k); },
  };
}
const hdr = (id: string, createdDate: string, statusId = "COMPLETE") =>
  ({ simulationId: id, productStoreId: "STORE", statusId, createdDate } as any);

// list set/get roundtrip, scoped by productStoreId.
{
  const s = mem();
  Cache.setList("STORE", [hdr("A", "2026-06-09T10:00:00Z"), hdr("B", "2026-06-09T09:00:00Z")], 0, s);
  const got = Cache.getList("STORE", Date.now(), s);
  assert.strictEqual(got.length, 2, "roundtrip 2 headers");
  assert.strictEqual(Cache.getList("OTHER", Date.now(), s).length, 0, "other store bucket empty");
}

// list capped at 50 newest by createdDate desc.
{
  const s = mem();
  const many = Array.from({ length: 60 }, (_, i) => hdr(`S${i}`, `2026-06-09T${String(i % 24).padStart(2, "0")}:00:00Z`));
  Cache.setList("STORE", many, 0, s);
  assert.strictEqual(Cache.getList("STORE", Date.now(), s).length, 50, "capped at 50");
}

// detail LRU put/get; eviction past 25 (least-recently-read goes first).
{
  const s = mem();
  for (let i = 0; i < 25; i++) Cache.putDetail(`D${i}`, { header: hdr(`D${i}`, "2026-06-09T10:00:00Z"), raw: { simulationId: `D${i}` }, cachedAt: 1000 }, s);
  Cache.getDetail("D0", Date.now(), s);                // touch D0 so it's most-recent
  Cache.putDetail("D25", { header: hdr("D25", "2026-06-09T10:00:00Z"), raw: {}, cachedAt: 1000 }, s); // evicts LRU (D1)
  assert.ok(Cache.getDetail("D0", Date.now(), s), "D0 survives (recently read)");
  assert.strictEqual(Cache.getDetail("D1", Date.now(), s), null, "D1 evicted");
}

// 30-day prune on read (list + detail).
{
  const s = mem();
  const now = 30 * 864e5 + 1000;
  Cache.setList("STORE", [hdr("OLD", "2026-01-01T00:00:00Z")], 0, s); // cachedAt 0 -> > 30d old at `now`
  assert.strictEqual(Cache.getList("STORE", now, s).length, 0, "stale list pruned");
  Cache.putDetail("OLDD", { header: hdr("OLDD", "2026-01-01T00:00:00Z"), raw: {}, cachedAt: 0 }, s);
  assert.strictEqual(Cache.getDetail("OLDD", now, s), null, "stale detail pruned");
}

// corrupt JSON tolerated.
{
  const s = mem();
  s.map.set("sim.history.list.STORE", "{not json");
  assert.deepStrictEqual(Cache.getList("STORE", Date.now(), s), [], "corrupt list -> []");
}

// null storage is a no-op (SSR / unavailable).
{
  assert.deepStrictEqual(Cache.getList("STORE", Date.now(), null), [], "null storage -> []");
  Cache.setList("STORE", [hdr("A", "2026-06-09T10:00:00Z")], 0, null); // must not throw
}

console.log("SimulationHistoryCache tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/simulationHistoryCache.test.ts`
Expected: FAIL — cannot find module `../src/services/SimulationHistoryCache`.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/SimulationHistoryCache.ts
// localStorage cache for the Past Simulations viewer. @common-free so it runs under tsx.
// - List: the DEFAULT view per productStore (latest 50 headers). Filtered views are NOT cached.
// - Detail: an LRU (25) of full R2 responses, keyed by simulationId. Completed runs are immutable.
// - Both prune entries older than 30 days on read. All writes are best-effort (cache is optional).

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PastSimHeader {
  simulationId: string; routingGroupId?: string; productStoreId?: string;
  runType?: string; statusId?: string;
  attemptedItemCount?: number; brokeredItemCount?: number; queuedItemCount?: number;
  durationMs?: number; sampleSize?: number; sampleCap?: number;
  simulationRan?: any; partial?: any; createdDate?: string; createdByUser?: string;
}
export interface DetailEntry { header: PastSimHeader; raw: any; cachedAt: number; }

const LIST_CAP = 50;
const DETAIL_CAP = 25;
const PRUNE_MS = 30 * 24 * 60 * 60_000; // 30 days

const listKey = (storeId: string) => `sim.history.list.${storeId}`;
const detailKey = (id: string) => `sim.history.detail.${id}`;
const LRU_KEY = "sim.history.lru";

function defaultStorage(): StorageLike | null {
  try { return typeof globalThis !== "undefined" && globalThis.localStorage ? globalThis.localStorage : null; }
  catch { return null; }
}
function readJson<T>(storage: StorageLike, key: string, fallback: T): T {
  try { const raw = storage.getItem(key); if (!raw) return fallback; const p = JSON.parse(raw); return p ?? fallback; }
  catch { return fallback; }
}
function writeJson(storage: StorageLike, key: string, value: any): void {
  try { storage.setItem(key, JSON.stringify(value)); } catch (e) { console.error("[SimulationHistoryCache] write failed", key, e); }
}
const ts = (d?: string): number => { const t = d ? Date.parse(d) : NaN; return Number.isNaN(t) ? 0 : t; };

interface ListBucket { headers: PastSimHeader[]; cachedAt: number; }

export function setList(storeId: string, headers: PastSimHeader[], cachedAt: number = Date.now(), storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  const sorted = [...headers].sort((a, b) => ts(b.createdDate) - ts(a.createdDate)).slice(0, LIST_CAP);
  writeJson(storage, listKey(storeId), { headers: sorted, cachedAt } as ListBucket);
}

export function getList(storeId: string, now: number = Date.now(), storage: StorageLike | null = defaultStorage()): PastSimHeader[] {
  if (!storage) return [];
  const bucket = readJson<ListBucket | null>(storage, listKey(storeId), null);
  if (!bucket || !Array.isArray(bucket.headers)) return [];
  if (now - (bucket.cachedAt ?? 0) > PRUNE_MS) { try { storage.removeItem(listKey(storeId)); } catch { /* ignore */ } return []; }
  return bucket.headers;
}

/** Prepend a header to the cached list (dedupe by simulationId), keeping it newest-first and capped. */
export function prependHeader(storeId: string, header: PastSimHeader, now: number = Date.now(), storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  const existing = getList(storeId, now, storage).filter((h) => h.simulationId !== header.simulationId);
  setList(storeId, [header, ...existing], now, storage);
}

function lruOrder(storage: StorageLike): string[] { return readJson<string[]>(storage, LRU_KEY, []); }
function touchLru(storage: StorageLike, id: string): void {
  const order = lruOrder(storage).filter((x) => x !== id);
  order.unshift(id);
  while (order.length > DETAIL_CAP) {
    const evict = order.pop()!;
    try { storage.removeItem(detailKey(evict)); } catch { /* ignore */ }
  }
  writeJson(storage, LRU_KEY, order);
}

export function putDetail(id: string, entry: DetailEntry, storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  writeJson(storage, detailKey(id), entry);
  touchLru(storage, id);
}

export function getDetail(id: string, now: number = Date.now(), storage: StorageLike | null = defaultStorage()): DetailEntry | null {
  if (!storage) return null;
  const entry = readJson<DetailEntry | null>(storage, detailKey(id), null);
  if (!entry) return null;
  if (now - (entry.cachedAt ?? 0) > PRUNE_MS) {
    try { storage.removeItem(detailKey(id)); } catch { /* ignore */ }
    writeJson(storage, LRU_KEY, lruOrder(storage).filter((x) => x !== id));
    return null;
  }
  touchLru(storage, id); // mark most-recently-read
  return entry;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/simulationHistoryCache.test.ts`
Expected: PASS — prints `SimulationHistoryCache tests passed`.

- [ ] **Step 5: Commit**

```bash
git add src/services/SimulationHistoryCache.ts tests/simulationHistoryCache.test.ts
git commit -m "feat(sim): SimulationHistoryCache — localStorage list cache + detail LRU + prune"
```

---

## Task 3: `SimulationService` read functions (R1/R2) + dev mock

Add `pastSimulationsQuery` (pure URL/params builder — the testable seam) and the two async read
functions. A dev mock supplies fixtures until the backend ships.

**Files:**
- Modify: `src/services/SimulationService.ts` (append)
- Create: `src/mock/pastSimulationsMock.ts`
- Test: `tests/pastSimulationsQuery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/pastSimulationsQuery.test.ts
import assert from "assert";
import { pastSimulationsQuery } from "../src/services/SimulationService";

// default view: only productStoreId + paging.
assert.deepStrictEqual(
  pastSimulationsQuery({ productStoreId: "STORE", pageIndex: 0, pageSize: 25 }),
  { url: "brokeringSimulations", params: { productStoreId: "STORE", orderByField: "-createdDate", pageIndex: 0, pageSize: 25 } },
  "default query",
);

// filters included only when present.
assert.deepStrictEqual(
  pastSimulationsQuery({ productStoreId: "STORE", routingGroupId: "GRP", statusId: "COMPLETE", runType: "VARIATION", pageIndex: 1, pageSize: 25 }),
  { url: "brokeringSimulations", params: { productStoreId: "STORE", routingGroupId: "GRP", statusId: "COMPLETE", runType: "VARIATION", orderByField: "-createdDate", pageIndex: 1, pageSize: 25 } },
  "filtered query",
);

// isFiltered helper: true when any non-store filter is set.
import { isFilteredQuery } from "../src/services/SimulationService";
assert.strictEqual(isFilteredQuery({ productStoreId: "STORE", pageIndex: 0, pageSize: 25 }), false, "store-only is not filtered");
assert.strictEqual(isFilteredQuery({ productStoreId: "STORE", statusId: "FAILED", pageIndex: 0, pageSize: 25 }), true, "status is a filter");

console.log("pastSimulationsQuery tests passed");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/pastSimulationsQuery.test.ts`
Expected: FAIL — `pastSimulationsQuery` is not exported.

- [ ] **Step 3: Append the implementation to `SimulationService.ts`**

Append at the end of `src/services/SimulationService.ts`:

```ts
// ---- Past simulations (read-only: backend request R1/R2) -------------------------------------

export interface PastSimulationsFilters {
  productStoreId: string;
  routingGroupId?: string;
  statusId?: string;        // RUNNING | COMPLETE | FAILED
  runType?: string;         // SINGLE | VARIATION
  fromDate?: string;
  thruDate?: string;
  pageIndex: number;
  pageSize: number;
}

/** Pure: build the GET url + params for the list endpoint (R1). Newest-first. */
export function pastSimulationsQuery(f: PastSimulationsFilters): { url: string; params: Record<string, any> } {
  const params: Record<string, any> = { productStoreId: f.productStoreId };
  if (f.routingGroupId) params.routingGroupId = f.routingGroupId;
  if (f.statusId) params.statusId = f.statusId;
  if (f.runType) params.runType = f.runType;
  if (f.fromDate) params.fromDate = f.fromDate;
  if (f.thruDate) params.thruDate = f.thruDate;
  params.orderByField = "-createdDate";
  params.pageIndex = f.pageIndex;
  params.pageSize = f.pageSize;
  return { url: "brokeringSimulations", params };
}

/** Pure: true when the query carries any filter beyond productStoreId+paging (so the cache is bypassed). */
export function isFilteredQuery(f: PastSimulationsFilters): boolean {
  return Boolean(f.routingGroupId || f.statusId || f.runType || f.fromDate || f.thruDate);
}

// Flip to true (or wire VITE_SIM_USE_MOCK) until backend R1/R2 are live in your environment.
function useMock(env: Record<string, any> = import.meta.env): boolean {
  return (env && String(env.VITE_SIM_USE_MOCK)) === "true";
}

/** List persisted simulations (R1). Returns { headers, total }. */
export async function fetchPastSimulations(f: PastSimulationsFilters): Promise<{ headers: any[]; total: number }> {
  if (useMock()) { const { mockPastSimulations } = await import("../mock/pastSimulationsMock"); return mockPastSimulations(f); }
  const { api, commonUtil } = await import("@common");
  const { url, params } = pastSimulationsQuery(f);
  const resp: any = await api({ url, method: "GET", baseURL: simApiBaseUrl(), params });
  if (commonUtil.hasError(resp)) throw new Error(`Failed to load past simulations: ${JSON.stringify(resp?.data)?.slice(0, 300)}`);
  const headers = Array.isArray(resp.data) ? resp.data : (resp.data?.brokeringSimulations ?? resp.data?.results ?? []);
  const total = Number(resp.data?.totalCount ?? resp.data?.count ?? headers.length);
  return { headers, total };
}

/** Fetch one persisted simulation with its variants (R2). Returns the raw response for the adapter. */
export async function fetchPastSimulation(simulationId: string): Promise<any> {
  if (useMock()) { const { mockPastSimulation } = await import("../mock/pastSimulationsMock"); return mockPastSimulation(simulationId); }
  const { api, commonUtil } = await import("@common");
  const resp: any = await api({ url: `brokeringSimulations/${simulationId}`, method: "GET", baseURL: simApiBaseUrl() });
  if (commonUtil.hasError(resp)) throw new Error(`Failed to load simulation ${simulationId}: ${JSON.stringify(resp?.data)?.slice(0, 300)}`);
  return resp.data;
}
```

- [ ] **Step 4: Create the dev mock**

```ts
// src/mock/pastSimulationsMock.ts
// Dev-only fixtures for the Past Simulations viewer, used when VITE_SIM_USE_MOCK="true"
// until backend R1/R2 ship. Never imported on production paths (dynamic import gated by useMock()).
import type { PastSimulationsFilters } from "../services/SimulationService";

const HEADERS = [
  { simulationId: "SIM_1001", routingGroupId: "GRP_NYC", productStoreId: "STORE", runType: "VARIATION", statusId: "COMPLETE",
    attemptedItemCount: 100, brokeredItemCount: 90, queuedItemCount: 10, durationMs: 184000, sampleSize: 100, sampleCap: 500,
    simulationRan: "Y", partial: "N", createdDate: "2026-06-09T10:15:00Z", createdByUser: "aditi.patel" },
  { simulationId: "SIM_1000", routingGroupId: "GRP_NYC", productStoreId: "STORE", runType: "SINGLE", statusId: "COMPLETE",
    attemptedItemCount: 80, brokeredItemCount: 64, queuedItemCount: 16, durationMs: 90000, sampleSize: 80, sampleCap: 500,
    simulationRan: "Y", partial: "N", createdDate: "2026-06-08T17:00:00Z", createdByUser: "aditi.patel" },
];

export async function mockPastSimulations(f: PastSimulationsFilters): Promise<{ headers: any[]; total: number }> {
  let rows = HEADERS.filter((h) => h.productStoreId === f.productStoreId);
  if (f.routingGroupId) rows = rows.filter((h) => h.routingGroupId === f.routingGroupId);
  if (f.statusId) rows = rows.filter((h) => h.statusId === f.statusId);
  if (f.runType) rows = rows.filter((h) => h.runType === f.runType);
  return { headers: rows, total: rows.length };
}

export async function mockPastSimulation(simulationId: string): Promise<any> {
  const header = HEADERS.find((h) => h.simulationId === simulationId) ?? HEADERS[0];
  return {
    ...header,
    variants: [
      { variantSeqId: 0, label: "baseline", isBaseline: "Y", failed: "N",
        attemptedItemCount: header.attemptedItemCount, brokeredItemCount: header.brokeredItemCount, queuedItemCount: header.queuedItemCount, diffJson: null },
      ...(header.runType === "VARIATION" ? [{
        variantSeqId: 1, label: "Tighter distance", isBaseline: "N", failed: "N",
        attemptedItemCount: 100, brokeredItemCount: 95, queuedItemCount: 5,
        diffJson: '{"routingBrokeredDelta":5}',
      }] : []),
    ],
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx tsx tests/pastSimulationsQuery.test.ts`
Expected: PASS — prints `pastSimulationsQuery tests passed`.

- [ ] **Step 6: Commit**

```bash
git add src/services/SimulationService.ts src/mock/pastSimulationsMock.ts tests/pastSimulationsQuery.test.ts
git commit -m "feat(sim): SimulationService read fns (R1/R2) + dev mock + query builder"
```

---

## Task 4: `pastSimulationStore` (SWR orchestration)

Pinia options store: cache-then-revalidate list, cache-first immutable detail, `recordCompletedRun`.

**Files:**
- Create: `src/store/pastSimulationStore.ts`
- Test: `tests/pastSimulationStore.test.ts`

- [ ] **Step 1: Write the failing test (vitest — mocks service + storage)**

```ts
// tests/pastSimulationStore.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

vi.mock("@common", () => ({})); // store imports nothing from @common directly, but guard the alias.
const fetchPastSimulations = vi.fn();
const fetchPastSimulation = vi.fn();
vi.mock("@/services/SimulationService", () => ({
  fetchPastSimulations: (...a: any[]) => fetchPastSimulations(...a),
  fetchPastSimulation: (...a: any[]) => fetchPastSimulation(...a),
  isFilteredQuery: (f: any) => Boolean(f.routingGroupId || f.statusId || f.runType || f.fromDate || f.thruDate),
}));
// In-memory storage so the cache module persists within the test.
const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
});

// Relative import for the SUT (matches the repo's existing vitest pattern); the store's own
// internal `@/services/...` imports still resolve via the vitest `@` alias and are mocked above.
import { usePastSimulationStore } from "../src/store/pastSimulationStore";

describe("pastSimulationStore", () => {
  beforeEach(() => { setActivePinia(createPinia()); store.clear(); fetchPastSimulations.mockReset(); fetchPastSimulation.mockReset(); });

  it("serves cached list immediately, then revalidates and swaps", async () => {
    const s = usePastSimulationStore();
    // seed cache via a first successful load
    fetchPastSimulations.mockResolvedValueOnce({ headers: [{ simulationId: "A", productStoreId: "ST", createdDate: "2026-06-09T10:00:00Z", statusId: "COMPLETE" }], total: 1 });
    await s.loadList({ productStoreId: "ST", pageIndex: 0, pageSize: 25 });
    expect(s.list.map((h: any) => h.simulationId)).toEqual(["A"]);

    // second load: cache hit is shown synchronously; revalidate returns A+B
    fetchPastSimulations.mockResolvedValueOnce({ headers: [
      { simulationId: "B", productStoreId: "ST", createdDate: "2026-06-09T11:00:00Z", statusId: "COMPLETE" },
      { simulationId: "A", productStoreId: "ST", createdDate: "2026-06-09T10:00:00Z", statusId: "COMPLETE" },
    ], total: 2 });
    const p = s.loadList({ productStoreId: "ST", pageIndex: 0, pageSize: 25 });
    expect(s.list.map((h: any) => h.simulationId)).toEqual(["A"]); // cached shown first
    await p;
    expect(s.list.map((h: any) => h.simulationId)).toEqual(["B", "A"]); // revalidated
  });

  it("keeps cached list and sets listError when revalidate fails", async () => {
    const s = usePastSimulationStore();
    fetchPastSimulations.mockResolvedValueOnce({ headers: [{ simulationId: "A", productStoreId: "ST", createdDate: "2026-06-09T10:00:00Z", statusId: "COMPLETE" }], total: 1 });
    await s.loadList({ productStoreId: "ST", pageIndex: 0, pageSize: 25 });
    fetchPastSimulations.mockRejectedValueOnce(new Error("boom"));
    await s.loadList({ productStoreId: "ST", pageIndex: 0, pageSize: 25 });
    expect(s.list.map((h: any) => h.simulationId)).toEqual(["A"]);
    expect(s.listError).toBeTruthy();
  });

  it("bypasses cache for filtered queries", async () => {
    const s = usePastSimulationStore();
    fetchPastSimulations.mockResolvedValueOnce({ headers: [{ simulationId: "F", productStoreId: "ST", createdDate: "2026-06-09T10:00:00Z", statusId: "FAILED" }], total: 1 });
    await s.loadList({ productStoreId: "ST", statusId: "FAILED", pageIndex: 0, pageSize: 25 });
    expect(store.has("sim.history.list.ST")).toBe(false); // not cached
  });

  it("loadDetail serves cached terminal run without refetch, fetches on miss", async () => {
    const s = usePastSimulationStore();
    fetchPastSimulation.mockResolvedValueOnce({ simulationId: "A", statusId: "COMPLETE", runType: "SINGLE", partial: "N", simulationRan: "Y",
      variants: [{ variantSeqId: 0, isBaseline: "Y", failed: "N", brokeredItemCount: 1, attemptedItemCount: 1, queuedItemCount: 0 }] });
    const d1 = await s.loadDetail("A");
    expect(d1.baseline.brokeredItemCount).toBe(1);
    expect(fetchPastSimulation).toHaveBeenCalledTimes(1);
    const d2 = await s.loadDetail("A"); // cached terminal -> no second fetch
    expect(d2.baseline.brokeredItemCount).toBe(1);
    expect(fetchPastSimulation).toHaveBeenCalledTimes(1);
  });

  it("recordCompletedRun prepends + dedupes in the list cache", async () => {
    const s = usePastSimulationStore();
    fetchPastSimulations.mockResolvedValueOnce({ headers: [{ simulationId: "A", productStoreId: "ST", createdDate: "2026-06-09T10:00:00Z", statusId: "COMPLETE" }], total: 1 });
    await s.loadList({ productStoreId: "ST", pageIndex: 0, pageSize: 25 });
    s.recordCompletedRun({ simulationId: "NEW", productStoreId: "ST", createdDate: "2026-06-09T12:00:00Z", statusId: "COMPLETE" });
    expect(s.list[0].simulationId).toBe("NEW");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pastSimulationStore.test.ts`
Expected: FAIL — cannot resolve `@/store/pastSimulationStore`.

- [ ] **Step 3: Write the implementation**

```ts
// src/store/pastSimulationStore.ts
// SWR orchestration for the Past Simulations viewer.
// - List: cache-then-revalidate (default view only); filtered queries always live, never cached.
// - Detail: cache-first for immutable (COMPLETE/FAILED) runs; fetch on miss or non-terminal.
import { acceptHMRUpdate, defineStore } from "pinia";
import {
  fetchPastSimulations, fetchPastSimulation, isFilteredQuery, type PastSimulationsFilters,
} from "@/services/SimulationService";
import * as Cache from "@/services/SimulationHistoryCache";
import { persistedSimulationAdapter, type AdaptedResults } from "@/util/persistedSimulationAdapter";

const TERMINAL = new Set(["COMPLETE", "FAILED"]);

export const usePastSimulationStore = defineStore("pastSimulation", {
  state: () => ({
    list: [] as Cache.PastSimHeader[],
    listLoading: false,
    listRefreshing: false,
    listError: null as string | null,
    total: 0,
    detailById: {} as Record<string, AdaptedResults>,
    detailRawById: {} as Record<string, any>,
    detailLoading: false,
    detailError: null as string | null,
  }),
  actions: {
    async loadList(filters: PastSimulationsFilters) {
      this.listError = null;
      const filtered = isFilteredQuery(filters);
      if (filtered) {
        this.listLoading = true;
        try { const { headers, total } = await fetchPastSimulations(filters); this.list = headers; this.total = total; }
        catch (e: any) { this.listError = e?.message ?? "Failed to load simulations."; }
        finally { this.listLoading = false; }
        return;
      }
      // default view: show cache immediately, revalidate in the background.
      const cached = Cache.getList(filters.productStoreId);
      if (cached.length) { this.list = cached; this.listLoading = false; this.listRefreshing = true; }
      else { this.listLoading = true; }
      try {
        const { headers, total } = await fetchPastSimulations(filters);
        this.list = headers; this.total = total;
        Cache.setList(filters.productStoreId, headers);
      } catch (e: any) {
        this.listError = e?.message ?? "Failed to refresh simulations.";
      } finally {
        this.listLoading = false; this.listRefreshing = false;
      }
    },

    async loadDetail(simulationId: string): Promise<AdaptedResults> {
      this.detailError = null;
      if (this.detailById[simulationId]) return this.detailById[simulationId];
      const cached = Cache.getDetail(simulationId);
      if (cached && TERMINAL.has(String(cached.header?.statusId))) {
        const adapted = persistedSimulationAdapter(cached.raw);
        this.detailRawById[simulationId] = cached.raw; this.detailById[simulationId] = adapted;
        return adapted;
      }
      this.detailLoading = true;
      try {
        const raw = await fetchPastSimulation(simulationId);
        const adapted = persistedSimulationAdapter(raw);
        this.detailRawById[simulationId] = raw; this.detailById[simulationId] = adapted;
        if (TERMINAL.has(String(raw?.statusId))) {
          Cache.putDetail(simulationId, { header: raw, raw, cachedAt: Date.now() });
        }
        return adapted;
      } catch (e: any) {
        this.detailError = e?.message ?? "Failed to load simulation.";
        throw e;
      } finally {
        this.detailLoading = false;
      }
    },

    // Called when a fresh live run completes (simulationStore deep-link hook): make it visible now.
    recordCompletedRun(header: Cache.PastSimHeader) {
      if (!header?.simulationId || !header?.productStoreId) return;
      Cache.prependHeader(header.productStoreId, header);
      this.list = [header, ...this.list.filter((h) => h.simulationId !== header.simulationId)];
    },
  },
});

if (import.meta.hot) import.meta.hot.accept(acceptHMRUpdate(usePastSimulationStore, import.meta.hot));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pastSimulationStore.test.ts`
Expected: PASS — 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/store/pastSimulationStore.ts tests/pastSimulationStore.test.ts
git commit -m "feat(sim): pastSimulationStore — SWR list + cache-first immutable detail"
```

---

## Task 5: `SimulationHome` segment + route + `PastSimulationsList`

**Files:**
- Modify: `src/views/SimulationHome.vue`
- Create: `src/components/simulation/PastSimulationsList.vue`
- Modify: `src/router/index.ts`

- [ ] **Step 1: Add the detail route**

In `src/router/index.ts`, find the `simulate/:routingGroupId` route (currently importing
`Simulation.vue`) and add a sibling route immediately after it:

```ts
      {
        path: "simulate/history/:simulationId",
        name: "PastSimulationDetail",
        component: () => import("@/views/PastSimulationDetail.vue"),
        props: true,
      },
```

- [ ] **Step 2: Create `PastSimulationsList.vue`**

```vue
<!-- src/components/simulation/PastSimulationsList.vue -->
<template>
  <div>
    <ion-item lines="none">
      <ion-select :label="translate('Status')" interface="popover" :value="statusId" @ionChange="onFilter('statusId', $event.detail.value)">
        <ion-select-option :value="''">{{ translate("All") }}</ion-select-option>
        <ion-select-option value="COMPLETE">{{ translate("Complete") }}</ion-select-option>
        <ion-select-option value="FAILED">{{ translate("Failed") }}</ion-select-option>
      </ion-select>
      <ion-note v-if="sim.listRefreshing" slot="end" color="medium">{{ translate("Refreshing…") }}</ion-note>
    </ion-item>

    <div v-if="sim.listError" class="ion-padding">
      <ion-text color="danger">{{ sim.listError }}</ion-text>
      <ion-button fill="outline" size="small" @click="reload">{{ translate("Retry") }}</ion-button>
    </div>

    <div v-if="sim.listLoading" class="ion-padding">
      <ion-spinner name="crescent" /> {{ translate("Loading simulations…") }}
    </div>

    <div v-else-if="!sim.list.length" class="ion-padding ion-text-center">
      <p>{{ translate("No past simulations yet") }}</p>
      <ion-note>{{ translate("Run a simulation to see it here.") }}</ion-note>
    </div>

    <ion-list v-else>
      <ion-item v-for="h in sim.list" :key="h.simulationId" button detail @click="open(h.simulationId)">
        <ion-label>
          <h2>{{ h.routingGroupId }} <ion-badge v-if="h.statusId === 'FAILED'" color="danger">{{ translate("Failed") }}</ion-badge></h2>
          <p>{{ h.runType }} · {{ h.brokeredItemCount }}/{{ h.attemptedItemCount }} {{ translate("brokered") }} · {{ commonUtil.getDateAndTime(h.createdDate) }}</p>
        </ion-label>
      </ion-item>
    </ion-list>
  </div>
</template>

<script setup lang="ts">
import { IonBadge, IonButton, IonItem, IonLabel, IonList, IonNote, IonSelect, IonSelectOption, IonSpinner, IonText } from "@ionic/vue";
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { translate, commonUtil } from "@common";
import { usePastSimulationStore } from "@/store/pastSimulationStore";
import { useUserStore } from "@/store/userStore";

const router = useRouter();
const sim = usePastSimulationStore();
const userStore = useUserStore();
const statusId = ref("");

const productStoreId = computed<string>(() => (userStore.getCurrentEComStore?.productStoreId) ?? userStore.getUserProfile?.productStoreId ?? "");

function reload() {
  sim.loadList({ productStoreId: productStoreId.value, statusId: statusId.value || undefined, pageIndex: 0, pageSize: 25 });
}
function onFilter(_key: string, value: string) { statusId.value = value; reload(); }
function open(id: string) { router.push(`/tabs/simulate/history/${id}`); }

onMounted(reload);
</script>
```

> **Note:** confirm the `productStoreId` accessor against the app's user store (the line above tries
> `getCurrentEComStore` then `getUserProfile.productStoreId`). If neither exists, use whatever the
> Simulation editor already uses to scope the current store, and update this one computed.

- [ ] **Step 3: Add the segment to `SimulationHome.vue`**

Read the current `src/views/SimulationHome.vue`, then wrap its existing content so an `ion-segment`
chooses between the existing picker and the new list:

```vue
<!-- add inside the <ion-content> of SimulationHome.vue, above the existing picker markup -->
<ion-segment :value="tab" @ionChange="tab = String($event.detail.value)">
  <ion-segment-button value="new"><ion-label>{{ translate("New simulation") }}</ion-label></ion-segment-button>
  <ion-segment-button value="past"><ion-label>{{ translate("Past simulations") }}</ion-label></ion-segment-button>
</ion-segment>

<div v-show="tab === 'new'">
  <!-- existing group picker markup stays here, unchanged -->
</div>
<past-simulations-list v-if="tab === 'past'" />
```

In the `<script setup>` of `SimulationHome.vue` add:

```ts
import { ref } from "vue";
import { IonSegment, IonSegmentButton, IonLabel } from "@ionic/vue";
import { translate } from "@common";
import PastSimulationsList from "@/components/simulation/PastSimulationsList.vue";
const tab = ref<"new" | "past">("new");
```

- [ ] **Step 4: Verify in the running app (mock)**

```bash
# .env: set VITE_SIM_USE_MOCK="true"
npm run serve
```
Open the Simulate tab → "Past simulations" segment. Expected: two mock rows (SIM_1001 VARIATION,
SIM_1000 SINGLE), "Refreshing…" flicker, status filter narrows to COMPLETE/FAILED. Tapping a row
navigates to `/tabs/simulate/history/SIM_1001` (blank until Task 6).

- [ ] **Step 5: Commit**

```bash
git add src/views/SimulationHome.vue src/components/simulation/PastSimulationsList.vue src/router/index.ts
git commit -m "feat(sim): Past simulations segment + list + detail route"
```

---

## Task 6: `PastSimulationDetail` reusing `SimulationResults`

`SimulationResults.vue` reads `simulationStore().results`. For a saved run we render it from the
persisted detail. Simplest reuse without refactoring the component: set the adapted result onto a
transient field the existing results UI reads. To avoid coupling to the live editor store, this
view sets `simulationStore().results` directly for display (read-only screen; `loadGroup` resets it
on the live screen).

**Files:**
- Create: `src/views/PastSimulationDetail.vue`

- [ ] **Step 1: Create the view**

```vue
<!-- src/views/PastSimulationDetail.vue -->
<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button default-href="/tabs/simulate" /></ion-buttons>
        <ion-title>{{ translate("Saved simulation") }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <div v-if="sim.detailLoading" class="ion-padding"><ion-spinner name="crescent" /> {{ translate("Loading…") }}</div>
      <div v-else-if="sim.detailError" class="ion-padding">
        <ion-text color="danger">{{ sim.detailError }}</ion-text>
        <ion-button fill="outline" size="small" @click="load">{{ translate("Retry") }}</ion-button>
      </div>
      <simulation-results v-else />
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { IonBackButton, IonButtons, IonContent, IonHeader, IonPage, IonSpinner, IonText, IonTitle, IonToolbar, IonButton } from "@ionic/vue";
import { onMounted } from "vue";
import { translate } from "@common";
import SimulationResults from "@/components/simulation/SimulationResults.vue";
import { usePastSimulationStore } from "@/store/pastSimulationStore";
import { simulationStore } from "@/store/simulationStore";

const props = defineProps<{ simulationId: string }>();
const sim = usePastSimulationStore();
const live = simulationStore();

async function load() {
  try {
    const adapted = await sim.loadDetail(props.simulationId);
    live.results = adapted as any;   // read-only display reuse of the existing results UI
    live.isRunning = false;
    live.view = "results";
  } catch { /* detailError already set */ }
}
onMounted(load);
</script>
```

- [ ] **Step 2: Verify in the running app (mock)**

```bash
npm run serve   # VITE_SIM_USE_MOCK="true"
```
From the Past list tap SIM_1001 → the existing results scorecard renders (baseline 90/100, variant
"Tighter distance" 95/100). Tap SIM_1000 → single-run scorecard (64/80, no variants). Refresh the
browser on the detail URL → loads from cache instantly (no spinner).

- [ ] **Step 3: Commit**

```bash
git add src/views/PastSimulationDetail.vue
git commit -m "feat(sim): PastSimulationDetail reuses SimulationResults via adapter + cache"
```

---

## Task 7: Deep-link from a fresh run (`lastSimulationId` + action)

**Files:**
- Modify: `src/store/simulationStore.ts`
- Modify: `src/components/simulation/SimulationResults.vue`

- [ ] **Step 1: Add `lastSimulationId` to the store state**

In `src/store/simulationStore.ts`, add to `state()` (after `view`):

```ts
    // The persisted simulationId of the most recently completed run (backend R3), for deep-linking.
    lastSimulationId: null as string | null,
```

Reset it in `loadGroup()` alongside the other resets (where `this.results = null` is set):

```ts
      this.lastSimulationId = null;
```

- [ ] **Step 2: Capture `simulationId` from the poll result in `runBatch`**

In `runBatch`, after `const result = await pollJob(...)` succeeds and before
`this.setVariationPhase(ids, "done")`, capture the id if present (read-if-present, safe when absent):

```ts
        const sid = (result as any)?.simulationId ?? (result as any)?.variation?.simulationId ?? (result as any)?.groupRun?.simulationId;
        if (sid && !this.lastSimulationId) this.lastSimulationId = String(sid);
```

- [ ] **Step 3: Show "View saved result" in `SimulationResults.vue`**

In `src/components/simulation/SimulationResults.vue`, inside the `v-if="sim.results"` block (near
the top, beside the partial/simulationRan notes), add:

```vue
      <ion-button
        v-if="sim.lastSimulationId"
        size="small" fill="outline"
        @click="$router.push(`/tabs/simulate/history/${sim.lastSimulationId}`)"
      >
        {{ translate("View saved result") }}
      </ion-button>
```

Ensure `IonButton` is imported in that component's `<script setup>` (add to the existing
`@ionic/vue` import if missing) and that `translate` is imported from `@common`.

- [ ] **Step 4: Type-check the whole app**

Run: `npx vue-tsc --noEmit -p tsconfig.json`
Expected: 0 app-source errors (the lone `common/components/ImageModal.vue` error is pre-existing).

- [ ] **Step 5: Re-run all new pure + store tests**

Run:
```bash
npx tsx tests/persistedSimulationAdapter.test.ts
npx tsx tests/simulationHistoryCache.test.ts
npx tsx tests/pastSimulationsQuery.test.ts
npx vitest run tests/pastSimulationStore.test.ts
```
Expected: all print/report pass.

- [ ] **Step 6: Commit**

```bash
git add src/store/simulationStore.ts src/components/simulation/SimulationResults.vue
git commit -m "feat(sim): deep-link a fresh run to its saved record (lastSimulationId)"
```

---

## Final verification (after all tasks)

- [ ] `npx vue-tsc --noEmit -p tsconfig.json` → 0 app-source errors.
- [ ] All four new tests pass (3 tsx + 1 vitest).
- [ ] In-app (mock): list renders + filters + refresh hint; detail renders saved run; browser
  refresh on detail/list restores instantly from cache; a completed live run surfaces "View saved
  result" and appears at the top of the Past list.
- [ ] Flip `VITE_SIM_USE_MOCK` off once backend R1/R2 are live in the target environment; only
  `SimulationService` behavior changes.

## Open items to confirm with backend (carry from the backend request)

1. R1/R2 response envelope (array vs `{ brokeringSimulations, totalCount }`) and pagination param
   names — `fetchPastSimulations` currently tolerates a few shapes; pin once confirmed.
2. `diffJson` string vs object — adapter handles both; no change needed either way.
3. **`outcomes` in R2** — persisted variants carry counts but no `outcomes` object, so the richer
   outcome-metric panels (expedited/stockout/fulfillment-mix/composite) render empty for past runs
   in Phase 1. If those should populate, the backend must include per-variant `outcomes` in R2 (add
   to the backend request) or it waits for Phase 2 aggregates (R5). Count-based scorecard + diff
   work today.
4. `productStoreId` scoping/visibility (request open question #3).
