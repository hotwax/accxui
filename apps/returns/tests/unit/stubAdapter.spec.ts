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

  it("progresses an exchange PUSH -> PROC_OK across polls", async () => {
    const { returnId } = await stubAdapter.createExchange({
      orderId: "DEMO-1001",
      returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      exchangeItems: [{ productId: "P1", quantity: 1 }],
      fulfillmentType: "SHIPPED",
      shipmentMethodTypeId: "STANDARD",
    });
    let sync = await stubAdapter.getSyncStatus(returnId); // step 1: PUSH_OK / PROC_PENDING
    expect(sync.shopify).toBe("pending");
    sync = await stubAdapter.getSyncStatus(returnId);      // step 2: PROC_OK
    expect(sync.shopify).toBe("synced");
    const d = await stubAdapter.getReturn(returnId);
    expect(d.shopifySync?.processStatusId).toBe("PROC_OK");
  });

  it("retryExchangePush re-arms a stuck exchange from PROC_PENDING back through PROC_OK", async () => {
    const { returnId } = await stubAdapter.createExchange({
      orderId: "DEMO-1001",
      returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      exchangeItems: [{ productId: "P1", quantity: 1 }],
      fulfillmentType: "SHIPPED",
      shipmentMethodTypeId: "STANDARD",
    });
    await stubAdapter.getSyncStatus(returnId); // advance to PUSH_OK / PROC_PENDING
    // Simulate a stuck mid-flight push: retry before PROC_OK fires.
    await stubAdapter.retryExchangePush(returnId);
    expect((await stubAdapter.getSyncStatus(returnId)).shopify).toBe("pending"); // step 1 re-runs
    expect((await stubAdapter.getSyncStatus(returnId)).shopify).toBe("synced");  // step 2 confirms
    expect((await stubAdapter.getReturn(returnId)).shopifySync?.processStatusId).toBe("PROC_OK");
  });

  it("marks the exchange return-half isExchange on the list summary", async () => {
    const { returnId } = await stubAdapter.createExchange({
      orderId: "DEMO-1001",
      returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      exchangeItems: [{ productId: "P1", quantity: 1 }],
      fulfillmentType: "SHIPPED",
      shipmentMethodTypeId: "STANDARD",
    });
    const { items } = await stubAdapter.listReturns({ pageIndex: 0, pageSize: 50 });
    expect(items.find((r) => r.returnId === returnId)?.isExchange).toBe(true);
    expect(items.find((r) => r.returnId === "10000")?.isExchange).toBeFalsy();
  });

  it("getReplacementOrder returns the outgoing order detail for an exchange", async () => {
    const { returnId, replacementOrderId } = await stubAdapter.createExchange({
      orderId: "DEMO-1001",
      returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      exchangeItems: [{ productId: "P1", quantity: 1 }],
      fulfillmentType: "SHIPPED",
      shipmentMethodTypeId: "STANDARD",
    });
    expect(replacementOrderId).toBeTruthy();
    const order = await stubAdapter.getReplacementOrder(replacementOrderId!);
    expect(order.orderId).toBe(replacementOrderId);
    expect(order.statusId).toBe("ORDER_APPROVED");
    expect(order.items[0].productId).toBe("P1");
    expect(order.items[0].unitPrice).toBeGreaterThan(0);
    expect(order.grandTotal).toBeGreaterThan(0);
    // The seeded return id is unrelated; this is the replacement order.
    expect(order.orderId).not.toBe(returnId);
  });

  it("retryExchangePush is an idempotent no-op once the exchange is already confirmed", async () => {
    const { returnId } = await stubAdapter.createExchange({
      orderId: "DEMO-1001",
      returnItems: [{ orderItemSeqId: "00001", returnQuantity: 1, returnReasonId: "RTN_SIZE_EXCHANGE" }],
      exchangeItems: [{ productId: "P1", quantity: 1 }],
      fulfillmentType: "SHIPPED",
      shipmentMethodTypeId: "STANDARD",
    });
    await stubAdapter.getSyncStatus(returnId);
    await stubAdapter.getSyncStatus(returnId); // now PROC_OK / synced
    await stubAdapter.retryExchangePush(returnId);
    // Still synced — a confirmed exchange is never spuriously un-synced.
    expect((await stubAdapter.getReturn(returnId)).sync.shopify).toBe("synced");
  });
});
