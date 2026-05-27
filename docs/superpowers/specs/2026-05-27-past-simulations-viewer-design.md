# Past Simulations Viewer — Design Spec

**Date:** 2026-05-27
**Author:** toaditi
**Status:** Draft — pending user review

---

## Context

Brokering group-run simulations are now **persisted** to the OrderRouting writable DB at the end
of every `simulate#BrokeringGroupRun` (see the backend KT/handoff and the entity/writer specs
`2026-05-27-brokering-simulation-result-entities-design.md` /
`…-result-writer-design.md`). The PWA can already *run* simulations (the brokering simulation
screen, spec `2026-05-27-brokering-simulation-screen-design.md`) but has no way to **view or
analyse past runs**.

This spec covers a read-only **"view / slice-and-dice past simulations"** experience in the PWA's
**Simulate** tab.

### Hard prerequisite (not yet built)

There is currently **no read/query REST API** for the persisted simulation entities — today's
endpoints only *run* sims. Every screen here depends on the read API proposed in the backend
handoff §3. **Phase 1 can be built and unit-tested against a mock, but is not functional until the
backend ships those endpoints.** This is the gating dependency for the whole feature.

---

## Goals / Non-goals

**Goals**
- List persisted simulations with filters, newest first.
- Open a saved run and see its comparison/diff, reusing the existing results UI.
- Deep-link from a just-finished run to its saved record.
- (Phase 2) Slice/dice a run's items by facility / finalReason / distance, plus a searchable
  order-level table.

**Non-goals (v1)**
- Any write/delete/retention UI (runs persist with no TTL; cleanup is a backend concern).
- Map/geo views (Follow-up C — origin/destination lat-long + distance are NULL today; hide geo UI).
- Cross-store analytics beyond the list filters.
- A charting dependency (Phase 2 uses in-house CSS/SVG charts).

---

## Key decisions (from brainstorming)

1. **Phased** — Phase 1: list + detail (+ deep-link). Phase 2: slice/dice charts + item table.
2. **Entry point** — a two-segment `SimulationHome`: **"New simulation"** (existing group picker)
   and **"Past simulations"** (the list). No new top-level tab.
3. **Detail rendering** — an **adapter** maps the persisted §3 detail response into the shape the
   existing `SimulationResults.vue` already renders; one results UI for both live and saved runs.
4. **Aggregates** — computed **server-side** (§3 `/aggregates`); the FE renders compact rollups.
   The order-level table pages the `/items` endpoint separately.
5. **Charts (Phase 2)** — **in-house CSS/SVG** (bar + donut); no charting library added.
6. **`simulationId`** — treated as an opaque string (Moqui sequenced id).

---

## Backend dependency (assumed contract — confirm with backend owner)

Designed against backend handoff §2 (Follow-up A) and §3. Final shapes to be confirmed.

### Follow-up A — `simulationId` in the async poll envelope (Phase 1 consumer)

```
GET routingGroups/{routingGroupId}/brokeringSimulation/jobs/{jobId}
  → { jobId, status, groupRun? | variation?, error?, simulationId? }   // simulationId present when complete
```
The FE reads `simulationId` if present and ignores its absence (graceful).

### §3 — read API for past simulations

| Verb & path | Returns | Phase |
|---|---|---|
| `GET brokeringSimulations` | page of `BrokeringSimulation` headers; filters: `routingGroupId`, `productStoreId`, `statusId`, `runType`, `createdDate` range; sort `createdDate desc`; paginated | 1 |
| `GET brokeringSimulations/{simulationId}` | one header + its `variants[]` (counts, `isBaseline`, `failed`, `diffJson`) | 1 |
| `GET brokeringSimulations/{id}/variants/{variantSeqId}/items` | page of `BrokeringSimulationItem`; filters: `facilityId`, `finalReason`, `orderId`; paginated | 2 |
| `GET brokeringSimulations/{id}/aggregates` | server rollups (counts by `finalReason`, counts+`routedQty` by `facilityId`, distance sum/avg), per variant | 2 |

