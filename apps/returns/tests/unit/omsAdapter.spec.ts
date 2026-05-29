import { describe, it, expect } from "vitest";
import { mapReturnDetail, mapOrderToReturnable } from "@/adapters/omsAdapter";

describe("mapReturnDetail", () => {
  it("maps a synced shopify-origin return (PUSH_OK + SHOPIFY_RTN_ID)", () => {
    const d = mapReturnDetail({
      returnDetail: { returnId: "10042", statusId: "RETURN_REQUESTED", entryDate: "2026-05-29 18:30:00.000" },
      items: [{ orderId: "10001", orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "DEFECTIVE" }],
      statusHistory: [{ statusId: "RETURN_REQUESTED", statusDatetime: "2026-05-29 18:30:00.000" }],
      identifications: [{ returnIdentificationTypeId: "SHOPIFY_RTN_ID", idValue: "gid://shopify/Return/123" }],
      shopifySync: { shopifyReturnId: "gid://shopify/Return/123", pushStatusId: "PUSH_OK" },
    });
    expect(d).toMatchObject({
      returnId: "10042", orderId: "10001", origin: "shopify",
      sync: { shopify: "synced" }, externalIds: { shopify: "gid://shopify/Return/123" },
    });
    expect(d.items[0]).toMatchObject({ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "DEFECTIVE" });
    expect(d.statuses[0]).toMatchObject({ statusId: "RETURN_REQUESTED", statusDate: "2026-05-29 18:30:00.000" });
  });

  it("maps a pwa return with PUSH_FAILED to failed", () => {
    const d = mapReturnDetail({
      returnDetail: { returnId: "10043", statusId: "RETURN_REQUESTED", entryDate: "x" },
      items: [{ orderId: "10001", orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "UNWANTED" }],
      statusHistory: [], identifications: [],
      shopifySync: { shopifyReturnId: null, pushStatusId: "PUSH_FAILED" },
    });
    expect(d).toMatchObject({ origin: "pwa", sync: { shopify: "failed" }, externalIds: { shopify: null } });
  });

  it("maps a null shopifySync (Phase A / OMS-only) to not_synced", () => {
    const d = mapReturnDetail({
      returnDetail: { returnId: "10044", statusId: "RETURN_REQUESTED", entryDate: "x" },
      items: [{ orderId: "10001", orderItemSeqId: "00001", returnQuantity: 2, returnReasonId: "UNWANTED" }],
      statusHistory: [], identifications: [], shopifySync: null,
    });
    expect(d.sync.shopify).toBe("not_synced");
    expect(d.orderId).toBe("10001");
    expect(d.items[0].returnQuantity).toBe(2);
  });
});

describe("mapOrderToReturnable", () => {
  it("flattens orderDetail.shipGroups and trusts the backend returnableQuantity", () => {
    const order = mapOrderToReturnable({
      orderDetail: {
        orderId: "10001",
        billingEmail: "a@b.com",
        shipGroups: [{ items: [{ orderItemSeqId: "00001", productId: "P1", quantity: 2, unitPrice: 25, alreadyReturnedQuantity: 1, returnableQuantity: 1 }] }],
      },
    });
    expect(order.orderId).toBe("10001");
    expect(order.items[0]).toMatchObject({
      orderItemSeqId: "00001", productId: "P1", orderedQty: 2, alreadyReturnedQty: 1, returnableQty: 1, unitPrice: 25,
    });
  });

  it("falls back to quantity minus already-returned when returnableQuantity is absent", () => {
    const order = mapOrderToReturnable({
      orderDetail: { orderId: "10002", shipGroups: [{ items: [{ orderItemSeqId: "00001", quantity: 3, unitPrice: 10, alreadyReturnedQuantity: 1 }] }] },
    });
    expect(order.items[0].returnableQty).toBe(2);
  });
});
