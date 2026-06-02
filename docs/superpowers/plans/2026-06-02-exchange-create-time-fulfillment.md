# Exchange Create-Time Fulfillment & Skip-Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the exchange fulfillment decision to the create page (shipment method for shipped, physical facility for immediate) and delete the approve step for exchanges — create drives both halves to their terminal state.

**Architecture:** The PWA `apps/returns` is a Vue 3 + Ionic + Pinia app behind a swappable `ReturnsService` (real `omsAdapter` over Maarg REST, demo `stubAdapter` in-memory). The create form gains a Fulfillment card; `createExchange` sends `fulfillmentType` + (`shipmentMethodTypeId` | `facilityId`); the exchange-detail screen loses Approve/Complete. Backend already accepts `fulfillmentType` + `facilityId` and finalizes in one call; `shipmentMethodTypeId` is wired now but ignored server-side until backend work lands (shown with an honest note).

**Tech Stack:** Vue 3 (`<script setup>`), Ionic Vue, Pinia, TypeScript, Vitest (unit), Cypress (e2e), `vue-tsc` for type checking.

**Spec:** `docs/superpowers/specs/2026-06-02-exchange-create-time-fulfillment-design.md`

**Conventions for every task:**
- All commands run from `apps/returns/` unless noted.
- Run a single unit file with: `npx vitest run tests/unit/<file>.spec.ts`
- Type check with: `npx vue-tsc --noEmit`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/types/returns.ts` | Shared types | Add `ShipmentMethod`; extend `CreateExchangeInput`; add `ExchangeDetail.shipmentMethod` |
| `src/services/ReturnsService.ts` | Service contract | Add `listShipmentMethods`; drop `facilityId` from `completeReturn` |
| `src/adapters/omsAdapter.ts` | Real REST adapter | Extend `buildExchangeCreateBody`; add `listShipmentMethods`; drop `facilityId` from `completeReturn` |
| `src/adapters/stubAdapter.ts` | Demo adapter | Branch `createExchange` on fulfillment; add `listShipmentMethods`; update `getReplacementOrder`/`completeReturn` |
| `src/store/returnsStore.ts` | Pinia store | Add `loadShipmentMethods`; drop `facilityId` from `completeReturn` |
| `src/views/CreateReturn.vue` | Create form | Add Fulfillment card + state + validation + submit fields |
| `src/views/ExchangeDetail.vue` | Exchange detail | Remove Approve/Complete; keep Cancel + sync/close + Retry |
| `src/locales/en.json` | i18n | Add fulfillment/method/facility strings |
| `tests/e2e/exchange-happy-path.cy.ts` | e2e | Drive the new create flow |

---

## Task 1: Types

**Files:**
- Modify: `src/types/returns.ts`

- [ ] **Step 1: Add the `ShipmentMethod` interface**

Add directly after the `Facility` interface at the end of the file:

```ts
/** A shipment method the operator can choose for a shipped exchange (the create-page method picker). */
export interface ShipmentMethod {
  shipmentMethodTypeId: string;
  description: string;
}
```

- [ ] **Step 2: Extend `CreateExchangeInput`**

Replace the existing `CreateExchangeInput` interface (the block ending with the "No fulfillmentType" comment) with:

```ts
export interface CreateExchangeInput {
  orderId: string;
  returnItems: ReturnItemInput[];     // what comes back (same shape as a return line)
  exchangeItems: ExchangeItemInput[]; // what goes out (mirrored from returnItems for same-product)
  note?: string;
  currencyUomId?: string;
  // Fulfillment is chosen at create time. SHIPPED brokers the replacement (ORDER_APPROVED); IMMEDIATE
  // fulfills it from `facilityId` now (ORDER_COMPLETED). No separate approve step for an exchange.
  fulfillmentType: FulfillmentType;
  shipmentMethodTypeId?: string; // required (client-side) for SHIPPED; ignored server-side until backend threads it through
  facilityId?: string;           // required for IMMEDIATE — origin facility the ship group is issued from
}
```

- [ ] **Step 3: Add `shipmentMethod` to `ExchangeDetail`**

In the `ExchangeDetail` interface, add a field after `fulfillmentType?: FulfillmentType;`:

```ts
  shipmentMethod?: string; // fulfillment method label (carried from create; shown on the replacement panel)
```

- [ ] **Step 4: Verify it type-checks**

Run: `npx vue-tsc --noEmit`
Expected: PASS (no errors). It is fine for adapters to be temporarily out of date — they're fixed in later tasks; if `vue-tsc` flags `createExchange` callers for the new required `fulfillmentType`, that is expected and resolved in Tasks 4 and 6. If you want a clean checkpoint, proceed; the field becomes required so existing callers WILL error until updated. That is acceptable mid-plan.

- [ ] **Step 5: Commit**

```bash
git add src/types/returns.ts
git commit -m "feat(returns): types for create-time exchange fulfillment"
```

---

## Task 2: Service contract

**Files:**
- Modify: `src/services/ReturnsService.ts`

- [ ] **Step 1: Add `listShipmentMethods` to the imports and interface**

Add `ShipmentMethod` to the type import list at the top, then add this method to the `ReturnsService` interface (next to `listFacilities`):

```ts
  // Shipment methods for the create-page picker (shown for a SHIPPED exchange).
  listShipmentMethods(): Promise<ShipmentMethod[]>;
```

- [ ] **Step 2: Drop `facilityId` from `completeReturn`**

Replace the `completeReturn` declaration and its comment with:

```ts
  // Complete transitions RETURN_APPROVED/RETURN_RECEIVED -> RETURN_COMPLETED and (server-side) triggers
  // the async Shopify completion (returnProcess + returnClose). retryComplete re-runs a failed close.
  completeReturn(returnId: string): Promise<void>;
