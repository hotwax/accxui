# Appeasement Returns (Two-Shape) — Frontend (PWA) Design

**Date:** 2026-06-01
**Branch:** `feat/rma-returns-pwa`
**Backend design:** `docs/superpowers/specs/2026-06-01-appeasement-two-shape-restock-model-design.md`
**Handoff:** Appeasement Returns (Two-Shape) — Frontend (PWA) Handoff (2026-06-01)

## Summary

An appeasement is a goodwill **refund that is not restocked**, built on the existing returns machinery
(`returnHeaderTypeId = "APPEASEMENT"`, same `RETURN_REQUESTED → APPROVED / REJECTED / CANCELLED`
lifecycle, same approve/reject/cancel/push endpoints, same `shopifySync` polling).

It now comes in **two shapes**, chosen by the operator on create:

| Shape | When | Operator input | Backend line model |
|---|---|---|---|
| **Shipping refund** (B) | Monetary-only goodwill refund, no line item (e.g. refund shipping). | An amount. | One `ReturnAdjustment` (`APPEASEMENT`), no `ReturnItem`. |
| **Lost-in-shipment** (A) | A specific order line is refunded but not sent back (lost/damaged in transit). | Pick order item(s) + qty; optionally override the refund amount. | Real `ReturnItem`(s) (`RET_LOST_ITEM`), one per picked line. |

**Shape B is already built** in the current working tree: create posts to the dedicated
`POST /rest/s1/oms/returns/appeasementReturn` endpoint, `listAppeasementReasons` is wired, the inline
hint, stand-alone goodwill refunds (nothing returned), refund-only cancel handling, and
auto-complete-on-approve are all in place. Detail maps the appeasement from the single monetary
`items[0]` line.

**Shape A is the new work this design covers:** an item picker on create that flips the request to send
`items` (with `amount` becoming an optional override), and detail rendering that branches on
`items[0].productId` to show real product line(s) + a summed refund.

The shape is selected purely by **whether `items` is sent** on the appeasement payload. The endpoint, auth,
reasons list, lifecycle, sync chip, and error handling are identical for both shapes.

## Create — one endpoint, two shapes

`POST /rest/s1/oms/returns/appeasementReturn`, `authenticate="true"`, REST base `/rest/s1/oms`.

```jsonc
{
  "orderId": "...",                 // required (both shapes)
  "reasonId": "APPEASE_GOODWILL",   // required, must be an APPEASE_* code
  "currencyUomId": "USD",           // optional; defaults to order currency
  "note": "loyal customer",         // optional
  "relatedReturnId": "M100100",     // optional; links to the standard return co-created alongside it

  // ── pick ONE shape ──
  // (A) LOST-IN-SHIPMENT: send items. amount is an OPTIONAL override.
  "items": [ { "orderItemSeqId": "00001", "quantity": 1 } ],
  "amount": 30.00                   // OPTIONAL when items present (override of the default total)

  // (B) SHIPPING REFUND: omit items. amount is REQUIRED.
  // "amount": 8.50
}
```

Response (both shapes, 2xx): `{ "returnId": "M100101", "statusId": "RETURN_REQUESTED" }`. No Shopify push on
create — the refund fires on approve.

The two-call create flow is unchanged: when the operator also returns kept items, the standard
`customerReturn` is created first, then the `appeasementReturn` is created with `relatedReturnId` pointing
at it. A stand-alone appeasement (nothing kept returned) skips the first call.

## Section 1 — Data model (`types/returns.ts`)

`AppeasementInput` gains an optional item list; `amount` becomes optional (required for Shape B, an
optional override for Shape A):

```ts
export interface AppeasementItemInput {
  orderItemSeqId: string;
  quantity: number;
}
export interface AppeasementInput {
  amount?: number;                 // required for amount-only; OPTIONAL override when items present
  currencyUomId: string;
  reasonId: string;
  note?: string;
  items?: AppeasementItemInput[];  // present → lost-in-shipment shape
}
```

