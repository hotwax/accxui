import type { ReturnsService } from "@/services/ReturnsService";
import type {
  CreateExchangeInput, CreateReturnInput, Facility, FulfillmentType, OrderForReturn, ReplacementOrderDetail,
  ReturnDetail, ReturnReason, ReturnSummary, ShipmentMethod, SyncState, SyncTarget,
} from "@/types/returns";

interface StubReturn extends ReturnDetail {
  pushAttempted: boolean;
  pollsUntilSynced: number;
  closeAttempted: boolean;
  pollsUntilClosed: number;
}

const FACILITIES: Facility[] = [
  { facilityId: "STORE_DT", facilityName: "Downtown Store" },
  { facilityId: "STORE_MALL", facilityName: "Mall Store" },
  { facilityId: "WAREHOUSE_1", facilityName: "Central Warehouse" },
];

const SHIPMENT_METHODS: ShipmentMethod[] = [
  { shipmentMethodTypeId: "STANDARD", description: "Standard Shipping" },
  { shipmentMethodTypeId: "EXPRESS", description: "Express" },
  { shipmentMethodTypeId: "NEXT_DAY", description: "Next Day" },
];

const REASONS: ReturnReason[] = [
  { returnReasonId: "RTN_NOT_WANT", description: "No longer wanted" },
  { returnReasonId: "RTN_DEFECTIVE_ITEM", description: "Defective item" },
  { returnReasonId: "RTN_SIZE_EXCHANGE", description: "Wrong size" },
];

const APPEASEMENT_REASONS: ReturnReason[] = [
  { returnReasonId: "APPEASE_DAMAGED", description: "Goodwill refund — item arrived damaged" },
  { returnReasonId: "APPEASE_LATE", description: "Goodwill refund — late delivery" },
  { returnReasonId: "APPEASE_GOODWILL", description: "Goodwill / customer retention" },
  { returnReasonId: "APPEASE_PRICE_MATCH", description: "Goodwill refund — price match" },
  { returnReasonId: "APPEASE_OTHER", description: "Goodwill refund — other (see note)" },
];

const ORDER: OrderForReturn = {
  orderId: "DEMO-1001",
  orderName: "#1001",
  currencyUomId: "USD",
  billingEmail: "demo@example.com",
  items: [
    { orderItemSeqId: "00001", productId: "P1", productName: "Classic Tee", orderedQty: 2, alreadyReturnedQty: 0, returnableQty: 2, unitPrice: 19.99 },
    { orderItemSeqId: "00002", productId: "P2", productName: "Denim Jacket", orderedQty: 1, alreadyReturnedQty: 0, returnableQty: 1, unitPrice: 49.0 },
  ],
};

let store: Map<string, StubReturn>;
let seq: number;

function seedShopifyReturn(): StubReturn {
  return {
    returnId: "10000",
    type: "standard",
    orderId: "DEMO-2002",
    orderName: "#2002",
    orderDate: "2026-05-20T08:00:00Z",
    // An already-approved, synced return (a return must be approved before it syncs to Shopify).
    statusId: "RETURN_APPROVED",
    entryDate: "2026-05-28T10:00:00Z",
    origin: "shopify",
    sync: { shopify: "synced" },
    items: [{ orderItemSeqId: "00001", productId: "P9", productName: "Wool Beanie", returnQuantity: 1, returnReasonId: "DEFECTIVE", returnReasonDesc: "Defective item" }],
    statuses: [
      { statusId: "RETURN_REQUESTED", statusDate: "2026-05-28T10:00:00Z" },
      { statusId: "RETURN_APPROVED", statusDate: "2026-05-28T10:05:00Z" },
    ],
    externalIds: { shopify: "gid://shopify/Return/555" },
    shopifySync: { synced: true, shopifyReturnId: "gid://shopify/Return/555", pushStatusId: "PUSH_OK", returnStatusId: "OPEN" },
    pushAttempted: false,
    pollsUntilSynced: 0,
    closeAttempted: false,
    pollsUntilClosed: 0,
  };
}

export function __resetStub() {
  store = new Map();
  const seed = seedShopifyReturn();
  store.set(seed.returnId, seed);
  seq = 20000;
}
__resetStub();

function toSummary(r: StubReturn): ReturnSummary {
  return { returnId: r.returnId, type: r.type, orderId: r.orderId, orderName: r.orderName, orderDate: r.orderDate, statusId: r.statusId, entryDate: r.entryDate, origin: r.origin, sync: r.sync, isExchange: r.isExchange === true };
}

