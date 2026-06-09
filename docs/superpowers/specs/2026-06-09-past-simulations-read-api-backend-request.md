
# Backend Project Request — Past-Simulations Read/Query REST API

**Date:** 2026-06-09
**Requested by:** Frontend (order-routing PWA) — Aditi Patel
**Backend owner / component:** `sim-routing` (depends on `order-routing`)
**Blocks:** PWA "Past Simulations Viewer" (spec `2026-05-27-past-simulations-viewer-design.md`), Phase 1.

> **✅ FULFILLED (2026-06-09).** Backend shipped R1–R5; authoritative confirmed contract:
> `2026-06-09-past-simulations-read-api-frontend-integration.md`. Notable confirmations: R1 →
> `{ simulationList, totalCount }`; R2 → `{ simulation:{header}, variants:[] }`; JSON fields return
> **parsed**; `createdDate` is epoch millis. Open question #2 (JSON string vs object) → **parsed**.
> One follow-up not in scope of the original request: per-variant `outcomes` is absent from R2 (FE
> rich panels degrade in Phase 1).

---

## 1. Why

Group-run simulations are already **persisted** to the `BrokeringSimulation*` entities when a
run is submitted with `persistResult: true` (default), and the submit/run path already returns a
`simulationId` (see `sim-routing-frontend-integration.md` §6). The data is in the DB.

**The gap:** there is **no read/query REST API** to get that data back. The handoff catalog
(§4) exposes only endpoints that *run* simulations plus a poll endpoint whose results are
**pollable for ~5 minutes** (`simulation.jobCompletedTtlMs`), after which a poll returns
`not_found`. So once the TTL lapses (or the user refreshes / comes back later), a completed
run's results are unreachable from the PWA even though they are persisted.

The frontend needs to **list persisted simulations** and **open any one of them** to view its
results (reusing the existing `SimulationResults.vue` UI). This request defines the read API the
PWA will build against. The frontend will layer its own client-side cache on top; that is a FE
concern and is **not** part of this request.

---

## 2. What already exists (no change requested)

From `sim-routing-frontend-integration.md`:

- Run + poll: `POST/GET …/routingGroups/{id}/brokeringSimulation/jobs[/{jobId}]` (poll TTL ~5 min).
- Persistence: `persistResult:true` writes `BrokeringSimulation*` and returns `simulationId`.
- Scenario CRUD: `/scenarios…`.
- Run analytics: `/routing-runs/summary`, `/facility-changes/summary`.

Persisted entities (already defined in
`order-routing/entity/BrokeringSimulationEntities.xml`, each has a `short-alias`):

| Entity | short-alias | Grain |
|---|---|---|
| `BrokeringSimulation` | `brokeringSimulations` | one run (header) |
| `BrokeringSimulationVariant` | `brokeringSimulationVariants` | one variant within a run |
| `BrokeringSimulationRuleResult` | `brokeringSimulationRuleResults` | one routing within a variant |
| `BrokeringSimulationItem` | `brokeringSimulationItems` | one order-item line |
| `BrokeringSimulationRuleAttempt` | `brokeringSimulationRuleAttempts` | one rule attempt |

The `short-alias`es suggest these could be exposed cheaply via Moqui entity-auto REST resources;
purpose-built find services are equally fine. The FE only depends on the **paths + response
shapes** below, not the implementation.

---

## 3. Endpoints requested

Base + auth + content-type per existing order-routing conventions (`sim-routing-frontend-integration.md` §3).

### R1 — List persisted simulations (Phase 1, **blocking**)

```
GET  brokeringSimulations
```
- **Filters (all optional, AND-combined):** `routingGroupId`, `productStoreId`, `statusId`
  (`RUNNING`/`COMPLETE`/`FAILED`), `runType` (`SINGLE`/`VARIATION`), `createdDate` range
  (`fromDate`/`thruDate` or your standard range params).
- **Sort:** `createdDate` descending (newest first) by default.
- **Pagination:** standard Moqui paging — confirm whether `pageIndex`/`pageSize` or
  `viewIndex`/`viewSize`, and please return a total count for the FE list footer.
- **Returns:** page of `BrokeringSimulation` **headers** — fields:
  `simulationId, routingGroupId, productStoreId, runType, statusId, attemptedItemCount,
  brokeredItemCount, queuedItemCount, durationMs, sampleSize, sampleCap, simulationRan, partial,
  createdDate, createdByUser`.