`AppeasementFields` (detail read model) is unchanged — `amount` carries the **summed** refund for Shape A.
The product lines ride the existing `ReturnDetail.items` array, so no new field is needed there; the view
branches on `items[0].productId`.

## Section 2 — Create form (`views/CreateReturn.vue`)

Inside the existing appeasement card (shown only when ≥1 item is kept), add a mode toggle when appeasement
is enabled:

```ts
const appeasementMode = ref<"amount" | "items">("amount");
const appeasementSelections = reactive<Record<string, { qty: number }>>({}); // keyed by orderItemSeqId
const appeasementAmountTouched = ref(false); // did the operator override the auto total?
```

- **Amount mode** → the current form (amount + reason + note), unchanged.
- **Items mode** → render the order's returnable lines with a checkbox + qty stepper (reusing the standard
  picker's line list/steppers), plus reason + note. The amount field shows the **auto total**
  `Σ(unitPrice × qty)` and stays editable; editing sets `appeasementAmountTouched = true`. Switching modes
  or changing picks while untouched re-syncs the amount to the auto total.

Default-amount computed:

```ts
const appeasementItemsTotal = computed(() =>
  Object.entries(appeasementSelections).reduce((sum, [seqId, s]) => {
    const line = order.value?.items.find((i) => i.orderItemSeqId === seqId);
    return sum + (line ? line.unitPrice * s.qty : 0);
  }, 0));
```

`appeasementValid` branches by mode:

