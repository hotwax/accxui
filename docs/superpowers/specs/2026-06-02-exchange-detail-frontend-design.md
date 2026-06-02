> ⚠️ **Partly superseded (2026-06-02):** the fulfillment + approve/complete flow described here was
> replaced by create-time fulfillment with the approve step removed. See
> `2026-06-02-exchange-create-time-fulfillment-design.md`. The two-halves screen layout still applies.

# PWA Exchange Detail screen — Frontend Design

**Date:** 2026-06-02
**App:** `apps/returns`
**Builds on:** the same-product exchange work (`2026-06-02-pwa-same-product-exchange-design.md`).
**Backend contract:** `2026-06-02-exchange-detail-backend-contract.md` (two additive fields:
`isExchange` on list rows; order-level fields on `GET /oms/orders/{id}`). Wires now, lights up when the
backend lands — exactly as returns/appeasements/exchanges did. The stub adapter demos the whole flow.

---

## 1. Goal

A dedicated **`/exchange-detail/:returnId`** screen that presents an exchange as **two co-equal halves on
one page**:

- **Returning** — the return half (items coming back): return lines + reasons, the Shopify-return sync
  state ("Exchange confirmed"), and the lifecycle actions (approve / reject / cancel / complete + Retry).
- **Replacement** — an **order-level panel** for the outgoing replacement order: order name/id, date,
  status, fulfillment (shipped + tracking / handed-over in store), line items, order total, and the
  even-swap / credit copy.

Keyed by the **return id** (e.g. `M100313`). One `getReturn(returnId)` call provides the return half and
the `exchange` block; a second `getReplacementOrder(exchange.replacementOrderId)` call provides the richer
order-level panel (approach #3 — "richer replacement view").

## 2. Routing & entry — list-driven, no redirects

- New route `{ path: "/exchange-detail/:returnId", name: "ExchangeDetail", component: ExchangeDetail.vue,
  props: true, beforeEnter: authGuard }`.
- **The list routes by type**: `ReturnSummary.isExchange` → an exchange row opens `/exchange-detail/:returnId`,
  a plain row opens `/return-detail/:returnId`, plus an Exchange badge. No redirects in either detail view.
- The create-exchange flow (`CreateReturn.vue`) navigates straight to `/exchange-detail/:returnId`.
- **Exchange detection (the field that matters):** the backend marks an exchange on `shopifySync`
  (`shopifySync.isExchange: true`, `shopifySync.replacementOrderId`). `mapReturnDetail` reads those
  (falling back to a top-level `isExchange`/`exchange` block for the stub). The list maps `isExchange` from
  the row (`row.isExchange` or `row.shopifySync.isExchange`).

## 3. Types (`types/returns.ts`)

- `ShopifySync` gains `isExchange?` + `replacementOrderId?` (where the backend actually marks an exchange).
- `ReturnSummary.isExchange?: boolean` (list routing). `ExchangeDetail`'s order-level fields
  (`fulfillmentType`/`orderStatusId`/`items`/`exchangeCreditAmount`) are optional — the detail only carries
  `replacementOrderId`; the rest comes from `getReplacementOrder`.
- New `ReplacementOrderDetail` (the outgoing order panel):
  ```ts
  export interface ReplacementOrderItem {
    productId: string; productName: string; sku?: string; quantity: number; unitPrice: number;
  }
  export interface ReplacementOrderDetail {
    orderId: string; orderName: string; orderDate?: string;
    statusId: string;                 // ORDER_APPROVED | ORDER_COMPLETED
    currencyUomId: string; grandTotal?: number;
    fulfillmentType?: FulfillmentType;
    shipmentMethod?: string; trackingCode?: string; carrier?: string;
    items: ReplacementOrderItem[];
  }
  ```

## 4. Service & adapters

- Service: add `getReplacementOrder(orderId: string): Promise<ReplacementOrderDetail>`.
- `omsAdapter`:
  - `getReplacementOrder` → `GET oms/orders/{orderId}` mapped by a new pure, unit-tested
    `mapReplacementOrder(raw)` (header + fulfillment + items; reads the existing `orderStatusId`; trusts
    backend `grandTotal`; defaults `currencyUomId` to USD; flattens `shipGroups[].items[]`).
- `stubAdapter`:
  - `getReplacementOrder` synthesizes the panel from the stored exchange block (status, fulfillment,
    items, computed total; a tracking code for a shipped replacement).

## 5. Store (`store/returnsStore.ts`)

- `loadReplacementOrder(orderId)` → `getReturnsService().getReplacementOrder(orderId)` (mirrors
  `loadOrder`). All lifecycle actions are reused unchanged.

## 6. View (`views/ExchangeDetail.vue`)

- Header: title `Exchange #{returnId}`, Exchange badge, return status, requested date.
- **Returning** section: return line list (product, qty, reason, sku); the Shopify-sync card (chip reads
  **"Exchange confirmed"** at `synced`; failed → error + Retry via `store.retryExchangePush`); the
  lifecycle action card (approve/reject/cancel/complete), reusing `ReturnDetail`'s action handlers and the
  `runAction`/`confirmAction` helpers and `syncState` utils.
- **Replacement** section: the `ReplacementOrderDetail` panel — order name/id, date, status
  ("Completed" / "Approved — in fulfillment"), fulfillment ("Handed over in store" / "Shipped" +
  tracking code when present), line items (product, qty, unit price), order total, even-swap/credit copy.
  While loading, a spinner; on failure, a muted "Couldn't load the replacement order" line (the return
  half still renders).
- `onIonViewWillEnter`: `fetchReturn` → if not an exchange, redirect to `/return-detail/:returnId` (a
  plain return opened here); else `loadReplacementOrder`; poll a `pending` sync to settle (reused).
- `data-testid`s: `exchange-detail-back-btn`, `exchange-detail-loading`, `exchange-returning-section`,
  `exchange-replacement-section`, `exchange-replacement-order`, `exchange-replacement-items`,
  `exchange-approve-btn` / `-reject-btn` / `-cancel-btn` / `-complete-btn` / `-retry-btn`.

## 7. Tests & i18n

- Unit: `mapReplacementOrder` (header/fulfillment/items, currency default); `listReturns`/stub carry
  `isExchange`; store `loadReplacementOrder`; `ExchangeDetail.vue` renders both halves + "Exchange
  confirmed"; `ReturnsList` routes an exchange row to `/exchange-detail`.
- i18n: `en.json` strings for the new section headers, replacement-order labels, fulfillment/tracking and
  order-total copy (reusing existing exchange/sync strings where they already exist).

## 8. Definition of done

- `/exchange-detail/:returnId` renders the two halves; exchange list rows route to it; create-exchange
  navigates to it.
- Replacement panel shows order-level detail from `getReplacementOrder`; lifecycle + sync reuse existing
  store actions and the exchange-aware approve fix.
- Stub demos the whole flow with no backend. Unit tests green; `vue-tsc` clean for the new/changed files.