**Header fields used** (from `BrokeringSimulation`): `simulationId`, `routingGroupId`,
`productStoreId`, `runType` (`SINGLE`/`VARIATION`), `statusId` (`RUNNING`/`COMPLETE`/`FAILED`),
summary counts (brokered/attempted/queued), `createdDate`.
**Enum codes** (strings): `finalReason ∈ {FULLY_BROKERED, PARTIALLY_BROKERED, QUEUED, UNFILLABLE,
ERROR}`; `outcome ∈ {FULL_BROKER, PARTIAL_BROKER, QUEUED, NO_INVENTORY, ERROR, SKIPPED_BY_ACTION}`.
Single (non-variation) runs carry one synthetic baseline variant (`variantSeqId=0`,
`isBaseline=Y`), so children sit at uniform depth.

---

## Architecture

PWA-only (plus the backend dependency). Reuses Ionic list patterns and the existing
`SimulationResults.vue` / diff widgets. Read-only: the only calls are GETs against §3.

```
Simulate tab
  SimulationHome.vue  [ New simulation | Past simulations ]   (ion-segment)
     ├─ New simulation  → (existing) group picker → editor
     └─ Past simulations → PastSimulationsList.vue
                              │ row tap
                              ▼
                  /tabs/simulate/history/:simulationId
                     PastSimulationDetail.vue
                        fetchSimulation(id) → persistedSimulationAdapter → SimulationResults.vue
                        │ "Slice & dice" (Phase 2)
                        ▼
                     SimulationSliceDice.vue  → /aggregates (charts) + /items (table)
```

### Files

**Phase 1**

| File | Responsibility |
|---|---|
| `src/views/SimulationHome.vue` (modify) | Add an `ion-segment` ("New simulation" / "Past simulations"); host the existing picker and the new list. |
| `src/components/simulation/PastSimulationsList.vue` (create) | Filter controls + paginated Ionic list of headers; row → detail route. |
| `src/views/PastSimulationDetail.vue` (create) | Load `{simulationId}`, run the adapter, render `SimulationResults`; "Slice & dice" entry (Phase 2). |
| `src/util/persistedSimulationAdapter.ts` (create, pure) | Map §3 detail response → `{ baseline, variants[], partial }` consumed by `SimulationResults`. |
| `src/services/SimulationService.ts` (extend) | `fetchPastSimulations(filters)`, `fetchSimulation(id)` (read-only; dynamic `@common` import, matching the existing module). |
| `src/router/index.ts` (modify) | Add `simulate/history/:simulationId` (with `props: true`). |

**Phase 2**

| File | Responsibility |
|---|---|
| `src/views/SimulationSliceDice.vue` (create) | Charts + searchable item table for a chosen variant. |
| `src/components/simulation/FacilityAllocationChart.vue` (create) | CSS/SVG bar chart (allocation counts + routedQty by facility). |
| `src/components/simulation/FinalReasonChart.vue` (create) | CSS/SVG donut (backorder vs brokered breakdown). |
| `src/services/SimulationService.ts` (extend) | `fetchSimulationAggregates(id, variantSeqId)`, `fetchSimulationItems(id, variantSeqId, filters)`. |

### Routing

- `/tabs/simulate` — `SimulationHome` (segment state held locally; default "New simulation").
- `/tabs/simulate/history/:simulationId` — `PastSimulationDetail` (`props: true`, per the app
  convention; **not** `useRoute()`).
- Phase 2 slice/dice is a child view/segment of the detail route (e.g.
  `/tabs/simulate/history/:simulationId` with a detail/slice segment, or a nested route — final
  shape decided in the plan).

---

## Data flow & the adapter

**List:** filter state → `fetchPastSimulations(filters)` → Ionic list with infinite-scroll/paged
loading → row tap routes to detail.

**Detail:** `fetchSimulation(id)` returns the header + `variants[]`. `persistedSimulationAdapter`
maps it to `{ baseline, variants, partial }`:
- `baseline` = the variant with `isBaseline=Y` (its counts as the `groupRun` shape:
  `brokeredItemCount` / `queuedItemCount` / `attemptedItemCount`).
