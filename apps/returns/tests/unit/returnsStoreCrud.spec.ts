import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

vi.stubEnv("VITE_RETURNS_BACKEND", "stub");

import { useReturnsStore } from "@/store/returnsStore";
import { getReturnsService } from "@/services/ReturnsService";
import { __resetStub } from "@/adapters/stubAdapter";

describe("returnsStore CRUD (stub adapter)", () => {
  beforeEach(() => { setActivePinia(createPinia()); __resetStub(); });

  it("fetches the returns list", async () => {
    const store = useReturnsStore();
    await store.fetchReturns();
    expect(store.returns.length).toBeGreaterThanOrEqual(1);
    expect(store.total).toBeGreaterThanOrEqual(1);
  });

  it("creates a return and loads it as current", async () => {
    const store = useReturnsStore();
    const returnId = await store.submitReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
    });
    await store.fetchReturn(returnId);
    expect(store.current?.returnId).toBe(returnId);
    expect(store.current?.sync.shopify).toBe("not_synced");
  });

  it("pushes and resolves to synced via polling", async () => {
    const store = useReturnsStore();
    const returnId = await store.submitReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
    });
    await store.fetchReturn(returnId);
    await store.pushAndPoll(returnId, "shopify", { intervalMs: 0, maxAttempts: 5 });
    expect(store.current?.sync.shopify).toBe("synced");
  });

  async function createRequested() {
    const store = useReturnsStore();
    const returnId = await store.submitReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
    });
    await store.fetchReturn(returnId);
    expect(store.current?.statusId).toBe("RETURN_REQUESTED");
    return { store, returnId };
  }

  it("approve transitions requested -> approved and syncs to Shopify", async () => {
    const { store, returnId } = await createRequested();
    expect(store.current?.sync.shopify).toBe("not_synced");
    await store.approveReturn(returnId, { intervalMs: 0, maxAttempts: 5 });
    expect(store.current?.statusId).toBe("RETURN_APPROVED");
    // approval triggered the push; pollSync (called inside approveReturn) drives it to synced
    expect(store.current?.sync.shopify).toBe("synced");
  });

  it("reject transitions requested -> rejected and never syncs", async () => {
    const { store, returnId } = await createRequested();
    await store.rejectReturn(returnId);
    expect(store.current?.statusId).toBe("RETURN_REJECTED");
    expect(store.current?.sync.shopify).toBe("not_synced");
  });

  it("cancel transitions an approved return -> cancelled", async () => {
    const { store, returnId } = await createRequested();
    await store.approveReturn(returnId, { intervalMs: 0, maxAttempts: 5 });
    await store.cancelReturn(returnId, { intervalMs: 0, maxAttempts: 5 });
    expect(store.current?.statusId).toBe("RETURN_CANCELLED");
  });

  it("cancelling a synced return stays synced with Shopify status CANCELED", async () => {
    const { store, returnId } = await createRequested();
    await store.approveReturn(returnId, { intervalMs: 0, maxAttempts: 5 });
    expect(store.current?.sync.shopify).toBe("synced");
    await store.cancelReturn(returnId, { intervalMs: 0, maxAttempts: 5 });
    expect(store.current?.statusId).toBe("RETURN_CANCELLED");
    // synced is authoritative — the return still exists in Shopify, just cancelled there.
    expect(store.current?.sync.shopify).toBe("synced");
    expect(store.current?.shopifySync?.returnStatusId).toBe("CANCELED");
  });

  it("rejecting a non-requested return throws (guard)", async () => {
    const { store, returnId } = await createRequested();
    await store.approveReturn(returnId, { intervalMs: 0, maxAttempts: 5 });
    await expect(store.rejectReturn(returnId)).rejects.toThrow();
  });

  it("completes an approved return -> completed and closes it in Shopify", async () => {
    const { store, returnId } = await createRequested();
    await store.approveReturn(returnId, { intervalMs: 0, maxAttempts: 5 });
    expect(store.current?.sync.shopify).toBe("synced");
    const state = await store.completeReturn(returnId, { intervalMs: 0, maxAttempts: 5 });
    expect(store.current?.statusId).toBe("RETURN_COMPLETED");
    expect(state).toBe("completed");
    expect(store.current?.shopifySync?.returnStatusId).toBe("CLOSED");
  });

  it("completing is idempotent on an already-completed return", async () => {
    const { store, returnId } = await createRequested();
    await store.approveReturn(returnId, { intervalMs: 0, maxAttempts: 5 });
    await store.completeReturn(returnId, { intervalMs: 0, maxAttempts: 5 });
    await expect(store.completeReturn(returnId, { intervalMs: 0, maxAttempts: 5 })).resolves.toBe("completed");
    expect(store.current?.statusId).toBe("RETURN_COMPLETED");
  });

  it("completing a non-approved/received return throws (guard)", async () => {
    const { store, returnId } = await createRequested();
    await expect(store.completeReturn(returnId, { intervalMs: 0, maxAttempts: 5 })).rejects.toThrow();
  });

  it("submitting with an appeasement co-creates a linked appeasement return", async () => {
    const store = useReturnsStore();
    const returnId = await store.submitReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
      appeasement: { amount: 10, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL", note: "sorry" },
    });
    expect(returnId).toBeTruthy();
    await store.fetchReturns(0, 50);
    const appeasementRow = store.returns.find((r) => r.type === "appeasement");
    expect(appeasementRow).toBeTruthy();
    // The widened service contract exposes the linked appeasement id directly.
    const direct = await getReturnsService().createReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
      appeasement: { amount: 10, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL" },
    });
    expect(direct.appeasementReturnId).toBeTruthy();
  });

  it("blocks an appeasement above the kept-merchandise cap", async () => {
    const store = useReturnsStore();
    await expect(store.submitReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
      // 9999 >> kept-merchandise value (~$49 after returning 1 unit), so the cap guard rejects it.
      appeasement: { amount: 9999, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL" },
    })).rejects.toThrow();
  });

  it("approving an appeasement refunds and auto-completes it (approval IS completion)", async () => {
    const store = useReturnsStore();
    await store.submitReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
      appeasement: { amount: 10, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL" },
    });
    await store.fetchReturns(0, 50);
    const appeasementId = store.returns.find((r) => r.type === "appeasement")!.returnId;
    await store.approveReturn(appeasementId, { intervalMs: 0, maxAttempts: 5 });
    expect(store.current?.sync.shopify).toBe("synced");
    expect(store.current?.shopifySync?.shopifyRefundId).toBeTruthy();
    // For an appeasement, approval is completion — it finalizes straight to RETURN_COMPLETED.
    expect(store.current?.statusId).toBe("RETURN_COMPLETED");
  });

  it("cancels a still-requested appeasement without polling for a Shopify return status", async () => {
    const store = useReturnsStore();
    await store.submitReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
      appeasement: { amount: 10, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL" },
    });
    await store.fetchReturns(0, 50);
    const appeasementId = store.returns.find((r) => r.type === "appeasement")!.returnId;
    // Cancel before approval (an appeasement auto-completes on approve, so a synced appeasement is no
    // longer cancellable). A requested appeasement is not synced, so no Shopify-return poll runs.
    await store.cancelReturn(appeasementId, { intervalMs: 0, maxAttempts: 5 });
    expect(store.current?.statusId).toBe("RETURN_CANCELLED");
    expect(store.current?.shopifySync?.shopifyReturnId ?? null).toBeNull();
    expect(store.current?.shopifySync?.returnStatusId ?? null).toBeNull();
  });

  it("submits a lost-in-shipment appeasement and reads back product lines", async () => {
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
});
