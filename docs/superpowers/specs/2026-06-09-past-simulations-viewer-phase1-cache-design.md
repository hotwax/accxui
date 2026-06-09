# Past Simulations Viewer — Phase 1 (backend-fetch + cache) Design

**Date:** 2026-06-09
**Author:** toaditi
**Status:** Draft — pending user review
**Branch:** `feat/simulation-outcome-metrics` (order-routing PWA)

---

## Context

Group-run simulations are **persisted** server-side (`BrokeringSimulation*` entities) but the PWA
has no way to view past runs: the only way to see results today is the live poll, which expires
~5 min after completion (`simulation.jobCompletedTtlMs`) and is lost on refresh. Results don't
persist on the client either — `simulationStore.results` is in-memory only and `loadGroup()`
nulls it on every mount.

This spec covers **Phase 1** of the Past Simulations Viewer: a read-only list of persisted runs
with an expandable detail view, **layered with a backend-fetch + client cache** so the experience
is instant and survives refresh. It builds on:

- **UI shell / routing / adapter concept:** `2026-05-27-past-simulations-viewer-design.md`
  (this doc supersedes its Phase 1 with the caching layer and the post-split backend contract).
- **Backend contract:** `2026-06-09-past-simulations-read-api-backend-request.md` (R1 list,
  R2 detail, R3 `simulationId` in poll). **Phase 1 is gated on R1+R2 shipping**; until then it
  runs against a toggleable mock.

Phase 2 (slice/dice charts + item table, backend R4/R5) is out of scope here.

## Goals / Non-goals

**Goals**
- List persisted simulations (newest first), filterable, shown in the Simulate tab.
- Open any run → reuse the existing `SimulationResults.vue` to show its comparison/diff.
- **Cache:** instant list on tab open and after refresh; instant reopen of any previously viewed
  run; backend remains the source of truth (stale-while-revalidate for the list, cache-first for
  immutable completed runs).
- Deep-link a just-finished live run to its saved record.

**Non-goals (Phase 1)**
- Phase 2 slice/dice charts and the order-item table (backend R4/R5).
- Any write/delete/retention UI (persistence + retention are backend concerns).
- Per-filter-combination caching (only the default view is cached — see Design decision 3).
- Geo/map views (lat/long are null today).
- IndexedDB (localStorage is sufficient at Phase-1 volumes; see Design decision 2).

## Key design decisions

1. **SWR list + immutable detail cache.** The list is stale-while-revalidate; detail is
   cache-first because a run with `statusId ∈ {COMPLETE, FAILED}` is **immutable** — its detail
   never changes, so a cached copy is always valid.
2. **localStorage, bounded.** Mirrors the existing `SimulationJobStore` (localStorage,
   `@common`-free, `tsx`-testable). List cache holds the latest ~50 headers; detail is an LRU of
   ~25 blobs; both prune entries older than 30 days. IndexedDB is a future escalation only if blob
   sizes grow.
3. **Only the default view is cached.** The cached list is the default tab view: current
   `productStoreId` scope, no extra filters, first page, `createdDate desc`. Applying any filter
   (status, runType, routingGroup, date range) issues a **live** fetch and does not read/write the
   cache. This keeps SWR correct without a cache-key explosion.
4. **Adapter is the single seam.** `persistedSimulationAdapter` maps the R2 detail response into
   the `{ baseline, variants, partial }` shape `SimulationResults.vue` already renders, absorbing
   persisted-vs-live differences (notably `diffJson`).
