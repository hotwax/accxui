import { describe, it, expect, beforeEach } from "vitest";
import { stubAdapter, __resetStub } from "@/adapters/stubAdapter";

describe("stubAdapter", () => {
  beforeEach(() => __resetStub());

  it("seeds one shopify-origin return in the list", async () => {
    const { items, total } = await stubAdapter.listReturns({});
    expect(total).toBeGreaterThanOrEqual(1);
    expect(items.some((r) => r.origin === "shopify")).toBe(true);
  });

  it("looks up an order with returnable lines", async () => {
    const order = await stubAdapter.getOrderForReturn("DEMO-1001");
    expect(order.orderId).toBe("DEMO-1001");
    expect(order.items[0].returnableQty).toBeGreaterThan(0);
  });

  it("creates a pwa-origin return that starts not_synced", async () => {
    const { returnId } = await stubAdapter.createReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
    });
    const detail = await stubAdapter.getReturn(returnId);
    expect(detail.origin).toBe("pwa");
    expect(detail.sync.shopify).toBe("not_synced");
  });

  it("flips pending then synced across polls after a push", async () => {
    const { returnId } = await stubAdapter.createReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
    });
    await stubAdapter.pushToTarget(returnId, "shopify");
    expect((await stubAdapter.getSyncStatus(returnId)).shopify).toBe("pending");
    expect((await stubAdapter.getSyncStatus(returnId)).shopify).toBe("synced");
  });

  it("co-creates a linked appeasement return alongside the standard return", async () => {
    const { returnId, appeasementReturnId } = await stubAdapter.createReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
      appeasement: { amount: 10, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL", note: "sorry" },
    });
    expect(appeasementReturnId).toBeTruthy();
    const standard = await stubAdapter.getReturn(returnId);
    expect(standard.type).toBe("standard");
    const appeasement = await stubAdapter.getReturn(appeasementReturnId!);
    expect(appeasement.type).toBe("appeasement");
    expect(appeasement.items).toHaveLength(0);
    expect(appeasement.appeasement).toMatchObject({
      amount: 10, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL", note: "sorry", relatedReturnId: returnId,
    });
    expect(appeasement.sync.shopify).toBe("not_synced");
  });

  it("creates a stand-alone appeasement (no standard return) when no items are returned", async () => {
    const { returnId, appeasementReturnId } = await stubAdapter.createReturn({
      orderId: "DEMO-1001",
      items: [],
      appeasement: { amount: 10, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL" },
    });
    expect(appeasementReturnId).toBeTruthy();
    // With no item return, navigation lands on the appeasement itself.
    expect(returnId).toBe(appeasementReturnId);
    const appeasement = await stubAdapter.getReturn(appeasementReturnId!);
    expect(appeasement.type).toBe("appeasement");
    // No linked standard return for a stand-alone appeasement.
    expect(appeasement.appeasement?.relatedReturnId ?? null).toBeNull();
  });

  it("rejects an appeasement amount above the kept-merchandise cap", async () => {
    // DEMO-1001 kept value when returning 1x00001 (unit 19.99): 1x19.99 + 1x49 = 68.99.
    await expect(stubAdapter.createReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
      appeasement: { amount: 9999, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL" },
    })).rejects.toThrow();
  });

  it("rejects an appeasement when every returnable unit is being returned (nothing kept)", async () => {
    await expect(stubAdapter.createReturn({
      orderId: "DEMO-1001",
      items: [
        { orderItemSeqId: "00001", productId: "P1", returnQuantity: 2, returnReasonId: "RTN_NOT_WANT" },
        { orderItemSeqId: "00002", productId: "P2", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" },
      ],
      appeasement: { amount: 5, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL" },
    })).rejects.toThrow();
  });

  it("lists dedicated appeasement reasons (APPEASE_* codes)", async () => {
    const reasons = await stubAdapter.listAppeasementReasons();
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.every((r) => r.returnReasonId.startsWith("APPEASE_"))).toBe(true);
  });

  it("settles an approved appeasement to synced with a shopifyRefundId (not a return id)", async () => {
    const { appeasementReturnId } = await stubAdapter.createReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
      appeasement: { amount: 10, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL" },
    });
    await stubAdapter.approveReturn(appeasementReturnId!);
    expect((await stubAdapter.getSyncStatus(appeasementReturnId!)).shopify).toBe("pending");
    expect((await stubAdapter.getSyncStatus(appeasementReturnId!)).shopify).toBe("synced");
    const settled = await stubAdapter.getReturn(appeasementReturnId!);
    expect(settled.shopifySync?.shopifyRefundId).toBeTruthy();
    expect(settled.shopifySync?.shopifyReturnId ?? null).toBeNull();
  });
});
