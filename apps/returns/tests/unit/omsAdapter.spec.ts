import { describe, it, expect } from "vitest";
import { mapReturnHeaderToSummary, mapOrderToReturnable } from "@/adapters/omsAdapter";

describe("mapReturnHeaderToSummary", () => {
  it("flags shopify origin and synced when SHOPIFY_RTN_ID identification is present", () => {
    const summary = mapReturnHeaderToSummary({
      returnId: "10000", statusId: "RETURN_REQUESTED", entryDate: "2026-05-28T10:00:00Z",
      orderId: "DEMO-2002",
      returnIdentifications: [{ returnIdentificationTypeId: "SHOPIFY_RTN_ID", idValue: "gid://1" }],
    });
    expect(summary).toMatchObject({ returnId: "10000", origin: "shopify", sync: { shopify: "synced" } });
  });

  it("flags pwa origin and not_synced with no identification", () => {
    const summary = mapReturnHeaderToSummary({
      returnId: "20000", statusId: "RETURN_REQUESTED", entryDate: "2026-05-29T12:00:00Z",
      orderId: "DEMO-1001", returnIdentifications: [],
    });
    expect(summary).toMatchObject({ origin: "pwa", sync: { shopify: "not_synced" } });
  });
});

describe("mapOrderToReturnable", () => {
  it("flattens ship-group items and computes returnable qty", () => {
    const order = mapOrderToReturnable({
      orderDetail: { orderId: "DEMO-1001", billingEmail: "a@b.com" },
      shipGroups: [{ items: [{ orderItemSeqId: "00001", productId: "P1", quantity: 2, unitPrice: 10 }] }],
    });
    expect(order.orderId).toBe("DEMO-1001");
    expect(order.items[0]).toMatchObject({ orderItemSeqId: "00001", returnableQty: 2 });
  });
});
