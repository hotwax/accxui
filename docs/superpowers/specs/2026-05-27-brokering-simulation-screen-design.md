# Brokering Group Simulation Screen — Design Spec

**Date:** 2026-05-27
**Author:** toaditi
**Status:** Draft — pending user review

---

## Context

The PWA has a circuit/group editor (`CircuitCanvas.vue`) that lets a merchant edit a routing
group — its routings, rules, actions, filters, and parameters — and **persist** those changes to
the Order Routing backend via `RoutingService` on an explicit Save.

Separately, the circuit (Mastra) server already exposes a `runBrokeringGroupSimulation` tool
(`circuit/src/mastra/tools/runBrokeringGroupSimulation.ts`) that runs the full routing group
end-to-end against a snapshot of today's unrouted orders **without touching production data**,
and can compare up to 5 variant configs against the same order snapshot.

This spec defines a **new merchant-facing screen** that is the human-driven counterpart to that
tool: it looks and feels like the circuit editor, but instead of saving to the backend it lets the
user build any number of **variations** of the group, then submits them to the group-run
simulation and shows a comparison of the results. The LLM is not involved — the user assembles the
variants by hand.

---

## Goals / Non-goals

**Goals**
- A screen that visually mirrors the circuit/group editor but never writes to the backend.
- Let the user open a routing group, edit a canvas, and save the current state as a *variation*.
- Allow an unlimited number of variations.
- On submit, run all variations against the same order snapshot and present a comparison
  (which config is best) plus per-order / per-routing / per-facility drill-downs.

**Non-goals (explicitly out of scope for v1)**
- Persisting variations across page reload (variations are session-scoped, in memory).
- Background / return-later runs or a cross-session run history (the user stays on the screen
  while a run is in progress; navigating away abandons the in-progress run).
- Saving a variation back as a real routing group / writing any backend mutation.
- Sub-job, item-level progress (the backend does not stream it).

---

## Key decisions (from brainstorming)

1. **Simulation target** — the same group-run simulation backend the `runBrokeringGroupSimulation`
   tool uses. The screen produces the same logical payload (flat params + `routingConfigDeltas` +
   `variants[]`) and consumes the same `{ groupRun } | { variation }` result envelope.
2. **Variation model** — each variation is a **full snapshot** (photograph) of the edited group
   config. The baseline is the live group config as loaded and is never edited. The
   *changes-only* payload the backend wants is computed by **diffing** each snapshot against the
   baseline at submit time.
3. **Unlimited variations, batched** — the user may create any number of variations. At submit the
   screen chunks them into batches of ≤5 variants (the backend cap), fires one job per batch, polls
   all jobs, and merges the results.
4. **Fork, don't refactor** — the canvas is a **fork** of `CircuitCanvas.vue` into a new
   `SimulationCanvas.vue`, with all `RoutingService` mutations removed and Save rewired to capture a
   variation. The live editor is left untouched (zero regression risk; the ~100KB duplication is
   the accepted cost).
5. **Entry** — a **new top-level tab** ("Simulate") with a routing-group picker, independent of
   whatever the user was editing in the live tab.
6. **Diff approach A+** — structural diff at submit, **and** sim-mode editing is constrained to
   exactly the delta vocabulary the backend schema supports, so no edit can be silently dropped
   from the simulation.
7. **Async job model** — the screen submits to an **async job-based group endpoint**
   (submit → `jobId` → poll), mirroring the single-run job model, rather than the existing
   synchronous group endpoint. **This endpoint does not exist yet** and is a hard backend
   dependency (see "Backend dependency").

---

## Backend dependency (must confirm / build)

### Current reality

- **Group run is synchronous today.** `runBrokeringGroupSimulation` POSTs to
  `/rest/s1/order-routing/routingGroups/{routingGroupId}/simulation` and **blocks** until the
  simulation completes (typically 3–10 minutes, longer with variants). The HTTP response body *is*
  the result: `{ groupRun }` (no variants) or `{ variation }` (variants present). There is no
  `jobId`, no status field, no polling. Errors are non-2xx HTTP.
- **The async job model exists only for single-run.** `submitBrokeringSimulation` /
  `getBrokeringSimulationStatus` use `/rest/s1/order-routing/productStores/{productStoreId}/brokeringSimulation/jobs/{jobId}`
  and return `{ jobId, status, impact?, error? }`. This is a different endpoint and resource and is
  **not** usable for group runs.