- `variants[]` = the non-baseline variants, each → `{ label, groupRun: {counts}, diff: parse(diffJson), failed }`.
- `partial` = derived from header/variants (any failed/incomplete).
`SimulationResults.vue` then renders the scorecard + drill-downs unchanged. The adapter is the
**single seam** that absorbs persisted-vs-live shape differences (e.g. `diffJson` is a JSON string
or object → parse to the `diff` object the widget reads: `finalReasonTransitions`,
`routingBrokeredDelta`, `facilityAllocationDelta`).

**Slice/dice (Phase 2):** `fetchSimulationAggregates(id, variantSeqId)` → charts;
`fetchSimulationItems(id, variantSeqId, filters)` → paged searchable table.

---

## Deep-link from a fresh run (Follow-up A consumer, Phase 1)

`simulationStore` already holds run state. Add `lastSimulationId: string | null`, set from the poll
envelope's `simulationId` when a batch completes (read-if-present; safe when absent). When set,
`SimulationResults` shows a **"View saved result"** action routing to
`/tabs/simulate/history/{lastSimulationId}`. With batching (multiple jobs/`simulationId`s), use the
first completed batch's id and note the limitation (one saved record per batch — the list shows all).

---

## Errors / empty / loading

- **Loading:** skeleton/spinner on list and detail fetches.
- **Empty:** "No past simulations yet" with a hint to run one.
- **Error:** per-call message + Retry, mirroring the `loadError` pattern in `Simulation.vue`.
- **Failed/partial runs:** `statusId=FAILED` shown as a badge in the list; failed variants and
  `simulationRan:false` surfaced in detail exactly as the live results screen already does.
- **Backend not ready:** until §3 ships, `fetchPastSimulations`/`fetchSimulation` will error;
  the error+retry state covers this. A mock (toggleable) is used during development.

---

## Testing

- **`persistedSimulationAdapter.ts`** (pure, `tsx` + `node:assert`, the risk center): baseline
  extraction (`isBaseline=Y`); variation run with multiple variants; single run (synthetic
  baseline only); `diffJson` as string vs object → parsed `diff`; failed-variant flag; missing/null
  fields (counts default sensibly).
- **`SimulationService`** read functions: URL/param construction for filters + pagination; error
  propagation (mirroring existing `commonUtil.hasError` handling).
- **Views** (`PastSimulationsList`, `PastSimulationDetail`, `SimulationSliceDice`): verified in the
  running app (repo has no Vue unit-test runner); against a mock until §3 lands.

---

## Suggested build sequence

1. **Phase 1** — adapter (TDD) → `SimulationService` read fns → `PastSimulationsList` →
   `PastSimulationDetail` (reuse `SimulationResults`) → segment + route → Follow-up A deep-link.
2. **Phase 2** — `SimulationService` aggregates/items fns → CSS/SVG chart components →
   `SimulationSliceDice` → wire from detail.

Phase 1 is independently shippable once the §3 list + detail endpoints exist; Phase 2 needs
`/aggregates` + `/items`.

---

## Open questions / assumptions

1. **§3 contract** — list/detail/items/aggregates shapes are assumed from the backend handoff;
   confirm field names and pagination style (entity-auto vs purpose-built find/aggregate services)
   with the backend owner before wiring `SimulationService`.
2. **`diffJson` shape** — assumed to parse into the same `diff` object the live variation envelope
   carries (`finalReasonTransitions`, `routingBrokeredDelta`, `facilityAllocationDelta`). If the
   persisted diff differs, only the adapter changes.
3. **Auth/visibility** — assumed past simulations are visible within the current store scope (list
   filters by `productStoreId`); confirm whether org-wide or per-user scoping is required.
4. **Batched-run deep-link** — a submit can spawn multiple jobs, each persisting its own
   `simulationId`. Phase 1 deep-links the first; the list shows all. Revisit if a single combined
   record is wanted.
