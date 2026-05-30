export type SyncTarget = "shopify";
export type SyncState = "not_synced" | "pending" | "synced" | "failed";
export type ReturnOrigin = "pwa" | "shopify";

/** Outcome of an outbound push trigger (the "failed" case is surfaced as a thrown error instead). */
export type PushOutcome = "pushed" | "already_synced" | "skipped";

export interface ReturnItemInput {
  orderItemSeqId: string;
  productId?: string; // display-only context; not submitted to the create endpoint
  productName?: string; // display-only context; not submitted to the create endpoint
  returnQuantity: number;
  returnReasonId: string;
}

export interface ReturnSummary {
  returnId: string;
  // The list endpoint (GET /oms/returns) is lightweight: it returns neither orderId nor sync/origin.
  // Those are only available from the detail endpoint, so they are optional on a summary.
  orderId?: string;
  // Customer-facing Shopify order name/number (e.g. "#1001"); preferred over the internal orderId for display.
  // NB: this is OrderHeader.orderName, NOT the Shopify GID (orderExternalId) — the GID is never displayed.
  orderName?: string;
  // The order's placement date — distinct from entryDate/returnDate (the return's own dates).
  orderDate?: string;
  statusId: string;
  entryDate: string;
  returnChannelEnumId?: string;
  origin?: ReturnOrigin;
  sync?: Record<SyncTarget, SyncState>;
}

export interface ReturnItemDetail {
  orderItemSeqId: string;
  productId: string;
  productName: string; // "" when the backend doesn't supply one; views fall back to productId
  returnQuantity: number;
  returnReasonId: string;
  returnReasonDesc?: string;
}

export interface ReturnStatus {
  statusId: string;
  statusDate: string;
}

export interface ReturnDetail extends ReturnSummary {
  // The detail endpoint always provides these (narrowing the optionals on ReturnSummary).
  orderId: string;
  origin: ReturnOrigin;
  sync: Record<SyncTarget, SyncState>;
  items: ReturnItemDetail[];
  statuses: ReturnStatus[];
  externalIds: Record<SyncTarget, string | null>;
}

export interface ReturnableLine {
  orderItemSeqId: string;
  productId: string;
  productName: string; // "" when the backend doesn't supply one; views fall back to productId
  orderedQty: number;
  alreadyReturnedQty: number;
  returnableQty: number;
  unitPrice: number;
}

export interface OrderForReturn {
  orderId: string;
  // Customer-facing Shopify order name/number (e.g. "#1001"); "" when absent.
  orderName: string;
  items: ReturnableLine[];
  billingEmail?: string;
}

export interface ReturnReason {
  returnReasonId: string;
  description: string;
}

export interface CreateReturnInput {
  orderId: string;
  items: ReturnItemInput[];
}
