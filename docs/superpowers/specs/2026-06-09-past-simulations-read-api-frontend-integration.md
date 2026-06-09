# Frontend Integration — Past Simulations Read/Query API (backend-confirmed contract)

**Audience:** Frontend team (order-routing PWA)
**Owner:** Aditi Patel (aditi.patel@hotwax.co)
**Date:** 2026-06-09
**Status:** ✅ Implemented and verified end-to-end over HTTP (local). Fulfils the backend request
`2026-06-09-past-simulations-read-api-backend-request.md` (R1–R5). Unblocks the Phase-1 plan
`docs/superpowers/plans/2026-06-09-past-simulations-viewer-phase1.md`.

> This is the **authoritative contract** — supersedes the assumed shapes in the request/design
> docs. Typos in the original handoff (`vatSeqId`, `unt`) are corrected here to the real field
> names (`variantSeqId`, item `count`).

---

## 1. Endpoints

| Ref | Endpoint | Phase |
|---|---|---|
| **R1** | `GET /brokeringSimulations` | 1 — list |
| **R2** | `GET /brokeringSimulations/{simulationId}` | 1 — detail + variants |
| **R3** | `simulationId` already in the group-run poll completion envelope | 1 — deep-link (no change) |
| **R4** | `GET /brokeringSimulations/{simulationId}/variants/{variantSeqId}/items` | 2 — item table |
| **R5** | `GET /brokeringSimulations/{simulationId}/aggregates` | 2 — rollups |

## 2. Base URL, auth, conventions

- **Base URL:** `…/rest/s1/order-routing` (same `SIM_API_BASE_URL` the app already uses; UAT host
  `https://asb-sim-uat.hotwax.io/rest/s1/order-routing`). Also mirrored under `…/rest/s1/sim-routing/…`
  (identical) — FE pins to the `order-routing` prefix.
- **Auth:** unchanged (`api_key` header / session). Unauthenticated → **403**; **404** = wrong path.
- **Content type:** `application/json`.

## 3. Pagination

- Params: **`pageIndex`** (0-based, default `0`), **`pageSize`** (default `50`); offset = `pageIndex*pageSize`.
- Every paged response includes **`totalCount`** (Long). Pages = `ceil(totalCount / pageSize)`.

## 4. JSON fields are returned **parsed** (objects/arrays)

Bind to the parsed key; ignore the raw `*Json` string (still present for reference).

| Where | Parsed key (use) | Raw (ignore) |
|---|---|---|
| R2 header | `runOptions`, `config` | `runOptionsJson`, `configJson` |
| R2 variant | `diff`, `parameterOverrides`, `routingDeltas` | `diffJson`, `parameterOverridesJson`, `routingDeltasJson` |

Parsed key is `null`/`{}`/`[]` when the column was null/empty (baseline variant:
`parameterOverrides:{}`, `routingDeltas:[]`, `diff:null`).

## 5. Shapes

**R1** `GET /brokeringSimulations?productStoreId=&routingGroupId=&statusId=&runType=&fromDate=&thruDate=&pageIndex=0&pageSize=50`
- Filters optional, AND-combined; sort `createdDate` **desc**.
- Returns `{ simulationList: [...headers], totalCount }`.

```jsonc
{
  "simulationList": [{
    "simulationId": "M100051", "routingGroupId": "MORNING_ORDER_GROUP", "productStoreId": null,
    "runType": "VARIATION", "statusId": "COMPLETE",
    "attemptedItemCount": 0, "brokeredItemCount": 0, "queuedItemCount": 0,
    "durationMs": 655, "sampleSize": null, "sampleCap": 500,
    "simulationRan": "Y", "partial": "N", "sourceDescription": "simulation",
    "createdDate": 1780984319839     // epoch millis (Long)
  }],
  "totalCount": 12
}
```

**R2** `GET /brokeringSimulations/{simulationId}` → `{ simulation: {header + parsed runOptions/config}, variants: [...] }`
- Unknown id → `{ "simulation": null, "variants": [] }` at HTTP 200 (not 404).
- Variants ordered by `variantSeqId`; `SINGLE` runs carry one synthetic baseline
  (`variantSeqId:0, isBaseline:"Y", label:"baseline"`).

