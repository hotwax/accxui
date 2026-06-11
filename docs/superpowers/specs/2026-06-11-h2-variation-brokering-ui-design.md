# H2 variation brokering UI — design

**Date:** 2026-06-11
**Status:** approved, ready for implementation plan
**Backend contract:** sim-routing component, base path `/rest/s1/sim-routing` (sim instance —
`http://localhost:8075` local, `https://asb-sim-uat.hotwax.io` deployed). Backend implemented and
verified end-to-end (clone → edit → run → results), 2026-06-11.

---

## 1. Goal and the core shift

A **variation** is an editable, what-if copy of a routing group that lives entirely in the sim's H2
database (`SIMVAR` schema). The user clones a real (MySQL-synced) routing group, edits the copy — down
to the rule level — and runs a brokering simulation against the copy. The real config is never touched.
"What you edit is exactly what runs," which fixes the long-standing confusion where editing routing
config in the OMS UI did not affect the sim (the sim reads a separate, 15-minute-synced mirror).

This **replaces** the existing client-side simulation flow rather than running alongside it. The two
mechanisms target the same user goal but differ fundamentally:

| | Existing (retired) | New (this design) |
|---|---|---|
| Edit target | local `working` clone | server-side H2 variation |
| Persistence | diff computed at submit (`simulationDiff`/`simulationBatch`) | immediate REST write per node |
| "variation" | in-memory snapshot | sim-only group `VM…` with re-keyed ids |
| Run | async batch of baseline + N variants | one variation, synchronous |
| Results | baseline-vs-N-variants on cost/SLA/fill-rate | per-routing counts, variation vs parent |

Key facts the UI must respect:

- The **parent group id** (e.g. `100001`) is a real, MySQL-synced group. The **variation group id**
  (e.g. `VM100204`) is a new, sim-only object. They are different objects.
- **Variation ids are re-keyed and prefixed.** Parent routing `100008` becomes `VM100204_100008`.
  Always use the ids returned by `GET /variations/{id}` for edit calls — never the parent's ids.
  Re-keyed ids are internal; display the human `routingName`.
- Nothing is ever written to MySQL. Variation state survives the 15-minute mirror sync; it is only
  lost on a full sim DB reset.
- Only `ROUTING_ACTIVE` routings — and within them `RULE_ACTIVE` rules — run in a simulation.
- A condition with `operator: null, fieldValue: null` is an **unset placeholder** the engine ignores —
  render it as an empty/optional row, not an active constraint.

---

## 2. Editable surface (the contract)

`GET /variations/{id}` returns the whole tree; every node has edit endpoints. Two layers, two meanings —
both surfaced in the UI:

- **Filters** (on a routing) decide *which orders* the routing considers (sales channel, facility,
  shipment method, …).
- **Rules** (+ their inventory conditions and actions) decide *how the routing brokers* the orders it
  gets — facility selection/ranking, safety stock, queue/cancel behaviour.

```
routing            → toggle status (active/draft/archived) + sequence
  ├─ filter        → add / edit / remove scope filters
  └─ rule          → toggle status + sequence
       ├─ inventoryCondition → add / edit / remove (ENTCT_FILTER narrows, ENTCT_SORT_BY orders)
       └─ action            → add / edit / remove (ORA_NEXT_RULE, ORA_MV_TO_QUEUE, …)
```

All writes hit SIMVAR only and are immediate (no save step, no cross-edit transaction).

---

## 3. Config / wiring (section A)

- Add `simRoutingApiBaseUrl(env = import.meta.env)` to `SimulationService.ts`, reading a new env
  `VITE_SIM_ROUTING_API_BASE_URL`, defaulting to the same sim host with `/rest/s1/sim-routing`. Add the
  var to `.env.example`.
- Auth is unchanged: all variation calls go through the existing `simApi({ baseURL:
  simRoutingApiBaseUrl(), … })`. Two-instance mode attaches the api_key; single-instance uses the OMS
  Bearer. Login stays on `order-routing/login` (`SimAuthService`, unchanged).
- `sim-routing` is on the **same host** as `VITE_SIM_URL`, so the api_key is valid there and the
  existing `sameOrigin` cross-host guard in `simApi()` already covers the split-brain misconfig.

---

## 4. Data layer (section B)

### 4.1 `VariationService.ts` (new) — one function per endpoint

All via `simApi({ baseURL: simRoutingApiBaseUrl() })`. `BASE` below = `/rest/s1/sim-routing`.

