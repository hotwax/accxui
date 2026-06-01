# Appeasement Returns (Two-Shape) — Frontend (PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the lost-in-shipment (item-based) appeasement shape on top of the already-built amount-only (shipping-refund) shape, in the returns PWA.

**Architecture:** An appeasement is chosen on the create-return page via a mode toggle inside the appeasement card: "Refund an amount" (existing form) or "Refund specific items" (new item+qty picker). Picking items flips the create request to send `items`, with the amount becoming an optional override. The detail view branches on `items[0].productId` — real product line(s) + a summed refund for the item-based shape, the existing single monetary line for the amount-only/legacy shape. Same `POST /oms/returns/appeasementReturn` endpoint, same lifecycle/sync/reasons/errors for both shapes.

**Tech Stack:** Vue 3 (`<script setup>`), Ionic Vue, Pinia, Vitest (unit), Cypress (e2e). Spec: `docs/superpowers/specs/2026-06-01-appeasement-two-shape-frontend-pwa-design.md`.

**Working directory:** all commands run from `apps/returns/` unless stated otherwise.

---

### Task 1: Data model — optional amount + item list on the appeasement input

**Files:**
- Modify: `apps/returns/src/types/returns.ts:52-58`

- [ ] **Step 1: Add `AppeasementItemInput` and make `amount` optional with an `items` field**

Replace the existing `AppeasementInput` block (currently lines 52-58):

```ts
/** A single lost order line picked for a lost-in-shipment appeasement. */
export interface AppeasementItemInput {
  orderItemSeqId: string;
  quantity: number;
}

/** The optional appeasement block an operator adds on the create-return page. */
export interface AppeasementInput {
  amount?: number;                 // required for the amount-only shape; OPTIONAL override when items present
  currencyUomId: string;
  reasonId: string;
  note?: string;
  items?: AppeasementItemInput[];  // present → lost-in-shipment shape; absent → shipping-refund shape
}
```

`AppeasementFields` (the detail read model, lines 43-50) is intentionally unchanged — `amount` carries the summed refund for the item shape; product lines ride the existing `ReturnDetail.items`.

- [ ] **Step 2: Typecheck the change compiles**

Run: `npx vue-tsc --noEmit -p tsconfig.json`
Expected: PASS (no errors). If `vue-tsc` is unavailable, run `npx tsc --noEmit` and expect the same. Note: making `amount` optional will surface a downstream error in `stubAdapter.ts` (`appeasement.amount <= 0` on a possibly-undefined value) — that is fixed in Task 4. If the typecheck flags only that line, proceed; it is expected.

- [ ] **Step 3: Commit**

```bash
git add apps/returns/src/types/returns.ts
git commit -m "feat(returns): optional amount + item list on AppeasementInput (two-shape)"
```

---

### Task 2: omsAdapter detail read — summed amount + shape detection

The detail mapper currently reads the appeasement amount/reason/note from the single monetary line `items[0]`. Extend it to detect the item shape (lines carry a `productId`) and sum the per-line refund.

**Files:**
- Modify: `apps/returns/src/adapters/omsAdapter.ts:50-62`
- Test: `apps/returns/tests/unit/omsAdapter.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/omsAdapter.spec.ts` inside the existing `describe("appeasement mapping", ...)` block (after the existing amount-only test, near line 200):

```ts
  it("sums per-line refund for an item-based (lost-in-shipment) appeasement", () => {
    const d = mapReturnDetail({
      returnDetail: { returnId: "M2", returnHeaderTypeId: "APPEASEMENT", statusId: "RETURN_REQUESTED", entryDate: "2026-06-01", currencyUomId: "USD" },
      items: [
        { orderItemSeqId: "00001", productId: "P1", productName: "Classic Tee", returnPrice: "12.50", returnReasonId: "APPEASE_GOODWILL", reasonDescription: "Goodwill", returnQuantity: 1 },
        { orderItemSeqId: "00002", productId: "P2", productName: "Denim Jacket", returnPrice: "10.00", returnReasonId: "APPEASE_GOODWILL", returnQuantity: 2 },
      ],
      identifications: [{ returnIdentificationTypeId: "RELATED_RETURN_ID", idValue: "M1" }],
    });
    expect(d.type).toBe("appeasement");
    // 12.50*1 + 10.00*2 = 32.50
    expect(d.appeasement?.amount).toBe(32.5);
    expect(d.appeasement?.reasonId).toBe("APPEASE_GOODWILL");
    expect(d.appeasement?.relatedReturnId).toBe("M1");
    // The product lines are preserved for rendering.
    expect(d.items).toHaveLength(2);
    expect(d.items[0].productId).toBe("P1");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/omsAdapter.spec.ts -t "sums per-line refund"`
Expected: FAIL — `d.appeasement?.amount` is `12.5` (only the first line), not `32.5`.

- [ ] **Step 3: Implement the shape-aware mapping**

In `src/adapters/omsAdapter.ts`, replace the block at lines 50-62:

```ts
  // Appeasement detail: shape is detected by whether the lines carry a productId.
  // - amount-only / legacy: a single synthetic monetary line (no productId) — amount = its returnPrice.
  // - lost-in-shipment: real product line(s) — amount = Σ(returnPrice × returnQuantity).
  // The linked standard return is a RELATED_RETURN_ID identification.
  const appLines = type === "appeasement" ? items : [];
  const isItemAppeasement = appLines.length > 0 && !!appLines[0].productId;
  const appeasement = type === "appeasement"
    ? {
        amount: isItemAppeasement
          ? appLines.reduce((s, it) => s + Number(it.returnPrice ?? 0) * Number(it.returnQuantity), 0)
          : Number(appLines[0]?.returnPrice ?? 0),
        currencyUomId: rd.currencyUomId ?? "USD",
        reasonId: appLines[0]?.returnReasonId ?? "",
        reasonDesc: appLines[0]?.reasonDescription || undefined,
        note: isItemAppeasement ? undefined : appLines[0]?.description || undefined,
        relatedReturnId: idents.find((i) => i.returnIdentificationTypeId === "RELATED_RETURN_ID")?.idValue || undefined,
      }
    : undefined;
```

(`items` here is the raw items array — `raw.items ?? []` from line 42 — which carries `returnPrice`/`reasonDescription`/`description`. The mapped `ReturnItemDetail[]` built at line 79 already carries `productId`, so the view can branch on it.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/omsAdapter.spec.ts`
Expected: PASS — the new test and all existing appeasement-mapping tests (the amount-only line still maps to its `returnPrice`).

- [ ] **Step 5: Commit**

```bash
git add apps/returns/src/adapters/omsAdapter.ts apps/returns/tests/unit/omsAdapter.spec.ts
git commit -m "feat(returns): sum per-line refund for item-based appeasement detail read"
```

---

### Task 3: omsAdapter create write — send items + conditional amount

Extract the appeasement create body into a pure, testable helper, then wire it into `createReturn`.

**Files:**
- Modify: `apps/returns/src/adapters/omsAdapter.ts` (create-body region inside `createReturn`, around lines 205-222; add an exported helper above `omsAdapter`)
- Test: `apps/returns/tests/unit/omsAdapter.spec.ts`

- [ ] **Step 1: Write the failing test**

Replace the placeholder `describe("createReturn appeasement payload", ...)` block in `tests/unit/omsAdapter.spec.ts` (currently lines 204-208) with:

```ts
import { mapReturnDetail, mapOrderToReturnable, mapReturnType, APPEASEMENT_RETURN_TYPE_ID, buildAppeasementCreateBody } from "@/adapters/omsAdapter";

describe("buildAppeasementCreateBody", () => {
  it("amount-only shape: sends amount, no items", () => {
    const body = buildAppeasementCreateBody("DEMO-1001", { amount: 8.5, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL", note: "hi" }, "M1");
    expect(body).toEqual({ orderId: "DEMO-1001", reasonId: "APPEASE_GOODWILL", currencyUomId: "USD", note: "hi", relatedReturnId: "M1", amount: 8.5 });
    expect("items" in body).toBe(false);
  });

  it("item shape without override: sends items, no amount", () => {
    const body = buildAppeasementCreateBody("DEMO-1001", { currencyUomId: "USD", reasonId: "APPEASE_GOODWILL", items: [{ orderItemSeqId: "00001", quantity: 1 }] });
    expect(body.items).toEqual([{ orderItemSeqId: "00001", quantity: 1 }]);
    expect("amount" in body).toBe(false);
    expect("relatedReturnId" in body).toBe(false);
  });

  it("item shape with override: sends both items and amount", () => {
    const body = buildAppeasementCreateBody("DEMO-1001", { amount: 30, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL", items: [{ orderItemSeqId: "00001", quantity: 1 }] }, "M1");
    expect(body.items).toEqual([{ orderItemSeqId: "00001", quantity: 1 }]);
    expect(body.amount).toBe(30);
  });
});
```

(Update the existing top-of-file import line `import { mapReturnDetail, mapOrderToReturnable, mapReturnType, APPEASEMENT_RETURN_TYPE_ID } from "@/adapters/omsAdapter";` to the version above that also imports `buildAppeasementCreateBody`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/omsAdapter.spec.ts -t "buildAppeasementCreateBody"`
Expected: FAIL — `buildAppeasementCreateBody` is not exported (import error / undefined).

- [ ] **Step 3: Add the helper and use it in `createReturn`**

In `src/adapters/omsAdapter.ts`, add this exported helper just above `export const omsAdapter: ReturnsService = {` (it needs the `AppeasementInput` and `AppeasementItemInput` types — confirm they are imported from `@/types/returns` at the top of the file; add them to the existing type import if missing). The explicit return type matters: it keeps the optional `items`/`amount` accessible to the test assertions under `vue-tsc` (conditional spreads alone would erase them from the inferred type):

```ts
/** Build the POST body for the appeasement create call. Shape is selected by `items`:
 *  amount-only sends `amount`; lost-in-shipment sends `items` and only sends `amount` when overridden. */
export function buildAppeasementCreateBody(orderId: string, a: AppeasementInput, relatedReturnId?: string): {
  orderId: string; reasonId: string; currencyUomId: string;
  note?: string; relatedReturnId?: string; items?: AppeasementItemInput[]; amount?: number;
} {
  return {
    orderId,
    reasonId: a.reasonId,
    currencyUomId: a.currencyUomId,
    ...(a.note ? { note: a.note } : {}),
    ...(relatedReturnId ? { relatedReturnId } : {}),
    ...(a.items?.length ? { items: a.items } : {}),
    ...(a.amount != null ? { amount: a.amount } : {}),
  };
}
```

Then replace the inline body construction inside `createReturn` (the `const appResp = await omsApi({ ... data: { orderId: input.orderId, amount: a.amount, ... } })` call, currently around lines 205-222) so the `data` is built by the helper:

```ts
    if (!input.appeasement) return { returnId };
    // Appeasement is a SEPARATE call (confirmed contract: two calls, not one atomic create).
    const appResp: any = await omsApi({
      url: "oms/returns/appeasementReturn", method: "POST",
      data: buildAppeasementCreateBody(input.orderId, input.appeasement, returnId || undefined),
    });
    if (commonUtil.hasError(appResp)) throw new Error("Failed to create appeasement");
    const appeasementReturnId = appResp.data.returnId;
    // Navigate to the standard return when there is one, else to the stand-alone appeasement.
    return { returnId: returnId || appeasementReturnId, appeasementReturnId };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/omsAdapter.spec.ts`
Expected: PASS — all three `buildAppeasementCreateBody` cases plus the existing mapping tests.

- [ ] **Step 5: Commit**

```bash
git add apps/returns/src/adapters/omsAdapter.ts apps/returns/tests/unit/omsAdapter.spec.ts
git commit -m "feat(returns): build appeasement create body for both shapes (items + conditional amount)"
```

---

### Task 4: Stub adapter — persist real product lines for an item-based appeasement

So the detail view and E2E render the item shape end-to-end before the backend lands.

**Files:**
- Modify: `apps/returns/src/adapters/stubAdapter.ts:101-156`
- Test: `apps/returns/tests/unit/stubAdapter.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/stubAdapter.spec.ts` (follow the file's existing `__resetStub()` + `stubAdapter` usage pattern):

```ts
  it("co-creates a lost-in-shipment appeasement with real product lines and a summed refund", async () => {
    __resetStub();
    const { appeasementReturnId } = await stubAdapter.createReturn({
      orderId: "DEMO-1001",
      items: [],
      appeasement: {
        currencyUomId: "USD", reasonId: "APPEASE_GOODWILL",
        items: [{ orderItemSeqId: "00001", quantity: 1 }], // Classic Tee @ 19.99
      },
    });
    const detail = await stubAdapter.getReturn(appeasementReturnId!);
    expect(detail.type).toBe("appeasement");
    expect(detail.items).toHaveLength(1);
    expect(detail.items[0].productId).toBe("P1");
    expect(detail.items[0].returnQuantity).toBe(1);
    // Default refund = unitPrice × qty (no override supplied).
    expect(detail.appeasement?.amount).toBeCloseTo(19.99, 2);
  });

  it("an amount-only appeasement still persists no product lines", async () => {
    __resetStub();
    const { appeasementReturnId } = await stubAdapter.createReturn({
      orderId: "DEMO-1001",
      items: [],
      appeasement: { amount: 8.5, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL" },
    });
    const detail = await stubAdapter.getReturn(appeasementReturnId!);
    expect(detail.items).toHaveLength(0);
    expect(detail.appeasement?.amount).toBe(8.5);
  });
```

(Confirm `__resetStub` and `stubAdapter` are imported at the top of the spec; if only `__resetStub` is imported, add `stubAdapter` to the import from `@/adapters/stubAdapter`.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/stubAdapter.spec.ts -t "lost-in-shipment"`
Expected: FAIL — the stub stores `items: []` and reads `appeasement.amount` (now possibly undefined), so the item shape produces no product lines / wrong amount (or a TypeError on `appeasement.amount <= 0`).

- [ ] **Step 3: Implement item-shape support in `createReturn`**

In `src/adapters/stubAdapter.ts`, replace the block from `if (!appeasement) return { returnId };` through the `store.set(appeasementReturnId, { ... })` call (currently lines 126-153) with:

```ts
    if (!appeasement) return { returnId };

    // Eligibility + amount cap (kept-merchandise value). Mirrors the server-side guard.
    const returnedQty: Record<string, number> = {};
    for (const i of items) returnedQty[i.orderItemSeqId] = (returnedQty[i.orderItemSeqId] ?? 0) + i.returnQuantity;
    const keptValue = ORDER.items.reduce(
      (sum, l) => sum + Math.max(0, l.returnableQty - (returnedQty[l.orderItemSeqId] ?? 0)) * l.unitPrice, 0);
    if (keptValue <= 0) throw new Error("Appeasement requires at least one kept item");

    // Lost-in-shipment shape: real product lines from the picked order items.
    const isItemShape = !!appeasement.items?.length;
    const appItems = (appeasement.items ?? []).map((ai) => {
      const line = ORDER.items.find((l) => l.orderItemSeqId === ai.orderItemSeqId);
      return {
        orderItemSeqId: ai.orderItemSeqId,
        productId: line?.productId ?? "",
        productName: line?.productName ?? "",
        returnQuantity: ai.quantity,
        returnReasonId: appeasement.reasonId,
        returnReasonDesc: APPEASEMENT_REASONS.find((x) => x.returnReasonId === appeasement.reasonId)?.description,
      };
    });
    const autoTotal = (appeasement.items ?? []).reduce(
      (s, ai) => s + (ORDER.items.find((l) => l.orderItemSeqId === ai.orderItemSeqId)?.unitPrice ?? 0) * ai.quantity, 0);
    // amount is the override when present, else the picked-line total (item shape) or the typed amount (amount shape).
    const refundAmount = appeasement.amount ?? autoTotal;
    if (refundAmount <= 0 || refundAmount > keptValue) throw new Error("Appeasement amount out of range");

    const appeasementReturnId = String(seq++);
    store.set(appeasementReturnId, {
      returnId: appeasementReturnId, type: "appeasement", orderId, orderName: ORDER.orderName,
      orderDate: "2026-05-22T08:00:00Z", statusId: "RETURN_REQUESTED", entryDate: now, origin: "pwa",
      sync: { shopify: "not_synced" },
      items: appItems,
      appeasement: {
        amount: refundAmount, currencyUomId: appeasement.currencyUomId,
        reasonId: appeasement.reasonId,
        reasonDesc: APPEASEMENT_REASONS.find((x) => x.returnReasonId === appeasement.reasonId)?.description,
        note: appeasement.note, relatedReturnId: returnId || undefined,
      },
      statuses: [{ statusId: "RETURN_REQUESTED", statusDate: now }],
      externalIds: { shopify: null },
      shopifySync: null,
      pushAttempted: false, pollsUntilSynced: 0,
      closeAttempted: false, pollsUntilClosed: 0,
    });
    void isItemShape; // shape is implied by appItems.length; kept for readability of the branch above
    // Navigate to the standard return when there is one, else to the stand-alone appeasement.
    return { returnId: returnId || appeasementReturnId, appeasementReturnId };
```

(If lint flags the `void isItemShape;` line as unused-noise, delete both that line and the `const isItemShape` declaration — they are only documentation. The functional path keys off `appeasement.items`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/stubAdapter.spec.ts`
Expected: PASS — both new tests plus all existing stub tests (amount-only path unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/returns/src/adapters/stubAdapter.ts apps/returns/tests/unit/stubAdapter.spec.ts
git commit -m "feat(returns): stub persists product lines + summed refund for item-based appeasement"
```

---

### Task 5: Store flow — submitting an item-based appeasement reaches the service

The store passes `CreateReturnInput` straight through, so no store code changes — this task adds a regression test proving the item-shape input flows end-to-end against the stub.

**Files:**
- Test: `apps/returns/tests/unit/returnsStoreCrud.spec.ts`

- [ ] **Step 1: Write the test**

Add to `tests/unit/returnsStoreCrud.spec.ts` (match the existing store-test setup — `setActivePinia` + `__resetStub` + `useReturnsStore`):

```ts
  it("submits a lost-in-shipment appeasement and reads back product lines", async () => {
    __resetStub();
    const store = useReturnsStore();
    const returnId = await store.submitReturn({
      orderId: "DEMO-1001",
      items: [],
      appeasement: {
        currencyUomId: "USD", reasonId: "APPEASE_GOODWILL",
        items: [{ orderItemSeqId: "00001", quantity: 1 }],
      },
    });
    const detail = await getReturnsService().getReturn(returnId);
    expect(detail.type).toBe("appeasement");
    expect(detail.items[0].productName).toBe("Classic Tee");
    expect(detail.appeasement?.amount).toBeCloseTo(19.99, 2);
  });
```

(Confirm `__resetStub`, `useReturnsStore`, and `getReturnsService` are imported at the top of the spec; add any that are missing, matching the existing imports in the file.)

- [ ] **Step 2: Run the test to verify it passes**

Run: `npx vitest run tests/unit/returnsStoreCrud.spec.ts -t "lost-in-shipment"`
Expected: PASS — Tasks 1 and 4 already make this path work. (If it fails, the store or stub wiring regressed; do not "fix" by changing the test.)

- [ ] **Step 3: Commit**

```bash
git add apps/returns/tests/unit/returnsStoreCrud.spec.ts
git commit -m "test(returns): store submits an item-based appeasement end-to-end"
```

---

### Task 6: Create form — mode toggle + item picker + submit logic

**Files:**
- Modify: `apps/returns/src/views/CreateReturn.vue`
- Test: `apps/returns/tests/unit/CreateReturn.spec.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/CreateReturn.spec.ts`:

```ts
  it("items mode: picking a lost item auto-fills the amount and submits an item-based appeasement", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    // Keep everything (no standard-return selections) so the appeasement is eligible.
    (wrapper.vm as any).appeasementEnabled = true;
    (wrapper.vm as any).setAppeasementMode("items");
    (wrapper.vm as any).setAppeasementQty("00001", 1); // Classic Tee @ 19.99
    (wrapper.vm as any).appeasementReasonId = "APPEASE_GOODWILL";
    await flushPromises();
    // Amount auto-fills to the picked-line total and the form is valid.
    expect((wrapper.vm as any).appeasementAmount).toBeCloseTo(19.99, 2);
    expect((wrapper.vm as any).appeasementValid).toBe(true);

    const id = await (wrapper.vm as any).submit();
    const detail = await getReturnsService().getReturn(id);
    expect(detail.type).toBe("appeasement");
    expect(detail.items[0].productId).toBe("P1");
    expect(detail.appeasement?.amount).toBeCloseTo(19.99, 2);
  });

  it("items mode: an over-cap override is invalid and hints the cap", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    (wrapper.vm as any).appeasementEnabled = true;
    (wrapper.vm as any).setAppeasementMode("items");
    (wrapper.vm as any).setAppeasementQty("00001", 1);
    (wrapper.vm as any).appeasementReasonId = "APPEASE_GOODWILL";
    // keptValue for the full order = 2*19.99 + 1*49 = 88.98; override above that is invalid.
    (wrapper.vm as any).onAppeasementAmountInput(9999);
    await flushPromises();
    expect((wrapper.vm as any).appeasementValid).toBe(false);
    expect((wrapper.vm as any).appeasementHint).toContain("kept-item value");
  });

  it("items mode: no picked line blocks submit with a 'pick' hint", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    (wrapper.vm as any).appeasementEnabled = true;
    (wrapper.vm as any).setAppeasementMode("items");
    (wrapper.vm as any).appeasementReasonId = "APPEASE_GOODWILL";
    await flushPromises();
    expect((wrapper.vm as any).appeasementValid).toBe(false);
    expect((wrapper.vm as any).appeasementHint).toContain("Pick at least one lost item");
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/CreateReturn.spec.ts -t "items mode"`
Expected: FAIL — `setAppeasementMode` / `setAppeasementQty` / `onAppeasementAmountInput` are not defined on the component.

- [ ] **Step 3: Add the script-side state, computeds, handlers, and exposure**

In `src/views/CreateReturn.vue` `<script setup>`:

(a) Add imports — extend the `@ionic/vue` import with `IonSegment, IonSegmentButton`:

```ts
import {
  IonBackButton, IonButton, IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonContent, IonFab,
  IonFabButton, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonPage, IonSegment,
  IonSegmentButton, IonSelect, IonSelectOption, IonTextarea, IonTitle, IonToggle, IonToolbar,
} from "@ionic/vue";
```

(b) Add state after `const appeasementNote = ref<string>("");` (line 141):

```ts
const appeasementMode = ref<"amount" | "items">("amount");
const appeasementSelections = reactive<Record<string, { qty: number }>>({});
// Did the operator type an explicit override? While false, the amount field mirrors the picked-line total.
const appeasementAmountTouched = ref(false);
```

(c) Add computeds after `hasKeptItems` (line 152), before `appeasementValid`:

```ts
const appeasementItemsTotal = computed(() =>
  Object.entries(appeasementSelections).reduce((sum, [seqId, s]) => {
    const line = order.value?.items.find((i) => i.orderItemSeqId === seqId);
    return sum + (line ? line.unitPrice * s.qty : 0);
  }, 0));
const pickedAppeasementItems = computed(() =>
  Object.entries(appeasementSelections)
    .filter(([, s]) => s.qty > 0)
    .map(([orderItemSeqId, s]) => ({ orderItemSeqId, quantity: s.qty })));
// The refund total in effect: the override (once touched) else the auto picked-line total.
const appeasementEffectiveTotal = computed(() =>
  appeasementMode.value === "items" && !appeasementAmountTouched.value
    ? appeasementItemsTotal.value
    : Number(appeasementAmount.value));
```

(d) Replace `appeasementValid` (lines 154-158) with a mode-aware version:

```ts
const appeasementValid = computed(() => {
  if (!appeasementEnabled.value) return true;
  if (!hasKeptItems.value || !appeasementReasonId.value) return false;
  if (appeasementMode.value === "items") {
    const total = appeasementEffectiveTotal.value;
    return pickedAppeasementItems.value.length > 0 && total > 0 && total <= keptValue.value;
  }
  const amt = Number(appeasementAmount.value);
  return amt > 0 && amt <= keptValue.value;
});
```

(e) Replace `appeasementHint` (lines 162-173) with a mode-aware version:

```ts
const appeasementHint = computed(() => {
  if (!appeasementEnabled.value || appeasementValid.value) return "";
  const cap = `${order.value?.currencyUomId ?? ""} ${keptValue.value.toFixed(2)}`.trim();
  if (appeasementMode.value === "items") {
    if (!pickedAppeasementItems.value.length) return translate("Pick at least one lost item.");
    if (appeasementEffectiveTotal.value > keptValue.value) {
      return `${translate("Refund can't exceed the kept-item value of")} ${cap}.`;
    }
    if (!appeasementReasons.value.length) {
      return translate("Appeasement reasons couldn't be loaded — reload the order and try again.");
    }
    return translate("Choose a reason for the appeasement.");
  }
  if (appeasementAmount.value === null) return "";
  const amt = Number(appeasementAmount.value);
  if (!(amt > 0 && amt <= keptValue.value)) {
    return `${translate("Enter a refund amount between 0 and")} ${cap}.`;
  }
  if (!appeasementReasons.value.length) {
    return translate("Appeasement reasons couldn't be loaded — reload the order and try again.");
  }
  return translate("Choose a reason for the appeasement.");
});
```

(f) Add a sync watch + handlers after the existing `watch(hasKeptItems, ...)` block (lines 176-178):

```ts
// Mirror the amount field to the auto picked-line total while the operator hasn't overridden it.
watch([appeasementItemsTotal, appeasementMode], ([total, mode]) => {
  if (mode === "items" && !appeasementAmountTouched.value) appeasementAmount.value = total as number;
});
function setAppeasementMode(mode: "amount" | "items") {
  appeasementMode.value = mode;
  appeasementAmountTouched.value = false;
  appeasementAmount.value = mode === "items" ? appeasementItemsTotal.value : null;
}
function setAppeasementQty(seqId: string, qty: number) {
  appeasementSelections[seqId] = { qty };
}
function onAppeasementAmountInput(v: number) {
  appeasementAmount.value = v;
  if (appeasementMode.value === "items") appeasementAmountTouched.value = true;
}
```

(g) Replace the `appeasement` object built in `submit()` (lines 221-228) with the two-shape version:

```ts
  const appeasement = appeasementEnabled.value && appeasementValid.value
    ? {
        currencyUomId: order.value.currencyUomId,
        reasonId: appeasementReasonId.value,
        ...(appeasementNote.value.trim() ? { note: appeasementNote.value.trim() } : {}),
        ...(appeasementMode.value === "items"
          ? {
              items: pickedAppeasementItems.value,
              ...(appeasementAmountTouched.value ? { amount: Number(appeasementAmount.value) } : {}),
            }
          : { amount: Number(appeasementAmount.value) }),
      }
    : undefined;
```

(h) Extend `defineExpose` (lines 249-253) to add the new members:

```ts
defineExpose({
  orderId, order, selections, lookupOrder, submit,
  appeasementEnabled, appeasementAmount, appeasementReasonId, appeasementNote, appeasementReasons,
  appeasementMode, appeasementSelections, appeasementAmountTouched,
  setAppeasementMode, setAppeasementQty, onAppeasementAmountInput,
  appeasementItemsTotal, pickedAppeasementItems, appeasementEffectiveTotal,
  keptValue, hasKeptItems, appeasementValid, appeasementHint, canSubmit,
});
```

- [ ] **Step 4: Add the template — segment + item picker, and route the amount input through the handler**

In `src/views/CreateReturn.vue` `<template>`, replace the appeasement card content for the enabled case (the `<ion-card-content v-else-if="appeasementEnabled">` block, lines 84-102) with:

```html
            <ion-card-content v-else-if="appeasementEnabled">
              <ion-segment data-testid="create-appeasement-mode" :value="appeasementMode"
                @ionChange="setAppeasementMode($event.detail.value)">
                <ion-segment-button value="amount" data-testid="create-appeasement-mode-amount">
                  <ion-label>{{ translate("Refund an amount") }}</ion-label>
                </ion-segment-button>
                <ion-segment-button value="items" data-testid="create-appeasement-mode-items">
                  <ion-label>{{ translate("Refund specific items") }}</ion-label>
                </ion-segment-button>
              </ion-segment>

              <ion-list v-if="appeasementMode === 'items'" data-testid="create-appeasement-items">
                <ion-item v-for="line in order.items" :key="line.orderItemSeqId" :disabled="line.returnableQty === 0">
                  <ion-label>
                    <h2>{{ line.productName || line.sku || line.productId }}</h2>
                    <p>{{ translate("Returnable") }}: {{ line.returnableQty }}</p>
                  </ion-label>
                  <ion-select :placeholder="translate('Quantity')" slot="end" style="min-width: 90px"
                    :value="appeasementSelections[line.orderItemSeqId]?.qty ?? 0"
                    @ionChange="setAppeasementQty(line.orderItemSeqId, $event.detail.value)">
                    <ion-select-option v-for="n in line.returnableQty + 1" :key="n - 1" :value="n - 1">{{ n - 1 }}</ion-select-option>
                  </ion-select>
                </ion-item>
              </ion-list>

              <ion-item>
                <ion-input data-testid="create-appeasement-amount" type="number" min="0"
                  :label="appeasementMode === 'items' ? translate('Refund amount (override)') : translate('Refund amount')"
                  label-placement="stacked"
                  :value="appeasementAmount" @ionInput="onAppeasementAmountInput(Number($event.target.value ?? 0))" />
              </ion-item>
              <ion-item>
                <ion-select data-testid="create-appeasement-reason" :placeholder="translate('Reason')"
                  :label="translate('Reason')" label-placement="stacked"
                  :value="appeasementReasonId" @ionChange="appeasementReasonId = $event.detail.value">
                  <ion-select-option v-for="rsn in appeasementReasons" :key="rsn.returnReasonId" :value="rsn.returnReasonId">{{ rsn.description }}</ion-select-option>
                </ion-select>
              </ion-item>
              <ion-item>
                <ion-textarea data-testid="create-appeasement-note" :label="translate('Note (optional)')"
                  label-placement="stacked" :value="appeasementNote" @ionInput="appeasementNote = $event.target.value ?? ''" />
              </ion-item>
              <p v-if="appeasementHint" class="error" role="alert">{{ appeasementHint }}</p>
            </ion-card-content>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/CreateReturn.spec.ts`
Expected: PASS — the three new "items mode" tests plus all existing CreateReturn tests (amount mode unchanged).

- [ ] **Step 6: Commit**

```bash
git add apps/returns/src/views/CreateReturn.vue apps/returns/tests/unit/CreateReturn.spec.ts
git commit -m "feat(returns): create-form mode toggle + lost-item picker for item-based appeasement"
```

---

### Task 7: Detail view — render lost product line(s) in the refund card

**Files:**
- Modify: `apps/returns/src/views/ReturnDetail.vue` (template refund card ~lines 46-59; add a computed near line 182)
- Test: `apps/returns/tests/unit/ReturnDetail.spec.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/ReturnDetail.spec.ts`. First add a helper next to `appeasementDetail()`:

```ts
function itemAppeasementDetail(): ReturnDetailType {
  return {
    ...appeasementDetail(),
    appeasement: { amount: 32.5, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL", reasonDesc: "Goodwill", relatedReturnId: "30000" },
    items: [
      { orderItemSeqId: "00001", productId: "P1", productName: "Classic Tee", returnQuantity: 1, returnReasonId: "APPEASE_GOODWILL" },
      { orderItemSeqId: "00002", productId: "P2", productName: "Denim Jacket", returnQuantity: 2, returnReasonId: "APPEASE_GOODWILL" },
    ],
  };
}
```

Then the tests:

```ts
  it("renders the lost product line(s) and summed refund for an item-based appeasement", async () => {
    const store = useReturnsStore();
    store.current = itemAppeasementDetail();
    const wrapper = mount(ReturnDetail, { props: { returnId: "30001" }, global: { stubs: { "ion-page": false } } });
    await flushPromises();
    expect(wrapper.find("[data-testid=detail-appeasement-items]").exists()).toBe(true);
    const text = wrapper.text();
    expect(text).toContain("Classic Tee");
    expect(text).toContain("Denim Jacket");
    expect(wrapper.find("[data-testid=detail-appeasement-amount]").text()).toContain("32.50");
  });

  it("renders no product-line list for an amount-only appeasement", async () => {
    const store = useReturnsStore();
    store.current = appeasementDetail(); // items: []
    const wrapper = mount(ReturnDetail, { props: { returnId: "30001" }, global: { stubs: { "ion-page": false } } });
    await flushPromises();
    expect(wrapper.find("[data-testid=detail-appeasement-items]").exists()).toBe(false);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/ReturnDetail.spec.ts -t "appeasement"`
Expected: FAIL — `detail-appeasement-items` does not exist in the template yet.

- [ ] **Step 3: Add the `isItemAppeasement` computed**

In `src/views/ReturnDetail.vue` `<script setup>`, add after the existing `const isAppeasement = computed(...)` (line 182):

```ts
// An item-based (lost-in-shipment) appeasement carries real product line(s); an amount-only one does not.
const isItemAppeasement = computed(() => isAppeasement.value && !!r.value?.items?.[0]?.productId);
```

- [ ] **Step 4: Add the product-line list to the refund card**

In `src/views/ReturnDetail.vue` `<template>`, inside the appeasement refund card, insert the list between the reason `<p>` (line 52) and the note `<p>` (line 53):

```html
                  <p>{{ translate("Reason") }}: {{ translate(formatReason(r.appeasement.reasonId, r.appeasement.reasonDesc)) }}</p>
                  <ion-list v-if="isItemAppeasement" data-testid="detail-appeasement-items">
                    <ion-item v-for="it in r.items" :key="it.orderItemSeqId" lines="none">
                      <ion-label>
                        <h3>{{ it.productName || it.sku || it.productId }}</h3>
                        <p>{{ translate("Quantity") }}: {{ it.returnQuantity }}</p>
                      </ion-label>
                    </ion-item>
                  </ion-list>
                  <p v-if="r.appeasement.note" class="muted">{{ r.appeasement.note }}</p>
```

The lower lists (lines 134-150) are unchanged: the generic items list stays hidden for appeasements (`v-if="!isAppeasement"`), and the single "Goodwill refund" summary row still renders the summed `r.appeasement.amount`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/ReturnDetail.spec.ts`
Expected: PASS — the two new tests plus all existing appeasement detail tests (amount-only renders no item list).

- [ ] **Step 6: Commit**

```bash
git add apps/returns/src/views/ReturnDetail.vue apps/returns/tests/unit/ReturnDetail.spec.ts
git commit -m "feat(returns): render lost product line(s) + summed refund on item-based appeasement detail"
```

---

### Task 8: i18n — add the new English strings

**Files:**
- Modify: `apps/returns/src/locales/en.json`

- [ ] **Step 1: Add the new keys**

In `src/locales/en.json`, add these entries near the existing appeasement strings (after `"Refund amount"`, line 86). JSON keys must be unique — confirm none already exist before adding:

```json
  "Refund an amount": "Refund an amount",
  "Refund specific items": "Refund specific items",
  "Refund amount (override)": "Refund amount (override)",
  "Pick at least one lost item.": "Pick at least one lost item.",
  "Refund can't exceed the kept-item value of": "Refund can't exceed the kept-item value of",
```

- [ ] **Step 2: Verify the JSON is valid**

Run: `node -e "JSON.parse(require('fs').readFileSync('src/locales/en.json','utf8')); console.log('valid')"`
Expected: prints `valid`.

- [ ] **Step 3: Commit**

```bash
git add apps/returns/src/locales/en.json
git commit -m "feat(returns): i18n strings for two-shape appeasement create form"
```

---

### Task 9: E2E — lost-in-shipment happy path

**Files:**
- Modify: `apps/returns/tests/e2e/returns-happy-path.cy.ts`

- [ ] **Step 1: Add the Cypress test**

Add this `it(...)` block after the existing "creates a return with a goodwill appeasement" test (after line 50) in `tests/e2e/returns-happy-path.cy.ts`:

```ts
  it("creates a lost-in-shipment appeasement by picking a lost item", () => {
    cy.visit("/create-return");
    cy.get("ion-input[label='Order ID'] input").type("DEMO-1001");
    cy.contains("ion-button", "Look up order").click();

    // Keep everything (no standard-return selection) so the appeasement is eligible.
    cy.get("[data-testid=create-appeasement-toggle]").click();
    cy.get("[data-testid=create-appeasement-mode-items]").click();

    // Pick one unit of the first lost line.
    cy.get("[data-testid=create-appeasement-items]").contains("ion-item", "Classic Tee").within(() => {
      cy.get("ion-select").first().click();
    });
    cy.get("ion-select-option").contains("1").click();

    // Reason, then submit.
    cy.get("[data-testid=create-appeasement-reason]").click();
    cy.get("ion-select-option").first().click();
    cy.get("[data-testid=create-submit-btn]").click();

    // Lands on the appeasement detail, showing the lost product line + a refund amount.
    cy.url().should("include", "/return-detail/");
    cy.get("[data-testid=detail-appeasement-items]").contains("Classic Tee");
    cy.get("[data-testid=detail-appeasement-amount]").should("contain", "19.99");
  });
```

- [ ] **Step 2: Run the E2E spec**

Run: `npx cypress run --spec tests/e2e/returns-happy-path.cy.ts`
Expected: PASS — all specs in the file, including the new lost-in-shipment path. (Requires the dev server per the project's Cypress baseUrl config; if the suite is normally run via `npm run test:e2e` with a server started by CI, follow that same setup.)

- [ ] **Step 3: Commit**

```bash
git add apps/returns/tests/e2e/returns-happy-path.cy.ts
git commit -m "test(returns): e2e lost-in-shipment appeasement happy path"
```

---

### Task 10: Full verification sweep

**Files:** none (verification only)

- [ ] **Step 1: Run the entire unit suite**

Run: `npx vitest run`
Expected: PASS — all unit tests across the returns app, no regressions.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors (warnings acceptable if pre-existing). Fix any lint error introduced by the new code (e.g. an unused import/variable) and re-run.

- [ ] **Step 3: Typecheck**

Run: `npx vue-tsc --noEmit -p tsconfig.json` (or `npx tsc --noEmit` if `vue-tsc` is unavailable)
Expected: no type errors.

- [ ] **Step 4: Confirm the working tree is clean and the branch is ready**

Run: `git status`
Expected: clean tree, all task commits present on `feat/rma-returns-pwa`.

---

## Notes for the implementer

- **TDD throughout:** each feature task writes the failing test first, watches it fail for the stated reason, then implements the minimal change. Do not weaken a test to make it pass.
- **The amount field in items mode** mirrors the picked-line total until the operator types (`appeasementAmountTouched`). Once touched, it is an override and is sent as `amount`; untouched, only `items` is sent and the backend computes the default.
- **v1 simplification (from the spec):** the standard-return picker (`selections`) and the appeasement item picker (`appeasementSelections`) are independent; there is no client-side enforcement that a unit can't be both returned and appeased. The amount cap is `keptValue`, computed from the standard-return selections only.
- **Backward compatibility:** legacy `RET_NPROD_ITEM` appeasements and the amount-only shape both read as a single monetary line (no `productId`), so `isItemAppeasement` is false and they render exactly as today.