- *amount*: `amount > 0 && amount ≤ keptValue && reasonId` (today's rule).
- *items*: `≥1 line picked (qty > 0) && reasonId && effectiveTotal ≤ keptValue`, where `effectiveTotal` is
  the override (when touched) else the auto total. No standalone `amount > 0` check — picked lines
  guarantee a positive default.

`appeasementHint` gains an items-mode branch ("Pick at least one lost item"; the over-cap message is
reused).

Submit logic:

```ts
const appeasement = appeasementEnabled.value && appeasementValid.value
  ? {
      currencyUomId: order.value.currencyUomId,
      reasonId: appeasementReasonId.value,
      ...(appeasementNote.value.trim() ? { note: appeasementNote.value.trim() } : {}),
      ...(appeasementMode.value === "items"
        ? {
            items: pickedAppeasementItems.value,                                       // [{orderItemSeqId, quantity}]
            ...(appeasementAmountTouched.value ? { amount: Number(appeasementAmount.value) } : {}),
          }
        : { amount: Number(appeasementAmount.value) }),
    }
  : undefined;
```

Shape A sends `items` and only sends `amount` when overridden; Shape B sends `amount` only. Same endpoint
either way. `canSubmit` and the stand-alone-goodwill path are unchanged.

## Section 3 — omsAdapter (`adapters/omsAdapter.ts`)

Create body — carry items, make `amount` conditional:

```ts
const a = input.appeasement;
const appResp = await omsApi({
  url: "oms/returns/appeasementReturn", method: "POST",
  data: {
    orderId: input.orderId,
    reasonId: a.reasonId,
    currencyUomId: a.currencyUomId,
    ...(a.note ? { note: a.note } : {}),
    ...(returnId ? { relatedReturnId: returnId } : {}),
    ...(a.items?.length ? { items: a.items } : {}),
    ...(a.amount != null ? { amount: a.amount } : {}), // Shape B always; Shape A only when overridden
  },
});
```

Detail mapping — detect shape by whether the appeasement lines carry a `productId`:

```ts
const appLines = type === "appeasement" ? items : [];
const isItemAppeasement = appLines.length > 0 && !!appLines[0].productId;
const appeasement = type === "appeasement"
  ? {
      amount: isItemAppeasement
        ? appLines.reduce((s, it) => s + Number(it.returnPrice ?? 0) * it.returnQuantity, 0) // Σ returnPrice×qty
        : Number(appLines[0]?.returnPrice ?? 0),                                              // synthetic monetary line
      currencyUomId: rd.currencyUomId ?? "USD",
      reasonId: appLines[0]?.returnReasonId ?? "",
      reasonDesc: appLines[0]?.reasonDescription || undefined,
      note: isItemAppeasement ? undefined : appLines[0]?.description || undefined, // note only on the monetary line
      relatedReturnId: idents.find((i) => i.returnIdentificationTypeId === "RELATED_RETURN_ID")?.idValue || undefined,
    }
  : undefined;
```

The existing `items` (`ReturnItemDetail[]`) mapping needs no change — it already tolerates missing product
fields (`productName` defaults to `""`). For Shape B / legacy `RET_NPROD_ITEM`, `items[0]` is a synthetic
monetary line with no `productId` and is never rendered as a product (the view hides the generic items list
for appeasements). For Shape A the lines are real products and are rendered by Section 4.

## Section 4 — ReturnDetail rendering (`views/ReturnDetail.vue`)

New computed:

```ts
const isItemAppeasement = computed(() => isAppeasement.value && !!r.value?.items?.[0]?.productId);
```

The appeasement refund card's headline (`r.appeasement.amount`) already shows the right number for both
shapes (summed for Shape A). For Shape A, add a product-line list beneath the headline so the operator sees
what was refunded:

```html
<ion-card v-if="isAppeasement && r.appeasement">
  <ion-card-header><ion-card-title>{{ translate("Appeasement refund") }}</ion-card-title></ion-card-header>
  <ion-card-content>
    <h2 data-testid="detail-appeasement-amount">{{ commonUtil.formatCurrency(r.appeasement.amount, r.appeasement.currencyUomId) }}</h2>
    <p>{{ translate("Reason") }}: {{ translate(formatReason(...)) }}</p>
    <!-- Shape A only: the refunded (lost) product lines -->
    <ion-list v-if="isItemAppeasement" data-testid="detail-appeasement-items">
      <ion-item v-for="it in r.items" :key="it.orderItemSeqId">
        <ion-label>
          <h3>{{ it.productName || it.sku || it.productId }}</h3>
          <p>{{ translate("Qty") }}: {{ it.returnQuantity }}</p>
        </ion-label>
      </ion-item>
    </ion-list>
    <p v-if="r.appeasement.note" class="muted">{{ r.appeasement.note }}</p>
    <p v-if="r.appeasement.relatedReturnId">...related return link...</p>
  </ion-card-content>
</ion-card>
```

The lower goodwill-refund summary line (`v-if="!isAppeasement"` items list / the single "Goodwill refund"
row) stays as-is. Shape A's product detail lives in the refund card above, so the generic items list is not
un-hidden for appeasements (avoids a duplicate, unstyled product list). Lifecycle
(`canComplete`/`closeState` excluded for appeasements), the sync chip, and the related-return link are
untouched — identical for both shapes.

## Section 5 — Stub adapter, tests, E2E

**stubAdapter** (`adapters/stubAdapter.ts`): when `createReturn` receives an appeasement with `items`, build
the stub appeasement return's `items[]` from the picked order lines (productId/productName/sku/returnPrice =
unitPrice, returnQuantity = picked qty), set its summed amount, and keep the `RELATED_RETURN_ID` linkage.
Amount-only appeasements keep producing the single synthetic monetary line. This lets detail + E2E render
Shape A end-to-end before the backend lands.

**Unit tests:**

- `CreateReturn.spec.ts` — items-mode flow: toggle to items, pick line(s), auto-total fills the amount, an
  override sets `amount` in the payload, omitting the override sends `items` with no `amount`; validity
  blocks zero picks / over-cap; items-mode `appeasementHint` message.
- `omsAdapter.spec.ts` — create body carries `items` (+ conditional `amount`); `mapReturnDetail` produces a
  summed amount + product reason for a multi-line appeasement and still maps the synthetic monetary line for
  Shape B / legacy `RET_NPROD_ITEM`.
