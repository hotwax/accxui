# Backend Prompt — Exchange create-time fulfillment & skip-approval

**Date:** 2026-06-02
**Requested by:** PWA returns app (`apps/returns`)
**Type:** Behavioral change to the exchange create flow + one new read endpoint
**Supersedes:** the create-time fulfillment section (§0) of
`2026-06-02-exchange-detail-backend-contract.md`, which moved fulfillment *off* create time.
We are reversing that: fulfillment is chosen **at create time** again, and the **approval step for
exchanges is removed entirely**.

> **Goal of this doc:** tell us **what already exists**, **what needs to change**, and **what is net-new**
> for the contract below. Please answer the "Questions for backend" at the end inline.

---

## The new flow (what the PWA will do)

On the create page the operator now picks, per exchange:

- **Fulfillment type** — `SHIPPED` (ship the replacement to the customer) or `IMMEDIATE` (hand it over now,
  in-store / POS-style).
- **Shipment method** — required **only for `SHIPPED`** (used to build the replacement order's ship group).
- **Physical facility** — required **only for `IMMEDIATE`** (the origin facility the ship group is
  created from / fulfilled from on the spot).

The single **create** call then drives the replacement order to its terminal state immediately — there is
**no separate approve call** for an exchange:

| Fulfillment | Return-half status | Replacement order status | Notes |
|---|---|---|---|
| `SHIPPED`    | `RETURN_APPROVED`   | `ORDER_APPROVED`   | Replacement is **ready for brokering** (normal shipped fulfillment). Items awaited back. |
| `IMMEDIATE`  | `RETURN_COMPLETED`  | `ORDER_COMPLETED`  | Ship group created from the chosen facility and **completed** on the spot. |

**Approval is skipped for both halves.** The replacement order is **never** created at `_NA_` /
`ORDER_CREATED`, and the PWA will **not** call `POST /oms/returns/{id}/approve` for an exchange.

The Shopify exchange push (`returnCreate` + `returnProcess` → `PROC_OK` = "Exchange confirmed") should be
triggered **as part of create** now (it used to be owned by the approve SECA). For `IMMEDIATE`, since the
return-half is completed at create, the Shopify **close** (`returnProcess` + `returnClose`) should also run
as part of create. The PWA already polls both states (`shopifySync.processStatusId`,
`shopifySync.closePushStatusId`) and offers a Retry — no contract change there, just timing.

---

## Proposed contract

### 1. `POST /oms/returns/customerExchange` — accept fulfillment at create time (CHANGE)

Request body adds three fields (existing `orderId` / `returnItems` / `exchangeItems` / `note` /
`currencyUomId` unchanged):

```jsonc
{
  "orderId": "...",
  "returnItems":   [{ "orderItemSeqId": "...", "returnQuantity": 1, "returnReasonId": "..." }],
  "exchangeItems": [{ "productId": "...", "quantity": 1 }],   // unitPrice omitted = even swap
  "currencyUomId": "USD",

  "fulfillmentType":     "SHIPPED",          // NEW — "SHIPPED" | "IMMEDIATE"
  "shipmentMethodTypeId": "STANDARD",        // NEW — required when fulfillmentType == SHIPPED
  "facilityId":           "STORE_DT"         // NEW — required when fulfillmentType == IMMEDIATE
}
```

Behavior by `fulfillmentType`, as in the table above:
- `SHIPPED`: create the replacement order with the given `shipmentMethodTypeId` ship group →
  `ORDER_APPROVED` (ready for brokering); return-half → `RETURN_APPROVED`.
- `IMMEDIATE`: create the ship group from `facilityId` and complete it → `ORDER_COMPLETED`; return-half →
  `RETURN_COMPLETED`.
- Trigger the Shopify exchange push at create (and the close too, for `IMMEDIATE`).

Response unchanged: `{ "returnId": "...", "replacementOrderId": "..." }`.

### 2. `GET /oms/shipmentMethods` — list shipment methods (NEW read endpoint)

For the create-page **Shipment method** picker (shown for `SHIPPED`). Needs, per row, an id the create call
accepts as `shipmentMethodTypeId` and a human label:

```jsonc
{ "shipmentMethods": [ { "shipmentMethodTypeId": "STANDARD", "description": "Standard Shipping" }, … ] }
```

If these already exist under a different path/shape (e.g. `carrierShipmentMethod`, or scoped to a
carrier/facility), tell us the real endpoint + field names and we'll map to them.

### 3. `GET /oms/facilities` — physical facilities (NO CHANGE expected)

Already used; the PWA lists **physical** facilities (excludes virtual) for the `IMMEDIATE` picker, reading
`facilityId` + `facilityName`. Just confirm those fields are present.

### 4. `POST /oms/returns/{id}/approve` — no longer called for exchanges

The PWA stops calling approve for exchanges. No backend change required, but confirm nothing downstream
depends on the PWA approving an exchange (the replacement is already `ORDER_APPROVED`/`ORDER_COMPLETED`).

### 5. `POST /oms/returns/{id}/complete` — facilityId no longer sent for exchanges

The previous contract had complete accept `{ "facilityId": … }` to fulfill the replacement. That moves to
create. The PWA will no longer send a facility on complete, and will not drive complete for exchanges from
the detail screen at all. Confirm complete with an empty/unchanged body is still fine for plain returns.

---

## Unchanged / already working (please just confirm)

- `GET /oms/returns/{id}` still marks an exchange on `shopifySync` (`isExchange`, `replacementOrderId`) and
  the return-half `statusId` now reflects `RETURN_APPROVED`/`RETURN_COMPLETED` at create.
- `GET /oms/returns` list rows still carry `isExchange` (for list routing).
- `GET /oms/orders/{replacementOrderId}` still exposes `orderStatusId`, `orderDate`, `grandTotal`,
  `shipmentMethod`, and (for shipped) `trackingCode`/`carrierPartyId` — now populated at create rather than
  at approve/complete.

---

## Questions for backend (answer inline)

1. **Create call:** can `customerExchange` accept `fulfillmentType` + `shipmentMethodTypeId` + `facilityId`
   and drive the replacement to `ORDER_APPROVED` (shipped) / `ORDER_COMPLETED` (immediate) in one call?
   Or do we need a distinct endpoint / a follow-up call?
2. **Return-half status:** can the return-half be created directly in `RETURN_APPROVED` (shipped) /
   `RETURN_COMPLETED` (immediate), skipping `RETURN_REQUESTED`/approve?
3. **Shopify timing:** can the exchange push (`returnProcess` → `PROC_OK`) — and the close, for immediate —
   be triggered at create instead of at approve/complete?
4. **Shipment methods:** is there an endpoint that returns selectable shipment methods with a
   `shipmentMethodTypeId` (or equivalent) the create call accepts? What's the path/shape, and is it scoped
   (carrier / facility / product store)?
5. **Facility for immediate:** is `facilityId` from `GET /oms/facilities` the right identifier to create +
   complete the ship group from? Any constraint (must be physical / non-virtual / inventory-bearing)?
6. **Validation:** if `fulfillmentType` is missing, or the wrong companion field is sent (method on
   immediate, facility on shipped), should create reject — and with what error shape?
7. **Even swap / credit:** does create-time completion (immediate) change anything about the refund-
   difference handling vs. the previous flow?

---

## Out of scope (unchanged from prior doc)

The "immediate exchange leaves an OPEN return in Shopify" report (order `6775241670700`) remains a separate
investigation and does not block this change.
</content>
</invoke>
