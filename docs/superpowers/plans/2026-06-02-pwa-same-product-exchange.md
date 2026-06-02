# PWA Same-Product Exchanges Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add same-product exchange support to the returns PWA — return item(s) and send the *same* product(s) back — wired to the approved `customerExchange` backend contract, demoable today via the stub adapter.

**Architecture:** Extend the existing returns feature (no new app, no new routes). Exchange is a mode on `CreateReturn.vue`; `exchangeItems` are mirrored from the picked return lines. The detail view, lifecycle endpoints, and Shopify-sync polling are reused; the one new piece is a two-step (`PUSH` → `PROC`) sync collapse, with `PROC_OK` as the authoritative "confirmed". Both the live `omsAdapter` and the demo `stubAdapter` implement the same `ReturnsService` contract.

**Tech Stack:** Vue 3 + `<script setup>`, Ionic Vue, Pinia, TypeScript, Vitest (unit), Cypress (e2e), vue-i18n.

**Spec:** `docs/superpowers/specs/2026-06-02-pwa-same-product-exchange-design.md`

**Conventions for every test command below:** run from `apps/returns/` unless noted. Single-file run:
`pnpm test:unit -- run tests/unit/<file>.spec.ts`. Filter to one test: append `-t "<name substring>"`.
Final gate (from repo root): `pnpm --filter returns lint` and `pnpm --filter returns exec vue-tsc --noEmit`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/types/returns.ts` | Domain types | Add `FulfillmentType`, `ExchangeItemInput`, `CreateExchangeInput`, `ExchangeDetail`; extend `ShopifySync`, `ReturnDetail` |
| `src/util/syncState.ts` | Sync collapse + labels | Add `resolveExchangeSyncState` |
| `src/services/ReturnsService.ts` | Service contract | Add `createExchange`, `retryExchangePush` |
| `src/adapters/omsAdapter.ts` | Live backend | Add `buildExchangeCreateBody`, exchange detail mapping, `createExchange`, `retryExchangePush` |
| `src/adapters/stubAdapter.ts` | Demo backend | Add exchange create + two-step poll progression + retry |
| `src/store/returnsStore.ts` | App state/actions | Add `submitExchange`, `retryExchangePush` |
| `src/views/CreateReturn.vue` | Create flow | Add Return/Exchange mode + fulfillment toggle + exchange submit |
| `src/views/ReturnDetail.vue` | Detail flow | Add exchange badge + card + sync label + retry routing |
| `src/locales/en.json` | i18n | Add new strings |
| `tests/unit/*.spec.ts`, `tests/e2e/*.cy.ts` | Tests | New cases |

---

## Task 1: Exchange sync collapse (`resolveExchangeSyncState`)

**Files:**
- Modify: `src/types/returns.ts` (extend `ShopifySync`)
- Modify: `src/util/syncState.ts`
- Test: `tests/unit/syncState.spec.ts`

- [ ] **Step 1: Extend `ShopifySync` with the process-step fields**

In `src/types/returns.ts`, inside `interface ShopifySync`, after the `closePushErrorMessage` line, add:

```ts
  // Exchange create-push step 2 (returnProcess). PROC_OK is the authoritative "exchange confirmed".
  processStatusId?: string | null;     // PROC_OK | PROC_PENDING | PROC_FAILED | null
  processErrorMessage?: string | null; // present when processStatusId == PROC_FAILED
```

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/syncState.spec.ts`:

```ts
import { resolveExchangeSyncState } from "@/util/syncState";

describe("resolveExchangeSyncState", () => {
  it("is not_synced when shopifySync is null", () => {
    expect(resolveExchangeSyncState(null)).toBe("not_synced");
  });
  it("is synced only on PROC_OK (authoritative confirmed)", () => {
    expect(resolveExchangeSyncState({ pushStatusId: "PUSH_OK", processStatusId: "PROC_OK" })).toBe("synced");
  });
  it("is pending on PUSH_OK while the process step has not completed", () => {
    expect(resolveExchangeSyncState({ pushStatusId: "PUSH_OK", processStatusId: "PROC_PENDING" })).toBe("pending");
  });
  it("treats PUSH_OK with no process status as still pending (awaiting process)", () => {
    expect(resolveExchangeSyncState({ pushStatusId: "PUSH_OK", processStatusId: null })).toBe("pending");
  });
  it("is pending on PUSH_PENDING", () => {
    expect(resolveExchangeSyncState({ pushStatusId: "PUSH_PENDING" })).toBe("pending");
  });
  it("is failed on PUSH_FAILED", () => {
    expect(resolveExchangeSyncState({ pushStatusId: "PUSH_FAILED" })).toBe("failed");
  });
  it("is failed on PROC_FAILED", () => {
    expect(resolveExchangeSyncState({ pushStatusId: "PUSH_OK", processStatusId: "PROC_FAILED" })).toBe("failed");
  });
  it("is not_synced when present but empty", () => {
    expect(resolveExchangeSyncState({ pushStatusId: null, processStatusId: null })).toBe("not_synced");
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test:unit -- run tests/unit/syncState.spec.ts -t "resolveExchangeSyncState"`
Expected: FAIL — `resolveExchangeSyncState is not a function` (not exported yet).

- [ ] **Step 4: Implement `resolveExchangeSyncState`**

Append to `src/util/syncState.ts`:

```ts
/**
 * Collapse the backend `shopifySync` into a SyncState for an EXCHANGE. The exchange create-push is two
 * Shopify steps at approve-time: returnCreate (PUSH_*) then returnProcess (PROC_*). PROC_OK is the
 * authoritative "confirmed" — a created-but-not-yet-processed exchange (PUSH_OK only) is still pending.
 * - null                         → not_synced
 * - PROC_OK                      → synced (authoritative)
 * - PROC_FAILED / PUSH_FAILED    → failed (surface processErrorMessage / pushErrorMessage)
 * - PROC_PENDING / PUSH_PENDING  → pending
 * - PUSH_OK (awaiting process)   → pending
 * - else                         → not_synced
 */
