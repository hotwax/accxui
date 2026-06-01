import type { ReturnsService } from "@/services/ReturnsService";
import type {
  CreateReturnInput, OrderForReturn, ReturnDetail, ReturnReason,
  ReturnSummary, SyncState, SyncTarget,
} from "@/types/returns";

interface StubReturn extends ReturnDetail {
  pushAttempted: boolean;
  pollsUntilSynced: number;
  closeAttempted: boolean;
  pollsUntilClosed: number;
}

const REASONS: ReturnReason[] = [
  { returnReasonId: "RTN_NOT_WANT", description: "No longer wanted" },
  { returnReasonId: "RTN_DEFECTIVE_ITEM", description: "Defective item" },
  { returnReasonId: "RTN_SIZE_EXCHANGE", description: "Wrong size" },
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
  return { returnId: r.returnId, type: r.type, orderId: r.orderId, orderName: r.orderName, orderDate: r.orderDate, statusId: r.statusId, entryDate: r.entryDate, origin: r.origin, sync: r.sync };
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
    const returnId = String(seq++);
    makeStandard(returnId);
    if (!appeasement) return { returnId };

    // Eligibility + amount cap (kept-merchandise value). Mirrors the server-side guard (Open Q6).
    const returnedQty: Record<string, number> = {};
    for (const i of items) returnedQty[i.orderItemSeqId] = (returnedQty[i.orderItemSeqId] ?? 0) + i.returnQuantity;
    const keptValue = ORDER.items.reduce(
      (sum, l) => sum + Math.max(0, l.returnableQty - (returnedQty[l.orderItemSeqId] ?? 0)) * l.unitPrice, 0);
    if (keptValue <= 0) throw new Error("Appeasement requires at least one kept item");
    if (appeasement.amount <= 0 || appeasement.amount > keptValue) throw new Error("Appeasement amount out of range");

    const appeasementReturnId = String(seq++);
    store.set(appeasementReturnId, {
      returnId: appeasementReturnId, type: "appeasement", orderId, orderName: ORDER.orderName,
      orderDate: "2026-05-22T08:00:00Z", statusId: "RETURN_REQUESTED", entryDate: now, origin: "pwa",
      sync: { shopify: "not_synced" },
      items: [],
      appeasement: {
        amount: appeasement.amount, currencyUomId: appeasement.currencyUomId,
        reasonId: appeasement.reasonId,
        reasonDesc: REASONS.find((x) => x.returnReasonId === appeasement.reasonId)?.description,
        note: appeasement.note, relatedReturnId: returnId,
      },
      statuses: [{ statusId: "RETURN_REQUESTED", statusDate: now }],
      externalIds: { shopify: null },
      shopifySync: null,
      pushAttempted: false, pollsUntilSynced: 0,
      closeAttempted: false, pollsUntilClosed: 0,
    });
    return { returnId, appeasementReturnId };
  },
  async approveReturn(returnId) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    if (r.statusId !== "RETURN_REQUESTED") throw new Error("Only requested returns can be approved");
    r.statusId = "RETURN_APPROVED";
    r.statuses = [...r.statuses, { statusId: "RETURN_APPROVED", statusDate: "2026-05-29T12:05:00Z" }];
    // Approval triggers the OMS->Shopify push (getSyncStatus then progresses pending -> synced).
    r.pushAttempted = true;
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
    // A return already synced to Shopify stays synced after cancel; the Shopify-side status becomes CANCELED.
    if (r.shopifySync?.synced) r.shopifySync = { ...r.shopifySync, returnStatusId: "CANCELED" };
  },
  async completeReturn(returnId) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    if (r.statusId === "RETURN_COMPLETED") return; // idempotent: already completed, no double Shopify completion
    if (!["RETURN_APPROVED", "RETURN_RECEIVED"].includes(r.statusId)) throw new Error("Return cannot be completed");
    r.statusId = "RETURN_COMPLETED";
    r.statuses = [...r.statuses, { statusId: "RETURN_COMPLETED", statusDate: "2026-05-29T12:10:00Z" }];
    // Triggers the async Shopify close only when the return was actually synced; otherwise it no-ops (skipped).
    if (r.shopifySync?.shopifyReturnId) {
      r.closeAttempted = true;
      r.pollsUntilClosed = 1; // one poll shows pending, the next shows CLOSED
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
  async listReturnReasons() {
    return REASONS;
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
