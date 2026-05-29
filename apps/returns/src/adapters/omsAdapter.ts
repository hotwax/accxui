import { api, commonUtil } from "@common";
import type { ReturnsService } from "@/services/ReturnsService";
import type {
  CreateReturnInput, OrderForReturn, ReturnDetail, ReturnReason,
  ReturnSummary, SyncState, SyncTarget,
} from "@/types/returns";
import { computeReturnableLines, type RawOrderItem } from "@/util/returnable";
import { resolveOrigin, resolveSyncState, type Identification } from "@/util/syncState";

// ---- Pure mappers (unit-tested) ----

interface RawReturnHeader {
  returnId: string;
  statusId: string;
  entryDate: string;
  orderId?: string;
  returnIdentifications?: Identification[];
}

export function mapReturnHeaderToSummary(h: RawReturnHeader): ReturnSummary {
  const idents = h.returnIdentifications ?? [];
  const origin = resolveOrigin(idents);
  const hasShopifyId = idents.some((i) => i.returnIdentificationTypeId === "SHOPIFY_RTN_ID");
  const shopify: SyncState = resolveSyncState({ hasShopifyId, origin, pushAttempted: false, pushFailed: false });
  return {
    returnId: h.returnId,
    orderId: h.orderId ?? "",
    statusId: h.statusId,
    entryDate: h.entryDate,
    origin,
    sync: { shopify },
  };
}

interface RawOrder {
  orderDetail: { orderId: string; billingEmail?: string };
  shipGroups?: Array<{ items?: RawOrderItem[] }>;
}

export function mapOrderToReturnable(o: RawOrder, returnedQtyBySeqId: Record<string, number> = {}): OrderForReturn {
  const rawItems = (o.shipGroups ?? []).flatMap((g) => g.items ?? []);
  return {
    orderId: o.orderDetail.orderId,
    billingEmail: o.orderDetail.billingEmail,
    items: computeReturnableLines(rawItems, returnedQtyBySeqId),
  };
}

// ---- Adapter (wires mappers to OMS endpoints) ----

export const omsAdapter: ReturnsService = {
  async listReturns({ pageIndex = 0, pageSize = 20, statusId }) {
    const resp: any = await api({
      url: "oms/returns", method: "GET", baseURL: commonUtil.getMaargURL(),
      params: { pageIndex, pageSize, ...(statusId ? { statusId } : {}) },
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to list returns");
    const rows: RawReturnHeader[] = resp.data ?? [];
    const total = Number(resp.headers?.["x-total-count"] ?? rows.length);
    return { items: rows.map(mapReturnHeaderToSummary), total };
  },

  async getReturn(returnId): Promise<ReturnDetail> {
    const resp: any = await api({
      url: `ReturnHeader/${returnId}`, method: "GET", baseURL: commonUtil.getMaargURL(),
      params: { dependents: true },
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to load return");
    const h = resp.data;
    const summary = mapReturnHeaderToSummary(h);
    return {
      ...summary,
      items: (h.returnItems ?? []).map((i: any) => ({
        orderItemSeqId: i.orderItemSeqId, productId: i.productId,
        returnQuantity: Number(i.returnQuantity), returnReasonId: i.returnReasonId,
      })),
      statuses: (h.returnStatuses ?? []).map((s: any) => ({ statusId: s.statusId, statusDate: s.statusDate })),
      externalIds: { shopify: (h.returnIdentifications ?? []).find((i: any) => i.returnIdentificationTypeId === "SHOPIFY_RTN_ID")?.idValue ?? null },
    };
  },

  async createReturn(input: CreateReturnInput) {
    // Assumes composite create#CustomerReturn (backend in progress). One transactional call.
    const resp: any = await api({
      url: "oms/returns", method: "POST", baseURL: commonUtil.getMaargURL(), data: input,
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
      url: "ReturnReason", method: "GET", baseURL: commonUtil.getMaargURL(),
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to load reasons");
    return (resp.data ?? []).map((r: any) => ({ returnReasonId: r.returnReasonId, description: r.description }));
  },

  async pushToTarget(returnId, _target: SyncTarget) {
    // Assumes outbound push#ShopifyReturn endpoint (backend in progress).
    const resp: any = await api({
      url: `oms/returns/${returnId}/push`, method: "POST", baseURL: commonUtil.getMaargURL(),
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to push to Shopify");
  },

  async getSyncStatus(returnId): Promise<Record<SyncTarget, SyncState>> {
    const detail = await this.getReturn(returnId);
    return detail.sync;
  },
};