export function resolveExchangeSyncState(shopifySync: ShopifySync | null | undefined): SyncState {
  if (!shopifySync) return "not_synced";
  if (shopifySync.processStatusId === "PROC_OK") return "synced";
  if (shopifySync.processStatusId === "PROC_FAILED" || shopifySync.pushStatusId === "PUSH_FAILED") return "failed";
  if (
    shopifySync.processStatusId === "PROC_PENDING" ||
    shopifySync.pushStatusId === "PUSH_PENDING" ||
    shopifySync.pushStatusId === "PUSH_OK"
  ) return "pending";
  return "not_synced";
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:unit -- run tests/unit/syncState.spec.ts -t "resolveExchangeSyncState"`
Expected: PASS (8 passing).

- [ ] **Step 6: Commit**

```bash
git add src/types/returns.ts src/util/syncState.ts tests/unit/syncState.spec.ts
git commit -m "feat(returns): exchange-aware sync collapse (PROC_OK = confirmed)"
```

---

## Task 2: Exchange create-body builder (`buildExchangeCreateBody`)

**Files:**
- Modify: `src/types/returns.ts` (add exchange input types)
- Modify: `src/adapters/omsAdapter.ts`
- Test: `tests/unit/omsAdapter.spec.ts`

- [ ] **Step 1: Add the exchange input types**

In `src/types/returns.ts`, after the `AppeasementInput` interface (before `ReturnItemInput`), add:

```ts
export type FulfillmentType = "IMMEDIATE" | "SHIPPED";

/** A replacement line going out. unitPrice omitted → backend defaults to the product's price (even swap). */
export interface ExchangeItemInput {
  productId: string;
  quantity: number;
  unitPrice?: number;
}
```

Then after `CreateReturnInput` at the end of the file, add:

```ts
export interface CreateExchangeInput {
  orderId: string;
  fulfillmentType: FulfillmentType;
  returnItems: ReturnItemInput[];     // what comes back (same shape as a return line)
  exchangeItems: ExchangeItemInput[]; // what goes out (mirrored from returnItems for same-product)
  note?: string;
  currencyUomId?: string;
}
```

- [ ] **Step 2: Write the failing test**

In `tests/unit/omsAdapter.spec.ts`, add `buildExchangeCreateBody` to the import on line 2, then append:

```ts
describe("buildExchangeCreateBody", () => {
  const base = {
    orderId: "DEMO-1001",
    fulfillmentType: "SHIPPED" as const,
    returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
    exchangeItems: [{ productId: "P1", quantity: 1 }],
  };

  it("sends orderId, fulfillmentType, returnItems (seqId/qty/reason only) and exchangeItems", () => {
    const body = buildExchangeCreateBody({ ...base, currencyUomId: "USD" });
    expect(body.orderId).toBe("DEMO-1001");
    expect(body.fulfillmentType).toBe("SHIPPED");
    expect(body.returnItems).toEqual([{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }]);
    expect(body.exchangeItems).toEqual([{ productId: "P1", quantity: 1 }]);
    expect(body.currencyUomId).toBe("USD");
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

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test:unit -- run tests/unit/omsAdapter.spec.ts -t "buildExchangeCreateBody"`
Expected: FAIL — `buildExchangeCreateBody is not a function`.

- [ ] **Step 4: Implement the builder**

In `src/adapters/omsAdapter.ts`, add `CreateExchangeInput`, `ExchangeItemInput`, `FulfillmentType` to the type import block, then add after `buildAppeasementCreateBody`:

```ts
/** Build the POST body for the customerExchange create call. unitPrice is omitted per item when absent
 *  (backend defaults to the product price → even swap). Optional note/currencyUomId are omitted when empty. */
export function buildExchangeCreateBody(input: CreateExchangeInput): {
  orderId: string; fulfillmentType: FulfillmentType;
  returnItems: Array<{ orderItemSeqId: string; returnQuantity: number; returnReasonId: string }>;
  exchangeItems: ExchangeItemInput[]; note?: string; currencyUomId?: string;
} {
  return {
    orderId: input.orderId,
    fulfillmentType: input.fulfillmentType,
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
    ...(input.note ? { note: input.note } : {}),
    ...(input.currencyUomId ? { currencyUomId: input.currencyUomId } : {}),
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:unit -- run tests/unit/omsAdapter.spec.ts -t "buildExchangeCreateBody"`
Expected: PASS (3 passing).

- [ ] **Step 6: Commit**

```bash
git add src/types/returns.ts src/adapters/omsAdapter.ts tests/unit/omsAdapter.spec.ts
git commit -m "feat(returns): build customerExchange create body (mirrored items, even swap)"
```

---

## Task 3: Map the exchange block on the detail (`mapReturnDetail`)

**Files:**
- Modify: `src/types/returns.ts` (add `ExchangeDetail`, extend `ReturnDetail`)
- Modify: `src/adapters/omsAdapter.ts`
- Test: `tests/unit/omsAdapter.spec.ts`

- [ ] **Step 1: Add `ExchangeDetail` and extend `ReturnDetail`**

In `src/types/returns.ts`, after the `AppeasementFields` interface, add:

```ts
/** The replacement order, present on a ReturnDetail when isExchange === true. */
export interface ExchangeDetail {
  replacementOrderId: string;
  orderName?: string;
  fulfillmentType: FulfillmentType;
  orderStatusId: string; // ORDER_COMPLETED (immediate) | ORDER_APPROVED (shipped, in fulfillment)
  items: Array<{ productId: string; quantity: number; unitPrice?: number; itemDescription?: string }>;
  exchangeCreditAmount: number; // 0 = even swap
}
```

In `interface ReturnDetail`, after the `appeasement?: AppeasementFields;` line, add:

```ts
  // Present when this return is the return-half of an exchange.
  isExchange?: boolean;
  exchange?: ExchangeDetail;
```

- [ ] **Step 2: Write the failing test**

Append to the `describe("mapReturnDetail", ...)` region of `tests/unit/omsAdapter.spec.ts` (add a new describe block):

```ts
describe("exchange mapping", () => {
  it("maps isExchange + the exchange block and collapses sync via PROC", () => {
    const d = mapReturnDetail({
      returnDetail: { returnId: "M50", statusId: "RETURN_APPROVED", entryDate: 1, currencyUomId: "USD" },
      items: [{ orderItemSeqId: "00001", productId: "P1", productName: "Classic Tee", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      isExchange: true,
      exchange: {
        replacementOrderId: "EXC100100", orderName: "EXC-#1001-1", fulfillmentType: "SHIPPED",
        orderStatusId: "ORDER_APPROVED",
        items: [{ productId: "P1", quantity: 1, unitPrice: 19.99, itemDescription: "Classic Tee" }],
        exchangeCreditAmount: 0,
      },
      shopifySync: { pushStatusId: "PUSH_OK", processStatusId: "PROC_PENDING", shopifyReturnId: "gid://shopify/Return/1" },
    } as any);
    expect(d.isExchange).toBe(true);
    expect(d.exchange?.replacementOrderId).toBe("EXC100100");
    expect(d.exchange?.fulfillmentType).toBe("SHIPPED");
    expect(d.exchange?.exchangeCreditAmount).toBe(0);
    // PUSH_OK + PROC_PENDING collapses to pending for an exchange (NOT synced).
    expect(d.sync.shopify).toBe("pending");
  });

  it("collapses a PROC_OK exchange to synced", () => {
    const d = mapReturnDetail({
      returnDetail: { returnId: "M51", statusId: "RETURN_APPROVED", entryDate: 1 },
      items: [], isExchange: true,
      exchange: { replacementOrderId: "EXC2", fulfillmentType: "IMMEDIATE", orderStatusId: "ORDER_COMPLETED", items: [], exchangeCreditAmount: 0 },
      shopifySync: { pushStatusId: "PUSH_OK", processStatusId: "PROC_OK", shopifyReturnId: "gid://shopify/Return/2" },
    } as any);
    expect(d.sync.shopify).toBe("synced");
  });

  it("leaves a non-exchange return with isExchange undefined and the standard collapse", () => {
    const d = mapReturnDetail({
      returnDetail: { returnId: "M52", statusId: "RETURN_APPROVED", entryDate: 1 },
      items: [], shopifySync: { pushStatusId: "PUSH_OK", shopifyReturnId: "gid://shopify/Return/3" },
    } as any);
    expect(d.isExchange).toBeFalsy();
    expect(d.exchange).toBeUndefined();
    expect(d.sync.shopify).toBe("synced"); // standard collapse: PUSH_OK = synced
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test:unit -- run tests/unit/omsAdapter.spec.ts -t "exchange mapping"`
Expected: FAIL — `d.isExchange` is undefined / `d.sync.shopify` is "synced" not "pending".

- [ ] **Step 4: Implement the mapping**

In `src/adapters/omsAdapter.ts`:

(a) Add `resolveExchangeSyncState` to the import from `@/util/syncState`, and `ExchangeDetail` to the types import.

(b) Extend `interface RawReturnDetail` — add to the top level of the interface:

```ts
  isExchange?: boolean;
  exchange?: {
    replacementOrderId: string; orderName?: string; fulfillmentType: FulfillmentType; orderStatusId: string;
    items?: Array<{ productId: string; quantity: number | string; unitPrice?: number | string; itemDescription?: string }>;
    exchangeCreditAmount?: number | string;
  };
```

(c) In `mapReturnDetail`, replace the line
`const shopify: SyncState = resolveShopifySyncState(raw.shopifySync);`
with:

```ts
  const isExchange = raw.isExchange === true;
  const shopify: SyncState = isExchange
    ? resolveExchangeSyncState(raw.shopifySync)
    : resolveShopifySyncState(raw.shopifySync);
  const exchange: ExchangeDetail | undefined = isExchange && raw.exchange
    ? {
        replacementOrderId: raw.exchange.replacementOrderId,
        orderName: raw.exchange.orderName,
        fulfillmentType: raw.exchange.fulfillmentType,
        orderStatusId: raw.exchange.orderStatusId,
        items: (raw.exchange.items ?? []).map((it) => ({
          productId: it.productId,
          quantity: Number(it.quantity),
          unitPrice: it.unitPrice != null ? Number(it.unitPrice) : undefined,
          itemDescription: it.itemDescription,
        })),
        exchangeCreditAmount: Number(raw.exchange.exchangeCreditAmount ?? 0),
      }
    : undefined;
```

(d) In the returned object literal of `mapReturnDetail`, after `appeasement,` add:

```ts
    isExchange,
    exchange,
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:unit -- run tests/unit/omsAdapter.spec.ts -t "exchange mapping"`
Expected: PASS (3 passing). Also run the whole file to confirm no regressions:
`pnpm test:unit -- run tests/unit/omsAdapter.spec.ts` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/types/returns.ts src/adapters/omsAdapter.ts tests/unit/omsAdapter.spec.ts
git commit -m "feat(returns): map isExchange + exchange block on return detail"
```

---

## Task 4: Service contract + both adapters (`createExchange`, `retryExchangePush`)

**Files:**
- Modify: `src/services/ReturnsService.ts`
- Modify: `src/adapters/omsAdapter.ts`
- Modify: `src/adapters/stubAdapter.ts`
- Test: `tests/unit/stubAdapter.spec.ts`

- [ ] **Step 1: Add the two methods to the service contract**

In `src/services/ReturnsService.ts`, add `CreateExchangeInput` to the type import, then add to the `ReturnsService` interface (after `createReturn`):

```ts
  createExchange(input: CreateExchangeInput): Promise<{ returnId: string; replacementOrderId?: string }>;
  retryExchangePush(returnId: string): Promise<void>;
```

- [ ] **Step 2: Write the failing test**

Append to `tests/unit/stubAdapter.spec.ts` (inside the existing `describe("stubAdapter", ...)`):

```ts
  it("creates a same-product exchange with isExchange + an exchange block", async () => {
    const { returnId } = await stubAdapter.createExchange({
      orderId: "DEMO-1001", fulfillmentType: "SHIPPED",
      returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      exchangeItems: [{ productId: "P1", quantity: 1 }],
    });
    const d = await stubAdapter.getReturn(returnId);
    expect(d.isExchange).toBe(true);
    expect(d.statusId).toBe("RETURN_REQUESTED");
    expect(d.exchange?.fulfillmentType).toBe("SHIPPED");
    expect(d.exchange?.orderStatusId).toBe("ORDER_APPROVED");
    expect(d.exchange?.items[0].productId).toBe("P1");
    expect(d.exchange?.exchangeCreditAmount).toBe(0);
    expect(d.sync.shopify).toBe("not_synced");
  });

  it("marks an IMMEDIATE exchange replacement order completed", async () => {
    const { returnId } = await stubAdapter.createExchange({
      orderId: "DEMO-1001", fulfillmentType: "IMMEDIATE",
      returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      exchangeItems: [{ productId: "P1", quantity: 1 }],
    });
    const d = await stubAdapter.getReturn(returnId);
    expect(d.exchange?.orderStatusId).toBe("ORDER_COMPLETED");
  });

  it("progresses an approved exchange PUSH -> PROC_OK across polls", async () => {
    const { returnId } = await stubAdapter.createExchange({
      orderId: "DEMO-1001", fulfillmentType: "SHIPPED",
      returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      exchangeItems: [{ productId: "P1", quantity: 1 }],
    });
    await stubAdapter.approveReturn(returnId);
    let sync = await stubAdapter.getSyncStatus(returnId); // step 1: PUSH_OK / PROC_PENDING
    expect(sync.shopify).toBe("pending");
    sync = await stubAdapter.getSyncStatus(returnId);      // step 2: PROC_OK
    expect(sync.shopify).toBe("synced");
    const d = await stubAdapter.getReturn(returnId);
    expect(d.shopifySync?.processStatusId).toBe("PROC_OK");
  });
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test:unit -- run tests/unit/stubAdapter.spec.ts -t "exchange"`
Expected: FAIL — `stubAdapter.createExchange is not a function` (and TS error that `omsAdapter`/`stubAdapter` no longer satisfy `ReturnsService`).

- [ ] **Step 4a: Implement on `omsAdapter`**

In `src/adapters/omsAdapter.ts`, add to the `omsAdapter` object (after `createReturn`):

```ts
  async createExchange(input: CreateExchangeInput) {
    const resp: any = await omsApi({ url: "oms/returns/customerExchange", method: "POST", data: buildExchangeCreateBody(input) });
    if (commonUtil.hasError(resp)) throw new Error("Failed to create exchange");
    return { returnId: resp.data.returnId, replacementOrderId: resp.data.replacementOrderId };
  },

  async retryExchangePush(returnId) {
    const resp: any = await omsApi({ url: `oms/returns/${returnId}/pushExchangeToShopify`, method: "POST" });
    if (commonUtil.hasError(resp)) throw new Error("Failed to push exchange to Shopify");
  },
```

- [ ] **Step 4b: Implement on `stubAdapter`**

In `src/adapters/stubAdapter.ts`:

(i) Add `CreateExchangeInput` to the type import.

(ii) Add the create method to the `stubAdapter` object (after `createReturn`):

```ts
  async createExchange({ orderId, fulfillmentType, returnItems, exchangeItems }: CreateExchangeInput) {
    const now = "2026-05-29T12:00:00Z";
    const returnId = String(seq++);
    const replacementOrderId = `EXC${returnId}`;
    store.set(returnId, {
      returnId, type: "standard", orderId, orderName: ORDER.orderName, orderDate: "2026-05-22T08:00:00Z",
      statusId: "RETURN_REQUESTED", entryDate: now, origin: "pwa",
      sync: { shopify: "not_synced" },
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
        replacementOrderId, orderName: `${ORDER.orderName}-EXC`, fulfillmentType,
        orderStatusId: fulfillmentType === "IMMEDIATE" ? "ORDER_COMPLETED" : "ORDER_APPROVED",
        items: exchangeItems.map((e) => {
          const line = ORDER.items.find((l) => l.productId === e.productId);
          return { productId: e.productId, quantity: e.quantity, unitPrice: line?.unitPrice, itemDescription: line?.productName };
        }),
        exchangeCreditAmount: 0,
      },
      statuses: [{ statusId: "RETURN_REQUESTED", statusDate: now }],
      externalIds: { shopify: null },
      shopifySync: null,
      pushAttempted: false, pollsUntilSynced: 0,
      closeAttempted: false, pollsUntilClosed: 0,
    });
    return { returnId, replacementOrderId };
  },

  async retryExchangePush(returnId) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    // Idempotent resume: re-arm the push so getSyncStatus re-progresses, clearing any error.
    r.pushAttempted = true;
    r.sync = { shopify: "pending" };
    r.shopifySync = { ...(r.shopifySync ?? {}), pushStatusId: "PUSH_PENDING", processStatusId: null, processErrorMessage: null };
  },
```

(iii) In `getSyncStatus`, add an exchange branch at the very top of the method (before the existing standard `if (r.pushAttempted ...)` block):

```ts
    if (r.isExchange && r.pushAttempted && r.sync.shopify !== "synced") {
      const ss = r.shopifySync ?? {};
      if (ss.processStatusId === "PROC_PENDING") {
        // step 2 completes
        r.shopifySync = { ...ss, processStatusId: "PROC_OK" };
        r.sync = { shopify: "synced" };
        r.externalIds = { shopify: ss.shopifyReturnId ?? "gid://shopify/Return/EXC999" };
      } else {
        // step 1: returnCreate done, process now pending
        r.shopifySync = { ...ss, pushStatusId: "PUSH_OK", processStatusId: "PROC_PENDING", shopifyReturnId: ss.shopifyReturnId ?? "gid://shopify/Return/EXC999" };
        r.sync = { shopify: "pending" };
      }
      return r.sync;
    }
```

Note: the existing `approveReturn` already sets `pushAttempted = true`, `sync = pending`, and
`shopifySync = { synced: false, pushStatusId: "PUSH_PENDING" }` for any return — including an exchange —
so the exchange branch above takes over on the first `getSyncStatus` poll.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test:unit -- run tests/unit/stubAdapter.spec.ts`
Expected: PASS (all, including the 3 new exchange cases). The TS "does not satisfy ReturnsService" errors are gone now both adapters implement the methods.

- [ ] **Step 6: Commit**

```bash
git add src/services/ReturnsService.ts src/adapters/omsAdapter.ts src/adapters/stubAdapter.ts tests/unit/stubAdapter.spec.ts
git commit -m "feat(returns): createExchange + retryExchangePush on service and both adapters"
```

---

## Task 5: Store actions (`submitExchange`, `retryExchangePush`)

**Files:**
- Modify: `src/store/returnsStore.ts`
- Test: `tests/unit/returnsStoreCrud.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/returnsStoreCrud.spec.ts` (inside the existing describe):

```ts
  it("submits an exchange and drives it to synced via approve+poll (PROC_OK)", async () => {
    const store = useReturnsStore();
    const returnId = await store.submitExchange({
      orderId: "DEMO-1001", fulfillmentType: "SHIPPED",
      returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      exchangeItems: [{ productId: "P1", quantity: 1 }],
    });
    await store.fetchReturn(returnId);
    expect(store.current?.isExchange).toBe(true);
    expect(store.current?.statusId).toBe("RETURN_REQUESTED");
    expect(store.current?.sync.shopify).toBe("not_synced");

    await store.approveReturn(returnId, { intervalMs: 0, maxAttempts: 6 });
    expect(store.current?.statusId).toBe("RETURN_APPROVED");
    expect(store.current?.sync.shopify).toBe("synced");
    expect(store.current?.shopifySync?.processStatusId).toBe("PROC_OK");
  });

  it("retryExchangePush re-arms and polls a stuck exchange to synced", async () => {
    const store = useReturnsStore();
    const returnId = await store.submitExchange({
      orderId: "DEMO-1001", fulfillmentType: "SHIPPED",
      returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      exchangeItems: [{ productId: "P1", quantity: 1 }],
    });
    await store.fetchReturn(returnId);
    await store.retryExchangePush(returnId, { intervalMs: 0, maxAttempts: 6 });
    expect(store.current?.sync.shopify).toBe("synced");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- run tests/unit/returnsStoreCrud.spec.ts -t "exchange"`
Expected: FAIL — `store.submitExchange is not a function`.

- [ ] **Step 3: Implement the actions**

In `src/store/returnsStore.ts`, add `CreateExchangeInput` to the type import, then add these actions (after `submitReturn`):

```ts
    async submitExchange(input: CreateExchangeInput): Promise<string> {
      const { returnId } = await getReturnsService().createExchange(input);
      return returnId;
    },
    /** Re-run a failed/stuck exchange push (pushExchangeToShopify), then poll until it settles. */
    async retryExchangePush(returnId: string, opts: { intervalMs?: number; maxAttempts?: number } = {}) {
      await getReturnsService().retryExchangePush(returnId);
      return this.pollSync(returnId, "shopify", opts);
    },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test:unit -- run tests/unit/returnsStoreCrud.spec.ts -t "exchange"`
Expected: PASS (2 passing).

- [ ] **Step 5: Commit**

```bash
git add src/store/returnsStore.ts tests/unit/returnsStoreCrud.spec.ts
git commit -m "feat(returns): store submitExchange + retryExchangePush"
```

---

## Task 6: Create UI — Return/Exchange mode + fulfillment + submit

**Files:**
- Modify: `src/views/CreateReturn.vue`
- Test: `tests/unit/CreateReturn.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/CreateReturn.spec.ts`:

```ts
  it("submits a same-product exchange with mirrored exchangeItems and SHIPPED fulfillment", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    (wrapper.vm as any).setMode("exchange");
    (wrapper.vm as any).selections["00001"] = { qty: 1, returnReasonId: "RTN_SIZE_EXCHANGE" };
    await flushPromises();
    expect((wrapper.vm as any).canSubmit).toBe(true);
    const id = await (wrapper.vm as any).submit();
    expect(id).toBeTruthy();

    const created = await getReturnsService().getReturn(id);
    expect(created.isExchange).toBe(true);
    expect(created.exchange?.fulfillmentType).toBe("SHIPPED");
    expect(created.exchange?.items[0].productId).toBe("P1");
  });

  it("hides the appeasement and ignores it in exchange mode", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    (wrapper.vm as any).setMode("exchange");
    await flushPromises();
    expect((wrapper.vm as any).appeasementEnabled).toBe(false);
    expect(wrapper.find("[data-testid=create-appeasement-toggle]").exists()).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- run tests/unit/CreateReturn.spec.ts -t "exchange"`
Expected: FAIL — `setMode is not a function`.

- [ ] **Step 3: Add the mode + fulfillment state and submit branch (script)**

In `src/views/CreateReturn.vue` `<script setup>`:

(a) Add `FulfillmentType` to the type import from `@/types/returns`.

(b) After `const appeasementMode = ref<"amount" | "items">("amount");`, add:

```ts
const mode = ref<"return" | "exchange">("return");
const fulfillmentType = ref<FulfillmentType>("SHIPPED");
function setMode(m: "return" | "exchange") {
  mode.value = m;
  if (m === "exchange") appeasementEnabled.value = false; // appeasement is unavailable for exchanges
}
```

(c) Replace the `canSubmit` computed with:

```ts
const canSubmit = computed(() =>
  mode.value === "exchange"
    ? hasItemsSelected.value
    : (hasItemsSelected.value || appeasementEnabled.value) && appeasementValid.value);
```

(d) In `submit()`, immediately after the `const items = ...` block (before `const appeasement = ...`), add the exchange branch:

```ts
  if (mode.value === "exchange") {
    if (!items.length) return;
    const returnItems = items.map((i) => ({ orderItemSeqId: i.orderItemSeqId, returnQuantity: i.returnQuantity, returnReasonId: i.returnReasonId }));
    const exchangeItems = items.map((i) => ({ productId: i.productId, quantity: i.returnQuantity }));
    error.value = "";
    emitter.emit("presentLoader", { message: "Submitting exchange" });
    let exchangeReturnId: string | undefined;
    try {
      exchangeReturnId = await store.submitExchange({ orderId: order.value.orderId, fulfillmentType: fulfillmentType.value, returnItems, exchangeItems, currencyUomId: order.value.currencyUomId });
    } catch (e) {
      error.value = describeApiError(e, translate("Failed to create exchange"));
      commonUtil.showToast(error.value);
    } finally {
      emitter.emit("dismissLoader");
    }
    if (exchangeReturnId) router.push(`/return-detail/${exchangeReturnId}`);
    return exchangeReturnId;
  }
```

Note: `items[].productId` is already populated by the existing mapping in `submit()` (it reads
`line.productId` from the looked-up order), so the mirrored `exchangeItems` carry the right product.

(e) Add `mode, fulfillmentType, setMode` to the `defineExpose({ ... })` object.

- [ ] **Step 4: Add the mode segment + fulfillment toggle (template)**

In `src/views/CreateReturn.vue` template, immediately inside `<main>` and before the `<div class="empty-state" ... v-if="!order">`, add the mode segment (only meaningful once an order is loaded):

```html
          <ion-segment v-if="order && hasReturnable" data-testid="create-mode-segment" :value="mode"
            @ionChange="setMode($event.detail.value as 'return' | 'exchange')">
            <ion-segment-button value="return" data-testid="create-mode-return">
              <ion-label>{{ translate("Return") }}</ion-label>
            </ion-segment-button>
            <ion-segment-button value="exchange" data-testid="create-mode-exchange">
              <ion-label>{{ translate("Exchange") }}</ion-label>
            </ion-segment-button>
          </ion-segment>
```

Gate the appeasement card on return mode — change its opening tag from
`<ion-card v-if="order && hasReturnable" class="appeasement">` to:

```html
          <ion-card v-if="order && hasReturnable && mode === 'return'" class="appeasement">
```

Add the fulfillment card after the appeasement card (still inside `<main>`):

```html
          <ion-card v-if="order && hasReturnable && mode === 'exchange'" class="fulfillment">
            <ion-card-header>
              <ion-card-title>{{ translate("Replacement delivery") }}</ion-card-title>
            </ion-card-header>
            <ion-card-content>
              <ion-segment data-testid="create-fulfillment-segment" :value="fulfillmentType"
                @ionChange="fulfillmentType = $event.detail.value as 'SHIPPED' | 'IMMEDIATE'">
                <ion-segment-button value="SHIPPED" data-testid="create-fulfillment-shipped">
                  <ion-label>{{ translate("Ship to customer") }}</ion-label>
                </ion-segment-button>
                <ion-segment-button value="IMMEDIATE" data-testid="create-fulfillment-immediate">
                  <ion-label>{{ translate("Hand over now") }}</ion-label>
                </ion-segment-button>
              </ion-segment>
              <p class="muted">{{ fulfillmentType === 'IMMEDIATE'
                ? translate("The replacement is handed over now and its order completes immediately.")
                : translate("The replacement is shipped to the customer through the normal fulfillment flow.") }}</p>
            </ion-card-content>
          </ion-card>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:unit -- run tests/unit/CreateReturn.spec.ts`
Expected: PASS (all, including the 2 new exchange cases and the existing return/appeasement cases).

- [ ] **Step 6: Commit**

```bash
git add src/views/CreateReturn.vue tests/unit/CreateReturn.spec.ts
git commit -m "feat(returns): create-form Return/Exchange mode + fulfillment toggle"
```

---

## Task 7: Detail UI — exchange badge, card, sync label, retry routing

**Files:**
- Modify: `src/views/ReturnDetail.vue`
- Test: `tests/unit/ReturnDetail.spec.ts`

- [ ] **Step 1: Write the failing test**

In `tests/unit/ReturnDetail.spec.ts`, add a factory and a describe block (place the factory near the existing `appeasementDetail` factory, the describe at the end of the file):

```ts
function exchangeDetail(): ReturnDetailType {
  return {
    returnId: "40001", type: "standard", orderId: "DEMO-1001", orderName: "#1001",
    statusId: "RETURN_APPROVED", entryDate: "2026-05-29T12:00:00Z", origin: "pwa",
    sync: { shopify: "pending" },
    shopifySync: { pushStatusId: "PUSH_OK", processStatusId: "PROC_PENDING", shopifyReturnId: "gid://shopify/Return/1" },
    isExchange: true,
    exchange: {
      replacementOrderId: "EXC40001", orderName: "#1001-EXC", fulfillmentType: "SHIPPED",
      orderStatusId: "ORDER_APPROVED",
      items: [{ productId: "P1", quantity: 1, unitPrice: 19.99, itemDescription: "Classic Tee" }],
      exchangeCreditAmount: 0,
    },
    items: [{ orderItemSeqId: "00001", productId: "P1", productName: "Classic Tee", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
    statuses: [{ statusId: "RETURN_REQUESTED", statusDate: "2026-05-29T12:00:00Z" }],
    externalIds: { shopify: "gid://shopify/Return/1" },
  };
}

describe("ReturnDetail.vue (exchange)", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("renders the exchange badge and the replacement-order card", async () => {
    const store = useReturnsStore();
    store.current = exchangeDetail();
    const wrapper = mount(ReturnDetail, { props: { returnId: "40001" }, global: { stubs: { "ion-page": false } } });
    await flushPromises();
    const text = wrapper.text();
    expect(text).toContain("Exchange");
    expect(text).toContain("EXC40001");          // replacement order id
    expect(text).toContain("Even swap");         // exchangeCreditAmount === 0 copy
    expect(wrapper.find("[data-testid=detail-exchange-card]").exists()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test:unit -- run tests/unit/ReturnDetail.spec.ts -t "exchange"`
Expected: FAIL — text does not contain "EXC40001" / card testid absent.

- [ ] **Step 3: Add the computeds + retry routing (script)**

In `src/views/ReturnDetail.vue` `<script setup>`:

(a) After `const isAppeasement = computed(...)`, add:

```ts
const isExchange = computed(() => r.value?.isExchange === true);
```

(b) Replace the `retryPush` function with exchange-aware routing:

```ts
function retryPush() {
  return isExchange.value
    ? runAction("Pushing exchange to Shopify", () => store.retryExchangePush(props.returnId), "Push to Shopify failed")
    : runAction("Pushing to Shopify", () => store.pushAndPoll(props.returnId, "shopify"), "Push to Shopify failed");
}
```

- [ ] **Step 4: Add the badge, card, and sync label (template)**

(a) After the appeasement badge line
`<ion-badge v-if="isAppeasement" color="tertiary" data-testid="detail-appeasement-badge">{{ translate("Appeasement") }}</ion-badge>`
add:

```html
                  <ion-badge v-if="isExchange" color="secondary" data-testid="detail-exchange-badge">{{ translate("Exchange") }}</ion-badge>
```

(b) After the appeasement `<ion-card v-if="isAppeasement && r.appeasement"> ... </ion-card>` block, add the exchange card:

```html
              <ion-card v-if="isExchange && r.exchange" data-testid="detail-exchange-card">
                <ion-card-header>
                  <ion-card-title>{{ translate("Exchange") }}</ion-card-title>
                </ion-card-header>
                <ion-card-content>
                  <h2 data-testid="detail-exchange-order">{{ r.exchange.orderName || r.exchange.replacementOrderId }}</h2>
                  <p>{{ r.exchange.fulfillmentType === 'IMMEDIATE' ? translate("Handed over in store") : translate("Shipped to customer") }}</p>
                  <p class="muted">{{ r.exchange.orderStatusId === 'ORDER_COMPLETED' ? translate("Replacement completed") : translate("Replacement approved — in fulfillment") }}</p>
                  <ion-list data-testid="detail-exchange-items">
                    <ion-item v-for="(it, idx) in r.exchange.items" :key="idx" lines="none">
                      <ion-label>
                        <h3>{{ it.itemDescription || it.productId }}</h3>
                        <p>{{ translate("Quantity") }}: {{ it.quantity }}</p>
                      </ion-label>
                    </ion-item>
                  </ion-list>
                  <p class="muted">{{ r.exchange.exchangeCreditAmount > 0
                    ? `${translate('Refund difference owed')}: ${commonUtil.formatCurrency(r.exchange.exchangeCreditAmount, r.appeasement?.currencyUomId || 'USD')}`
                    : translate("Even swap — no refund difference") }}</p>
                </ion-card-content>
              </ion-card>
```

(c) In the Shopify-sync card, make the chip label exchange-aware. Replace
`<ion-label>{{ syncLabel(r.sync.shopify) }}</ion-label>` (the one inside the sync `ion-chip`) with:

```html
                    <ion-label>{{ isExchange && r.sync.shopify === 'synced' ? translate("Exchange confirmed") : syncLabel(r.sync.shopify) }}</ion-label>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test:unit -- run tests/unit/ReturnDetail.spec.ts`
Expected: PASS (all, including the new exchange case).

- [ ] **Step 6: Commit**

```bash
git add src/views/ReturnDetail.vue tests/unit/ReturnDetail.spec.ts
git commit -m "feat(returns): detail exchange badge, replacement-order card, confirmed sync label"
```

---

## Task 8: i18n strings

**Files:**
- Modify: `src/locales/en.json`

- [ ] **Step 1: Add the new strings**

Add these key/value pairs to `src/locales/en.json` (keys are the English source text — match the project's
identity-map convention; insert in alphabetical position to satisfy any sort lint):

```json
  "Even swap — no refund difference": "Even swap — no refund difference",
  "Exchange": "Exchange",
  "Exchange confirmed": "Exchange confirmed",
  "Failed to create exchange": "Failed to create exchange",
  "Hand over now": "Hand over now",
  "Handed over in store": "Handed over in store",
  "Refund difference owed": "Refund difference owed",
  "Replacement approved — in fulfillment": "Replacement approved — in fulfillment",
  "Replacement completed": "Replacement completed",
  "Replacement delivery": "Replacement delivery",
  "Ship to customer": "Ship to customer",
  "Submitting exchange": "Submitting exchange",
  "The replacement is handed over now and its order completes immediately.": "The replacement is handed over now and its order completes immediately.",
  "The replacement is shipped to the customer through the normal fulfillment flow.": "The replacement is shipped to the customer through the normal fulfillment flow."
```

- [ ] **Step 2: Verify the file is valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/en.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add src/locales/en.json
git commit -m "feat(returns): i18n strings for exchange create + detail"
```

---

## Task 9: e2e happy path

**Files:**
- Create: `tests/e2e/exchange-happy-path.cy.ts`

- [ ] **Step 1: Write the e2e spec**

Create `tests/e2e/exchange-happy-path.cy.ts`:

```ts
// Demo narrative: create a same-product exchange → approve → watch the two-step push confirm.
// Runs against the dev server (port 8101) with VITE_RETURNS_BACKEND=stub.
// NOTE: cypress is not installed by default. To run:
//   pnpm --filter returns add -D cypress   (approve the build), then `pnpm --filter returns dev`
//   in one terminal and `pnpm --filter returns test:e2e` in another (log in once if auth blocks).
describe("Exchange happy path (stub backend)", () => {
  it("creates a same-product exchange and confirms it in Shopify", () => {
    cy.visit("/create-return");
    cy.get("ion-input[label='Order ID'] input").type("DEMO-1001");
    cy.contains("ion-button", "Look up order").click();

    // Switch to Exchange mode.
    cy.get("[data-testid=create-mode-exchange]").click();

    // Return one unit of the first line (the replacement is the same product).
    cy.contains("ion-item", "Classic Tee").within(() => {
      cy.get("ion-select").first().click();
    });
    cy.get("ion-select-option").contains("1").click();
    cy.contains("ion-item", "Classic Tee").find("ion-select").last().click();
    cy.get("ion-select-option").first().click();

    // Default fulfillment (Ship to customer) is fine; submit.
    cy.get("[data-testid=create-submit-btn]").click();

    // Detail shows the exchange block as a requested return; approve to drive the push.
    cy.get("[data-testid=detail-exchange-card]").should("exist");
    cy.get("[data-testid=detail-approve-btn]").click();

    // Two-step push settles to "Exchange confirmed".
    cy.contains("Exchange confirmed", { timeout: 15000 });
  });
});
```

- [ ] **Step 2: Commit**

```bash
git add tests/e2e/exchange-happy-path.cy.ts
git commit -m "test(returns): e2e same-product exchange happy path"
```

> The e2e suite requires Cypress, which is not installed by default in this repo (build-script policy).
> If Cypress is available in the environment, run it per the header note; otherwise this spec is committed
> for the demo run and the unit suite is the gating check.

---

## Task 10: Final verification gate

- [ ] **Step 1: Run the full unit suite**

Run (from `apps/returns/`): `pnpm test:unit -- run`
Expected: all suites PASS.

- [ ] **Step 2: Typecheck + lint** (from repo root)

Run: `pnpm --filter returns exec vue-tsc --noEmit`
Expected: no errors.

Run: `pnpm --filter returns lint`
Expected: no errors.

- [ ] **Step 3: Manual smoke (optional, if running the app)**

`pnpm --filter returns dev`, then: look up `DEMO-1001` → Exchange mode → pick a line + reason → submit →
detail shows the Exchange card and badge → Approve → chip progresses to "Exchange confirmed".

- [ ] **Step 4: Final commit if any lint/tsc fixes were needed**

```bash
git add -A
git commit -m "chore(returns): lint/typecheck fixes for exchange feature"
```

---

## Self-review notes (coverage vs spec)

- §1 same-product / no search → Task 6 mirrors `exchangeItems` from picked lines; no picker added. ✓
- §1 fulfillmentType toggle, default SHIPPED → Task 6 fulfillment card. ✓
- §2 two-step PUSH→PROC collapse, PROC_OK authoritative, "Exchange confirmed" label → Tasks 1, 3, 7. ✓
- §2 appeasement unavailable in exchange mode → Task 6 (`setMode` clears + template gate). ✓
- §3 types → Tasks 1, 2, 3. ✓
- §4 service + both adapters, build body, detail mapping, stub demo → Tasks 2, 3, 4. ✓
- §5 store actions → Task 5. ✓
- §6/§7 create + detail UI → Tasks 6, 7. ✓
- §8 tests + i18n → every task (TDD) + Tasks 8, 9. ✓
- Retry routes to `pushExchangeToShopify` for exchanges → Tasks 4, 5, 7. ✓
</content>