```jsonc
{
  "simulation": {
    "simulationId": "M100051", "routingGroupId": "MORNING_ORDER_GROUP",
    "runType": "VARIATION", "statusId": "COMPLETE", "durationMs": 655, "sampleCap": 500,
    "simulationRan": "Y", "partial": "N", "createdDate": 1780984319839,
    "runOptions": null, "config": null
  },
  "variants": [
    { "variantSeqId": 0, "label": "Baseline (live config)", "isBaseline": "Y", "failed": "N",
      "attemptedItemCount": 0, "brokeredItemCount": 0, "queuedItemCount": 0, "durationMs": 0,
      "parameterOverrides": {}, "routingDeltas": [] },
    { "variantSeqId": 1, "label": "1", "isBaseline": "N", "failed": "N",
      "attemptedItemCount": 0, "brokeredItemCount": 0, "queuedItemCount": 0,
      "diff": { "routingBrokeredDelta": { "STANDARD_ROUTING": [0,0] }, "finalReasonTransitions": {}, "facilityAllocationDelta": {} },
      "parameterOverrides": {}, "routingDeltas": [], "scenarioId": null, "scenarioVariantSeqId": null }
  ]
}
```

**R3** — `GET /routingGroups/{routingGroupId}/brokeringSimulation/jobs/{jobId}` returns
`simulationId` on completion (`null` when `persistResult:false` or persistence failed).

**R4** `GET /brokeringSimulations/{id}/variants/{variantSeqId}/items?facilityId=&finalReason=&orderId=&pageIndex=0&pageSize=50`
→ `{ itemList: [...], totalCount }`, ordered by `ruleResultSeqId`,`itemSeqId`. Item fields:
`itemSeqId, orderId, shipGroupSeqId, orderItemSeqId, productId, finalReason, facilityId, routedQty,
itemQty, distance` (lat/long null today — hide geo).

**R5** `GET /brokeringSimulations/{id}/aggregates[?variantSeqId=]` → `{ aggregates: [ per-variant ] }`:

```jsonc
{ "aggregates": [{
  "variantSeqId": 0,
  "byFinalReason": { "FULLY_BROKERED": 8, "QUEUED": 2 },
  "byFacility":   { "FAC_A": { "itemCount": 6, "routedQty": 9 } },
  "distance":     { "count": 6, "sum": 123.4, "avg": 20.5667 }   // null sum/avg when count=0
}]}
```

## 6. Header field reference

| Field | Type | Notes |
|---|---|---|
| `simulationId` | String | PK; R2/R4/R5 path + R3 deep-link. |
| `routingGroupId` | String | |
| `productStoreId` | String | May be `null` on older rows. |
| `runType` | String | `SINGLE` \| `VARIATION`. |
| `statusId` | String | `RUNNING` \| `COMPLETE` \| `FAILED`. |
| `attemptedItemCount`/`brokeredItemCount`/`queuedItemCount` | Integer | Run totals. |
| `durationMs`, `sampleSize`, `sampleCap` | Integer | |
| `simulationRan`, `partial` | `"Y"`/`"N"` | |
| `createdDate` | Long | **Epoch millis.** |

## 7. Backend status (2026-06-09)

R1–R5 verified locally over HTTP against `/rest/s1/order-routing/brokeringSimulations…` (real rows,
parsed-JSON shapes confirmed) + integration suite `SimulationReadServicesIntegrationSpec` (8/8).
**Not yet promoted to UAT** — confirm availability per environment before wiring CI.

## 8. Notes for the FE plan

- `outcomes` is **not** in R2 (variants carry counts + `diff` only). The richer outcome-metric
  panels render empty for past runs in Phase 1; they can be fed from R5 aggregates in Phase 2.
- `createdDate` is epoch millis — sort/format accordingly (the cache + list handle numeric epoch).