export const stubAdapter: ReturnsService = {
  async listReturns({ pageIndex = 0, pageSize = 20 }) {
    const all = [...store.values()].map(toSummary);
    const start = pageIndex * pageSize;
    return { items: all.slice(start, start + pageSize), total: all.length };
  },
  async getReturn(returnId) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    // The Shopify completion runs async — advance CLOSE_PENDING -> CLOSED across re-fetches (poll source of truth).
    if (r.closeAttempted && r.shopifySync?.shopifyReturnId && r.shopifySync.returnStatusId !== "CLOSED") {
      if (r.pollsUntilClosed > 0) {
        r.pollsUntilClosed -= 1;
        r.shopifySync = { ...r.shopifySync, closePushStatusId: "CLOSE_PENDING" };
      } else {
        r.shopifySync = { ...r.shopifySync, closePushStatusId: "CLOSE_OK", returnStatusId: "CLOSED" };
      }
    }
    const { pushAttempted, pollsUntilSynced, closeAttempted, pollsUntilClosed, ...detail } = r;
    return detail;
  },
  async createReturn({ orderId, items, appeasement }: CreateReturnInput) {
    const now = "2026-05-29T12:00:00Z";
    const makeStandard = (id: string) => {
      store.set(id, {
        returnId: id, type: "standard", orderId, orderName: ORDER.orderName, orderDate: "2026-05-22T08:00:00Z",
        statusId: "RETURN_REQUESTED", entryDate: now, origin: "pwa",
        sync: { shopify: "not_synced" },
        items: items.map((i) => ({
          orderItemSeqId: i.orderItemSeqId,
          productId: i.productId ?? "",
          productName: i.productName ?? "",
          returnQuantity: i.returnQuantity,
          returnReasonId: i.returnReasonId,
          returnReasonDesc: REASONS.find((x) => x.returnReasonId === i.returnReasonId)?.description,
        })),
        statuses: [{ statusId: "RETURN_REQUESTED", statusDate: now }],
        externalIds: { shopify: null },
        shopifySync: null, // no push on create
        pushAttempted: false, pollsUntilSynced: 0,
        closeAttempted: false, pollsUntilClosed: 0,
      });
    };
    // A stand-alone appeasement (no items returned) creates no standard return.
    const returnId = items.length ? String(seq++) : "";
    if (returnId) makeStandard(returnId);
    if (!appeasement) return { returnId };

    // Eligibility + amount cap (kept-merchandise value). Mirrors the server-side guard.
    const returnedQty: Record<string, number> = {};
    for (const i of items) returnedQty[i.orderItemSeqId] = (returnedQty[i.orderItemSeqId] ?? 0) + i.returnQuantity;
    const keptValue = ORDER.items.reduce(
      (sum, l) => sum + Math.max(0, l.returnableQty - (returnedQty[l.orderItemSeqId] ?? 0)) * l.unitPrice, 0);
    if (keptValue <= 0) throw new Error("Appeasement requires at least one kept item");

    // Lost-in-shipment shape: real product lines from the picked order items.
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
    // Navigate to the standard return when there is one, else to the stand-alone appeasement.
    return { returnId: returnId || appeasementReturnId, appeasementReturnId };
  },
  async createExchange({ orderId, returnItems, exchangeItems, fulfillmentType, shipmentMethodTypeId, facilityId }: CreateExchangeInput) {
    const now = "2026-05-29T12:00:00Z";
    const returnId = String(seq++);
    const replacementOrderId = `EXC${returnId}`;
    const immediate = fulfillmentType === "IMMEDIATE";
    const returnStatus = immediate ? "RETURN_COMPLETED" : "RETURN_APPROVED";
    const orderStatus = immediate ? "ORDER_COMPLETED" : "ORDER_APPROVED";
    const shipmentMethod = immediate
      ? "Handed over in store"
      : SHIPMENT_METHODS.find((m) => m.shipmentMethodTypeId === shipmentMethodTypeId)?.description ?? "Standard Shipping";
    store.set(returnId, {
      returnId, type: "standard", orderId, orderName: ORDER.orderName, orderDate: "2026-05-22T08:00:00Z",
      statusId: returnStatus, entryDate: now, origin: "pwa",
      // Exchange push (and close, for immediate) fire at create — arm them so the detail polls them to settled.
      sync: { shopify: "pending" },
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
        replacementOrderId, orderName: `${ORDER.orderName}-EXC`,
        orderStatusId: orderStatus, fulfillmentType, shipmentMethod,
        items: exchangeItems.map((e) => {
          const line = ORDER.items.find((l) => l.productId === e.productId);
          return { productId: e.productId, quantity: e.quantity, unitPrice: line?.unitPrice, itemDescription: line?.productName };
        }),
        exchangeCreditAmount: 0,
      },
      statuses: [{ statusId: "RETURN_REQUESTED", statusDate: now }, { statusId: returnStatus, statusDate: now }],
      externalIds: { shopify: null },
      // Seed shopifyReturnId + CLOSE_PENDING for immediate so getReturn can advance the close once the push lands.
      shopifySync: immediate
        ? { synced: false, pushStatusId: "PUSH_PENDING", shopifyReturnId: `gid://shopify/Return/${replacementOrderId}`, closePushStatusId: "CLOSE_PENDING" }
        : { synced: false, pushStatusId: "PUSH_PENDING" },
      pushAttempted: true, pollsUntilSynced: 0,
      closeAttempted: immediate, pollsUntilClosed: immediate ? 1 : 0,
    });
    void facilityId; // the chosen facility is the issuance origin server-side; not modeled further in the stub
    return { returnId, replacementOrderId };
  },

  async retryExchangePush(returnId) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    if (!r.isExchange) throw new Error("retryExchangePush called on a non-exchange return");
    if (r.sync.shopify === "synced") return; // already confirmed (PROC_OK) — idempotent no-op, mirrors the live backend
    // Idempotent resume: re-arm the push so getSyncStatus re-progresses, clearing any error.
    r.pushAttempted = true;
    r.sync = { shopify: "pending" };
    r.shopifySync = { ...(r.shopifySync ?? {}), pushStatusId: "PUSH_PENDING", processStatusId: null, processErrorMessage: null };
  },

  async approveReturn(returnId) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    if (r.statusId !== "RETURN_REQUESTED") throw new Error("Only requested returns can be approved");
    r.statusId = "RETURN_APPROVED";
    r.statuses = [...r.statuses, { statusId: "RETURN_APPROVED", statusDate: "2026-05-29T12:05:00Z" }];
    // Approval triggers the OMS->Shopify push server-side, but that push is ASYNC. For an exchange the
    // approve SECA fully owns the (exchange) push, and it hasn't executed by the time the client re-fetches
    // — so the return still reads `not_synced` immediately after approve. We only arm `pushAttempted` so the
    // subsequent poll (getSyncStatus) can progress it; we deliberately do NOT pre-set PUSH_PENDING here, so
    // the post-approve fetch surfaces the realistic `not_synced` gap. (A client that wrongly kicks the plain
    // `pushToShopify` on that gap is the phantom-failure bug this models.)
    r.pushAttempted = true;
    if (r.isExchange) {
      r.pollsUntilSynced = 1;
      r.sync = { shopify: "not_synced" };
      r.shopifySync = null;
      // Approval brokers the replacement order (shipped fulfillment).
      if (r.exchange) r.exchange = { ...r.exchange, orderStatusId: "ORDER_APPROVED" };
      return;
    }
    // Plain return / appeasement: the synchronous PUSH_PENDING model (the plain push is idempotent and the
    // client may safely re-kick it on a not-yet-started push).
    r.pollsUntilSynced = 1;
    r.sync = { shopify: "pending" };
    r.shopifySync = { synced: false, pushStatusId: "PUSH_PENDING" };
  },
  async rejectReturn(returnId) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    if (r.statusId !== "RETURN_REQUESTED") throw new Error("Only requested returns can be rejected");
    r.statusId = "RETURN_REJECTED";
    r.statuses = [...r.statuses, { statusId: "RETURN_REJECTED", statusDate: "2026-05-29T12:05:00Z" }];
  },
  async cancelReturn(returnId) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    if (!["RETURN_REQUESTED", "RETURN_APPROVED"].includes(r.statusId)) throw new Error("Return cannot be cancelled");
    r.statusId = "RETURN_CANCELLED";
    r.statuses = [...r.statuses, { statusId: "RETURN_CANCELLED", statusDate: "2026-05-29T12:05:00Z" }];
    // A synced Shopify *return* stays synced after cancel; its Shopify-side status becomes CANCELED.
    // A refund-only appeasement has no Shopify return (only a shopifyRefundId), so there is nothing to
    // mark CANCELED there — leave returnStatusId unset, matching the live backend.
    if (r.shopifySync?.synced && r.shopifySync.shopifyReturnId) r.shopifySync = { ...r.shopifySync, returnStatusId: "CANCELED" };
  },
  async completeReturn(returnId) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    if (r.statusId === "RETURN_COMPLETED") return; // idempotent: already completed
    if (!["RETURN_APPROVED", "RETURN_RECEIVED"].includes(r.statusId)) throw new Error("Return cannot be completed");
    r.statusId = "RETURN_COMPLETED";
    r.statuses = [...r.statuses, { statusId: "RETURN_COMPLETED", statusDate: "2026-05-29T12:10:00Z" }];
    if (r.isExchange && r.exchange) r.exchange = { ...r.exchange, orderStatusId: "ORDER_COMPLETED" };
    if (r.shopifySync?.shopifyReturnId) {
      r.closeAttempted = true;
      r.pollsUntilClosed = 1;
      r.shopifySync = { ...r.shopifySync, closePushStatusId: "CLOSE_PENDING" };
    }
  },
  async retryComplete(returnId) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    if (!r.shopifySync?.shopifyReturnId) return; // nothing to close in Shopify
    r.closeAttempted = true;
    r.pollsUntilClosed = 1;
    r.shopifySync = { ...r.shopifySync, closePushStatusId: "CLOSE_PENDING", closePushErrorMessage: null };
  },
  async getOrderForReturn(orderId) {
    return { ...ORDER, orderId };
  },
  async getReplacementOrder(orderId): Promise<ReplacementOrderDetail> {
    const exchangeReturn = [...store.values()].find((r) => r.exchange?.replacementOrderId === orderId);
    if (!exchangeReturn?.exchange) throw new Error("Replacement order not found");
    const ex = exchangeReturn.exchange;
    const items = (ex.items ?? []).map((it) => ({
      productId: it.productId,
      productName: it.itemDescription ?? ORDER.items.find((l) => l.productId === it.productId)?.productName ?? "",
      sku: ORDER.items.find((l) => l.productId === it.productId)?.sku,
      quantity: it.quantity,
      unitPrice: it.unitPrice ?? 0,
    }));
    // Fulfillment is chosen at create: read it from the stored block. Shipped (approved) carries tracking.
    const shipped = ex.fulfillmentType === "SHIPPED";
    return {
      orderId,
      orderName: ex.orderName ?? orderId,
      orderDate: "2026-05-29T12:00:00Z",
      statusId: ex.orderStatusId ?? "ORDER_APPROVED",
      currencyUomId: "USD",
      grandTotal: items.reduce((s, it) => s + it.unitPrice * it.quantity, 0),
      fulfillmentType: ex.fulfillmentType,
      shipmentMethod: ex.shipmentMethod,
      trackingCode: shipped && ex.orderStatusId === "ORDER_APPROVED" ? "1Z999AA10123456784" : undefined,
      carrier: shipped ? "UPS" : undefined,
      items,
    };
  },
  async listFacilities() {
    return FACILITIES;
  },
  async listShipmentMethods() {
    return SHIPMENT_METHODS;
  },
  async listReturnReasons() {
    return REASONS;
  },
  async listAppeasementReasons() {
    return APPEASEMENT_REASONS;
  },
  async pushToTarget(returnId, _target: SyncTarget) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    r.pushAttempted = true;
    r.pollsUntilSynced = 1; // one poll shows "pending", the next shows "synced"
    r.sync = { shopify: "pending" };
    r.shopifySync = { synced: false, pushStatusId: "PUSH_PENDING" };
    return "pushed";
  },
  async getSyncStatus(returnId): Promise<Record<SyncTarget, SyncState>> {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
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
    if (r.pushAttempted && r.sync.shopify !== "synced") {
      if (r.pollsUntilSynced > 0) {
        r.pollsUntilSynced -= 1;
        r.sync = { shopify: "pending" };
        r.shopifySync = { synced: false, pushStatusId: "PUSH_PENDING" };
      } else {
        r.sync = { shopify: "synced" };
        if (r.type === "appeasement") {
          r.externalIds = { shopify: null };
          r.shopifySync = { synced: true, shopifyRefundId: "gid://shopify/Refund/999", pushStatusId: "PUSH_OK" };
        } else {
          r.externalIds = { shopify: "gid://shopify/Return/999" };
          r.shopifySync = { synced: true, shopifyReturnId: "gid://shopify/Return/999", pushStatusId: "PUSH_OK", returnStatusId: "OPEN" };
        }
      }
    }
    return r.sync;
  },
};