| Function | Method + path | Body |
|---|---|---|
| `listVariations(parentId)` | `GET {BASE}/variations?parentRoutingGroupId=` | — |
| `createVariation(parentId, name?)` | `POST {BASE}/routingGroups/{parentId}/variations` | `{ variationName? }` → `{ variationGroupId }` |
| `getVariation(vid)` | `GET {BASE}/variations/{vid}` | — → `{ variation }` |
| `setRouting(vid, rid, patch)` | `PUT {BASE}/variations/{vid}/routings/{rid}` | `{ statusId?, sequenceNum? }` |
| `upsertFilter(vid, rid, cond)` | `POST {BASE}/variations/{vid}/routings/{rid}/filters` | `{ conditionSeqId, fieldName, operator, fieldValue, sequenceNum, conditionTypeEnumId? }` |
| `deleteFilter(vid, rid, seqId)` | `DELETE {BASE}/variations/{vid}/routings/{rid}/filters/{seqId}` | — |
| `setRule(vid, rid, ruleId, patch)` | `PUT {BASE}/…/rules/{ruleId}` | `{ statusId?, sequenceNum? }` |
| `upsertInventoryCondition(vid, rid, ruleId, cond)` | `POST {BASE}/…/rules/{ruleId}/inventoryConditions` | `{ conditionSeqId, conditionTypeEnumId?, fieldName, operator, fieldValue, sequenceNum }` |
| `deleteInventoryCondition(vid, rid, ruleId, seqId)` | `DELETE {BASE}/…/rules/{ruleId}/inventoryConditions/{seqId}` | — |
| `upsertAction(vid, rid, ruleId, action)` | `POST {BASE}/…/rules/{ruleId}/actions` | `{ actionSeqId, actionTypeEnumId, actionValue }` |
| `deleteAction(vid, rid, ruleId, seqId)` | `DELETE {BASE}/…/rules/{ruleId}/actions/{seqId}` | — |
| `runVariation(vid, sampleCap?)` | `POST {BASE}/variations/{vid}/simulation` | `{ sampleCap? }` → `GroupRunResult` (synchronous, ~25–150s) |

Upsert is keyed by `(orderRoutingId, conditionSeqId)` for filters/conditions and
`(ruleId, actionSeqId)` for actions: same seqId updates, new seqId inserts. `conditionTypeEnumId`
defaults to `ENTCT_FILTER` when unset. The run is **synchronous** — call with a long client timeout
(≥180s) as a cancelable background request. If a posted `fieldName` can't be mapped to a scope column
the run returns an error (not a silent ignore) — surface it.

### 4.2 `variationAdapter.ts` (new, pure, unit-tested)

The single seam between the variation contract and the canvas's expected shape.

- **Inbound** (`GET` tree → canvas model): rename `filters` → `orderFilters`,
  `inventoryConditions` → `inventoryFilters`, keep `actions`; sort by `sequenceNum`; mirror
  `normalizeRoutingGroupHierarchy`'s exclusion rewrite (operator `not-equals`/`not-in` →
  `fieldName_excluded`) and placeholder handling (`operator: null` rows render as empty/optional).
- **Outbound** (canvas edit intent → REST payload): reverse the rename + `_excluded` rewrite, and
  select the correct `VariationService` call. Edits always use the re-keyed ids from the loaded tree.

### 4.3 `variationStore.ts` (new, Pinia 3 setup-style) — replaces `simulationStore`

State: parent group list (reuse `fetchRoutingGroupsList`), `variations` for the selected parent, the
open variation tree, a per-node save status map (`saving | saved | error`), run state (variation run +
cached parent run), and comparison results.

Edits are **optimistic**: update the local tree → fire the REST write → on error revert the node and
toast. No dirty/"Save" concept — each change persists immediately. Re-`GET` on demand (e.g. a manual
refresh) to resync.

---

## 5. Editor (section C)

Reuse `SimulationCanvas`'s presentation (it already renders routings → filters → rules → inventory
conditions + actions in Ionic). Refactor it to:

- Be driven by `variationStore`'s adapted tree instead of `simulationStore.working`.
- Emit **edit intents** (toggle routing, reorder, upsert/remove filter, toggle rule, upsert/remove
  inventory condition, upsert/remove action) that the store turns into immediate REST writes via the
  adapter. Remove the local-clone mutation + flush-on-switch behaviour.
- Show a small per-row saving indicator; no global Save button or dirty badge.

Filter / inventory-condition **value inputs** reuse `simReferenceStore` dropdowns where data exists
(facilities, facility groups, shipment methods, sales channels — matching the §field reference below),
free-text otherwise.

**Field reference (filter `fieldName` values):**

