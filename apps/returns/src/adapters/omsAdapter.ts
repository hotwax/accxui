import { api, commonUtil, logger } from "@common";
import type { ReturnsService } from "@/services/ReturnsService";
import type {
  CreateReturnInput, OrderForReturn, PushOutcome, ReturnableLine, ReturnDetail, ReturnReason,
  ReturnSummary, SyncState, SyncTarget,
} from "@/types/returns";
import {
  resolveOrigin, resolveShopifySyncState, type Identification, type ShopifySync,
} from "@/util/syncState";

// Service endpoints live under getMaargURL() (".../rest/s1/"); Entity REST lives under ".../rest/e1/".
const entityBaseURL = () => commonUtil.getMaargURL().replace("/rest/s1", "/rest/e1");

// ---- Pure mappers (unit-tested) ----

interface RawReturnDetail {
  returnDetail: { returnId: string; statusId: string; entryDate: string };
  items?: Array<{ orderId?: string; orderItemSeqId: string; productId?: string; returnQuantity: number | string; returnReasonId: string; itemDescription?: string }>;
  statusHistory?: Array<{ statusId: string; statusDatetime: string }>;
  identifications?: Identification[];
  shopifySync?: ShopifySync | null;
}

/** Map the `GET /oms/returns/{id}` payload into a ReturnDetail. */
export function mapReturnDetail(raw: RawReturnDetail): ReturnDetail {
  const idents = raw.identifications ?? [];
  const items = raw.items ?? [];
  const origin = resolveOrigin(idents);
  const shopify: SyncState = resolveShopifySyncState(raw.shopifySync);
  const shopifyReturnId = raw.shopifySync?.shopifyReturnId
    ?? idents.find((i) => i.returnIdentificationTypeId === "SHOPIFY_RTN_ID")?.idValue
    ?? null;
  return {
    returnId: raw.returnDetail.returnId,
    orderId: items[0]?.orderId ?? "",
    statusId: raw.returnDetail.statusId,
    entryDate: raw.returnDetail.entryDate,
    origin,
    sync: { shopify },
    items: items.map((i) => ({
      orderItemSeqId: i.orderItemSeqId,
      productId: i.productId ?? "",
      returnQuantity: Number(i.returnQuantity),
      returnReasonId: i.returnReasonId,
      // Backend getReturn does not join ReturnReason.description; view falls back to the id.
    })),
    statuses: (raw.statusHistory ?? []).map((s) => ({ statusId: s.statusId, statusDate: s.statusDatetime })),
    externalIds: { shopify: shopifyReturnId },
  };
}

interface RawOrderItem {
  orderItemSeqId: string;
  productId?: string;
  quantity: number | string;
  unitPrice: number | string;
  alreadyReturnedQuantity?: number | string;
  returnableQuantity?: number | string;
}
interface RawOrder {
  orderDetail: { orderId: string; billingEmail?: string; shipGroups?: Array<{ items?: RawOrderItem[] }> };
}

/** Map `GET /oms/orders/{id}` into an OrderForReturn, trusting the backend's returnableQuantity. */
export function mapOrderToReturnable(raw: RawOrder): OrderForReturn {
  const rawItems = (raw.orderDetail.shipGroups ?? []).flatMap((g) => g.items ?? []);
  const items: ReturnableLine[] = rawItems.map((it) => {
    const orderedQty = Number(it.quantity);
    const alreadyReturnedQty = Number(it.alreadyReturnedQuantity ?? 0);
    const returnableQty = it.returnableQuantity != null
      ? Number(it.returnableQuantity)
      : Math.max(0, orderedQty - alreadyReturnedQty);
    return {
      orderItemSeqId: it.orderItemSeqId,
      productId: it.productId ?? "",
      orderedQty,
      alreadyReturnedQty,
      returnableQty,
      unitPrice: Number(it.unitPrice),
    };
  });
  return { orderId: raw.orderDetail.orderId, billingEmail: raw.orderDetail.billingEmail, items };
}

