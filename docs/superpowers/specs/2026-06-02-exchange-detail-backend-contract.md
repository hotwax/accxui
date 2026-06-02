# Backend Prompt — PWA Exchange Detail screen contract

**Date:** 2026-06-02
**Requested by:** PWA returns app (`apps/returns`)
**Type:** Additive REST contract changes (no breaking changes)

The PWA is adding a dedicated **`/exchange-detail/:returnId`** screen that shows an exchange as two
co-equal halves on one page: the **return half** (items coming back) and the **replacement order**
(items going out). Routing has no redirects: the list opens exchange rows on the exchange page directly.

> **How an exchange is identified (already working).** The return **detail**
> (`GET /oms/returns/{id}`) marks an exchange on `shopifySync`: `shopifySync.isExchange: true` and
> `shopifySync.replacementOrderId`. The PWA reads those. No change needed there.

## 0. Exchange fulfillment flow (NEW — replaces the create-time fulfillment toggle)

> ⚠️ **Superseded (2026-06-02):** this section (fulfillment at approve/complete) was reversed — fulfillment
> is chosen at create time and the approve step is removed for exchanges. See
> `2026-06-02-exchange-create-time-fulfillment-backend-prompt.md` (+ answers) and
> `2026-06-02-exchange-create-time-fulfillment-design.md`. Sections 1–2 below still apply.

Fulfillment is **no longer chosen at create time**. The PWA no longer sends `fulfillmentType` on
`customerExchange`. Instead:

- **`POST /oms/returns/customerExchange`** — create the replacement ("exchange") order at the **`_NA_`
  facility** in a **created** state (`ORDER_CREATED`). It is neither brokered nor fulfilled yet. (Request
  body no longer includes `fulfillmentType`.)
- **`POST /oms/returns/{returnId}/approve`** — in addition to the existing approve + Shopify exchange push,
  **approve and broker** the replacement order (route it to a facility for normal shipped fulfillment →
  `ORDER_APPROVED`).
- **`POST /oms/returns/{returnId}/complete`** — now accepts a body **`{ "facilityId": "<physical facility>" }`**.
  Completing an exchange **fulfills the replacement order from that physical facility** (in-store / POS-style
  → `ORDER_COMPLETED`) in addition to the existing OMS→`RETURN_COMPLETED` + Shopify close. For a plain
  return the body is unchanged/empty.
- **`GET /oms/facilities`** — already exists (used by transfers); the PWA lists **physical** facilities
  (excluding virtual: `facilityTypeId=VIRTUAL_FACILITY&facilityTypeId_op=equals&facilityTypeId_not=Y`) for
  the Complete picker. No change expected — just confirm rows expose `facilityId` + `facilityName`.

Two more additive changes are needed for the screen:

## 1. `isExchange` on each `GET /rest/s1/oms/returns` list row

The list is the routing decision point (no redirects), but `shopifySync` is detail-only — so the list rows
don't currently carry the exchange flag. Add a boolean **`isExchange`** to each element of `returns[]`
(`true` for an exchange return-half, the same condition as `shopifySync.isExchange` on the detail). The PWA
also accepts it nested as `shopifySync.isExchange` on the row if that's easier to emit.

**Why:** so a list click on an exchange opens `/exchange-detail/:returnId` directly (returns open
`/return-detail/:returnId`), with no detail-page redirects.

## 2. Order-level fields on `GET /rest/s1/oms/orders/{orderId}` (for the replacement order)

The PWA already calls `GET /rest/s1/oms/orders/{orderId}` (today for the create-return returnable-lines
view) and reads `orderDetail` with: `orderId`, `orderName`/`externalOrderId`, `currencyUomId`,
`billingEmail`, and `shipGroups[].items[]` (`orderItemSeqId`, `productId`, `productName`, `sku`,
`quantity`, `unitPrice`, `alreadyReturnedQuantity`, `returnableQuantity`).

The exchange-detail screen calls this **same endpoint** with the `exchange.replacementOrderId` returned
on the return detail, to render an **order-level panel for the outgoing replacement order**. Please ensure
`orderDetail` also exposes the following header / fulfillment fields (additive):

| field | meaning |
|---|---|
| `orderDate` | when the replacement order was placed |
| `grandTotal` | replacement order total (paired with the existing `currencyUomId`) |

> **Order status:** use the **existing** `orderStatusId` field (`ORDER_APPROVED` = shipped / in
> fulfillment, `ORDER_COMPLETED` = handed over / completed) — the same field already on the return
> detail's `exchange` block. Do **not** add a duplicate `statusId` alias; the frontend reads
> `orderStatusId`.

Per ship group (or order-level) **fulfillment summary**:

| field | meaning |
|---|---|
| `shipmentMethod` (or `shipmentMethodEnumId` + label) | fulfillment method label |
| `trackingCode` | shipped fulfillment: tracking number, when available |
| `carrierPartyId` (or carrier label) | shipped fulfillment: carrier, when available |

**Line items** already present on `shipGroups[].items[]` (`productId`, `sku`, `productName`, `quantity`,
`unitPrice`) are sufficient — a per-line total is **not** required (the PWA computes `unitPrice ×
quantity`).

**Why:** the replacement panel shows a true order-level view (date, status, total, fulfillment/tracking),
not just the mirrored line items already echoed on the return detail's `exchange` block.

---

## Acceptance criteria

- `GET /oms/returns` rows carry `isExchange` (true for exchange return-halves) — or `shopifySync.isExchange`
  on the row. A plain return / appeasement row is `false`/omitted.
- `GET /oms/orders/{replacementOrderId}` returns `orderDate`, `grandTotal`, and the fulfillment/tracking
  fields alongside the existing items and the existing `orderStatusId` — with no changes to existing
  fields and no new `statusId` alias.

---

## Out of scope (separate item)

The **"immediate exchange leaves an in-progress (OPEN) return in Shopify"** report (order
`6775241670700`) is a **separate** investigation — it concerns whether an `IMMEDIATE` exchange should
auto-close (`returnClose`) the return-half on approval, and needs that order's push-history + Shopify
status to diagnose. It is **not** part of this screen's contract and should not block this change.