| fieldName | example values |
|---|---|
| `salesChannelEnumId` | `POS_SALES_CHANNEL`, `WEB_SALES_CHANNEL`, `EXCHG_SALES_CHANNEL`, `TIKTOK_SALES_CH`, `CSR_SALES_CHANNEL` |
| `facilityId` | `_NA_`, `BACKORDER_PARKING`, `PRE_ORDER_PARKING`, `REJECTED_ITM_PARKING`, `HC_QUEUE`, `UNFILLABLE_PARKING` |
| `shipmentMethodTypeId` | `STANDARD`, `SECOND_DAY`, `NEXT_DAY` |
| `originFacilityGroupId` | a facility-group id, e.g. `M3_FAC` |
| `productCategoryId`, `orderDate`, `priority`, `deliveryDays` | (used by some routings) |

`operator` is typically `equals` or `in` (for `in`, `fieldValue` is a comma-separated list).

---

## 6. Run + compare (section D)

"Run comparison" fires two runs concurrently:

- **Variation** — `POST /variations/{vid}/simulation` (synchronous, ~25–150s). No progress stream, so
  show **indeterminate** progress + an elapsed timer, cancelable.
- **Parent** live-config — the existing async job endpoint
  (`routingGroups/{parentId}/brokeringSimulation/jobs` + `pollJob`), submitted as a single no-op
  baseline variant; its `groupRun` carries the parent `routingResults`. This path **streams events**,
  so it shows a real progress bar.

Both return `routingResults[]` of the same shape. **Join per-routing by `routingName`** (fallback:
strip the `VM…_` prefix from the variation id and match the suffix to the parent id). Results view = a
side-by-side per-routing table: parent vs variation `eligibleEntryCount` / `attemptedItemCount` /
`brokeredItemCount` / `queuedItemCount`, with **eligible** featured prominently as the "did my filter
edit take effect" signal. Distinguish in the UI:

- **0 eligible** — the filter matched nothing (scope problem).
- **N eligible, 0 brokered** — no available inventory at candidate facilities (a valid outcome, not an
  error).

The **parent run is cached per parent group for the session** (it's stable — the real synced config)
with a manual "re-run parent" control, so iterating on a variation doesn't re-run the slow parent each
time. If the parent run fails, still render the variation-only column.

Runs persist and appear in the Past Simulations read API tagged with a non-null `variationGroupId`
(§3.9 of the contract). No new read plumbing is needed there.

---

## 7. Views & routing (section E)

- **`/simulate`** → `SimulationHome`: pick a parent group (sim group list), then list that group's
  variations (`listVariations(parentId)`, newest first) with a **"New variation"** action
  (`createVariation` → `getVariation`). Keep the existing "Past simulations" tab.
- **`/simulate/variation/:variationGroupId`** → editor + run/compare (replaces
  `/simulate/:routingGroupId`). On mount: `getVariation(vid)`.
- **`/simulate/history/:simulationId`** → keep the existing detail view; it already understands
  `variationGroupId` on the run header.
- `simulateGuard` feature flag unchanged.

---

## 8. Retirement (section F)

Removed **only after** the new path is green and a grep confirms no remaining importers (per the
standing deletion-caution rule — verify with tests + grep before deleting):

- `simulationStore.ts`, `simulationDiff.ts`, `simulationBatch.ts`, and their tests (diff/batch gone).
- Comparison-only result panels with no data source in the new contract: `OutcomeHeadline`,
  `TradeoffChart`, `CompositeScorePanel`, `ExpeditedPanel`, `FulfillmentMixPanel`, `StockoutPanel`,
  and the cost/SLA helpers in `outcomes.ts`.
- `VariationRail` (client-side snapshot picker) → replaced by the server-variation list on
  `SimulationHome`.
- **Scalar parameter overrides** (distance, safety stock, week-of-supply, etc. from the old
  `SimulationConfig`) are dropped — the variation contract doesn't model them; the what-if is expressed
  entirely through the routing tree + `sampleCap`.

**Kept:** `pollJob`/`submitBatch` (now power the parent live-config run), `pastSimulationStore`,
`simReferenceStore`, `SimulationProgress` (parent-run progress), `persistedSimulationAdapter`.

---

## 9. Testing (section G)

Pure unit tests in `tests/*.test.ts` (`node:assert`, runnable with `npx tsx`, matching the existing
convention — no new Jest wiring per CLAUDE.md):

- `variationAdapter` — both directions, including `_excluded` rewrite and `operator: null` placeholder
  handling.
- Per-routing **parent ↔ variation join** (by name, with id-suffix fallback).
- `VariationService` URL + payload builders (pure helpers, mocking `@common`'s `simApi`).

---

## 10. Known API-fit gaps (surfaced in-UI, not blocking)

- **No async variation run** — synchronous run gets indeterminate progress; leave a code comment to
  swap to submit/poll if the backend adds a job variant.
- **No delete-variation endpoint** — no delete affordance; variations accumulate. Short note in the
  variation list.
- **`clone` returns only the id** — one `GET` round-trip after create (already in the flow).