5. **Store-centric orchestration.** A new `pastSimulationStore` (Pinia, options API, matching the
   app's other stores) owns SWR; components stay thin. The cache (localStorage) and service
   (HTTP) are plain modules it composes.
6. **`simulationId` is an opaque string** (Moqui sequenced id).

---

## Architecture

```
Simulate tab
  SimulationHome.vue  [ New simulation | Past simulations ]   (ion-segment)
     ├─ New simulation  → (existing) group picker → editor
     └─ Past simulations → PastSimulationsList.vue ── reads ──▶ pastSimulationStore
                              │ row tap                              │
                              ▼                                      ├─ SimulationHistoryCache (localStorage)
                  /tabs/simulate/history/:simulationId               └─ SimulationService (HTTP: R1/R2)
                     PastSimulationDetail.vue
                        store.loadDetail(id) → persistedSimulationAdapter → SimulationResults.vue
```

`pastSimulationStore` is the only place that knows the SWR rules. `SimulationHistoryCache` knows
only how to persist/evict; `SimulationService` knows only how to call the backend.

### Files

| File | Change | Responsibility |
|---|---|---|
| `src/store/pastSimulationStore.ts` | create | State (`list`, `listLoading`, `listError`, `detailById`, `detailLoading`, `detailError`) + actions `loadList(force?)`, `loadDetail(id)`, `recordCompletedRun(header)`. Implements SWR + cache-first. |
| `src/services/SimulationHistoryCache.ts` | create | localStorage list cache + detail LRU + age-prune. `@common`-free, injectable `StorageLike` (like `SimulationJobStore`). |
| `src/services/SimulationService.ts` | extend | `fetchPastSimulations(filters)` (R1), `fetchPastSimulation(id)` (R2). Read-only GETs; dynamic `@common` import matching the existing module style; honors `VITE_SIM_API_NAME` prefix. |
| `src/util/persistedSimulationAdapter.ts` | create (pure) | R2 detail → `{ baseline, variants, partial }` for `SimulationResults`. |
| `src/components/simulation/PastSimulationsList.vue` | create | Filter controls + paginated Ionic list of headers; row → detail route; loading/empty/error states. |
| `src/views/PastSimulationDetail.vue` | create | `props: { simulationId }`; `store.loadDetail` → adapter → `SimulationResults`; loading/error/retry. |
| `src/views/SimulationHome.vue` | modify | Add `ion-segment` ("New simulation" / "Past simulations"); host the existing picker and the new list; default to "New simulation". |
| `src/router/index.ts` | modify | Add `simulate/history/:simulationId` with `props: true` (app convention; not `useRoute()`). |
| `src/store/simulationStore.ts` | modify | Add `lastSimulationId: string \| null`, set from the poll completion envelope's `simulationId` (R3) when a batch completes (read-if-present, safe when absent). |
| `src/components/simulation/SimulationResults.vue` | modify | When `simulationStore.lastSimulationId` is set, show a "View saved result" action → `/tabs/simulate/history/{id}`. |
| `src/mock/pastSimulationsMock.ts` | create (dev only) | Toggleable fixture for R1/R2 so Phase 1 is testable before the backend ships. Gated by an env flag; never imported in prod paths. |

### Routing

- `/tabs/simulate` — `SimulationHome` (segment state local; default "New simulation").
- `/tabs/simulate/history/:simulationId` — `PastSimulationDetail` (`props: true`).

---

## Data flow & the cache

### Types (FE-internal)

```ts
// header (R1 row / list-cache entry)
interface PastSimHeader {
  simulationId: string; routingGroupId: string; productStoreId: string;
  runType: "SINGLE" | "VARIATION"; statusId: "RUNNING" | "COMPLETE" | "FAILED";
  attemptedItemCount: number; brokeredItemCount: number; queuedItemCount: number;
  durationMs: number; sampleSize: number; sampleCap: number;
  simulationRan: boolean; partial: boolean; createdDate: string; createdByUser: string;
}
// detail (R2) = header + variants[]; cached as the raw response, adapted on read.
interface PastSimDetailCacheEntry { header: PastSimHeader; raw: any; cachedAt: number; }
```

### List (stale-while-revalidate)

`loadList(force = false)` on the Past segment becoming active:
1. If **not filtered**: read `SimulationHistoryCache.getList()` → set `list` immediately
   (`listLoading=false` if cache hit). The view renders instantly, even right after a refresh.
2. Fire `SimulationService.fetchPastSimulations({ productStoreId, page:0, ... })`:
   - success → replace `list`, `SimulationHistoryCache.setList(headers)`.
   - error → keep the cached `list`, set `listError` (non-blocking banner + Retry).
3. **Filtered** queries (any of status / runType / routingGroup / date): skip the cache entirely —
   `listLoading=true`, live fetch, render result; cache is neither read nor written.

Pagination: first page is cached; subsequent pages are live appends (not cached).

### Detail (cache-first, immutable)

`loadDetail(id)`:
1. If `detailById[id]` (in-memory) → use it.
2. Else `SimulationHistoryCache.getDetail(id)`: if present **and** `header.statusId ∈
   {COMPLETE, FAILED}` → adopt it (no fetch).
3. Else `SimulationService.fetchPastSimulation(id)` → store raw in `detailById[id]` and
   `SimulationHistoryCache.putDetail(id, entry)` (LRU). On error → `detailError` + Retry.
4. The component always renders `persistedSimulationAdapter(raw)`.

A `RUNNING` (non-terminal) detail is never cached and always refetched (defensive; "past" rows are
normally terminal).

### Fresh-run hook

When a live run completes and the poll envelope carries `simulationId` (R3),
`simulationStore` sets `lastSimulationId` and calls
`pastSimulationStore.recordCompletedRun(headerFromRun)`, which **prepends** the header to the
cached list (dedupe by `simulationId`). The new run is visible on the Past tab immediately; the
next `loadList` revalidate reconciles it with the server.

### Bounds / prune (in `SimulationHistoryCache`)

- List: store at most the latest 50 headers (`createdDate desc`).
- Detail: LRU keyed by `simulationId`, max 25 entries (evict least-recently-read).
- Prune any list/detail entry with `cachedAt`/`createdDate` older than 30 days on read.
- Keys: `sim.history.list.<productStoreId>`, `sim.history.detail.<simulationId>`,
  `sim.history.lru` (the LRU order index). All writes wrapped in try/catch (quota/serialization),
  failures are non-fatal (cache is an optimization, never required).

---

## The adapter

`persistedSimulationAdapter(raw)` → `{ baseline, variants, partial }`:
- `baseline` = the variant with `isBaseline=Y`; its counts map to the `groupRun` shape
  (`brokeredItemCount` / `queuedItemCount` / `attemptedItemCount`).
- `variants[]` = non-baseline variants → `{ label, groupRun: {counts}, diff: parse(diffJson),
  failed, failureReason }`.
- `partial` = header `partial=Y` or any variant `failed=Y`.
- `diffJson` may arrive as a JSON **string** or an **object** (backend request open question #2);
  the adapter normalizes either to the `diff` object `SimulationResults` reads
  (`finalReasonTransitions`, `routingBrokeredDelta`, `facilityAllocationDelta`).
- Missing/null counts default to 0; a `SINGLE` run with only the synthetic baseline yields
  `variants: []` and renders as a single-run scorecard.

This is the **only** module that changes if the persisted shape differs from the live envelope.

---

## Errors / empty / loading

- **First uncached load:** skeleton/spinner on list and detail.
- **Cache hit + revalidate:** data shows instantly; a subtle "refreshing…" hint while the
  background fetch runs; silent success-swap, non-blocking error banner on failure.
- **Error:** per-call message + Retry, mirroring the `loadError` pattern in `Simulation.vue`;
  cached data stays on screen.
- **Empty:** "No past simulations yet" with a hint to run one.
- **Failed/partial runs:** `statusId=FAILED` → badge in the list; failed variants and
  `simulationRan=false` surfaced in detail exactly as the live results screen already does.
- **Backend not ready:** until R1/R2 ship, the service errors; the error+retry state covers it,
  and the dev mock (env-gated) provides fixtures for building/testing.

---

## Testing

Two runners as per repo convention: pure logic via `npx tsx` + `node:assert`; `.vue` via `vitest`.

- **`persistedSimulationAdapter.ts`** (pure, the risk center): baseline extraction (`isBaseline=Y`);
  variation run with multiple variants; single run (synthetic baseline only); `diffJson` as string
  vs object → parsed `diff`; failed-variant flag; missing/null counts default to 0.
- **`SimulationHistoryCache.ts`** (injected `StorageLike`, like `SimulationJobStore`): list
  set/get roundtrip; cap to 50 newest; detail LRU put/get + eviction at 25; age-prune at 30 days;
  corrupt-JSON tolerance; quota/throw is swallowed (returns empty/no-op).
- **`pastSimulationStore`** SWR (mocked service + injected storage): cache-hit renders then
  revalidates and swaps; revalidate error keeps cached list + sets `listError`; filtered query
  bypasses cache; `loadDetail` serves cached terminal without fetch, fetches on miss and on
  `RUNNING`; `recordCompletedRun` prepends + dedupes.
- **`SimulationService`** read fns: URL/param construction for filters + pagination; error
  propagation (`commonUtil.hasError`).
- **Views** (`PastSimulationsList`, `PastSimulationDetail`, `SimulationHome` segment): verified in
  the running app against the mock until R1/R2 land.

---

## Build sequence

1. `persistedSimulationAdapter` (TDD) — the pure seam.
2. `SimulationHistoryCache` (TDD) — localStorage cache + LRU + prune.
3. `SimulationService.fetchPastSimulations` / `fetchPastSimulation` (+ dev mock).
4. `pastSimulationStore` (SWR) — wires cache + service.
5. `PastSimulationsList` + `SimulationHome` segment + route.
6. `PastSimulationDetail` reusing `SimulationResults`.
7. Deep-link: `simulationStore.lastSimulationId` (R3) + "View saved result" action.

Steps 1–4 are testable headlessly now (mock); 5–7 verified in-app. The whole feature flips from
mock to live when backend R1/R2 ship — only the service module changes.

---

## Contract status (confirmed 2026-06-09)

Backend shipped R1–R5; authoritative shapes in
`2026-06-09-past-simulations-read-api-frontend-integration.md`. Resolved:
- R1 = `{ simulationList, totalCount }`; R2 = `{ simulation:{header}, variants:[] }` (nested).
- JSON fields return **parsed** (`diff`, `parameterOverrides`, `routingDeltas`, `runOptions`,
  `config`) — bind to those, not the `*Json` strings.
- `createdDate` = epoch millis (Long); `pageIndex`/`pageSize` + `totalCount`; R3 already returns
  `simulationId` on poll completion.

## Open questions / assumptions

1. **`outcomes` not in R2** — persisted variants carry counts + `diff` only, so the richer
   outcome-metric panels render empty for past runs in Phase 1 (count scorecard + diff work). Add
   per-variant `outcomes` to R2, or feed them from R5 aggregates in Phase 2, if rich panels are
   required for Phase 1.
2. **Scope** — list filters by current `productStoreId` (may be null on older rows); confirm
   org-wide vs per-user visibility. Cache key is per `productStoreId` (store switch = separate bucket).
3. **`createdByUser` display** — header carries the login id; a friendly name may need a later
   lookup (not Phase 1).
4. **Environment** — routes verified locally, not yet on UAT; build/test on the mock until they land.
5. **Batched runs** — a submit can spawn multiple jobs, each with its own `simulationId`; the
   deep-link uses the first completed batch's id, the list shows all. Revisit if a single combined
   record is wanted.
