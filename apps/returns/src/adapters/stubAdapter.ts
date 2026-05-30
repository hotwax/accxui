import type { ReturnsService } from "@/services/ReturnsService";
import type {
  CreateReturnInput, OrderForReturn, ReturnDetail, ReturnReason,
  ReturnSummary, SyncState, SyncTarget,
} from "@/types/returns";

interface StubReturn extends ReturnDetail {
  pushAttempted: boolean;
  pollsUntilSynced: number;
}

const REASONS: ReturnReason[] = [
  { returnReasonId: "RTN_NOT_WANT", description: "No longer wanted" },
  { returnReasonId: "RTN_DEFECTIVE_ITEM", description: "Defective item" },
  { returnReasonId: "RTN_SIZE_EXCHANGE", description: "Wrong size" },
];

const ORDER: OrderForReturn = {
  orderId: "DEMO-1001",
  orderName: "#1001",
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
    orderId: "DEMO-2002",
    orderName: "#2002",
    orderDate: "2026-05-20T08:00:00Z",
    statusId: "RETURN_REQUESTED",
    entryDate: "2026-05-28T10:00:00Z",
    origin: "shopify",
    sync: { shopify: "synced" },
    items: [{ orderItemSeqId: "00001", productId: "P9", productName: "Wool Beanie", returnQuantity: 1, returnReasonId: "DEFECTIVE", returnReasonDesc: "Defective item" }],
    statuses: [{ statusId: "RETURN_REQUESTED", statusDate: "2026-05-28T10:00:00Z" }],
    externalIds: { shopify: "gid://shopify/Return/555" },
    pushAttempted: false,
    pollsUntilSynced: 0,
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
  return { returnId: r.returnId, orderId: r.orderId, orderName: r.orderName, orderDate: r.orderDate, statusId: r.statusId, entryDate: r.entryDate, origin: r.origin, sync: r.sync };
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
    const { pushAttempted, pollsUntilSynced, ...detail } = r;
    return detail;
  },
  async createReturn({ orderId, items }: CreateReturnInput) {
    const returnId = String(seq++);
    const now = "2026-05-29T12:00:00Z";
    store.set(returnId, {
      returnId, orderId, orderName: ORDER.orderName, orderDate: "2026-05-22T08:00:00Z", statusId: "RETURN_REQUESTED", entryDate: now, origin: "pwa",
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
      pushAttempted: false, pollsUntilSynced: 0,
    });
    return { returnId };
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
    return "pushed";
  },
  async getSyncStatus(returnId): Promise<Record<SyncTarget, SyncState>> {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    if (r.pushAttempted && r.sync.shopify !== "synced") {
      if (r.pollsUntilSynced > 0) {
        r.pollsUntilSynced -= 1;
        r.sync = { shopify: "pending" };
      } else {
        r.sync = { shopify: "synced" };
        r.externalIds = { shopify: "gid://shopify/Return/999" };
      }
    }
    return r.sync;
  },
};
