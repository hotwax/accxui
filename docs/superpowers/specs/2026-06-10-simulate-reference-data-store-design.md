# Simulate-tab reference data: dedicated store isolation

**Date:** 2026-06-10
**Status:** Design approved
**Scope:** `apps/order-routing` (the Order Routing PWA)

## Problem

The simulation page runs against its own Moqui instance (the *sim* backend, `:8075`),
separate from the login OMS (`:8085`) the rest of the app talks to. Its rule editor
must show the reference data — facilities, facility groups, shipping methods, and
sales channels — that belongs to the **sim** instance.

Those reference slices live in two app-wide stores that every tab shares:

- `productStore`: `facilities`, `shippingMethods`, `facilityGroups`
- `utilStore.enums`: `ORDER_SALES_CHANNEL` (merged in via `fetchOmsEnums`)

A prior fix threaded an optional `baseURL` through `productStore`/`utilStore` so the
sim page could point those fetches at `:8075`. But because the stores are shared
in-memory across tabs, that created a cross-contamination window: whichever tab
loaded first won, and forcing sim data into the shared store could leak sim
reference data into the non-sim pages (and vice versa).

## Goal

Isolate the simulate tab's editor reference data into its own store so the two
backends never share state. The change must be **contained to the simulate tab** —
no behavior change for any other tab.

## Decision: dedicated `simReferenceStore` (Approach A)

A new Pinia store is the *only* sim-aware reference-data code. The simulate-tab
editor reads from it; `productStore`/`utilStore` revert to OMS-only.

Rejected alternatives:

- **B — extract shared fetcher helpers** used by both `productStore` and the sim
  store. Cleaner deduplication, but refactors `productStore`, adding risk to every
  non-sim page for ~30 lines of saved code.
- **C — keep `baseURL` threading + reset the shared store on page-leave.** Doesn't
  truly isolate (still one shared store) and leaves a contamination window.

A wins on isolation and the smallest blast radius. `SimulationCanvas` (imported only
by `views/Simulation.vue`, the Simulate tab) is the single consumer that changes.

## The store — `src/store/simReferenceStore.ts`

```
state:
  productStoreId: string         // which store the cached data is for
  facilities:      Record<string, any>
  facilityGroups:  Record<string, any>
  shippingMethods: Record<string, any>
  salesChannels:   Record<string, any>   // ORDER_SALES_CHANNEL enums

getters:
  getVirtualFacilities   // facilities filtered to parentTypeId === VIRTUAL_FACILITY (mirrors productStore)
  getShippingMethods
  getFacilityGroups
  getSalesChannels

action:
  fetchReferenceData({ productStoreId, force? })
```

`fetchReferenceData`:

- Caches by `productStoreId` — when the group's store is unchanged and data is
  loaded, it skips the refetch unless `force` is set.
- Fetches all four slices in parallel from the **sim Moqui** with
  `baseURL: simMoquiUrl()` (the bare `:8075` REST root):
  - `order-routing/facilities`
  - `order-routing/productStores/{id}/shippingMethods`
  - `order-routing/productStores/{id}/facilityGroups`
  - `order-routing/omsenums?enumTypeId=ORDER_SALES_CHANNEL`
- Reduces each response into the same keyed-map shape the existing stores use.

The fetch/reduce logic is inlined in the store action (small, self-contained) rather
than shared with `productStore`, to keep the non-sim pages untouched.

## `SimulationCanvas.vue` wiring

- `facilities` → `simRef.getVirtualFacilities`
- `shippingMethods` → `simRef.getShippingMethods`
- `facilityGroups` / `brokeringFacilityGroups` → `simRef.getFacilityGroups`
- New `salesChannels` computed → `simRef.getSalesChannels`; the three
  `enums['ORDER_SALES_CHANNEL']` reads (template lines ~189, ~198, and the
  `getOptionLabel` ternary ~1409) point at it instead.
- The existing `enums` computed (`utilStore`) **stays** — it still backs `getLabel`
  for `ORD_SORT_PARAM_TYPE` / `INV_SORT_PARAM_TYPE` labels, which are component-level
  config identical across instances.
- Mount load swaps `product.fetchRoutingReferenceData({ ...baseURL, force })` →
  `simRef.fetchReferenceData({ productStoreId })`. `utilStore.fetchStatusInformation()`
  stays (routing statuses are shared config).

## Out of scope (per scope decision: editor only)

The Circuit AI draft manifest (`buildBrokeringAgentSnapshot`) keeps reading the
shared `productStore`/`utilStore`. The assistant on the sim page reasons over OMS
reference data for now (or empty, on a fresh sim-tab load that never populated
`productStore`). No change to that path. Isolating Tier 2 is a possible follow-up.

## Revert of the prior interim fix

- `productStore`: remove the `baseURL` field from `ProductStoreReferenceDataPayload`
  and the `baseURL` pass-through in `fetchFacilities`, `fetchShippingMethods`,
  `fetchFacilityGroups`. Restore `fetchFacilities` to its original signature.
- `utilStore.fetchOmsEnums`: drop the `baseURL?` second parameter.
- **Kept:** the `simMoquiUrl()` helper in `SimulationService.ts` (the new store uses
  it) + its `tests/simMoquiUrl.test.ts` + the `.env.example` `VITE_SIM_URL` doc.

`productStore.fetchRoutingReferenceData` becomes unused after this change (the sim
page was its only caller); it reverts to its original form and is left in place
rather than deleted, to keep the `productStore` diff minimal.

## Testing

`tests/simReferenceStore.test.ts`, mirroring the existing store tests' mocked-`api`
pattern, asserting the isolation guarantee:

1. Every outbound fetch carries `baseURL === simMoquiUrl()` (never the OMS default).
2. The four keyed maps populate correctly from representative responses.
3. The `productStoreId` cache skips a redundant refetch for the same store, and
   `force` / a changed `productStoreId` triggers a refetch.

## Isolation invariant

After this change, the only module importing `simReferenceStore` is
`SimulationCanvas.vue`. No other tab's code path touches sim reference data, and the
simulate tab triggers no OMS reference fetch. This is the concrete meaning of
"isolated to the simulate tab."