### R2 — Get one persisted simulation with its variants (Phase 1, **blocking**)

```
GET  brokeringSimulations/{simulationId}
```
- **Returns:** the header (R1 fields) **plus** `variants[]` from `BrokeringSimulationVariant`:
  `variantSeqId, label, isBaseline, failed, failureReason, attemptedItemCount, brokeredItemCount,
  queuedItemCount, durationMs, diffJson, parameterOverridesJson, routingDeltasJson, scenarioId,
  scenarioVariantSeqId`.
- **JSON-string fields** (`diffJson`, `parameterOverridesJson`, `routingDeltasJson`,
  `configJson`, `runOptionsJson`): please confirm whether these come back as **raw JSON strings**
  or **already-parsed objects**. The FE adapter handles either, but we'll hard-code one — tell us
  which.
- Single (`runType=SINGLE`) runs should carry one synthetic baseline variant
  (`variantSeqId=0, isBaseline=Y`) so the FE sees uniform shape — confirm this holds.

### R3 — `simulationId` in the async poll completion envelope (Phase 1, deep-link)

```
GET  routingGroups/{routingGroupId}/brokeringSimulation/jobs/{jobId}
  → { jobId, status:"complete", impact:{…}, simulationId }   // add simulationId on completion
```
So the PWA can deep-link a just-finished run to its saved record. FE reads it if present and
tolerates absence. Confirm whether the completion envelope already includes `simulationId`
(the run response does per §6) — if so, R3 is a no-op/confirmation only.

### R4 — Variant items, paginated (Phase 2)

```
GET  brokeringSimulations/{simulationId}/variants/{variantSeqId}/items
```
- **Filters (optional):** `facilityId`, `finalReason`
  (`FULLY_BROKERED/PARTIALLY_BROKERED/QUEUED/UNFILLABLE/ERROR`), `orderId`.
- **Paginated** (same convention as R1).
- **Returns:** page of `BrokeringSimulationItem`: `itemSeqId, orderId, shipGroupSeqId,
  orderItemSeqId, productId, finalReason, facilityId, routedQty, itemQty, distance` (lat/long are
  null today — FE hides geo).

### R5 — Server-side aggregates per variant (Phase 2)

```
GET  brokeringSimulations/{simulationId}/aggregates   (optionally ?variantSeqId=)
```
- **Returns**, per variant: counts by `finalReason`; counts + `routedQty` by `facilityId`;
  distance sum/avg. Computed server-side so the FE renders compact rollups without pulling all items.

---

## 4. Phasing & priority

| Item | Phase | Priority |
|---|---|---|
| R1 list + R2 detail | 1 | **Blocking** — FE Phase 1 (list + reopen) cannot ship without these |
| R3 simulationId in poll | 1 | High — enables deep-link; confirm-or-add |
| R4 items, R5 aggregates | 2 | After Phase 1 — slice/dice charts + item table |

The FE will build Phase 1 against a mock of R1/R2 immediately and flip to the live endpoints when
they land.

---

## 5. Open questions for the backend owner

1. **Pagination params** — `pageIndex/pageSize` vs `viewIndex/viewSize`; is a total count returned?
2. **JSON-string fields** — raw strings or parsed objects in the R2 response? (Pick one; FE pins to it.)
3. **Auth / visibility scope** — are past simulations visible org-wide, per `productStoreId`, or
   per creating user? The FE list will filter by `productStoreId` by default.
4. **Single-run baseline** — does a `SINGLE` run reliably persist the synthetic
   `variantSeqId=0, isBaseline=Y` variant?
5. **Mount location** — these read routes should mount under the same base the run/poll endpoints
   end up on (order-routing vs sim-routing, per handoff §2/§8). FE prefix is a single env var.
6. **Status filter values** — confirm `statusId` codes are exactly `RUNNING/COMPLETE/FAILED`
   (plain codes, no `StatusItem` FK, per the entity description).

---

*Source of truth for shapes: `BrokeringSimulationEntities.xml` and `sim-routing-frontend-integration.md`.
Once R1–R3 shapes are confirmed, frontend Phase 1 (list + detail + cache) proceeds.*