A synchronous request that blocks for many minutes is acceptable from the Mastra tool because it
runs server-side in Node. From the **browser PWA** it is timeout-prone (browser / proxy / gateway
idle limits will cut a 10+ minute `fetch`, especially when batched). We therefore design against an
async job variant.

### Assumed async group-run contract (to confirm with backend team)

```
POST /rest/s1/order-routing/routingGroups/{routingGroupId}/brokeringSimulation/jobs
  body (flat — simulationConfig fields promoted to root, routingGroupId in URL only):
    {
      // parameter / data overrides (all optional)
      distance, brokeringSafetyStock, weekOfSupplyFilterEnabled, weekOfSupplyThreshold,
      facilityGroupId, ignoreFacilityOrderLimit, facilityOrderLimitOverride,
      splitOrderItemGroup, assignmentEnumId, inventorySortByList, modelInventoryConsumption,
      minimumStockOverrides, inventoryCountOverrides, allowBrokeringOverrides,
      maximumOrderLimitOverrides, facilitiesToSimulateAtLimit,
      facilitiesToAddToGroup, facilitiesToRemoveFromGroup,
      // structural deltas applied to the baseline before the run
      routingConfigDeltas: RoutingConfigDelta[],
      // up to 5 variants, each its own overrides + structural deltas
      variants: [{ label, parameterOverrides?, routingDeltas? }],
      sampleCap
    }
  → 200 { jobId }

GET /rest/s1/order-routing/routingGroups/{routingGroupId}/brokeringSimulation/jobs/{jobId}
  → 200 {
      jobId,
      status: 'running' | 'complete' | 'failed' | 'not_found',
      groupRun?,    // present when status === 'complete' and no variants were sent
      variation?,   // present when status === 'complete' and variants were sent
      error?        // present when status === 'failed'
    }
```

- `complete` → body carries the same `{ groupRun }` / `{ variation }` envelope the synchronous
  endpoint returns today (so the result-reading code is shared regardless of how the job is run).
- Completed jobs stay pollable for ~5 minutes, then return `not_found` (same lifecycle as the
  single-run job endpoint).

The PWA-facing work (canvas fork, variation management, diff engine, results rendering) can be
built and unit-tested **before** this endpoint lands; only the submit → poll path is gated on it.

### `RoutingConfigDelta` shape (from the existing tool schema)

Discriminated union on `op` (see `circuit/src/mastra/tools/runBrokeringGroupSimulation.ts`):

| op | required fields |
|---|---|
| `ADD_RULE` | `orderRoutingId`, `ruleSeed` (map of new-rule fields) |
| `REMOVE_RULE` | `routingRuleId` |
| `SET_RULE_ACTION` | `routingRuleId`, `actionTypeEnumId`, `actionValue` |
| `SET_RULE_INV_COND` | `routingRuleId`, `fieldName`, `fieldValue` |
| `SET_ROUTING_FILTER` | `orderRoutingId`, `fieldName`, `fieldValue` |
| `SET_ROUTING_SEQUENCE_NUM` | `orderRoutingId`, `sequenceNum` |
| `SET_RULE_SEQUENCE_NUM` | `routingRuleId`, `sequenceNum` |

The parameter override fields are the `simulationConfigSchema` fields, also defined in that file.

---

## Architecture

This is a **PWA-only** feature (plus the backend endpoint dependency). It reuses the existing
`orderRoutingStore` for group data and follows the read-only-until-explicit-action discipline of the
rest of the app — except here there is *no* persisting action at all; the only outbound call is the
simulation submit, which is non-mutating by definition.

```
[Simulate tab]
   SimulationHome.vue  ── pick group ──▶  Simulation.vue (/tabs/simulate/:routingGroupId)
                                              │ loads group → baseline snapshot
                                              ▼
        ┌─────────────────────────────────────────────────────────────┐
        │ SimulationCanvas.vue (fork of CircuitCanvas, edit in memory)  │
        │ VariationRail.vue   (baseline + variations[], add/dup/del)    │
        └─────────────────────────────────────────────────────────────┘
                                              │ Submit
                                              ▼
        simulationDiff.ts  ── diff(baseline, snapshot) → variants[] ──▶ chunk ≤5
                                              │
                            SimulationService.ts  submit + poll per batch
                                              │
              SimulationProgress.vue  ◀── per-batch status ──▶  SimulationResults.vue
```

