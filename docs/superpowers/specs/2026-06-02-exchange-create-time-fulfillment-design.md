# PWA Exchange — create-time fulfillment & skip-approval — Frontend Design

**Date:** 2026-06-02
**App:** `apps/returns`
**Backend prompt:** `2026-06-02-exchange-create-time-fulfillment-backend-prompt.md`
**Backend answers:** confirmed — `customerExchange` already accepts `fulfillmentType` + `facilityId` and
drives both halves to their terminal state in one call (no `/approve`), firing the Shopify push (and close,
for immediate) at create. The one gap is `shipmentMethodTypeId` (ignored server-side today; shipped ship
group hardcoded to `STANDARD`).

**Supersedes:** §0 of `2026-06-02-exchange-detail-backend-contract.md` and the fulfillment/approve parts of
`2026-06-02-exchange-detail-frontend-design.md`, which put the fulfillment decision at approve/complete.
This reverses that: fulfillment is chosen **at create time**, and the **approve step is removed for
exchanges**.

---

## 1. Goal

Move the exchange fulfillment decision to the **create page** and delete the approval step for exchanges.
The single create call drives the replacement to its terminal state:

| Mode | Operator picks | Return-half | Replacement order | Shopify (at create) |
|---|---|---|---|---|
| **Shipped** (default) | shipment method | `RETURN_APPROVED` | `ORDER_APPROVED` (ready for brokering) | exchange push (`returnCreate`+`returnProcess`) |
| **Immediate** | physical facility | `RETURN_COMPLETED` | `ORDER_COMPLETED` (issued from facility) | push **then** close (`returnProcess`+`returnClose`) |

There is no `RETURN_REQUESTED` resting state and **no Approve action** anywhere in the exchange UI.

## 2. Create form (`views/CreateReturn.vue`, exchange mode)

When `mode === "exchange"` and at least one line is picked, a **Fulfillment** card renders:

- **Fulfillment toggle** — `ion-segment` `Ship to customer` (`SHIPPED`, default) / `Hand over now`
  (`IMMEDIATE`). State: `exchangeFulfillment = ref<FulfillmentType>("SHIPPED")`.
- **Shipped → Shipment method** `ion-select` (required), options from `store.loadShipmentMethods()`.
  - **Honest note** (per backend gap): an inline `muted` line — *"Shipped exchanges currently ship
    Standard regardless of selection; more methods arrive when the backend lands."* The field is still
    submitted so it lights up automatically once the backend accepts it.
- **Immediate → Fulfillment facility** `ion-select` (required), options from `store.loadFacilities()`
  (physical only). Inline `muted` hint: *"Stock is issued from this facility now."*