```

- [ ] **Step 3: Verify it type-checks the interface only**

Run: `npx vue-tsc --noEmit`
Expected: Errors in `omsAdapter.ts`/`stubAdapter.ts`/`returnsStore.ts` for the not-yet-implemented `listShipmentMethods` and the `completeReturn` arity. This is expected — fixed in Tasks 3–5.

- [ ] **Step 4: Commit**

```bash
git add src/services/ReturnsService.ts
git commit -m "feat(returns): service contract for shipment methods + complete arity"
```

---

## Task 3: omsAdapter

**Files:**
- Modify: `src/adapters/omsAdapter.ts`
- Test: `tests/unit/omsAdapter.spec.ts`

- [ ] **Step 1: Update the failing `buildExchangeCreateBody` tests**

In `tests/unit/omsAdapter.spec.ts`, replace the entire `describe("buildExchangeCreateBody", …)` block with:

```ts
describe("buildExchangeCreateBody", () => {
  const base = {
    orderId: "DEMO-1001",
    returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
    exchangeItems: [{ productId: "P1", quantity: 1 }],
    fulfillmentType: "SHIPPED" as const,
  };

  it("sends fulfillmentType + shipmentMethodTypeId for a shipped exchange", () => {
    const body = buildExchangeCreateBody({ ...base, shipmentMethodTypeId: "STANDARD", currencyUomId: "USD" });
    expect(body.orderId).toBe("DEMO-1001");
    expect(body.fulfillmentType).toBe("SHIPPED");
    expect(body.shipmentMethodTypeId).toBe("STANDARD");
    expect("facilityId" in body).toBe(false);
    expect(body.returnItems).toEqual([{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }]);
    expect(body.exchangeItems).toEqual([{ productId: "P1", quantity: 1 }]);
    expect(body.currencyUomId).toBe("USD");
  });

  it("sends fulfillmentType + facilityId for an immediate exchange", () => {
    const body = buildExchangeCreateBody({ ...base, fulfillmentType: "IMMEDIATE", facilityId: "STORE_DT" });
    expect(body.fulfillmentType).toBe("IMMEDIATE");
    expect(body.facilityId).toBe("STORE_DT");
    expect("shipmentMethodTypeId" in body).toBe(false);
  });

  it("omits unitPrice per exchange item when absent, includes it when present", () => {
    const body = buildExchangeCreateBody({ ...base, exchangeItems: [{ productId: "P1", quantity: 2, unitPrice: 19.99 }] });
    expect(body.exchangeItems[0]).toEqual({ productId: "P1", quantity: 2, unitPrice: 19.99 });
  });

  it("omits optional note/currencyUomId when not provided", () => {
    const body = buildExchangeCreateBody(base);
    expect("note" in body).toBe(false);
    expect("currencyUomId" in body).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/omsAdapter.spec.ts`
Expected: FAIL — `body.fulfillmentType` is `undefined` (the builder doesn't emit it yet).

- [ ] **Step 3: Update `buildExchangeCreateBody`**

In `src/adapters/omsAdapter.ts`, replace the `buildExchangeCreateBody` function (and its doc comment) with:

```ts
/** Build the POST body for the customerExchange create call. unitPrice is omitted per item when absent
 *  (backend defaults to the product price → even swap). fulfillmentType is required; SHIPPED carries
 *  shipmentMethodTypeId (ignored server-side until the backend threads it through), IMMEDIATE carries
 *  facilityId (origin facility issued from now). Optional note/currencyUomId are omitted when empty. */
export function buildExchangeCreateBody(input: CreateExchangeInput): {
  orderId: string;
  returnItems: Array<{ orderItemSeqId: string; returnQuantity: number; returnReasonId: string }>;
  exchangeItems: ExchangeItemInput[]; fulfillmentType: FulfillmentType;
  shipmentMethodTypeId?: string; facilityId?: string; note?: string; currencyUomId?: string;
} {
  return {
    orderId: input.orderId,
    returnItems: input.returnItems.map((i) => ({
      orderItemSeqId: i.orderItemSeqId,
      returnQuantity: i.returnQuantity,
      returnReasonId: i.returnReasonId,
    })),
    exchangeItems: input.exchangeItems.map((e) => ({
      productId: e.productId,
      quantity: e.quantity,
      ...(e.unitPrice != null ? { unitPrice: e.unitPrice } : {}),
    })),
    fulfillmentType: input.fulfillmentType,
    ...(input.shipmentMethodTypeId ? { shipmentMethodTypeId: input.shipmentMethodTypeId } : {}),
    ...(input.facilityId ? { facilityId: input.facilityId } : {}),
    ...(input.note ? { note: input.note } : {}),
    ...(input.currencyUomId ? { currencyUomId: input.currencyUomId } : {}),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/omsAdapter.spec.ts`
Expected: PASS.

- [ ] **Step 5: Add `listShipmentMethods` and drop `facilityId` from `completeReturn`**

In `src/adapters/omsAdapter.ts`:

(a) Add `ShipmentMethod` to the type import from `@/types/returns`.

(b) Replace the `completeReturn` method body with the no-facility version:

```ts
  async completeReturn(returnId) {
    // OMS -> RETURN_COMPLETED immediately; the Shopify completion (returnProcess + returnClose) runs async.
    const resp: any = await omsApi({ url: `oms/returns/${returnId}/complete`, method: "POST" });
    if (commonUtil.hasError(resp)) throw new Error("Failed to complete return");
  },
```

(c) Add `listShipmentMethods` immediately after `listFacilities`:

```ts
  async listShipmentMethods(): Promise<ShipmentMethod[]> {
    // Global shipment method types (the create-page picker for a shipped exchange).
    const resp: any = await omsApi({ url: "oms/shippingGateways/shipmentMethodTypes", method: "GET" });
    if (commonUtil.hasError(resp)) throw new Error("Failed to load shipment methods");
    const rows: any[] = Array.isArray(resp.data) ? resp.data : resp.data?.shipmentMethodTypes ?? [];
    return rows.map((m) => ({
      shipmentMethodTypeId: m.shipmentMethodTypeId,
      description: m.description ?? m.shipmentMethodTypeId,
    }));
  },
```

- [ ] **Step 6: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: `omsAdapter.ts` is clean. Remaining errors (if any) are in `stubAdapter.ts`/`returnsStore.ts`/views — fixed in later tasks.

- [ ] **Step 7: Commit**

```bash
git add src/adapters/omsAdapter.ts tests/unit/omsAdapter.spec.ts
git commit -m "feat(returns): omsAdapter create-time fulfillment + shipment methods"
```

---

## Task 4: stubAdapter

**Files:**
- Modify: `src/adapters/stubAdapter.ts`
- Test: `tests/unit/stubAdapter.spec.ts`

- [ ] **Step 1: Rewrite the exchange unit tests for the new flow**

Open `tests/unit/stubAdapter.spec.ts`. Replace the three exchange-related tests (the "created at the _NA_ facility" creation test, the approve-brokers test, and the "completing an exchange from a facility" test) and the facilities test with the block below. Keep all other tests as-is. If a removed test referenced `approveReturn`/`completeReturn(returnId, "STORE_DT")` for an exchange, it is replaced here.

```ts
  it("creates a SHIPPED exchange approved on both halves", async () => {
    const { returnId, replacementOrderId } = await stubAdapter.createExchange({
      orderId: "DEMO-1001",
      returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      exchangeItems: [{ productId: "P1", quantity: 1 }],
      fulfillmentType: "SHIPPED",
      shipmentMethodTypeId: "STANDARD",
    });
    const detail = await stubAdapter.getReturn(returnId);
    expect(detail.statusId).toBe("RETURN_APPROVED");
    expect(detail.isExchange).toBe(true);
    expect(detail.exchange?.orderStatusId).toBe("ORDER_APPROVED");
    const repl = await stubAdapter.getReplacementOrder(replacementOrderId!);
    expect(repl.statusId).toBe("ORDER_APPROVED");
    expect(repl.fulfillmentType).toBe("SHIPPED");
    expect(repl.shipmentMethod).toBe("Standard Shipping");
  });

  it("creates an IMMEDIATE exchange completed on both halves", async () => {
    const { returnId, replacementOrderId } = await stubAdapter.createExchange({
      orderId: "DEMO-1001",
      returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      exchangeItems: [{ productId: "P1", quantity: 1 }],
      fulfillmentType: "IMMEDIATE",
      facilityId: "STORE_DT",
    });
    const detail = await stubAdapter.getReturn(returnId);
    expect(detail.statusId).toBe("RETURN_COMPLETED");
    expect(detail.exchange?.orderStatusId).toBe("ORDER_COMPLETED");
    const repl = await stubAdapter.getReplacementOrder(replacementOrderId!);
    expect(repl.statusId).toBe("ORDER_COMPLETED");
    expect(repl.fulfillmentType).toBe("IMMEDIATE");
  });

  it("lists physical facilities to fulfill an exchange from", async () => {
    const facilities = await stubAdapter.listFacilities();
    expect(facilities.length).toBeGreaterThan(0);
    expect(facilities[0]).toHaveProperty("facilityId");
    expect(facilities[0]).toHaveProperty("facilityName");
  });

  it("lists shipment methods for the create picker", async () => {
    const methods = await stubAdapter.listShipmentMethods();
    expect(methods.length).toBeGreaterThan(0);
    expect(methods[0]).toHaveProperty("shipmentMethodTypeId");
    expect(methods[0]).toHaveProperty("description");
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/stubAdapter.spec.ts`
Expected: FAIL — `createExchange` still creates `ORDER_CREATED`/`RETURN_REQUESTED`, and `listShipmentMethods` doesn't exist.

- [ ] **Step 3: Add the `SHIPMENT_METHODS` constant + imports**

In `src/adapters/stubAdapter.ts`:

(a) Extend the type import to include `FulfillmentType` and `ShipmentMethod`:

```ts
import type {
  CreateExchangeInput, CreateReturnInput, Facility, FulfillmentType, OrderForReturn, ReplacementOrderDetail,
  ReturnDetail, ReturnReason, ReturnSummary, ShipmentMethod, SyncState, SyncTarget,
} from "@/types/returns";
```

(b) Add this constant right after the `FACILITIES` constant:

```ts
const SHIPMENT_METHODS: ShipmentMethod[] = [
  { shipmentMethodTypeId: "STANDARD", description: "Standard Shipping" },
  { shipmentMethodTypeId: "EXPRESS", description: "Express" },
  { shipmentMethodTypeId: "NEXT_DAY", description: "Next Day" },
];
```

- [ ] **Step 4: Rewrite `createExchange` to branch on fulfillment**

Replace the whole `createExchange` method with:

```ts
  async createExchange({ orderId, returnItems, exchangeItems, fulfillmentType, shipmentMethodTypeId, facilityId }: CreateExchangeInput) {
    const now = "2026-05-29T12:00:00Z";
    const returnId = String(seq++);
    const replacementOrderId = `EXC${returnId}`;
    const immediate = fulfillmentType === "IMMEDIATE";
    const returnStatus = immediate ? "RETURN_COMPLETED" : "RETURN_APPROVED";
    const orderStatus = immediate ? "ORDER_COMPLETED" : "ORDER_APPROVED";
    const shipmentMethod = immediate
      ? "Handed over in store"
      : SHIPMENT_METHODS.find((m) => m.shipmentMethodTypeId === shipmentMethodTypeId)?.description ?? "Standard Shipping";
    store.set(returnId, {
      returnId, type: "standard", orderId, orderName: ORDER.orderName, orderDate: "2026-05-22T08:00:00Z",
      statusId: returnStatus, entryDate: now, origin: "pwa",
      // Exchange push (and close, for immediate) fire at create — arm them so the detail polls them to settled.
      sync: { shopify: "pending" },
      items: returnItems.map((i) => {
        const line = ORDER.items.find((l) => l.orderItemSeqId === i.orderItemSeqId);
        return {
          orderItemSeqId: i.orderItemSeqId, productId: line?.productId ?? "", productName: line?.productName ?? "",
          returnQuantity: i.returnQuantity, returnReasonId: i.returnReasonId,
          returnReasonDesc: REASONS.find((x) => x.returnReasonId === i.returnReasonId)?.description,
        };
      }),
      isExchange: true,
      exchange: {
        replacementOrderId, orderName: `${ORDER.orderName}-EXC`,
        orderStatusId: orderStatus, fulfillmentType, shipmentMethod,
        items: exchangeItems.map((e) => {
          const line = ORDER.items.find((l) => l.productId === e.productId);
          return { productId: e.productId, quantity: e.quantity, unitPrice: line?.unitPrice, itemDescription: line?.productName };
        }),
        exchangeCreditAmount: 0,
      },
      statuses: [{ statusId: "RETURN_REQUESTED", statusDate: now }, { statusId: returnStatus, statusDate: now }],
      externalIds: { shopify: null },
      // Seed shopifyReturnId + CLOSE_PENDING for immediate so getReturn can advance the close once the push lands.
      shopifySync: immediate
        ? { synced: false, pushStatusId: "PUSH_PENDING", shopifyReturnId: `gid://shopify/Return/${replacementOrderId}`, closePushStatusId: "CLOSE_PENDING" }
        : { synced: false, pushStatusId: "PUSH_PENDING" },
      pushAttempted: true, pollsUntilSynced: 0,
      closeAttempted: immediate, pollsUntilClosed: immediate ? 1 : 0,
    });
    void facilityId; // the chosen facility is the issuance origin server-side; not modeled further in the stub
    return { returnId, replacementOrderId };
  },
```

- [ ] **Step 5: Update `getReplacementOrder` to read stored fulfillment**

Replace the `getReplacementOrder` method with:

```ts
  async getReplacementOrder(orderId): Promise<ReplacementOrderDetail> {
    const exchangeReturn = [...store.values()].find((r) => r.exchange?.replacementOrderId === orderId);
    if (!exchangeReturn?.exchange) throw new Error("Replacement order not found");
    const ex = exchangeReturn.exchange;
    const items = (ex.items ?? []).map((it) => ({
      productId: it.productId,
      productName: it.itemDescription ?? ORDER.items.find((l) => l.productId === it.productId)?.productName ?? "",
      sku: ORDER.items.find((l) => l.productId === it.productId)?.sku,
      quantity: it.quantity,
      unitPrice: it.unitPrice ?? 0,
    }));
    // Fulfillment is chosen at create: read it from the stored block. Shipped (approved) carries tracking.
    const shipped = ex.fulfillmentType === "SHIPPED";
    return {
      orderId,
      orderName: ex.orderName ?? orderId,
      orderDate: "2026-05-29T12:00:00Z",
      statusId: ex.orderStatusId ?? "ORDER_APPROVED",
      currencyUomId: "USD",
      grandTotal: items.reduce((s, it) => s + it.unitPrice * it.quantity, 0),
      fulfillmentType: ex.fulfillmentType,
      shipmentMethod: ex.shipmentMethod,
      trackingCode: shipped && ex.orderStatusId === "ORDER_APPROVED" ? "1Z999AA10123456784" : undefined,
      carrier: shipped ? "UPS" : undefined,
      items,
    };
  },
```

- [ ] **Step 6: Drop `facilityId` from the stub `completeReturn`**

Replace the `completeReturn` method with (removes the `facilityId` param and the exchange "completable from REQUESTED" special case — exchanges no longer sit at REQUESTED):

```ts
  async completeReturn(returnId) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    if (r.statusId === "RETURN_COMPLETED") return; // idempotent: already completed
    if (!["RETURN_APPROVED", "RETURN_RECEIVED"].includes(r.statusId)) throw new Error("Return cannot be completed");
    r.statusId = "RETURN_COMPLETED";
    r.statuses = [...r.statuses, { statusId: "RETURN_COMPLETED", statusDate: "2026-05-29T12:10:00Z" }];
    if (r.isExchange && r.exchange) r.exchange = { ...r.exchange, orderStatusId: "ORDER_COMPLETED" };
    if (r.shopifySync?.shopifyReturnId) {
      r.closeAttempted = true;
      r.pollsUntilClosed = 1;
      r.shopifySync = { ...r.shopifySync, closePushStatusId: "CLOSE_PENDING" };
    }
  },
```

- [ ] **Step 7: Add `listShipmentMethods`**

Add immediately after the `listFacilities` method:

```ts
  async listShipmentMethods() {
    return SHIPMENT_METHODS;
  },
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/stubAdapter.spec.ts`
Expected: PASS. If a stale exchange test elsewhere in the file still calls `approveReturn(returnId)` on an exchange and asserts `ORDER_APPROVED`, delete that assertion path — approval is no longer part of the exchange flow.

- [ ] **Step 9: Commit**

```bash
git add src/adapters/stubAdapter.ts tests/unit/stubAdapter.spec.ts
git commit -m "feat(returns): stubAdapter create-time exchange fulfillment"
```

---

## Task 5: Store

**Files:**
- Modify: `src/store/returnsStore.ts`
- Test: `tests/unit/returnsStoreCrud.spec.ts`

- [ ] **Step 1: Write a failing test for `loadShipmentMethods`**

In `tests/unit/returnsStoreCrud.spec.ts`, add a test (place it near the other store action tests; the file already sets up a Pinia store named `store`):

```ts
  it("loadShipmentMethods returns the service's shipment methods", async () => {
    const methods = await store.loadShipmentMethods();
    expect(methods.length).toBeGreaterThan(0);
    expect(methods[0]).toHaveProperty("shipmentMethodTypeId");
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/returnsStoreCrud.spec.ts`
Expected: FAIL — `store.loadShipmentMethods is not a function`.

- [ ] **Step 3: Add `loadShipmentMethods` and fix `completeReturn` arity**

In `src/store/returnsStore.ts`:

(a) Add the action next to `loadFacilities`:

```ts
    /** Shipment methods for the create-page exchange picker (shown for a shipped exchange). */
    async loadShipmentMethods() {
      return getReturnsService().listShipmentMethods();
    },
```

(b) Replace the `completeReturn` action with the no-facility version:

```ts
    async completeReturn(returnId: string, opts: { intervalMs?: number; maxAttempts?: number } = {}) {
      await getReturnsService().completeReturn(returnId);
      return this.pollCompletion(returnId, opts);
    },
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/unit/returnsStoreCrud.spec.ts`
Expected: PASS.

- [ ] **Step 5: Update the store's exchange submit tests to send fulfillment**

The existing `submitExchange(...)` calls in this file must now include `fulfillmentType`. For each `store.submitExchange({ … })` call, add `fulfillmentType: "SHIPPED", shipmentMethodTypeId: "STANDARD"` to the object. Run the file again to confirm green:

Run: `npx vitest run tests/unit/returnsStoreCrud.spec.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/returnsStore.ts tests/unit/returnsStoreCrud.spec.ts
git commit -m "feat(returns): store loadShipmentMethods + complete arity"
```

---

## Task A: Address + geo types

> Shipping-address feature (folded in). Execute after Task 5, before Task 6. Spec:
> `docs/superpowers/specs/2026-06-02-exchange-shipping-address-design.md`.

**Files:** Modify `src/types/returns.ts`

- [ ] **Step 1: Add `PostalAddress` and `Geo`** — add after the `ShipmentMethod` interface:

```ts
/** A postal address (replacement ship-to / order ship-to). geoIds drive the country/state dropdowns. */
export interface PostalAddress {
  toName?: string;
  attnName?: string;
  address1: string;
  address2?: string;
  city: string;
  stateProvinceGeoId?: string;  // omitted for countries without a state level
  postalCode: string;
  countryGeoId: string;
  phone?: string;
}

/** A selectable geo (country or state/province) for the address dropdowns. */
export interface Geo {
  geoId: string;
  geoName: string;
}
```

- [ ] **Step 2: Add `shippingAddress` to `OrderForReturn`** — add a field to the `OrderForReturn` interface:

```ts
  shippingAddress?: PostalAddress; // the order's ship-to; prefills the exchange shipping-address form
```

- [ ] **Step 3: Add `shippingAddress` to `CreateExchangeInput`** — add after `facilityId?: string;`:

```ts
  shippingAddress?: PostalAddress; // SHIPPED only — the replacement order's ship-to (geoIds from the dropdowns)
```

- [ ] **Step 4: Type-check** — `npx vue-tsc --noEmit`. Expected: no NEW errors from `returns.ts` (cross-file errors from earlier tasks may remain until their tasks run; the known pre-existing `ReturnsList.vue:32` error is unrelated).

- [ ] **Step 5: Commit**

```bash
git add src/types/returns.ts
git commit -m "feat(returns): types for exchange shipping address + geos"
```

---

## Task B: Service contract for geos

**Files:** Modify `src/services/ReturnsService.ts`

- [ ] **Step 1: Add `Geo` to the import and two methods to the interface** — add `Geo` to the type import list, then add next to `listShipmentMethods`:

```ts
  // Geo lists for the create-page shipping-address dropdowns (SHIPPED exchange).
  listCountries(): Promise<Geo[]>;
  listStates(countryGeoId: string): Promise<Geo[]>;
```

- [ ] **Step 2: Type-check** — `npx vue-tsc --noEmit`. Expected: errors in `omsAdapter.ts`/`stubAdapter.ts` for the not-yet-implemented `listCountries`/`listStates` (resolved in Tasks C/D).

- [ ] **Step 3: Commit**

```bash
git add src/services/ReturnsService.ts
git commit -m "feat(returns): service contract for geo lists"
```

---

## Task C: omsAdapter — address mapping + geos

**Files:** Modify `src/adapters/omsAdapter.ts`; Test `tests/unit/omsAdapter.spec.ts`

- [ ] **Step 1: Write failing tests** — append to `tests/unit/omsAdapter.spec.ts` (the file imports from `@/adapters/omsAdapter`; add `mapPostalAddress` to that import). Add:

```ts
describe("mapPostalAddress", () => {
  it("maps a full address and omits empty optionals", () => {
    const a = mapPostalAddress({
      toName: "Jane Doe", address1: "123 Main St", address2: "Apt 4", city: "Austin",
      stateProvinceGeoId: "USA_TX", postalCode: "78701", countryGeoId: "USA", phone: "+1 512 555 0100",
    });
    expect(a).toEqual({
      toName: "Jane Doe", address1: "123 Main St", address2: "Apt 4", city: "Austin",
      stateProvinceGeoId: "USA_TX", postalCode: "78701", countryGeoId: "USA", phone: "+1 512 555 0100",
    });
  });
  it("returns undefined when there is no address1", () => {
    expect(mapPostalAddress(null)).toBeUndefined();
    expect(mapPostalAddress({ city: "Austin" })).toBeUndefined();
  });
});

describe("mapOrderToReturnable shippingAddress", () => {
  it("surfaces the first ship group's shipping address", () => {
    const o = mapOrderToReturnable({
      orderDetail: {
        orderId: "DEMO-1001",
        shipGroups: [{ shippingAddress: { address1: "1 A St", city: "Austin", postalCode: "78701", countryGeoId: "USA" }, items: [] }],
      },
    });
    expect(o.shippingAddress).toMatchObject({ address1: "1 A St", city: "Austin", countryGeoId: "USA" });
  });
});

describe("buildExchangeCreateBody shippingAddress", () => {
  const base = {
    orderId: "DEMO-1001",
    returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
    exchangeItems: [{ productId: "P1", quantity: 1 }],
    fulfillmentType: "SHIPPED" as const,
  };
  it("includes shippingAddress when present, omits it when absent", () => {
    const addr = { address1: "1 A St", city: "Austin", postalCode: "78701", countryGeoId: "USA" };
    expect((buildExchangeCreateBody({ ...base, shippingAddress: addr }) as any).shippingAddress).toEqual(addr);
    expect("shippingAddress" in buildExchangeCreateBody(base)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/omsAdapter.spec.ts` → FAIL (`mapPostalAddress` undefined).

- [ ] **Step 3: Implement.** In `src/adapters/omsAdapter.ts`:

(a) Add `Geo` and `PostalAddress` to the type import from `@/types/returns`.

(b) Add a raw type + the pure mapper (place near `mapOrderToReturnable`):

```ts
interface RawPostalAddress {
  toName?: string; attnName?: string; address1?: string; address2?: string; city?: string;
  stateProvinceGeoId?: string; postalCode?: string; countryGeoId?: string; phone?: string;
}

/** Map a raw ship-group postal address; returns undefined when there's no usable address (no address1). */
export function mapPostalAddress(raw?: RawPostalAddress | null): PostalAddress | undefined {
  if (!raw || !raw.address1) return undefined;
  return {
    ...(raw.toName ? { toName: raw.toName } : {}),
    ...(raw.attnName ? { attnName: raw.attnName } : {}),
    address1: raw.address1,
    ...(raw.address2 ? { address2: raw.address2 } : {}),
    city: raw.city ?? "",
    ...(raw.stateProvinceGeoId ? { stateProvinceGeoId: raw.stateProvinceGeoId } : {}),
    postalCode: raw.postalCode ?? "",
    countryGeoId: raw.countryGeoId ?? "",
    ...(raw.phone ? { phone: raw.phone } : {}),
  };
}
```

(c) Add `shippingAddress?: RawPostalAddress;` to the `RawShipGroup` interface.

(d) In `mapOrderToReturnable`, surface the address — change the returned object to include it. Just before the `return {`, add:

```ts
  const shippingAddress = (raw.orderDetail.shipGroups ?? [])
    .map((g) => mapPostalAddress(g.shippingAddress))
    .find((a) => a != null);
```

and add to the returned object (after `items,`):

```ts
    ...(shippingAddress ? { shippingAddress } : {}),
```

(e) In `buildExchangeCreateBody`, add `shippingAddress?: PostalAddress;` to the return-type annotation, and add to the returned object (after the `facilityId` spread):

```ts
    ...(input.shippingAddress ? { shippingAddress: input.shippingAddress } : {}),
```

(f) Add the two geo fetchers after `listShipmentMethods`:

```ts
  async listCountries(): Promise<Geo[]> {
    const resp: any = await omsApi({ url: "oms/geos", method: "GET", params: { geoTypeId: "COUNTRY", pageSize: 300 } });
    if (commonUtil.hasError(resp)) throw new Error("Failed to load countries");
    const rows: any[] = Array.isArray(resp.data) ? resp.data : resp.data?.geos ?? [];
    return rows.map((g) => ({ geoId: g.geoId, geoName: g.geoName ?? g.geoId }));
  },
  async listStates(countryGeoId: string): Promise<Geo[]> {
    const resp: any = await omsApi({ url: "oms/geos", method: "GET", params: { geoIdFrom: countryGeoId, geoTypeId: "PROVINCE", pageSize: 300 } });
    if (commonUtil.hasError(resp)) throw new Error("Failed to load states");
    const rows: any[] = Array.isArray(resp.data) ? resp.data : resp.data?.geos ?? [];
    return rows.map((g) => ({ geoId: g.geoId, geoName: g.geoName ?? g.geoId }));
  },
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/omsAdapter.spec.ts` → PASS.

- [ ] **Step 5: Type-check** — `npx vue-tsc --noEmit` → `omsAdapter.ts` clean.

- [ ] **Step 6: Commit**

```bash
git add src/adapters/omsAdapter.ts tests/unit/omsAdapter.spec.ts
git commit -m "feat(returns): omsAdapter shipping-address mapping + geo lists"
```

---

## Task D: stubAdapter — address + geos

**Files:** Modify `src/adapters/stubAdapter.ts`; Test `tests/unit/stubAdapter.spec.ts`

- [ ] **Step 1: Write failing tests** — append to `tests/unit/stubAdapter.spec.ts`:

```ts
  it("the demo order carries a shipping address", async () => {
    const order = await stubAdapter.getOrderForReturn("DEMO-1001");
    expect(order.shippingAddress).toBeDefined();
    expect(order.shippingAddress?.countryGeoId).toBe("USA");
  });

  it("lists countries and a country's states ([] for unknown)", async () => {
    const countries = await stubAdapter.listCountries();
    expect(countries.find((c) => c.geoId === "USA")).toBeDefined();
    const states = await stubAdapter.listStates("USA");
    expect(states.length).toBeGreaterThan(0);
    expect(await stubAdapter.listStates("ZZZ")).toEqual([]);
  });

  it("stores the submitted shipping address on the exchange", async () => {
    const addr = { address1: "9 New St", city: "Dallas", stateProvinceGeoId: "USA_TX", postalCode: "75201", countryGeoId: "USA" };
    const { returnId } = await stubAdapter.createExchange({
      orderId: "DEMO-1001",
      returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      exchangeItems: [{ productId: "P1", quantity: 1 }],
      fulfillmentType: "SHIPPED", shipmentMethodTypeId: "STANDARD", shippingAddress: addr,
    });
    const detail = await stubAdapter.getReturn(returnId);
    expect(detail.exchange?.shippingAddress).toMatchObject({ address1: "9 New St", city: "Dallas" });
  });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/stubAdapter.spec.ts` → FAIL.

- [ ] **Step 3: Implement.** In `src/adapters/stubAdapter.ts`:

(a) Add `Geo` and `PostalAddress` to the type import.

(b) Add a `shippingAddress` to the demo `ORDER` constant (add the field to the `ORDER` object):

```ts
  shippingAddress: {
    toName: "Demo Customer", address1: "500 Congress Ave", city: "Austin",
    stateProvinceGeoId: "USA_TX", postalCode: "78701", countryGeoId: "USA", phone: "+1 512 555 0100",
  },
```

(c) Add canned geo data near the `FACILITIES` constant:

```ts
const COUNTRIES: Geo[] = [
  { geoId: "USA", geoName: "United States" },
  { geoId: "CAN", geoName: "Canada" },
];
const STATES: Record<string, Geo[]> = {
  USA: [
    { geoId: "USA_TX", geoName: "Texas" },
    { geoId: "USA_CA", geoName: "California" },
    { geoId: "USA_NY", geoName: "New York" },
  ],
  CAN: [
    { geoId: "CAN_ON", geoName: "Ontario" },
    { geoId: "CAN_BC", geoName: "British Columbia" },
  ],
};
```

(d) Add the `ExchangeDetail` block's address: in `createExchange`, add `...(shippingAddress ? { shippingAddress } : {})` to the `exchange:` object literal, and destructure `shippingAddress` from the input parameter. (NOTE: `ExchangeDetail` needs a `shippingAddress?: PostalAddress` field — add it to the `ExchangeDetail` interface in `src/types/returns.ts` as part of this task, and import `PostalAddress` there if not already imported. Commit that type tweak with this task.)

(e) Add the geo fetchers after `listShipmentMethods`:

```ts
  async listCountries() {
    return COUNTRIES;
  },
  async listStates(countryGeoId: string) {
    return STATES[countryGeoId] ?? [];
  },
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/stubAdapter.spec.ts` → PASS.

- [ ] **Step 5: Type-check** — `npx vue-tsc --noEmit` → stub clean (views still pending Task 6).

- [ ] **Step 6: Commit**

```bash
git add src/adapters/stubAdapter.ts tests/unit/stubAdapter.spec.ts src/types/returns.ts
git commit -m "feat(returns): stubAdapter shipping address + geo lists"
```

---

## Task E: Store geo actions

**Files:** Modify `src/store/returnsStore.ts`; Test `tests/unit/returnsStoreCrud.spec.ts`

- [ ] **Step 1: Write failing tests** — add to `tests/unit/returnsStoreCrud.spec.ts`:

```ts
  it("loadCountries and loadStates proxy the service", async () => {
    const countries = await store.loadCountries();
    expect(countries.length).toBeGreaterThan(0);
    const states = await store.loadStates("USA");
    expect(states.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run tests/unit/returnsStoreCrud.spec.ts` → FAIL.

- [ ] **Step 3: Implement** — add next to `loadShipmentMethods` in `src/store/returnsStore.ts`:

```ts
    /** Countries for the create-page shipping-address dropdown. */
    async loadCountries() {
      return getReturnsService().listCountries();
    },
    /** States/provinces for a chosen country (empty when the country has none). */
    async loadStates(countryGeoId: string) {
      return getReturnsService().listStates(countryGeoId);
    },
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run tests/unit/returnsStoreCrud.spec.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/returnsStore.ts tests/unit/returnsStoreCrud.spec.ts
git commit -m "feat(returns): store loadCountries/loadStates"
```

---

## Task 6: Create form (`CreateReturn.vue`) — fulfillment pickers + shipping address

Builds the SHIPPED shipment-method picker, the IMMEDIATE facility picker, AND the SHIPPED shipping-address
block in one pass. Depends on Tasks 1–5 (fulfillment) and Tasks A–E (address + geos).

**Files:**
- Modify: `src/views/CreateReturn.vue`
- Test: `tests/unit/CreateReturn.spec.ts`

- [ ] **Step 1: Rewrite the exchange create tests**

In `tests/unit/CreateReturn.spec.ts`, replace the two exchange tests (`"submits a same-product exchange …"` and `"hides the appeasement and ignores it in exchange mode"`) with the four below. NOTE: the demo order (`DEMO-1001`) carries a shipping address (Task D), so a SHIPPED exchange's address is prefilled and already valid after lookup — the shipped test relies on that.

```ts
  it("shipped exchange: prefills address, requires a method, submits fulfillment + method + address, lands approved", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    await (wrapper.vm as any).setMode("exchange");
    await flushPromises();
    expect(wrapper.find("[data-testid=create-fulfillment-segment]").exists()).toBe(true);
    // Address prefilled from the order.
    expect((wrapper.vm as any).shippingAddress.address1).toBe("500 Congress Ave");
    expect((wrapper.vm as any).shippingAddress.countryGeoId).toBe("USA");
    (wrapper.vm as any).selections["00001"] = { qty: 1, returnReasonId: "RTN_SIZE_EXCHANGE" };
    await flushPromises();
    // Address is valid (prefilled), but no method chosen yet → submit blocked.
    expect((wrapper.vm as any).canSubmit).toBe(false);
    (wrapper.vm as any).selectedShipmentMethodId = "STANDARD";
    await flushPromises();
    expect((wrapper.vm as any).canSubmit).toBe(true);
    const id = await (wrapper.vm as any).submit();
    expect(id).toBeTruthy();
    const created = await getReturnsService().getReturn(id);
    expect(created.isExchange).toBe(true);
    expect(created.statusId).toBe("RETURN_APPROVED");
    expect(created.exchange?.orderStatusId).toBe("ORDER_APPROVED");
    expect(created.exchange?.shippingAddress?.address1).toBe("500 Congress Ave");
  });

  it("shipped exchange: an incomplete address blocks submit", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    await (wrapper.vm as any).setMode("exchange");
    await flushPromises();
    (wrapper.vm as any).selections["00001"] = { qty: 1, returnReasonId: "RTN_SIZE_EXCHANGE" };
    (wrapper.vm as any).selectedShipmentMethodId = "STANDARD";
    (wrapper.vm as any).shippingAddress.address1 = ""; // clear a required field
    await flushPromises();
    expect((wrapper.vm as any).canSubmit).toBe(false);
  });

  it("immediate exchange: requires a facility, no address, submits fulfillmentType + facilityId, lands completed", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    await (wrapper.vm as any).setMode("exchange");
    await flushPromises();
    (wrapper.vm as any).exchangeFulfillment = "IMMEDIATE";
    (wrapper.vm as any).selections["00001"] = { qty: 1, returnReasonId: "RTN_SIZE_EXCHANGE" };
    await flushPromises();
    expect((wrapper.vm as any).canSubmit).toBe(false);
    (wrapper.vm as any).selectedFacilityId = "STORE_DT";
    await flushPromises();
    expect((wrapper.vm as any).canSubmit).toBe(true);
    const id = await (wrapper.vm as any).submit();
    const created = await getReturnsService().getReturn(id);
    expect(created.statusId).toBe("RETURN_COMPLETED");
    expect(created.exchange?.orderStatusId).toBe("ORDER_COMPLETED");
    expect(created.exchange?.shippingAddress).toBeUndefined();
  });

  it("changing the country loads its states and clears the chosen state", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    await (wrapper.vm as any).setMode("exchange");
    await flushPromises();
    await (wrapper.vm as any).onCountryChange("CAN");
    await flushPromises();
    expect((wrapper.vm as any).shippingAddress.countryGeoId).toBe("CAN");
    expect((wrapper.vm as any).shippingAddress.stateProvinceGeoId).toBeFalsy();
    expect((wrapper.vm as any).states.some((s: any) => s.geoId === "CAN_ON")).toBe(true);
  });

  it("hides the appeasement and ignores it in exchange mode", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    await (wrapper.vm as any).setMode("exchange");
    await flushPromises();
    expect((wrapper.vm as any).appeasementEnabled).toBe(false);
    expect(wrapper.find("[data-testid=create-appeasement-toggle]").exists()).toBe(false);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/CreateReturn.spec.ts`
Expected: FAIL — no `create-fulfillment-segment`, no `shippingAddress`/`onCountryChange`, `setMode` is sync, etc.

- [ ] **Step 3: Add the Fulfillment card (with the SHIPPED address block) to the template**

In `src/views/CreateReturn.vue`, replace the fulfillment comment block (the `<!-- Fulfillment is no longer chosen here … -->` comment near the end of `<main>`) with:

```html
          <ion-card v-if="order && hasReturnable && mode === 'exchange'" class="fulfillment">
            <ion-card-header>
              <ion-card-title>{{ translate("Fulfillment") }}</ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <ion-segment data-testid="create-fulfillment-segment" :value="exchangeFulfillment"
                @ionChange="exchangeFulfillment = $event.detail.value as FulfillmentType">
                <ion-segment-button value="SHIPPED" data-testid="create-fulfillment-shipped">
                  <ion-label>{{ translate("Ship to customer") }}</ion-label>
                </ion-segment-button>
                <ion-segment-button value="IMMEDIATE" data-testid="create-fulfillment-immediate">
                  <ion-label>{{ translate("Hand over now") }}</ion-label>
                </ion-segment-button>
              </ion-segment>

              <template v-if="exchangeFulfillment === 'SHIPPED'">
                <ion-item>
                  <ion-select data-testid="create-shipment-method" :label="translate('Shipment method')"
                    label-placement="stacked" :placeholder="translate('Select a method')"
                    :value="selectedShipmentMethodId" @ionChange="selectedShipmentMethodId = $event.detail.value">
                    <ion-select-option v-for="m in shipmentMethods" :key="m.shipmentMethodTypeId" :value="m.shipmentMethodTypeId">{{ m.description }}</ion-select-option>
                  </ion-select>
                </ion-item>
                <p class="muted ion-padding-start">{{ translate("Shipped exchanges currently ship Standard regardless of selection; more methods arrive when the backend lands.") }}</p>

                <!-- Shipping address: editable, prefilled from the order; geoIds drive country/state. -->
                <h3 class="ion-padding-start">{{ translate("Shipping address") }}</h3>
                <ion-item>
                  <ion-input data-testid="create-ship-toName" :label="translate('Recipient')" label-placement="stacked"
                    :value="shippingAddress.toName" @ionInput="shippingAddress.toName = $event.target.value ?? ''" />
                </ion-item>
                <ion-item>
                  <ion-input data-testid="create-ship-address1" :label="translate('Address line 1')" label-placement="stacked"
                    :value="shippingAddress.address1" @ionInput="shippingAddress.address1 = $event.target.value ?? ''" />
                </ion-item>
                <ion-item>
                  <ion-input data-testid="create-ship-address2" :label="translate('Address line 2')" label-placement="stacked"
                    :value="shippingAddress.address2" @ionInput="shippingAddress.address2 = $event.target.value ?? ''" />
                </ion-item>
                <ion-item>
                  <ion-input data-testid="create-ship-city" :label="translate('City')" label-placement="stacked"
                    :value="shippingAddress.city" @ionInput="shippingAddress.city = $event.target.value ?? ''" />
                </ion-item>
                <ion-item>
                  <ion-select data-testid="create-ship-country" :label="translate('Country')" label-placement="stacked"
                    :placeholder="translate('Select a country')" :value="shippingAddress.countryGeoId"
                    @ionChange="onCountryChange($event.detail.value)">
                    <ion-select-option v-for="c in countries" :key="c.geoId" :value="c.geoId">{{ c.geoName }}</ion-select-option>
                  </ion-select>
                </ion-item>
                <ion-item v-if="states.length">
                  <ion-select data-testid="create-ship-state" :label="translate('State / Province')" label-placement="stacked"
                    :placeholder="translate('Select a state / province')" :value="shippingAddress.stateProvinceGeoId"
                    @ionChange="shippingAddress.stateProvinceGeoId = $event.detail.value">
                    <ion-select-option v-for="s in states" :key="s.geoId" :value="s.geoId">{{ s.geoName }}</ion-select-option>
                  </ion-select>
                </ion-item>
                <ion-item>
                  <ion-input data-testid="create-ship-postalCode" :label="translate('Postal code')" label-placement="stacked"
                    :value="shippingAddress.postalCode" @ionInput="shippingAddress.postalCode = $event.target.value ?? ''" />
                </ion-item>
                <ion-item>
                  <ion-input data-testid="create-ship-phone" :label="translate('Phone')" label-placement="stacked"
                    :value="shippingAddress.phone" @ionInput="shippingAddress.phone = $event.target.value ?? ''" />
                </ion-item>
              </template>

              <template v-else>
                <ion-item>
                  <ion-select data-testid="create-fulfillment-facility" :label="translate('Fulfillment facility')"
                    label-placement="stacked" :placeholder="translate('Select a facility')"
                    :value="selectedFacilityId" @ionChange="selectedFacilityId = $event.detail.value">
                    <ion-select-option v-for="f in facilities" :key="f.facilityId" :value="f.facilityId">{{ f.facilityName }}</ion-select-option>
                  </ion-select>
                </ion-item>
                <p class="muted ion-padding-start">{{ translate("Stock is issued from this facility now.") }}</p>
              </template>
            </ion-card-content>
          </ion-card>
```

Ensure `IonInput` is imported from `@ionic/vue` in this file (it likely already is; add it to the import list if not).

- [ ] **Step 4: Add state, lazy loading, validation, prefill, and submit fields to the script**

In `src/views/CreateReturn.vue` `<script setup>`:

(a) Extend the type import:

```ts
import type { Facility, FulfillmentType, Geo, OrderForReturn, PostalAddress, ReturnReason, ShipmentMethod } from "@/types/returns";
```

(b) Add reactive state near the other `ref`s (after `const mode = ref…`):

```ts
const exchangeFulfillment = ref<FulfillmentType>("SHIPPED");
const shipmentMethods = ref<ShipmentMethod[]>([]);
const facilities = ref<Facility[]>([]);
const selectedShipmentMethodId = ref<string>("");
const selectedFacilityId = ref<string>("");
const fulfillmentOptionsLoaded = ref(false);
// Shipping address (SHIPPED only) — prefilled from the order, fully editable. geoIds drive the dropdowns.
const shippingAddress = reactive<PostalAddress>({ address1: "", city: "", postalCode: "", countryGeoId: "" });
const countries = ref<Geo[]>([]);
const states = ref<Geo[]>([]);
```

(c) Replace the existing `setMode` function with an async version that lazily loads the pickers + countries:

```ts
async function setMode(m: "return" | "exchange") {
  mode.value = m;
  if (m === "exchange") {
    appeasementEnabled.value = false; // appeasement is unavailable for exchanges
    if (!fulfillmentOptionsLoaded.value) {
      fulfillmentOptionsLoaded.value = true;
      // Each picker degrades independently — a failure of one must not block the others or the form.
      const [methods, facs, ctys] = await Promise.allSettled([
        store.loadShipmentMethods(), store.loadFacilities(), store.loadCountries(),
      ]);
      shipmentMethods.value = methods.status === "fulfilled" ? methods.value : [];
      facilities.value = facs.status === "fulfilled" ? facs.value : [];
      countries.value = ctys.status === "fulfilled" ? ctys.value : [];
    }
  }
}
```

(d) Add a country-change handler and a prefill helper:

```ts
// Reload states for a newly chosen country and clear the now-stale state selection.
async function onCountryChange(countryGeoId: string) {
  shippingAddress.countryGeoId = countryGeoId;
  shippingAddress.stateProvinceGeoId = undefined;
  states.value = countryGeoId ? await store.loadStates(countryGeoId) : [];
}
// Prefill the address fields from the order's shipping address (and load that country's states).
async function prefillShippingAddress() {
  const a = order.value?.shippingAddress;
  if (!a) return;
  Object.assign(shippingAddress, { address2: undefined, toName: undefined, attnName: undefined, phone: undefined, stateProvinceGeoId: undefined }, a);
  states.value = a.countryGeoId ? await store.loadStates(a.countryGeoId) : [];
}
```

(e) Call `prefillShippingAddress()` at the end of `lookupOrder()` after `order.value` is set (inside the `try`, after reasons load). It is safe to call even before the operator opens exchange mode.

(f) Add an address-validity computed and fold it into `canSubmit`:

```ts
// A shipped exchange needs a complete address: street, city, postal, country, and a state when the
// chosen country has a state level (states list non-empty).
const shippingAddressValid = computed(() =>
  !!shippingAddress.address1 && !!shippingAddress.city && !!shippingAddress.postalCode
    && !!shippingAddress.countryGeoId && (states.value.length === 0 || !!shippingAddress.stateProvinceGeoId));

const canSubmit = computed(() =>
  mode.value === "exchange"
    ? hasItemsSelected.value && (exchangeFulfillment.value === "SHIPPED"
        ? !!selectedShipmentMethodId.value && shippingAddressValid.value
        : !!selectedFacilityId.value)
    : (hasItemsSelected.value || appeasementEnabled.value) && appeasementValid.value);
```

(g) In `submit()`, in the exchange branch, replace the `store.submitExchange({ … })` call with:

```ts
      exchangeReturnId = await store.submitExchange({
        orderId: order.value.orderId, returnItems, exchangeItems, currencyUomId: order.value.currencyUomId,
        fulfillmentType: exchangeFulfillment.value,
        ...(exchangeFulfillment.value === "SHIPPED"
          ? { shipmentMethodTypeId: selectedShipmentMethodId.value, shippingAddress: { ...shippingAddress } }
          : { facilityId: selectedFacilityId.value }),
      });
```

(h) Add the new state to `defineExpose` (append to the existing object):

```ts
  exchangeFulfillment, shipmentMethods, facilities, selectedShipmentMethodId, selectedFacilityId,
  shippingAddress, countries, states, onCountryChange, shippingAddressValid,
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run tests/unit/CreateReturn.spec.ts`
Expected: PASS. If the shipped test's `canSubmit` is false after selecting a method, confirm `prefillShippingAddress` ran (the demo order address sets a valid `USA`/`USA_TX` address and its states load).

- [ ] **Step 6: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: `CreateReturn.vue` clean.

- [ ] **Step 7: Commit**

```bash
git add src/views/CreateReturn.vue tests/unit/CreateReturn.spec.ts
git commit -m "feat(returns): create-form exchange fulfillment pickers + shipping address"
```

---

## Task 7: Exchange detail (`ExchangeDetail.vue`) — read-only (no lifecycle actions)

Exchanges are created at their terminal state and **cannot be approved, completed, rejected, or canceled**.
The detail screen is therefore **read-only**: header, Returning section, Shopify sync card (+ Retry on a
failed push), the completion/close card (+ Retry, for immediate), and the Replacement panel. No "Actions"
card at all.

**Files:**
- Modify: `src/views/ExchangeDetail.vue`
- Test: `tests/unit/ExchangeDetail.spec.ts` (exists — replace its action-button assertions)

- [ ] **Step 1: Replace the unit test to assert NO lifecycle action buttons**

`tests/unit/ExchangeDetail.spec.ts` exists. Replace its body (keep imports/helpers that already work in the file; the shape below shows the intent — adapt to the file's existing setup/mount helpers). It mounts the view and drives `enter()` directly, since `onIonViewWillEnter` doesn't fire under a plain mount:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import ExchangeDetail from "@/views/ExchangeDetail.vue";
import { useReturnsStore } from "@/store/returnsStore";
import { getReturnsService } from "@/services/ReturnsService";

beforeEach(() => setActivePinia(createPinia()));

async function makeExchange(fulfillmentType: "SHIPPED" | "IMMEDIATE") {
  const svc = getReturnsService();
  const { returnId } = await svc.createExchange({
    orderId: "DEMO-1001",
    returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
    exchangeItems: [{ productId: "P1", quantity: 1 }],
    fulfillmentType,
    ...(fulfillmentType === "SHIPPED" ? { shipmentMethodTypeId: "STANDARD" } : { facilityId: "STORE_DT" }),
  });
  return returnId;
}

describe("ExchangeDetail", () => {
  it("shipped: read-only — no approve/complete/cancel buttons; sync settles to Exchange confirmed", async () => {
    const returnId = await makeExchange("SHIPPED");
    const wrapper = mount(ExchangeDetail, { props: { returnId }, global: { stubs: { "ion-page": false } } });
    await (wrapper.vm as any).enter();
    await flushPromises();
    expect(wrapper.find("[data-testid=exchange-approve-btn]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=exchange-complete-btn]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=exchange-cancel-btn]").exists()).toBe(false);
    const store = useReturnsStore();
    expect(store.current?.sync.shopify).toBe("synced");
  });

  it("immediate: read-only — no action buttons", async () => {
    const returnId = await makeExchange("IMMEDIATE");
    const wrapper = mount(ExchangeDetail, { props: { returnId }, global: { stubs: { "ion-page": false } } });
    await (wrapper.vm as any).enter();
    await flushPromises();
    expect(wrapper.find("[data-testid=exchange-approve-btn]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=exchange-complete-btn]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=exchange-cancel-btn]").exists()).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/unit/ExchangeDetail.spec.ts`
Expected: FAIL — the component still renders Approve/Complete/Cancel buttons.

- [ ] **Step 3: Delete the entire "Lifecycle actions" card from the template**

In `src/views/ExchangeDetail.vue`, delete the whole "Lifecycle actions" `<ion-card>` (the one gated
`v-if="canApprove || canComplete || canCancel"`, containing the approve/complete/reject/cancel buttons).
Remove it entirely — there is NO replacement card. The completion/close card and the Shopify sync card stay.

- [ ] **Step 4: Remove the now-dead muted hints in the sync card**

In the Shopify sync card, delete BOTH of these lines (an exchange is never `canApprove` and never
`RETURN_CANCELLED` now, so both branches are dead):

```html
                <p v-if="cancelledInShopify" class="muted">
                  {{ translate("Cancelled in OMS — still synced to Shopify") }}<template v-if="r.shopifySync?.returnStatusId"> · {{ r.shopifySync.returnStatusId }}</template>
                </p>
                <p v-else-if="canApprove" class="muted">{{ translate("Syncs to Shopify automatically when approved.") }}</p>
```

- [ ] **Step 5: Remove the now-dead script members**

In `<script setup>`:

(a) Delete the computeds `canApprove`, `canComplete`, `canCancel`, and `cancelledInShopify`. Keep
`isCompleted`, `closeState`, `exchangeCredit`, `isExchange`, `loaded`, `r`.

(b) Delete the functions `approve()`, `reject()`, `complete()` (the facility-picker completion), `cancel()`,
and `confirmAction()`. Keep `retryComplete()`, `retryPush()`, `runAction()`, `loadReplacement()`, `enter()`.

(c) Remove the now-unused `alertController` from the `@ionic/vue` import (it was only used by
`confirmAction()`/`complete()`). `commonUtil` stays (used by `formatCurrency` in the template). Verify no
other references to the deleted symbols remain (`store.loadFacilities`, `store.completeReturn`,
`store.cancelReturn`, `store.rejectReturn`, `store.approveReturn` should no longer be called from this file).

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run tests/unit/ExchangeDetail.spec.ts`
Expected: PASS.

- [ ] **Step 7: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: clean for `ExchangeDetail.vue` (no unused-symbol or missing-symbol errors).

- [ ] **Step 8: Commit**

```bash
git add src/views/ExchangeDetail.vue tests/unit/ExchangeDetail.spec.ts
git commit -m "feat(returns): exchange detail is read-only (exchanges can't be approved/completed/canceled)"
```

---

## Task 8: i18n strings

**Files:**
- Modify: `src/locales/en.json`

- [ ] **Step 1: Add the new keys**

`en.json` is a flat `{ "English source": "English translation" }` map (keys equal values for the en locale). Add these entries (keep the file alphabetized if it already is; otherwise append before the closing brace). Do NOT duplicate a key that already exists:

```json
  "Fulfillment": "Fulfillment",
  "Ship to customer": "Ship to customer",
  "Hand over now": "Hand over now",
  "Shipment method": "Shipment method",
  "Select a method": "Select a method",
  "Fulfillment facility": "Fulfillment facility",
  "Select a facility": "Select a facility",
  "Stock is issued from this facility now.": "Stock is issued from this facility now.",
  "Shipped exchanges currently ship Standard regardless of selection; more methods arrive when the backend lands.": "Shipped exchanges currently ship Standard regardless of selection; more methods arrive when the backend lands.",
  "Shipping address": "Shipping address",
  "Recipient": "Recipient",
  "Address line 1": "Address line 1",
  "Address line 2": "Address line 2",
  "City": "City",
  "State / Province": "State / Province",
  "Select a state / province": "Select a state / province",
  "Postal code": "Postal code",
  "Country": "Country",
  "Select a country": "Select a country",
  "Phone": "Phone"
```

- [ ] **Step 2: Verify the JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/en.json','utf8')); console.log('valid')"`
Expected: prints `valid`.

- [ ] **Step 3: Commit**

```bash
git add src/locales/en.json
git commit -m "feat(returns): i18n for create-time exchange fulfillment"
```

---

## Task 9: e2e happy path

**Files:**
- Modify: `tests/e2e/exchange-happy-path.cy.ts`

- [ ] **Step 1: Read the current test to learn its selectors/setup**

Run: `sed -n '1,200p' tests/e2e/exchange-happy-path.cy.ts`
Note how it logs in, looks up `DEMO-1001`, switches to exchange mode, and submits — you'll reuse those steps.

- [ ] **Step 2: Update the flow to choose fulfillment and assert no approve step**

Edit the test so that after switching to exchange mode and picking a line, it:
1. Asserts the fulfillment segment exists: `cy.get('[data-testid=create-fulfillment-segment]').should('exist')`.
2. Selects a shipment method via `[data-testid=create-shipment-method]` (Ionic select — open it and pick "Standard Shipping", matching how other selects are driven in this e2e suite).
3. Submits via `[data-testid=create-submit-btn]`.
4. On the exchange-detail screen, asserts the sync chip reads "Exchange confirmed", that `[data-testid=exchange-approve-btn]` does **not** exist, and that the replacement panel shows "Replacement approved — in fulfillment".

Add a second `it(...)` for the immediate path: set the segment to "Hand over now", pick a facility via `[data-testid=create-fulfillment-facility]`, submit, then assert the detail shows "Replacement completed" and no approve/cancel buttons.

Use the exact selectors introduced in Tasks 6–7 (`create-fulfillment-shipped`, `create-fulfillment-immediate`, `create-shipment-method`, `create-fulfillment-facility`, `exchange-approve-btn`, `exchange-cancel-btn`).

- [ ] **Step 3: Run the e2e suite**

Start the dev server in one shell: `npm run dev`
In another: `npx cypress run --spec tests/e2e/exchange-happy-path.cy.ts`
Expected: PASS (stub backend by default). If the suite needs `VITE_RETURNS_BACKEND` unset to use the stub, confirm it's not set to `oms`.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/exchange-happy-path.cy.ts
git commit -m "test(returns): e2e create-time exchange fulfillment happy path"
```

---

## Task 10: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full unit suite**

Run: `npx vitest run`
Expected: ALL PASS. If a test outside the ones edited above still assumes the old exchange flow (e.g. expects `ORDER_CREATED`, calls `approveReturn` on an exchange, or passes a facility to `completeReturn`), update it to the new flow per the spec and re-run.

- [ ] **Step 2: Type-check the whole app**

Run: `npx vue-tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no new errors in the changed files. Fix any (unused imports from removed code in `ExchangeDetail.vue` are the likely culprit).

- [ ] **Step 4: Final commit (if lint/typecheck required fixes)**

```bash
git add -A
git commit -m "chore(returns): lint/typecheck cleanup for create-time exchange fulfillment"
```

---

## Self-Review notes (verified against the spec)

- **§2 create form** → Task 6 (toggle, conditional method/facility, lazy load, validation, submit fields, honest note).
- **§3 types** → Task 1 (`ShipmentMethod`, `CreateExchangeInput` fields, `ExchangeDetail.shipmentMethod`).
- **§4 service/adapters** → Tasks 2 (contract), 3 (oms: build body, `listShipmentMethods`, complete arity), 4 (stub: branch, methods, replacement, complete).
- **§5 store** → Task 5 (`loadShipmentMethods`, complete arity).
- **§6 exchange detail** → Task 7 (remove Approve/Complete, keep Cancel + sync/close + Retry).
- **§7 tests** → Tasks 3–7, 9 (unit per file + e2e).
- **§8 i18n** → Task 8.
- **§10 known gap** → honest note in Task 6 Step 3; `shipmentMethodTypeId` submitted in Task 6 Step 4(e) and accepted/ignored per Task 3.
- **Type consistency:** `fulfillmentType` / `shipmentMethodTypeId` / `facilityId` names match across types, builder, store, adapters, and view; `ShipmentMethod.shipmentMethodTypeId` + `description` consistent in service, both adapters, and the picker; `completeReturn(returnId)` arity consistent across service, both adapters, store, and the ReturnDetail/ExchangeDetail call sites.
</content>
