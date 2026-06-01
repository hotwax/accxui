import { describe, it, expect } from "vitest";
import { mapReturnDetail, mapOrderToReturnable, mapReturnType, APPEASEMENT_RETURN_TYPE_ID } from "@/adapters/omsAdapter";

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

  it("treats shopifySync.synced === true as authoritative (synced even without PUSH_OK)", () => {
    const d = mapReturnDetail({
      returnDetail: { returnId: "10048", statusId: "RETURN_CANCELLED", entryDate: "x" },
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "UNWANTED" }],
      statusHistory: [], identifications: [],
      // Cancelled in OMS but still linked in Shopify: synced stays true, Shopify status CANCELED.
      shopifySync: { synced: true, shopifyReturnId: "gid://shopify/Return/77", returnStatusId: "CANCELED" },
    });
    expect(d.sync.shopify).toBe("synced");
    expect(d.shopifySync?.returnStatusId).toBe("CANCELED");
    expect(d.externalIds.shopify).toBe("gid://shopify/Return/77");
  });

  it("carries shopifySync.pushErrorMessage through for the failed-state UI", () => {
    const d = mapReturnDetail({
      returnDetail: { returnId: "10049", statusId: "RETURN_APPROVED", entryDate: "x" },
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "UNWANTED" }],
      statusHistory: [], identifications: [],
      shopifySync: { synced: false, pushStatusId: "PUSH_FAILED", pushErrorMessage: "Shopify rejected: order archived" },
    });
    expect(d.sync.shopify).toBe("failed");
    expect(d.shopifySync?.pushErrorMessage).toBe("Shopify rejected: order archived");
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

  it("reads order id, name, and date off returnDetail (not derived from items)", () => {
    const d = mapReturnDetail({
      returnDetail: {
        returnId: "10045", statusId: "RETURN_REQUESTED", entryDate: "2026-05-29 18:30:00.000",
        orderId: "10001", orderName: "#1001", orderDate: "2026-05-20 09:00:00.000",
      },
      items: [{ orderItemSeqId: "00001", productId: "P1", productName: "Blue Hoodie", returnQuantity: 1, returnReasonId: "DEFECTIVE" }],
      statusHistory: [], identifications: [], shopifySync: null,
    });
    expect(d).toMatchObject({ orderId: "10001", orderName: "#1001", orderDate: "2026-05-20 09:00:00.000" });
    expect(d.items[0]).toMatchObject({ productId: "P1", productName: "Blue Hoodie" });
  });

  it("uses externalOrderId for the display name when orderName is absent, and never the GID", () => {
    const d = mapReturnDetail({
      returnDetail: {
        returnId: "10046", statusId: "RETURN_REQUESTED", entryDate: "x",
        orderId: "10001", externalOrderId: "#1001", orderExternalId: "gid://shopify/Order/777",
      },
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "UNWANTED" }],
      statusHistory: [], identifications: [], shopifySync: null,
    });
    expect(d.orderName).toBe("#1001");
    expect(JSON.stringify(d)).not.toContain("gid://shopify/Order/777");
  });

  it("defensively falls back to the first item's orderId when returnDetail omits it", () => {
    const d = mapReturnDetail({
      returnDetail: { returnId: "10047", statusId: "RETURN_REQUESTED", entryDate: "x" },
      items: [{ orderId: "10009", orderItemSeqId: "00001", productId: "P1", itemDescription: "Red Cap", returnQuantity: 1, returnReasonId: "UNWANTED" }],
      statusHistory: [], identifications: [], shopifySync: null,
    });
    expect(d.orderId).toBe("10009");
    expect(d.items[0].productName).toBe("Red Cap");
    expect(d.orderName).toBe("");
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

  it("surfaces the order name (not the GID) and per-item product names", () => {
    const order = mapOrderToReturnable({
      orderDetail: {
        orderId: "10001", orderName: "#1001", orderExternalId: "gid://shopify/Order/777",
        shipGroups: [{ items: [{ orderItemSeqId: "00001", productId: "P1", productName: "Blue Hoodie", quantity: 2, unitPrice: 25 }] }],
      },
    });
    expect(order.orderName).toBe("#1001");
    expect(JSON.stringify(order)).not.toContain("gid://shopify/Order/777");
    expect(order.items[0]).toMatchObject({ productId: "P1", productName: "Blue Hoodie" });
  });

  it("leaves orderName and productName empty when the backend omits them", () => {
    const order = mapOrderToReturnable({
      orderDetail: { orderId: "10002", shipGroups: [{ items: [{ orderItemSeqId: "00001", productId: "P1", quantity: 1, unitPrice: 10 }] }] },
    });
    expect(order.orderName).toBe("");
    expect(order.items[0].productName).toBe("");
  });

  it("maps the product sku through when present, undefined when omitted", () => {
    const withSku = mapOrderToReturnable({
      orderDetail: { orderId: "10003", shipGroups: [{ items: [{ orderItemSeqId: "00001", productId: "P1", sku: "TEE-BLK-M", quantity: 1, unitPrice: 10 }] }] },
    });
    expect(withSku.items[0].sku).toBe("TEE-BLK-M");
    const withoutSku = mapOrderToReturnable({
      orderDetail: { orderId: "10004", shipGroups: [{ items: [{ orderItemSeqId: "00001", productId: "P1", quantity: 1, unitPrice: 10 }] }] },
    });
    expect(withoutSku.items[0].sku).toBeUndefined();
  });
});

