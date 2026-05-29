import { api, commonUtil, cookieHelper, useEmbeddedAppStore } from "@common";
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
  returnDetail: { returnId: string; statusId: string; entryDate: string | number };
  items?: Array<{ orderId?: string; orderItemSeqId: string; productId?: string; returnQuantity: number | string; returnReasonId: string; itemDescription?: string }>;
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
  return {
    returnId: raw.returnDetail.returnId,
    orderId: items[0]?.orderId ?? "",
    statusId: raw.returnDetail.statusId,
    entryDate: String(raw.returnDetail.entryDate),
    origin,
    sync: { shopify },
    items: items.map((i) => ({
      orderItemSeqId: i.orderItemSeqId,
      productId: i.productId ?? "",
      returnQuantity: Number(i.returnQuantity),
      returnReasonId: i.returnReasonId,
      // Backend getReturn does not join ReturnReason.description; view falls back to the id.
    })),
    statuses: (raw.statusHistory ?? []).map((s) => ({ statusId: s.statusId, statusDate: String(s.statusDatetime) })),
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

// ---- Adapter ----

// This Moqui build authenticates ONLY via the `api_key` (UserLoginKey) header — Bearer JWT is not wired.
// @common's remoteApi sends Bearer, so we must attach api_key ourselves. Source it from @common's store/
// cookie if a login captured it, else a demo-provisioned env key (VITE_RETURNS_API_KEY).
function maargApiKey(): string {
  try {
    const fromStore = useEmbeddedAppStore().getApiKey;
    if (fromStore) return fromStore;
  } catch { /* pinia not active (e.g. unit context) — fall through */ }
  return cookieHelper().get("api_key") || (import.meta.env.VITE_RETURNS_API_KEY as string) || "";
}

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
  // v2 service endpoint. The list is lightweight: rows carry no orderId or shopifySync, so a list
  // summary omits origin/sync — the detail endpoint is the source for those.
  async listReturns({ pageIndex = 0, pageSize = 20, statusId }) {
    const resp: any = await omsApi({
      url: "oms/returns", method: "GET",
      params: { pageIndex, pageSize, returnHeaderTypeId: "CUSTOMER_RETURN", ...(statusId ? { statusId } : {}) },
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to list returns");
    const rows: any[] = resp.data?.returns ?? [];
    const items: ReturnSummary[] = rows.map((r) => ({
      returnId: r.returnId,
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
