# PWA Same-Product Exchanges — Frontend Design

**Date:** 2026-06-02
**App:** `apps/returns`
**Backend contract:** `co.hotwax.oms.return.ReturnServices.create#CustomerExchange` (approved design, not yet
built — see the *PWA Exchanges — Frontend Handoff*, 2026-06-02). The PWA wires to the contract now and
lights up when the endpoints exist, exactly as returns and appeasements did.
**Builds on:** the two-shape appeasement work (`2026-06-01-appeasement-two-shape-frontend-pwa-design.md`).
Same auth (`api_key` via `maargApiKey`), same `/rest/s1/oms` base, same lifecycle statuses, same
poll/retry pattern.

---

## 1. What an exchange is (this scope)

An **exchange** = the customer returns item(s) **and** is sent the **same product(s)** back, recorded
against the original order. This is a like-for-like swap (size/defect), so:

- **No product search.** `exchangeItems` is **mirrored** from the return lines the operator picks: same
  `productId`, same `quantity`.
- **Even swap.** `unitPrice` is omitted from `exchangeItems` (backend defaults it to the product's price),
  so `exchangeCreditAmount` comes back `0`.
- The backend stores it as a normal customer return (items coming back) linked to a replacement
  ("exchange") order (items going out). In Shopify it all lands on the original order.

The **only** exchange-specific operator input beyond the return lines is `fulfillmentType`.

### `fulfillmentType` (required by the contract)

| value | meaning | replacement order ends up | UI |
|---|---|---|---|
| `SHIPPED` (default) | replacement is shipped to the customer | `ORDER_APPROVED`, runs normal fulfillment | "Ship replacement to customer" |
| `IMMEDIATE` | replacement handed over in-store now (POS-style) | `ORDER_COMPLETED` immediately | "Hand over now (in-store)" |

A two-option toggle, defaulting to `SHIPPED`. Helper copy notes that `IMMEDIATE` completes the replacement
order on the spot.

---

## 2. Lifecycle & sync — reuse, plus one new collapse

The exchange's **return half** uses the **identical** lifecycle and endpoints as a normal return —
`approve` / `reject` / `cancel` / `complete` are reused unchanged. There is no separate "exchange status"
vocabulary.

What is different is the **create push**. For a normal return the create-push is a single Shopify step
(`returnCreate`, `PUSH_*`) fired on approve, and completion (`returnClose`, `CLOSE_*`) is a separate step
fired on complete. For an **exchange**, the create-push is **two Shopify steps in sequence, both at
approve-time**:

1. `returnCreate` (with exchange items) → `pushStatusId` ∈ `PUSH_PENDING | PUSH_OK | PUSH_FAILED`
2. `returnProcess` (confirms the exchange + replacement fulfillment) → `processStatusId` ∈
   `PROC_PENDING | PROC_OK | PROC_FAILED`

**`PROC_OK` is the authoritative "confirmed in Shopify."** A created-but-not-yet-processed exchange
(`PUSH_OK`, no `PROC_OK`) is still **pending**.

### `resolveExchangeSyncState(shopifySync)` → `SyncState`

A new collapse in `util/syncState.ts`, reusing the existing `SyncState` vocabulary
(`not_synced | pending | synced | failed`):

| condition | result |
|---|---|
| `null` | `not_synced` |
| `processStatusId === "PROC_OK"` | `synced` (authoritative — confirmed) |
| `processStatusId === "PROC_FAILED"` | `failed` (surface `processErrorMessage`) |
| `pushStatusId === "PUSH_FAILED"` | `failed` (surface `pushErrorMessage`) |
| `pushStatusId === "PUSH_PENDING"` or `processStatusId === "PROC_PENDING"` | `pending` |
| `pushStatusId === "PUSH_OK"` (awaiting process) | `pending` |
| else | `not_synced` |

`ReturnDetail` carries `isExchange`, so `mapReturnDetail` collapses `sync.shopify` with
`resolveExchangeSyncState` for exchanges and the existing `resolveShopifySyncState` for plain returns.
Everything downstream (`getSyncStatus`, `pollSync`, the chip) stays generic and unchanged. The sync chip
label reads **"Exchange confirmed"** at `synced` when `isExchange`.

Retry on failure re-runs **both** steps idempotently (resumes at the failed step) via the exchange retry
endpoint (§4).

> **Decision:** the appeasement option is **not** offered in exchange mode — you cannot add a goodwill
> refund to an exchange. The Return/Exchange segment is mutually exclusive; appeasement stays available in
> Return mode only.

---

## 3. Types (`apps/returns/src/types/returns.ts`)

```ts
export type FulfillmentType = "IMMEDIATE" | "SHIPPED";

/** A replacement line going out. unitPrice omitted → backend defaults to the product's price (even swap). */
export interface ExchangeItemInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
}

export interface CreateExchangeInput {
  orderId: string;
  fulfillmentType: FulfillmentType;
  returnItems: ReturnItemInput[];   // what comes back (same shape as a return line)
  exchangeItems: ExchangeItemInput[]; // what goes out (mirrored from returnItems for same-product)
  note?: string;
  currencyUomId?: string;
}

/** The replacement order, present on a ReturnDetail when isExchange === true. */
export interface ExchangeDetail {
  replacementOrderId: string;
  orderName?: string;
  fulfillmentType: FulfillmentType;
  orderStatusId: string;            // ORDER_COMPLETED (immediate) | ORDER_APPROVED (shipped, in fulfillment)
  items: Array<{ productId: string; quantity: number; unitPrice?: number; itemDescription?: string }>;
  exchangeCreditAmount: number;     // 0 = even swap
}
```

- Extend `ShopifySync` with `processStatusId?: string | null` and `processErrorMessage?: string | null`.
- Extend `ReturnDetail` with `isExchange?: boolean` and `exchange?: ExchangeDetail`.

---

## 4. Service & adapters

### Service (`services/ReturnsService.ts`)
Add two methods; reuse everything else:

```ts
createExchange(input: CreateExchangeInput): Promise<{ returnId: string; replacementOrderId?: string }>;
retryExchangePush(returnId: string): Promise<void>;
```

### `omsAdapter.ts`
- `createExchange` → `POST oms/returns/customerExchange` with `buildExchangeCreateBody(input)`. Treat the
  response as a receipt; the store re-fetches the detail.
- `retryExchangePush` → `POST oms/returns/{returnId}/pushExchangeToShopify` (ignore body, re-fetch).
- **`buildExchangeCreateBody(input)`** — a pure, unit-tested helper that emits
  `{ orderId, fulfillmentType, returnItems[], exchangeItems[], note?, currencyUomId? }`, omitting
  `unitPrice` per exchange item when absent and omitting optional top-level fields when empty.
- **`mapReturnDetail`** — extend the raw shape with `isExchange?` and an `exchange?` sub-block; map them
  onto `ReturnDetail`. When `isExchange`, collapse `sync.shopify` via `resolveExchangeSyncState`
  (carry `processStatusId`/`processErrorMessage` through on the raw `shopifySync`). Existing return/
  appeasement mapping is untouched.

### `stubAdapter.ts`
Mirror the appeasement stub so the flow demos with no backend (reuse the existing standard `REASONS`,
which already include `RTN_SIZE_EXCHANGE`, for exchange return lines):
- `createExchange` seeds a `RETURN_REQUESTED` return with `isExchange: true` and an `exchange` block
  (replacement order id, `fulfillmentType` from input, `orderStatusId` = `ORDER_APPROVED` for `SHIPPED` /
  `ORDER_COMPLETED` for `IMMEDIATE`, mirrored items, `exchangeCreditAmount: 0`). `shopifySync: null`.
- `approveReturn` on an exchange sets `shopifySync = { pushStatusId: "PUSH_PENDING" }` and seeds the poll
  counters.
- `getSyncStatus` advances the exchange across re-fetches: `PUSH_PENDING → PUSH_OK → PROC_PENDING →
  PROC_OK` (each step shows `pending` until `PROC_OK` → `synced`), setting `shopifyReturnId` and the
  replacement order's `orderStatusId` at confirmation.
- `retryExchangePush` re-kicks from the failed step (idempotent), clearing the error message.

---

## 5. Store (`store/returnsStore.ts`)

- `submitExchange(input: CreateExchangeInput): Promise<string>` → `createExchange`, return `returnId`.
- `approveReturn` is **reused as-is**: approve drives the push server-side, and `pollSync` settles on the
  exchange-aware `synced`/`failed` because `sync.shopify` is already exchange-collapsed by the adapter.
- `retryExchangePush(returnId, opts?)` → `service.retryExchangePush` then `pollSync(returnId, "shopify")`.
  The detail view routes the Retry button to this when `isExchange`, else to the existing `pushAndPoll`.

---

## 6. Create UI (`views/CreateReturn.vue`)

- A **Return / Exchange** `ion-segment` at the top of the order section. Default `Return` (current flow,
  incl. the appeasement toggle/segment). `Exchange` mode:
  - Reuses the **existing returnable-line picker** (qty + reason per line). The picked lines are both the
    return lines and — mirrored — the replacement lines.
  - Hides the appeasement card.
  - Shows a **fulfillment** `ion-segment`/radio: "Ship replacement to customer" (`SHIPPED`, default) /
    "Hand over now (in-store)" (`IMMEDIATE`) + helper copy.
- `canSubmit` in exchange mode: at least one return line with qty > 0 and a reason.
- `submit` in exchange mode builds `returnItems` from the selections and `exchangeItems` as the mirror
  (`{ productId, quantity }`), then calls `store.submitExchange({ orderId, fulfillmentType, returnItems,
  exchangeItems, currencyUomId })` and navigates to `/return-detail/{returnId}`.
- `data-testid`s: `create-mode-segment`, `create-mode-return`, `create-mode-exchange`,
  `create-fulfillment-segment`, `create-fulfillment-shipped`, `create-fulfillment-immediate`.

---

## 7. Detail UI (`views/ReturnDetail.vue`)

- An **Exchange** badge next to the status when `r.isExchange` (`data-testid="detail-exchange-badge"`),
  parallel to the appeasement badge.
- An **Exchange** card (when `r.isExchange && r.exchange`):
  - Replacement order name/id (`detail-exchange-order`).
  - `fulfillmentType` rendered as "Shipped to customer" / "Handed over in store".
  - Replacement `orderStatusId` rendered as "Completed" (immediate) / "Approved — in fulfillment"
    (shipped).
  - Replacement line(s) (`detail-exchange-items`).
  - `exchangeCreditAmount` copy: `0` → "Even swap — no refund difference"; `> 0` → "Refund difference owed:
    {amount}" (copy provisional, confirm with backend).
- Shopify-sync card: same chip; for an exchange the label reads "Exchange confirmed" at `synced` and the
  Retry button calls `store.retryExchangePush`. Lifecycle buttons (approve/reject/cancel/complete)
  unchanged.
- `onIonViewWillEnter` already polls a `pending` `sync.shopify` to settle — works unchanged for the
  exchange's `PROC` poll.

---

## 8. Tests & i18n

**Unit:**
- `buildExchangeCreateBody` — mirrors items, omits absent `unitPrice`/optional fields.
- `mapReturnDetail` — maps `isExchange` + `exchange` block; exchange sync collapses via the new resolver.
- `resolveExchangeSyncState` — every row of the table in §2.
- store — `submitExchange`, `retryExchangePush` happy paths.
- `CreateReturn` — exchange-mode submit posts mirrored `exchangeItems` + `fulfillmentType`.
- `ReturnDetail` — renders the exchange badge + card; sync chip reads "Exchange confirmed".

**e2e** (`tests/e2e/`): an exchange happy path — create (Exchange mode, pick a line, SHIPPED) → detail
shows the exchange block + `RETURN_REQUESTED` → approve → poll to `PROC_OK` ("Exchange confirmed") —
mirroring `returns-happy-path.cy.ts`.

**i18n:** add `en.json` strings for the mode segment, fulfillment options + helper, exchange badge/card
labels, fulfillment/order-status renderings, `exchangeCreditAmount` copy, and the "Exchange confirmed"
sync label.

---

## 9. Definition of done

- Create page has a Return/Exchange segment; exchange mode posts `returnItems` + mirrored `exchangeItems`
  + `fulfillmentType` to `customerExchange`.
- Detail shows `isExchange`, the exchange badge, and the exchange card (replacement order,
  `fulfillmentType`, `orderStatusId`, lines, even-swap copy).
- Approve drives the push; the sync chip polls `PUSH_* → PROC_OK` and reads "Exchange confirmed" at
  `PROC_OK`. `PUSH_FAILED`/`PROC_FAILED` surface the message + a working Retry (`pushExchangeToShopify`).
- Lifecycle actions reuse the existing return endpoints unchanged. Appeasement is unavailable in exchange
  mode.
- Stub adapter demos the whole flow with no backend. Unit + e2e tests green; `pnpm lint` + `vue-tsc` clean.
</content>
</invoke>
