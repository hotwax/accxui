# Per-routing run-result drill-down — variation Results tab

**Date:** 2026-06-12
**Repo:** `accxui/apps/order-routing` (nested repo, branch `feat/simulation-outcome-metrics`)
**Status:** Approved design

## 1. Problem

The "Per-routing results" list on the variation Results tab shows only aggregate
counts per routing (Eligible / Brokered / Queued, parent → variation). Users
cannot see *what happened* inside a routing: which facilities orders were
brokered to, what was queued, or why an order ended where it did.

The variation simulation response already carries this detail —
`routingResults[].orderTraces[]` (order → final assignments → rule attempts) —
but the frontend types it as `any[]` and never renders it.

## 2. Scope

- **In:** clickable per-routing rows on the **variation Results tab only**
  (the parent → variation compare view rendered by `SimulationResults.vue`).
- **Out:** live batch-run results view, past/saved simulation detail pages
  (persisted runs don't expose traces until the Phase 2 read API R4/R5).
- **Data gaps handled by spec, not code:** shipping cost per routing/facility
  and product IDs/names are not in today's payload. Build with what exists;
  request the rest from backend (§7).

## 3. Available data (verified against backend serializer)

Source of truth: `ImpactPayloadSerializer.groovy` in the `sim-routing` Moqui
component (brokering-simulation repo). Each `RoutingRunResult` carries:

```
orderTraces[]: {
  orderId, shipGroupSeqId, orderItemSeqId,
  finalReason: FULLY_BROKERED | PARTIALLY_BROKERED | QUEUED | NO_INVENTORY | ERROR,
  finalAssignments[]: { orderId, orderItemSeqId, shipGroupSeqId, facilityId, routedQty, itemQty },
  ruleAttempts[]: { routingRuleId, sequenceNum, durationMs,
                    suggestedFulfillmentLocations, actionFilters,
                    outcome, runNextRule, errorMessage }
}
```

The variation run endpoint (`POST /variations/{vid}/simulation`) returns this
tree unstripped. Facility names resolve client-side from
`simReferenceStore.facilities[facilityId]` (already fetched from the sim Moqui,
keyed by facilityId); fall back to the raw ID.

**Not available per routing:** shipping cost (group-level only, in
`outcomes.cost`) and productId/productName (assignments carry only
`orderItemSeqId`).

## 4. Design

### 4.1 Data layer (no new API calls)

**Type the traces.** In `src/types/variation.ts`, replace
`orderTraces?: any[]` on `RoutingRunResult` with interfaces matching §3:
`OrderTrace`, `OrderAssignment`, `RuleAttempt`, plus a `FinalReason` union.
Fields stay optional-tolerant (older payloads may omit traces).

**New pure util `src/util/traceRollup.ts`.** All derivation logic lives here,
testable without Vue:

- `outcomeCounts(traces)` → `Record<FinalReason, number>`
- `facilityRollup(traces)` → `[{ facilityId, itemCount, totalRoutedQty }]`
- `compareFacilities(parentTraces, variationTraces)` →
  `[{ facilityId, parentQty, variationQty, delta }]`, sorted by variation
  count desc
- `queuedDiff(parentTraces, variationTraces)` → variation's queued order
  items, each flagged `newlyQueued` when the parent did not queue the same
  order item

All functions accept `undefined`/empty trace arrays and return empty results.

### 4.2 UI

**`src/components/simulation/RoutingRunDetailModal.vue`** (new `ion-modal`,
matching existing modal patterns such as `EditGroupModal.vue`). Opened from
`SimulationResults.vue`: each per-routing row becomes an `ion-item` with
`button` + detail chevron; click passes the row's `CompareRow` to the modal.

Sections, top to bottom:

1. **Summary** — Eligible / Brokered / Queued as `parent → variation`, same
   numbers as the list row, restated as a header card.
2. **Outcomes** — `finalReason` breakdown with deltas, e.g.
   "Fully brokered 0 → 120 · Queued 0 → 19 · No inventory 0 → 0".
3. **Facilities brokered** — table: facility name | parent items |
   variation items | delta, from `compareFacilities()`.
4. **Queued orders** — order + item IDs queued in the variation, with a
   "newly queued" badge from `queuedDiff()`.
5. **Per-order outcomes** — searchable list (filter by orderId substring),
   first 50 rows rendered with a "load more" increment of 50. Each row expands
   to show its `ruleAttempts` chain in plain English (e.g. "Rule 2: no
   suggested locations — fell through. Rule 3: routed to WH-NYC") and its
   final assignments.
6. **Cost note** — one muted line stating shipping cost is currently
   group-level only (visible on the outcomes dashboard); per-routing cost
   arrives with the backend enrichment (§7).

### 4.3 Edge cases

- **One-sided rows** (routing exists only in parent or only in variation):
  single-column view with a "not present in parent/variation" note; compare
  columns and deltas are suppressed.
- **Missing/empty `orderTraces`:** sections 2–5 degrade to a single
  "Per-order detail not available for this run" line; the summary card still
  renders from the aggregate counts.
- **Zero-eligible rows** stay clickable and open straight to the
  "filter matched nothing" explanation already used in the list signal line.
- **Unknown facilityId** (not in `simReferenceStore`): render the raw ID.

## 5. Components and boundaries

| Unit | Purpose | Depends on |
|---|---|---|
| `util/traceRollup.ts` | Pure trace → rollup derivations | `types/variation.ts` only |
| `RoutingRunDetailModal.vue` | Render one `CompareRow`'s detail | traceRollup, simReferenceStore, `@common` translate/format |
| `SimulationResults.vue` (edit) | Make rows clickable, host modal | existing store state (`variationCompareRows`) |
| `types/variation.ts` (edit) | Real trace types | — |

No store changes: the modal reads the `CompareRow` it is given and the
already-loaded reference data.

## 6. Testing

- `tests/traceRollup.test.ts` — covers all four rollup functions, including
  empty/undefined traces, one-sided rows, multi-assignment traces, and
  newly-queued flagging. Run with `npx tsx tests/traceRollup.test.ts`.
- Verification: `npm run build` plus `npx tsx tests/*.test.ts`.
  Do **not** run `npm run lint` (known broken in this repo: crashes and
  `--fix`es the whole tree).

## 7. Backend request (separate doc, no frontend code)

Write `docs/superpowers/specs/2026-06-12-trace-enrichment-backend-request.md`
asking the sim-routing component to add to each `OrderAssignment`:

- `productId` (and optionally `productName`) — enables "products brokered"
- `estShippingCost` (estimated per-assignment shipping cost) — enables
  per-routing and per-facility cost rollups and avg cost per order

The modal gains a "Products brokered" section and real cost columns when the
fields land; until then the UI degrades as described in §4.2 item 6.

## 8. Out of scope / future

- Per-routing drill-down on live batch runs and past simulations (needs R4/R5).
- Exporting the per-order table.
- Charting facility allocation shifts (the `diff.facilityAllocationDelta`
  already exists group-level; a future panel could visualize it).