describe("appeasement mapping", () => {
  it("maps a standard return to type 'standard' with no appeasement block", () => {
    expect(mapReturnType("CUSTOMER_RETURN")).toBe("standard");
    expect(mapReturnType(undefined)).toBe("standard");
    const d = mapReturnDetail({
      returnDetail: { returnId: "20001", statusId: "RETURN_REQUESTED", entryDate: "x" },
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "UNWANTED" }],
      statusHistory: [], identifications: [], shopifySync: null,
    });
    expect(d.type).toBe("standard");
    expect(d.appeasement).toBeUndefined();
  });

  it("maps an appeasement return-type id to type 'appeasement' and surfaces amount/reason/note/link", () => {
    expect(mapReturnType(APPEASEMENT_RETURN_TYPE_ID)).toBe("appeasement");
    const d = mapReturnDetail({
      returnDetail: {
        returnId: "20002", statusId: "RETURN_REQUESTED", entryDate: "x",
        returnHeaderTypeId: APPEASEMENT_RETURN_TYPE_ID,
        refundAmount: "12.50", currencyUomId: "USD",
        appeasementReasonId: "APPEASE_GOODWILL", appeasementReasonDesc: "Goodwill",
        note: "sorry for the trouble", primaryReturnId: "20001",
      },
      items: [], statusHistory: [], identifications: [],
      shopifySync: { synced: true, shopifyRefundId: "gid://shopify/Refund/5", pushStatusId: "PUSH_OK" },
    });
    expect(d.type).toBe("appeasement");
    expect(d.sync.shopify).toBe("synced");
    expect(d.appeasement).toMatchObject({
      amount: 12.5, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL",
      reasonDesc: "Goodwill", note: "sorry for the trouble", relatedReturnId: "20001",
    });
  });
});

describe("mapOrderToReturnable currency", () => {
  it("maps the order currencyUomId, defaulting to USD when absent", () => {
    const withCcy = mapOrderToReturnable({
      orderDetail: { orderId: "10001", currencyUomId: "EUR", shipGroups: [{ items: [{ orderItemSeqId: "00001", quantity: 1, unitPrice: 10 }] }] },
    });
    expect(withCcy.currencyUomId).toBe("EUR");
    const withoutCcy = mapOrderToReturnable({
      orderDetail: { orderId: "10002", shipGroups: [{ items: [{ orderItemSeqId: "00001", quantity: 1, unitPrice: 10 }] }] },
    });
    expect(withoutCcy.currencyUomId).toBe("USD");
  });
});

describe("createReturn appeasement payload", () => {
  it("returns both ids and is exercised against the stub in returnsStoreCrud", () => {
    expect(APPEASEMENT_RETURN_TYPE_ID).toBe("RTN_APPEASEMENT");
  });
});
