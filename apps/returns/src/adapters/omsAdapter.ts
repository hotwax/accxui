import { api, commonUtil } from "@common";
import { maargApiKey } from "@/util/maargAuth";
import type { ReturnsService } from "@/services/ReturnsService";
import type {
  CreateReturnInput, OrderForReturn, PushOutcome, ReturnableLine, ReturnDetail, ReturnReason,
  ReturnSummary, SyncState, SyncTarget,
} from "@/types/returns";
import {
  resolveOrigin, resolveShopifySyncState, type Identification, type ShopifySync,
} from "@/util/syncState";

// ---- Pure mappers (unit-tested) ----

interface RawReturnDetail {
  returnDetail: {
    returnId: string; statusId: string; entryDate: string | number; returnDate?: string | number;
    // Order reference now lives on returnDetail. orderName/externalOrderId are the customer-facing name
    // (OrderHeader.orderName, equal values); orderExternalId is the Shopify GID and is NEVER displayed.
    orderId?: string; orderName?: string; externalOrderId?: string; orderExternalId?: string; orderDate?: string | number;
  };
  items?: Array<{ orderId?: string; externalOrderId?: string; orderItemSeqId: string; productId?: string; productName?: string; sku?: string; returnQuantity: number | string; returnReasonId: string; itemDescription?: string }>;
  statusHistory?: Array<{ statusId: string; statusDatetime: string | number }>;
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
  const rd = raw.returnDetail;
  // Display name: prefer orderName, then its alias externalOrderId. Never orderExternalId (the GID).
  const orderName = rd.orderName ?? rd.externalOrderId ?? items[0]?.externalOrderId ?? "";
  return {
    returnId: rd.returnId,
    // Order ref now lives on returnDetail; fall back to the first item only for older payloads.
    orderId: rd.orderId ?? items[0]?.orderId ?? "",
    orderName,
    orderDate: rd.orderDate != null ? String(rd.orderDate) : undefined,
    statusId: rd.statusId,
    entryDate: String(rd.entryDate),
    origin,
    sync: { shopify },
    items: items.map((i) => ({
      orderItemSeqId: i.orderItemSeqId,
      productId: i.productId ?? "",
      // Prefer an explicit productName; fall back to the order item's itemDescription. "" -> view shows sku/productId.
      productName: i.productName ?? i.itemDescription ?? "",
      sku: i.sku ?? undefined,
      returnQuantity: Number(i.returnQuantity),
      returnReasonId: i.returnReasonId,
      // Backend getReturn does not join ReturnReason.description; view prettifies the reasonId instead.
    })),
    statuses: (raw.statusHistory ?? []).map((s) => ({ statusId: s.statusId, statusDate: String(s.statusDatetime) })),
    externalIds: { shopify: shopifyReturnId },
  };
}

interface RawOrderItem {
  orderItemSeqId: string;
  productId?: string;
  productName?: string;
  sku?: string;
  quantity: number | string;
  unitPrice: number | string;
  alreadyReturnedQuantity?: number | string;
  returnableQuantity?: number | string;
}
interface RawOrder {
  // orderName/externalOrderId are the customer-facing name; orderExternalId is the GID (never displayed).
  orderDetail: { orderId: string; orderName?: string; externalOrderId?: string; orderExternalId?: string; billingEmail?: string; shipGroups?: Array<{ items?: RawOrderItem[] }> };
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
      productName: it.productName ?? "",
      sku: it.sku ?? undefined,
      orderedQty,
      alreadyReturnedQty,
      returnableQty,
      unitPrice: Number(it.unitPrice),
    };
  });
  return {
    orderId: raw.orderDetail.orderId,
    // Prefer orderName, then its alias externalOrderId. Never orderExternalId (the GID).
    orderName: raw.orderDetail.orderName ?? raw.orderDetail.externalOrderId ?? "",
    billingEmail: raw.orderDetail.billingEmail,
    items,
  };
}

// ---- Adapter ----

// This Moqui build authenticates ONLY via the `api_key` (UserLoginKey) header — Bearer JWT is not wired.
// @common's remoteApi sends Bearer, so we attach api_key ourselves via the shared maargApiKey() helper.

/** api() wrapper that pins the Maarg base URL and the api_key auth header for every returns call. */
async function omsApi(config: any) {
  const key = maargApiKey();
  return api({
    baseURL: commonUtil.getMaargURL(),
    ...config,
    headers: { ...(key ? { api_key: key } : {}), ...(config.headers || {}) },
  });
}

export const omsAdapter: ReturnsService = {
  // v2 service endpoint. shopifySync is detail-only, so a list summary omits origin/sync.
  // The list SHOULD also carry the order identifier so rows are recognizable — we map orderId/
  // externalOrderId when the row provides them, and degrade to "Return #id" when it doesn't.
  // (Backend ask: include orderId + externalOrderId on each GET /oms/returns row.)
  async listReturns({ pageIndex = 0, pageSize = 20, statusId }) {
    const resp: any = await omsApi({
      url: "oms/returns", method: "GET",
      params: { pageIndex, pageSize, returnHeaderTypeId: "CUSTOMER_RETURN", ...(statusId ? { statusId } : {}) },
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to list returns");
    const rows: any[] = resp.data?.returns ?? [];
    const items: ReturnSummary[] = rows.map((r) => ({
      returnId: r.returnId,
      orderId: r.orderId ?? undefined,
      // Customer-facing name: orderName, or its alias externalOrderId. Never orderExternalId (the GID).
      orderName: r.orderName ?? r.externalOrderId ?? undefined,
      // Shopify order GID — not displayed, indexed only so search can match a Shopify order id.
      orderExternalId: r.orderExternalId ?? undefined,
      orderDate: r.orderDate != null ? String(r.orderDate) : undefined,
      statusId: r.statusId,
      entryDate: String(r.entryDate),
      returnChannelEnumId: r.returnChannelEnumId,
    }));
    // returnsCount is the count in this response; treated as the total for the demo's pagination.
    const total = Number(resp.data?.returnsCount ?? items.length);
    return { items, total };
  },

  async getReturn(returnId): Promise<ReturnDetail> {
    const resp: any = await omsApi({ url: `oms/returns/${returnId}`, method: "GET" });
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
    const resp: any = await omsApi({ url: "oms/returns/customerReturn", method: "POST", data: body });
    if (commonUtil.hasError(resp)) throw new Error("Failed to create return");
    return { returnId: resp.data.returnId };
  },

  async getOrderForReturn(orderId) {
    const resp: any = await omsApi({ url: `oms/orders/${orderId}`, method: "GET" });
    if (commonUtil.hasError(resp)) throw new Error("Order not found");
    return mapOrderToReturnable(resp.data);
  },

  async listReturnReasons(): Promise<ReturnReason[]> {
    const resp: any = await omsApi({ url: "oms/returnReasons", method: "GET" });
    if (commonUtil.hasError(resp)) throw new Error("Failed to load reasons");
    return (resp.data?.reasons ?? []).map((r: any) => ({ returnReasonId: r.returnReasonId, description: r.description }));
  },

  async pushToTarget(returnId, _target: SyncTarget): Promise<PushOutcome> {
    // Manual retry of the OMS→Shopify push. In Phase B the push also fires automatically on create.
    const resp: any = await omsApi({ url: `oms/returns/${returnId}/pushToShopify`, method: "POST" });
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