### Components (all new — no edits to the live editor)

| File | Purpose |
|---|---|
| `src/views/Simulation.vue` | Tab shell; switches between picker / canvas+rail / results, mirroring `Circuit.vue`'s state-switch pattern. |
| `src/views/SimulationHome.vue` | Routing-group picker, backed by `orderRoutingStore().fetchOrderRoutingGroups()` / `getRoutingGroups` (same source as `BrokeringRuns.vue`). |
| `src/components/simulation/SimulationCanvas.vue` | **Fork of `CircuitCanvas.vue`.** All `RoutingService` mutations removed; edits mutate local state only; Save captures a variation into the sim store. Editing surface restricted to the delta vocabulary (see "Diff approach A+"). |
| `src/components/simulation/VariationRail.vue` | Lists baseline + variations; add / duplicate / rename / delete / load-into-canvas; the Submit button. |
| `src/components/simulation/SimulationProgress.vue` | Live per-batch / per-variation status while a run is in progress. |
| `src/components/simulation/SimulationResults.vue` | Comparison scorecard + per-order / per-routing / per-facility drill-downs. |
| `src/store/modules/simulation/` (Vuex module) | `baseline`, `variations[]`, `activeVariationId`, `run` state, `results`. Session-scoped — **not** added to the persisted paths in `src/store/index.ts`. |
| `src/services/SimulationService.ts` | `submitBatch()` + `pollJob()`; read-only, never calls `RoutingService`. |
| `src/util/simulationDiff.ts` | Pure `diff(baseline, snapshot) → { parameterOverrides, routingDeltas }`. |

### Navigation

- Add a 4th `ion-tab-button` ("Simulate", e.g. `flaskOutline`) to `views/Tabs.vue` and include
  `/tabs/simulate` in `showFooter()`.
- Routes under `/tabs` in `router/index.ts`:
  - `simulate` → `SimulationHome.vue` (picker).
  - `simulate/:routingGroupId` → `Simulation.vue` (canvas + rail + results).

---

## Variation model & diff engine (Approach A+)

- **Baseline** = the live group config as loaded into `orderRoutingStore.currentGroup`, captured
  once as an immutable snapshot. It is never edited. Because the baseline *is* the live config, the
  top-level (shared) `simulationConfig` / `routingConfigDeltas` sent to the backend are empty — all
  changes live inside `variants[]`.
- **Variation** = a full snapshot of the group config taken when the user clicks "Save as
  variation". Stored with an id, a user-editable label, and the snapshot.
- **Sim-mode editing is gated to the delta vocabulary.** In `SimulationCanvas`, only edits that map
  to a known delta op are interactive; everything else is read-only:
  - **Parameter fields** (→ `parameterOverrides`): `distance`, `brokeringSafetyStock`,
    `weekOfSupplyFilterEnabled`, `weekOfSupplyThreshold`, `facilityGroupId`,
    `ignoreFacilityOrderLimit`, `facilityOrderLimitOverride`, `splitOrderItemGroup`,
    `assignmentEnumId`, `inventorySortByList`, `modelInventoryConsumption`, and the data-override
    maps (`minimumStockOverrides`, `inventoryCountOverrides`, `allowBrokeringOverrides`,
    `maximumOrderLimitOverrides`, `facilitiesToSimulateAtLimit`, `facilitiesToAddToGroup`,
    `facilitiesToRemoveFromGroup`).
  - **Structural ops** (→ `routingDeltas`): add / remove rule, set rule action, set rule inventory
    condition, set routing filter, reorder routing, reorder rule.
  - This bounds the diff problem completely — there is no editable field the diff cannot express,
    so nothing is silently dropped.

### `simulationDiff.ts`

Pure function, no UI coupling, fully unit-tested:

```
diff(baseline, snapshot) → { parameterOverrides: Partial<SimulationConfig>, routingDeltas: RoutingConfigDelta[] }
```

- **Parameters:** for each gated parameter field, if `snapshot[field] !== baseline[field]`, include it
  in `parameterOverrides`.
- **Routings / rules (matched by id):**
  - routing/rule present in snapshot but not baseline → `ADD_RULE` (new rules carry a temp client id
    in `ruleSeed`, never a real `routingRuleId`).
  - present in baseline but not snapshot → `REMOVE_RULE`.
  - same id, changed action → `SET_RULE_ACTION`; changed inventory condition → `SET_RULE_INV_COND`;
    changed routing filter → `SET_ROUTING_FILTER`.
  - changed order → `SET_ROUTING_SEQUENCE_NUM` / `SET_RULE_SEQUENCE_NUM`.