- `ReturnDetail.spec.ts` — Shape A renders `detail-appeasement-items` with product lines + summed
  `detail-appeasement-amount`; Shape B renders the monetary line and no item list.
- `stubAdapter.spec.ts` — co-created lost-in-shipment appeasement persists product lines + summed amount;
  amount-only path unchanged.
- `returnsStoreCrud.spec.ts` — submit carrying an items-based appeasement reaches the service with the right
  input.

**E2E** (`returns-happy-path.cy.ts`): a lost-in-shipment happy path — look up order, enable appeasement,
switch to "Refund specific items", pick a line, submit, land on detail, assert the product line + summed
refund render and the sync chip behaves as for Shape B.

**i18n** (`locales/en.json`): add segment labels ("Refund an amount" / "Refund specific items"), "Pick at
least one lost item", "Qty", and any items-mode hint copy.

## Eligibility & amount cap

Both guarded server-side; mirrored client-side for UX:

- Show the appeasement option only when ≥1 item is kept (returnable qty not already covered by return
  items). Full return → hide it.
- Amount cap = kept-merchandise value = Σ(unitPrice × keptQty) over not-returned units:
  - Shipping refund: typed `amount` must be `0 < amount ≤ keptValue`.
  - Lost-in-shipment: the defaulted-or-overridden total must be `≤ keptValue`.

**v1 simplification (decided):** the standard-return picker and the appeasement item picker are
**independent selections**. There is no client-side enforcement that a single unit cannot be both returned
and appeased; the backend treats appeasement lines as prior-return rows. The amount override is capped at
`keptValue` (computed from standard-return selections), and the items-mode hint surfaces an over-cap total.

## Lifecycle, sync, reasons, errors — unchanged for both shapes

- **Reasons:** `GET /rest/s1/oms/appeasementReasons` (same `APPEASE_*` codes), via `listAppeasementReasons`.
- **Lifecycle:** approve (fires the async Shopify refund), reject, cancel, pushToShopify recovery —
  identical, idempotent. An appeasement is not completable (no Shopify return to close); approval auto-
  finalizes the OMS return after the refund syncs.
- **Sync chip:** `resolveShopifySyncState` keys off `shopifySync.pushStatusId` + `synced`;
  `shopifySync.shopifyRefundId` is the "view refund in Shopify" link for both shapes.
- **Errors:** same 4xx guards (order not found, `amount <= 0`, reason not `APPEASE_*`, no item kept,
  over-cap, wrong-status transitions). Surface the server message.
- **Cancel-after-refund:** Shopify refunds are terminal and not auto-reversed; a cancelled appeasement may
  still show a completed refund.

## Backward compatibility

Old appeasements created before this change (single `RET_NPROD_ITEM` `ReturnItem`) keep reading as a
synthetic monetary line — the same path as the shipping-refund shape. No migration; no special-casing.

## Definition of done

- Operator can create a shipping-refund appeasement (amount only) — same result as today.
- Operator can create a lost-in-shipment appeasement by picking order item(s) + qty, with the amount
  defaulting to the picked-line value and overridable (capped at kept value).
- Detail renders both shapes correctly (monetary line vs product line[s], summed refund) and old
  `RET_NPROD_ITEM` appeasements still read.
- Approve/reject/cancel, sync polling, and refund retry behave identically for both shapes.

## Backend caveats (don't block on these)

- The lost-in-shipment push sends Shopify `refundCreate` with `refundLineItems`
  (`restockType: NO_RESTOCK`); the `RefundLineItemInput` shape is pending live-schema verification on the
  backend. A failed lost-in-shipment refund surfaces as `shopifySync.pushStatusId = "PUSH_FAILED"` with the
  GraphQL message — same retry affordance as any push failure. Shipping-refund pushes (transactions-only)
  are the already-proven path.
- Single-currency orders assumed for refund allocation; multi-currency is out of scope for v1.
