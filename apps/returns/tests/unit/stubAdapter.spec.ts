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
});