- A variation that diffs to an empty override + empty delta list is flagged in the UI as a no-op and
  excluded from submit (with a warning).

---

## Submit, batching & merge

1. For each variation, compute `variants[i] = { label, ...diff(baseline, snapshot) }`.
2. Drop no-op variations; warn the user.
3. Chunk `variants[]` into batches of ≤5.
4. For each batch: `POST …/brokeringSimulation/jobs` → `{ jobId }`; then poll
   `GET …/jobs/{jobId}` every 5–10s until `complete` / `failed` / `not_found`, with a long overall
   cap consistent with the 10+ minute group-run duration. Batches polled with limited concurrency.
5. **Merge** batch results: the `variation.baseline` is identical across batches → keep one; concat
   `variation.variants[]` in original order, preserving labels.
6. **Partial failure is tolerated:** a failed batch or a `variation.variants[i].failed` flag marks
   only those variations as failed; the rest still render.

---

## Run UX & results

### Progress

- After Submit the user **stays on the screen**. `SimulationProgress` shows each variation's state
  driven by real backend job status: **pending → submitted (have jobId) → running → done / failed**.
- No item-level sub-progress (backend does not stream it); a spinner + elapsed timer per running
  batch.
- Navigating away abandons the in-progress run (v1 non-goal to persist).

### Results (`SimulationResults.vue`)

Reads the merged `variation` envelope:

- **Scorecard:** baseline vs each variation — fill rate (`brokeredItemCount / attemptedItemCount`),
  brokered, queued (`queuedItemCount` — *not* the same as unrouted), unfillable counts. The winning
  variation (highest `brokeredItemCount`) is highlighted.
- **Drill-downs (expandable per variation):**
  - **Orders that changed outcome** — `diff.finalReasonTransitions` (e.g. `NO_INVENTORY → FILLED`,
    `FILLED → QUEUED`).
  - **Per-routing deltas** — `diff.routingBrokeredDelta` (`[baseline, variant]` counts).
  - **Per-facility deltas** — `diff.facilityAllocationDelta` (`[baseline, variant]` counts).

---

## Error handling

| Condition | Handling |
|---|---|
| Submit (`POST jobs`) non-2xx | Inline error on that batch; other batches proceed; offer retry of the failed batch. |
| Job `status: failed` | Mark batch failed, show `error`; other batches/variations unaffected. |
| Job `not_found` (expired) before completion | Surface "job expired, please re-run" for that batch. |
| Poll timeout (exceeds cap) | Mark batch timed out; allow re-run. |
| `simulationRan: false` in a result | Show "simulator unavailable — no numbers to report"; never fabricate. |
| `variation.partial: true` | Banner: some variants missing due to mid-run rollback. |
| No-op variation (empty diff) | Excluded from submit with a warning in the rail. |

---

## Testing

- **`simulationDiff.ts` (risk center):** parameter-only change; add rule; remove rule; reorder
  routings; reorder rules; change action / inventory condition / filter; no-op variation; multiple
  combined edits in one variation. (`node:assert` + `tsx`, per repo convention.)
- **Batching / merge:** N variations → correct batch count; baseline dedupe; label preservation;
  partial-failure handling.
- **`SimulationService`:** submit returns `jobId`; poll transitions running → complete; `failed`,
  `not_found`, and timeout paths.

---

## Open questions / assumptions

1. **Async group endpoint** — the submit/poll contract above is assumed and **must be confirmed or
   built by the backend team**. If they instead keep only the synchronous endpoint, the
   submit/poll path must be reworked (e.g. proxy the long blocking call through the circuit server).
2. **Flat body shape** — assumes the job endpoint accepts the same flat body the synchronous
   endpoint does (params promoted to root, `routingGroupId` in URL). Confirm with backend.
3. **Result envelope keys** — assumes `complete` jobs return `{ groupRun }` / `{ variation }`
   unchanged from the synchronous endpoint. If keys differ, only the result-reading code changes.
4. **`ruleSeed` shape for `ADD_RULE`** — the exact field map a new rule needs is defined by the
   backend; the diff engine assembles it from the canvas's new-rule state and passes it through.