function toSummary(d: ReturnDetail): ReturnSummary {
  return { returnId: d.returnId, orderId: d.orderId, statusId: d.statusId, entryDate: d.entryDate, origin: d.origin, sync: d.sync };
}

// ---- Adapter ----

export const omsAdapter: ReturnsService = {
  // No dedicated list service endpoint exists; we page ReturnHeader via Entity REST and enrich each
  // row through the detail endpoint (which is the only source of origin/sync/orderId). Demo-scale only.
  async listReturns({ pageIndex = 0, pageSize = 20 }) {
    const resp: any = await api({
      url: "org.apache.ofbiz.order.return.ReturnHeader", method: "GET", baseURL: entityBaseURL(),
      params: { limit: pageSize, offset: pageIndex * pageSize, orderByField: "-entryDate" },
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to list returns");
    const rows: Array<{ returnId: string }> = Array.isArray(resp.data) ? resp.data : (resp.data?.returnHeaderList ?? []);
    // Enrich each row via the detail endpoint; tolerate individual failures so one bad row can't blank the page.
    const settled = await Promise.allSettled(rows.map((row) => omsAdapter.getReturn(row.returnId)));
    const items = settled
      .filter((s): s is PromiseFulfilledResult<ReturnDetail> => s.status === "fulfilled")
      .map((s) => toSummary(s.value));
    const dropped = settled.length - items.length;
    if (dropped > 0) logger.warn?.(`listReturns: ${dropped}/${settled.length} returns failed to load and were omitted`);
    const total = Number(resp.headers?.["x-total-count"] ?? rows.length);
    return { items, total };
  },

  async getReturn(returnId): Promise<ReturnDetail> {
    const resp: any = await api({
      url: `oms/returns/${returnId}`, method: "GET", baseURL: commonUtil.getMaargURL(),
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to load return");
    return mapReturnDetail(resp.data);
  },

  async createReturn(input: CreateReturnInput) {
    const body = {
      orderId: input.orderId,
      items: input.items.map((i) => ({
        orderItemSeqId: i.orderItemSeqId,
        returnQuantity: i.returnQuantity,
        returnReasonId: i.returnReasonId,
      })),
    };
    const resp: any = await api({
      url: "oms/returns/customerReturn", method: "POST", baseURL: commonUtil.getMaargURL(), data: body,
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to create return");
    return { returnId: resp.data.returnId };
  },

  async getOrderForReturn(orderId) {
    const resp: any = await api({
      url: `oms/orders/${orderId}`, method: "GET", baseURL: commonUtil.getMaargURL(),
    });
    if (commonUtil.hasError(resp)) throw new Error("Order not found");
    return mapOrderToReturnable(resp.data);
  },

  async listReturnReasons(): Promise<ReturnReason[]> {
    const resp: any = await api({
      url: "oms/returnReasons", method: "GET", baseURL: commonUtil.getMaargURL(),
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to load reasons");
    return (resp.data?.reasons ?? []).map((r: any) => ({ returnReasonId: r.returnReasonId, description: r.description }));
  },

  async pushToTarget(returnId, _target: SyncTarget): Promise<PushOutcome> {
    // Manual retry of the OMS→Shopify push. In Phase B the push also fires automatically on create.
    const resp: any = await api({
      url: `oms/returns/${returnId}/pushToShopify`, method: "POST", baseURL: commonUtil.getMaargURL(),
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to push to Shopify");
    const status = resp.data?.status; // "pushed" | "already_synced" | "skipped" | "failed"
    if (status === "failed") throw new Error(resp.data.errorMessage || "Push to Shopify failed");
    return (status as PushOutcome) ?? "pushed";
  },

  async getSyncStatus(returnId): Promise<Record<SyncTarget, SyncState>> {
    const detail = await omsAdapter.getReturn(returnId);
    return detail.sync;
  },
};