- Methods + facilities load **lazily** the first time the operator switches to exchange mode (parallel,
  each guarded so one failure doesn't block the other — mirrors the appeasement-reasons pattern).
- `canSubmit` (exchange) = `hasItemsSelected && (exchangeFulfillment === "SHIPPED" ?
  !!selectedShipmentMethodTypeId : !!selectedFacilityId)`.
- `submit()` (exchange branch) builds `CreateExchangeInput` with `fulfillmentType` and the relevant id,
  then navigates to `/exchange-detail/:returnId` as today.

The appeasement card stays return-mode-only (unchanged). The old "fulfillment chosen later" comment block
is removed.

## 3. Types (`types/returns.ts`)

- `CreateExchangeInput` gains:
  ```ts
  fulfillmentType: FulfillmentType;        // required
  shipmentMethodTypeId?: string;           // required (client-side) when SHIPPED; ignored server-side until backend #1
  facilityId?: string;                     // required when IMMEDIATE
  ```
  Drop the "No fulfillmentType …" comment.
- New `ShipmentMethod { shipmentMethodTypeId: string; description: string }`.
- `ExchangeDetail` gains `shipmentMethod?: string` so the stub/detail can carry the real method label
  rather than inferring it from status.
- `FulfillmentType` ("IMMEDIATE" | "SHIPPED") already exists.

## 4. Service + adapters

**`ReturnsService.ts`**
- Add `listShipmentMethods(): Promise<ShipmentMethod[]>`.
- `completeReturn(returnId)` — drop the `facilityId?` param (exchanges no longer complete-with-facility; the
  store/views stop threading it). Plain-return completion is unaffected.

**`omsAdapter.ts`**
- `buildExchangeCreateBody` adds `fulfillmentType`, and `shipmentMethodTypeId` (when present) / `facilityId`
  (when present) — omitting whichever is absent.
- `createExchange` — endpoint unchanged (`POST oms/returns/customerExchange`); returns `{ returnId,
  replacementOrderId }`.
- `listShipmentMethods()` → `GET oms/shippingGateways/shipmentMethodTypes`, mapping rows to
  `{ shipmentMethodTypeId, description }` via a small pure mapper.
- `completeReturn` — remove the `facilityId` body; POST `oms/returns/{id}/complete` with no/empty body.
- `mapReplacementOrder` already reads `orderStatusId` / `shipmentMethod` / `fulfillmentType` — no change.

**`stubAdapter.ts`**
- `createExchange({ orderId, returnItems, exchangeItems, fulfillmentType, shipmentMethodTypeId, facilityId })`:
  - `IMMEDIATE`: return-half `RETURN_COMPLETED` (statuses `REQUESTED → COMPLETED`), replacement
    `ORDER_COMPLETED`; arm the exchange push **and** the close (`pushAttempted`, `pollsUntilSynced`,
    `closeAttempted`, `pollsUntilClosed`) so the detail polls both to settled.
  - `SHIPPED`: return-half `RETURN_APPROVED`, replacement `ORDER_APPROVED`; arm the exchange push only.
  - Store `fulfillmentType` + a `shipmentMethod` label (look up the chosen method's description; immediate →
    "Handed over in store") + `facilityId` on the exchange block.
- `listShipmentMethods()` → canned list (`STANDARD`/"Standard Shipping", `EXPRESS`/"Express", `NEXT_DAY`/
  "Next Day").
- `getReplacementOrder` — read `fulfillmentType` / `shipmentMethod` from the stored block instead of
  inferring from status; tracking code only for a `SHIPPED` (`ORDER_APPROVED`) order.
- `completeReturn(returnId)` — drop the `facilityId` param and the exchange "completable from REQUESTED"
  special case (exchanges no longer sit at REQUESTED). The exchange branches in `approveReturn` become dead
  for exchanges (kept for plain returns).

## 5. Store (`store/returnsStore.ts`)

- Add `loadShipmentMethods()` → `getReturnsService().listShipmentMethods()`.
- `submitExchange(input)` — passes the richer `CreateExchangeInput` through unchanged.
- `completeReturn(returnId, opts)` — drop the `facilityId` arg.
- `loadFacilities()` stays (now consumed by the create form, not the detail).

## 6. Exchange detail (`views/ExchangeDetail.vue`)

- **Remove:** the Approve button, the Complete button, the facility-picker `complete()` function,
  `canApprove`, `canComplete`, and the "syncs automatically when approved" hint.
- **Keep:**
  - Header / Returning section / Replacement panel (panel now shows the create-time
    `fulfillmentType` + `shipmentMethod`; tracking for shipped).
  - Shopify **sync card** + Retry (`retryExchangePush`) for a failed push.
  - **Actions card** gated on `canCancel` only — Cancel renders for a shipped `RETURN_APPROVED`; an
    immediate `RETURN_COMPLETED` shows no actions. (Reject is dropped: exchanges never sit at
    `RETURN_REQUESTED` now.)
  - **Completion/close card** (read-only state + Retry) for the immediate case (`isCompleted`).
- `enter()` still polls a `pending` push and, when completed, a `pending` close.

## 7. Tests

- `CreateReturn.spec`: exchange submit blocked until a method (shipped) / facility (immediate) is chosen;
  `submitExchange` called with `fulfillmentType` + the right id; the honest note renders for shipped.
- `omsAdapter.spec`: `buildExchangeCreateBody` includes `fulfillmentType` + method/facility (and omits the
  absent one); `listShipmentMethods` maps `shippingGateways/shipmentMethodTypes`; `completeReturn` sends no
  facility.
- `returnsStoreCrud.spec`: `loadShipmentMethods`; `submitExchange` passthrough; `completeReturn` new arity.
- `stubAdapter.spec`: immediate create → both halves terminal + push & close armed; shipped → both approved
  + push armed; `getReplacementOrder` reflects stored method/fulfillment.
- `ExchangeDetail` unit: no Approve/Complete buttons; Cancel shows for shipped, hidden for immediate;
  immediate shows completed + close state; sync chip reads "Exchange confirmed".
- `exchange-happy-path.cy.ts` (e2e): drive the new create form (toggle + method/facility), assert no approve
  step and that shipped lands approved / immediate lands completed.

## 8. i18n (`locales/en.json`)

Add: fulfillment toggle labels ("Ship to customer", "Hand over now"), "Shipment method",
"Fulfillment facility", the shipped-Standard honest note, the immediate facility hint, and any new
validation copy. Remove now-dead approve-related exchange strings.

## 9. Definition of done

- Create form collects fulfillment type + method (shipped) / facility (immediate) and submits them; create
  navigates to the exchange detail.
- Exchange detail has no Approve/Complete; Cancel for shipped, read-only sync/close + Retry otherwise.
- Replacement panel reflects create-time fulfillment + method; immediate shows completed, shipped shows
  approved + tracking.
- `shipmentMethodTypeId` is submitted (ignored server-side until backend #1) with the honest note shown.
- Stub demos shipped + immediate end to end; unit tests green; `vue-tsc` clean for changed files.

## 10. Known backend gap (tracked, not blocking)

`customerExchange` ignores `shipmentMethodTypeId` today and ships shipped exchanges as `STANDARD`. The PWA
wires the picker and submits the field now (with the honest note); it lights up automatically when the
backend threads the field through. Wrong-companion-field rejection (method on immediate / facility on
shipped) is not enforced server-side — the client's required-field validation is the guard. API errors are
4xx message strings (no per-field codes); `describeApiError` already handles that.
</content>
