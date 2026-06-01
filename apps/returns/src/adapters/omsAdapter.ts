import { api, commonUtil } from "@common";
import { maargApiKey } from "@/util/maargAuth";
import type { ReturnsService } from "@/services/ReturnsService";
import type {
  AppeasementInput, AppeasementItemInput,
  CreateReturnInput, OrderForReturn, PushOutcome, ReturnableLine, ReturnDetail, ReturnReason,
  ReturnSummary, ReturnType, SyncState, SyncTarget,
} from "@/types/returns";
import {
  resolveOrigin, resolveShopifySyncState, type Identification, type ShopifySync,
} from "@/util/syncState";

// Open Q1 (CONFIRMED): the return-type id that marks a return as an appeasement is the header-level
// returnHeaderTypeId === "APPEASEMENT". Centralised here so a future change is still a one-line edit.
export const APPEASEMENT_RETURN_TYPE_ID = "APPEASEMENT";

/** Map a raw returnHeaderTypeId to the UI return-type discriminator. */
export function mapReturnType(returnHeaderTypeId?: string | null): ReturnType {
  return returnHeaderTypeId === APPEASEMENT_RETURN_TYPE_ID ? "appeasement" : "standard";
}

// ---- Pure mappers (unit-tested) ----

interface RawReturnDetail {
  returnDetail: {
    returnId: string; statusId: string; entryDate: string | number; returnDate?: string | number;
    // Order reference now lives on returnDetail. orderName/externalOrderId are the customer-facing name
    // (OrderHeader.orderName, equal values); orderExternalId is the Shopify GID and is NEVER displayed.
    orderId?: string; orderName?: string; externalOrderId?: string; orderExternalId?: string; orderDate?: string | number;
    // Appeasement (confirmed contract): header carries the type + currency; the refund amount/reason/note
    // ride the single monetary item line and the linkage is a RELATED_RETURN_ID identification.
    returnHeaderTypeId?: string; currencyUomId?: string;
  };
  items?: Array<{ orderId?: string; externalOrderId?: string; orderItemSeqId: string; productId?: string; productName?: string; sku?: string; returnQuantity: number | string; returnReasonId: string; itemDescription?: string; returnPrice?: number | string; reasonDescription?: string; description?: string }>;
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
  const type = mapReturnType(rd.returnHeaderTypeId);
  // Appeasement detail: shape is detected by whether the lines carry a productId.
  // - amount-only / legacy: a single synthetic monetary line (no productId) — amount = its returnPrice.
  // - lost-in-shipment: real product line(s) — amount = Σ(returnPrice × returnQuantity).
  // The linked standard return is a RELATED_RETURN_ID identification.
  const appLines = type === "appeasement" ? items : [];
  const isItemAppeasement = appLines.length > 0 && !!appLines[0].productId;
  const appeasement = type === "appeasement"
    ? {
        amount: isItemAppeasement
          ? appLines.reduce((s, it) => s + Number(it.returnPrice ?? 0) * Number(it.returnQuantity), 0)
          : Number(appLines[0]?.returnPrice ?? 0),
        currencyUomId: rd.currencyUomId ?? "USD",
        reasonId: appLines[0]?.returnReasonId ?? "",
        reasonDesc: appLines[0]?.reasonDescription || undefined,
        note: isItemAppeasement ? undefined : appLines[0]?.description || undefined,
        relatedReturnId: idents.find((i) => i.returnIdentificationTypeId === "RELATED_RETURN_ID")?.idValue || undefined,
      }
    : undefined;
  // Display name: prefer orderName, then its alias externalOrderId. Never orderExternalId (the GID).
  const orderName = rd.orderName ?? rd.externalOrderId ?? items[0]?.externalOrderId ?? "";
  return {
    returnId: rd.returnId,
    type,
    appeasement,
    // Order ref now lives on returnDetail; fall back to the first item only for older payloads.
    orderId: rd.orderId ?? items[0]?.orderId ?? "",
    orderName,
    orderDate: rd.orderDate != null ? String(rd.orderDate) : undefined,
    statusId: rd.statusId,
    entryDate: String(rd.entryDate),
    origin,
    sync: { shopify },
    // Carry the raw object so the view can surface pushErrorMessage + Shopify-side returnStatusId.
    shopifySync: raw.shopifySync ?? null,
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
  orderDetail: { orderId: string; orderName?: string; externalOrderId?: string; orderExternalId?: string; billingEmail?: string; currencyUomId?: string; shipGroups?: Array<{ items?: RawOrderItem[] }> };
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
    currencyUomId: raw.orderDetail.currencyUomId ?? "USD",
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

/** Build the POST body for the appeasement create call. Shape is selected by `items`:
 *  amount-only sends `amount`; lost-in-shipment sends `items` and only sends `amount` when overridden. */
export function buildAppeasementCreateBody(orderId: string, a: AppeasementInput, relatedReturnId?: string): {
  orderId: string; reasonId: string; currencyUomId: string;
  note?: string; relatedReturnId?: string; items?: AppeasementItemInput[]; amount?: number;
} {
  return {
    orderId,
    reasonId: a.reasonId,
    currencyUomId: a.currencyUomId,
    ...(a.note ? { note: a.note } : {}),
    ...(relatedReturnId ? { relatedReturnId } : {}),
    ...(a.items?.length ? { items: a.items } : {}),
    ...(a.amount != null ? { amount: a.amount } : {}),
  };
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
      // Open Q1: if appeasements use a distinct returnHeaderTypeId, broaden this filter so they list too.
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to list returns");
    const rows: any[] = resp.data?.returns ?? [];
    const items: ReturnSummary[] = rows.map((r) => ({
      returnId: r.returnId,
      type: mapReturnType(r.returnHeaderTypeId),
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
    // Standard return for the kept-item return (when there are items to return).
    let returnId = "";
    if (input.items.length) {
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
      returnId = resp.data.returnId;
    }
    if (!input.appeasement) return { returnId };
    // Appeasement is a SEPARATE call (confirmed contract: two calls, not one atomic create).
    const appResp: any = await omsApi({
      url: "oms/returns/appeasementReturn", method: "POST",
      data: buildAppeasementCreateBody(input.orderId, input.appeasement, returnId || undefined),
    });
    if (commonUtil.hasError(appResp)) throw new Error("Failed to create appeasement");
    const appeasementReturnId = appResp.data.returnId;
    // Navigate to the standard return when there is one, else to the stand-alone appeasement.
    return { returnId: returnId || appeasementReturnId, appeasementReturnId };
  },

  async approveReturn(returnId) {
    const resp: any = await omsApi({ url: `oms/returns/${returnId}/approve`, method: "POST" });
    if (commonUtil.hasError(resp)) throw new Error("Failed to approve return");
  },

  async rejectReturn(returnId) {
    const resp: any = await omsApi({ url: `oms/returns/${returnId}/reject`, method: "POST" });
    if (commonUtil.hasError(resp)) throw new Error("Failed to reject return");
  },

  async cancelReturn(returnId) {
    const resp: any = await omsApi({ url: `oms/returns/${returnId}/cancel`, method: "POST" });
    if (commonUtil.hasError(resp)) throw new Error("Failed to cancel return");
  },

  async completeReturn(returnId) {
    // OMS -> RETURN_COMPLETED immediately; the Shopify completion (returnProcess + returnClose) runs async.
    const resp: any = await omsApi({ url: `oms/returns/${returnId}/complete`, method: "POST" });
    if (commonUtil.hasError(resp)) throw new Error("Failed to complete return");
  },

  async retryComplete(returnId) {
    // Re-run the Shopify completion after a CLOSE_FAILED (idempotent).
    const resp: any = await omsApi({ url: `oms/returns/${returnId}/retryComplete`, method: "POST" });
    if (commonUtil.hasError(resp)) throw new Error("Failed to retry completion");
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

  async listAppeasementReasons(): Promise<ReturnReason[]> {
    const resp: any = await omsApi({ url: "oms/appeasementReasons", method: "GET" });
    if (commonUtil.hasError(resp)) throw new Error("Failed to load appeasement reasons");
    return (resp.data?.reasons ?? [])
      .slice()
      .sort((x: any, y: any) => String(x.sequenceId ?? "").localeCompare(String(y.sequenceId ?? "")))
      .map((r: any) => ({ returnReasonId: r.returnReasonId, description: r.description }));
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
