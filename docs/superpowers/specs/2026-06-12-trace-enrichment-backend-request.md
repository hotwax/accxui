# Backend request: enrich group-run order traces for the routing drill-down

**Date:** 2026-06-12
**Requesting app:** `accxui/apps/order-routing` (variation Results tab drill-down)
**Target:** `sim-routing` Moqui component — `ImpactPayloadSerializer.groovy` / `OrderAssignment`
**Related:** docs/superpowers/specs/2026-06-12-routing-run-detail-drilldown-design.md

## What we need

Two additions to each `OrderAssignment` emitted in
`groupRun -> routingResults[] -> orderTraces[] -> finalAssignments[]`:

| Field | Type | Purpose |
|---|---|---|
| `productId` | String | "Products brokered" section in the per-routing drill-down modal |
| `productName` | String (optional, nice-to-have) | Avoids a client-side product lookup against the sim instance |
| `estShippingCost` | BigDecimal | Per-routing and per-facility shipping-cost rollups; avg cost per order |

`estShippingCost` should be the same estimate the simulator already uses for the
group-level `outcomes.cost.totalShippingCost`, attributed per assignment. If only a
per-shipGroup estimate exists, attributing it to the first assignment of the ship
group is acceptable — the frontend sums per facility/routing, so attribution
granularity matters less than the total being consistent with `outcomes.cost`.

## Where

- Serializer: `ImpactPayloadSerializer.assignmentToMap()` — add the three fields.
- Surfaces that must carry them: the variation run response
  (`POST /variations/{vid}/simulation` -> `groupRunResult`) and the persisted
  `impactPayloadJson` (so the Phase 2 R4 items endpoint inherits them).

## Compatibility

Additive, optional fields — the frontend types them optional and degrades to the
current behavior (no products section, group-level-only cost note) when absent.
No version gate needed.

## Frontend follow-up once delivered

- Add `productId` / `productName` / `estShippingCost` to `OrderAssignment` in
  `src/types/variation.ts`.
- New `traceRollup` functions: `productRollup(traces)` and cost sums in
  `facilityRollup` / `compareFacilities`.
- Modal gains a "Products brokered" section; the facilities table gains a cost
  column; the cost note is replaced by real per-routing numbers.
