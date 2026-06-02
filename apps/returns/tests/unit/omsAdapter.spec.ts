import { describe, it, expect } from "vitest";
import { mapReturnDetail, mapOrderToReturnable, mapReplacementOrder, mapReturnType, APPEASEMENT_RETURN_TYPE_ID, buildAppeasementCreateBody, buildExchangeCreateBody, mapPostalAddress } from "@/adapters/omsAdapter";

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
        returnHeaderTypeId: APPEASEMENT_RETURN_TYPE_ID, currencyUomId: "USD",
      },
      items: [{ orderItemSeqId: "00001", returnPrice: "12.50", returnReasonId: "APPEASE_GOODWILL", reasonDescription: "Goodwill", description: "sorry for the trouble", returnQuantity: 1 }],
      statusHistory: [], identifications: [{ returnIdentificationTypeId: "RELATED_RETURN_ID", idValue: "20001" }],
      shopifySync: { synced: true, shopifyRefundId: "gid://shopify/Refund/5", pushStatusId: "PUSH_OK" },
    });
    expect(d.type).toBe("appeasement");
    expect(d.sync.shopify).toBe("synced");
    expect(d.appeasement).toMatchObject({
      amount: 12.5, currencyUomId: "USD", reasonId: "APPEASE_GOODWILL",
      reasonDesc: "Goodwill", note: "sorry for the trouble", relatedReturnId: "20001",
    });
  });

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
});

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
    });
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
    });
    expect(d.sync.shopify).toBe("synced");
  });

  it("detects an exchange from shopifySync (isExchange + replacementOrderId), no top-level block", () => {
    // The real backend marks the exchange on shopifySync, not at the top level (order M100358 shape).
    const d = mapReturnDetail({
      returnDetail: { returnId: "M100358", statusId: "RETURN_REQUESTED", entryDate: 1, orderId: "M100620", currencyUomId: "USD" },
      items: [{ orderItemSeqId: "01", productId: "24050", returnQuantity: 1, returnReasonId: "DEFECTIVE" }],
      shopifySync: { synced: false, shopifyReturnId: null, isExchange: true, replacementOrderId: "M100621" },
    });
    expect(d.isExchange).toBe(true);
    expect(d.exchange?.replacementOrderId).toBe("M100621");
  });

  it("leaves a non-exchange return with isExchange undefined and the standard collapse", () => {
    const d = mapReturnDetail({
      returnDetail: { returnId: "M52", statusId: "RETURN_APPROVED", entryDate: 1 },
      items: [], shopifySync: { pushStatusId: "PUSH_OK", shopifyReturnId: "gid://shopify/Return/3" },
    });
    expect(d.isExchange).toBeFalsy();
    expect(d.exchange).toBeUndefined();
    expect(d.sync.shopify).toBe("synced"); // standard collapse: PUSH_OK = synced
  });

  it("leaves exchange undefined when isExchange is true but the exchange block is absent", () => {
    const d = mapReturnDetail({
      returnDetail: { returnId: "M53", statusId: "RETURN_APPROVED", entryDate: 1 },
      items: [], isExchange: true, // exchange block omitted (e.g. replacement order still being created)
      shopifySync: null,
    });
    expect(d.isExchange).toBe(true);
    expect(d.exchange).toBeUndefined();
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

describe("mapReplacementOrder", () => {
  it("maps order header, fulfillment/tracking and flattened line items", () => {
    const o = mapReplacementOrder({
      orderDetail: {
        orderId: "EXC100100", orderName: "EXC-#1001-1", orderDate: "2026-05-29T12:00:00Z",
        orderStatusId: "ORDER_APPROVED", currencyUomId: "USD", grandTotal: 39.98,
        shipGroups: [{
          shipmentMethod: "Standard", trackingCode: "1Z999AA10123456784", carrier: "UPS",
          items: [
            { orderItemSeqId: "00001", productId: "P1", productName: "Classic Tee", sku: "TEE-1", quantity: 1, unitPrice: 19.99 },
            { orderItemSeqId: "00002", productId: "P2", productName: "Denim Jacket", quantity: 1, unitPrice: 19.99 },
          ],
        }],
      },
    });
    expect(o.orderId).toBe("EXC100100");
    expect(o.orderName).toBe("EXC-#1001-1");
    expect(o.statusId).toBe("ORDER_APPROVED");
    expect(o.grandTotal).toBe(39.98);
    expect(o.trackingCode).toBe("1Z999AA10123456784");
    expect(o.carrier).toBe("UPS");
    expect(o.shipmentMethod).toBe("Standard");
    expect(o.items).toHaveLength(2);
    expect(o.items[0]).toMatchObject({ productId: "P1", productName: "Classic Tee", sku: "TEE-1", quantity: 1, unitPrice: 19.99 });
  });

  it("defaults currency to USD, falls back orderName to orderId, and coerces numeric strings", () => {
    const o = mapReplacementOrder({
      orderDetail: {
        orderId: "EXC2", orderStatusId: "ORDER_COMPLETED",
        shipGroups: [{ items: [{ orderItemSeqId: "00001", productId: "P1", quantity: "2", unitPrice: "10.00" }] }],
      },
    });
    expect(o.currencyUomId).toBe("USD");
    expect(o.orderName).toBe("EXC2");
    expect(o.grandTotal).toBeUndefined();
    expect(o.items[0]).toMatchObject({ productId: "P1", productName: "", quantity: 2, unitPrice: 10 });
  });
});

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
