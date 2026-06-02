export type SyncTarget = "shopify";
export type SyncState = "not_synced" | "pending" | "synced" | "failed";
export type ReturnOrigin = "pwa" | "shopify";

/**
 * The backend `shopifySync` object on a return detail. `null` when the return has never touched
 * Shopify (e.g. a fresh RETURN_REQUESTED — there is no push on create).
 */
export interface ShopifySync {
  synced?: boolean | null;          // authoritative: true once the OMS↔Shopify return link exists (stays true even after a Shopify-side cancel)
  shopifyReturnId?: string | null;  // gid://shopify/Return/...
  shopifyRefundId?: string | null;
  returnStatusId?: string | null;   // Shopify-side return status: "OPEN" | "CANCELED" | "CLOSED" (CLOSED is authoritative "completed in Shopify")
  lastSyncedDate?: string | null;
  lastAttemptDate?: string | null;
  pushStatusId?: string | null;     // create-push: PUSH_OK | PUSH_PENDING | PUSH_FAILED | null
  pushErrorMessage?: string | null; // present when pushStatusId == PUSH_FAILED
  closePushStatusId?: string | null;     // completion-push: CLOSE_OK | CLOSE_PENDING | CLOSE_FAILED | null
  closePushErrorMessage?: string | null; // present when closePushStatusId == CLOSE_FAILED
  // Exchange create-push step 2 (returnProcess). PROC_OK is the authoritative "exchange confirmed".
  processStatusId?: string | null;     // PROC_OK | PROC_PENDING | PROC_FAILED | null
  processErrorMessage?: string | null; // present when processStatusId == PROC_FAILED
}

/** Outcome of an outbound push trigger (the "failed" case is surfaced as a thrown error instead). */
export type PushOutcome = "pushed" | "already_synced" | "skipped";

/**
 * Collapsed state of the Shopify completion (returnProcess + returnClose), parallel to SyncState
 * for the create-push. Only meaningful once the return is RETURN_COMPLETED. See resolveShopifyCloseState.
 * - pending   : close push in flight (CLOSE_PENDING, or just triggered)
 * - completed : closed in Shopify (returnStatusId == CLOSED, authoritative — or CLOSE_OK)
 * - failed    : CLOSE_FAILED — surface closePushErrorMessage + a Retry
 * - skipped   : never synced to Shopify (no shopifyReturnId) — completion no-ops; "Completed (not in Shopify)"
 */
export type CompletionState = "pending" | "completed" | "failed" | "skipped";

/** Discriminates a normal customer return from a refund-only appeasement return. */
export type ReturnType = "standard" | "appeasement";

/**
 * Appeasement-specific fields, present on a ReturnSummary/ReturnDetail only when type === "appeasement".
 * The refund mirror itself rides the existing `shopifySync` object (shopifyRefundId) — these are the
 * appeasement's own descriptive fields.
 */
export interface AppeasementFields {
  amount: number;           // refund amount (to the original payment)
  currencyUomId: string;    // order currency
  reasonId: string;         // required reason
  reasonDesc?: string;      // backend-supplied description, if any
  note?: string;            // optional free text
  relatedReturnId?: string; // the standard return created alongside it
}

/** A single lost order line picked for a lost-in-shipment appeasement. */
export interface AppeasementItemInput {
  orderItemSeqId: string;
  quantity: number;
}

/** The optional appeasement block an operator adds on the create-return page. */
export interface AppeasementInput {
  amount?: number;                 // required for the amount-only shape; OPTIONAL override when items present
  currencyUomId: string;
  reasonId: string;
  note?: string;
  items?: AppeasementItemInput[];  // present → lost-in-shipment shape; absent → shipping-refund shape
}

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
  // Shopify order GID / external id (e.g. "gid://shopify/Order/5512…" or the raw numeric id). NOT displayed —
  // indexed only so search can match a Shopify order id. Populated once the backend returns it on list rows.
  orderExternalId?: string;
  // The order's placement date — distinct from entryDate/returnDate (the return's own dates).
  orderDate?: string;
  statusId: string;
  entryDate: string;
  returnChannelEnumId?: string;
  origin?: ReturnOrigin;
  sync?: Record<SyncTarget, SyncState>;
  // Return type discriminator. Optional on a summary (the list endpoint may omit it); the adapter
  // defaults it to "standard". An "appeasement" row renders a type badge.
  type?: ReturnType;
}

export interface ReturnItemDetail {
  orderItemSeqId: string;
  productId: string;
  productName: string; // "" when the backend doesn't supply one; views fall back to sku, then productId
  sku?: string; // Product SKU — the customer/merchant-facing product identifier, preferred over the internal productId. Populated once the backend returns it.
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
  // Collapsed sync state for the chip/colour (derived from shopifySync). See resolveShopifySyncState.
  sync: Record<SyncTarget, SyncState>;
  // Raw Shopify sync object from the backend (null when never pushed). Carries the push error message
  // and Shopify-side returnStatusId the view needs beyond the collapsed `sync` state.
  shopifySync?: ShopifySync | null;
  items: ReturnItemDetail[];
  statuses: ReturnStatus[];
  externalIds: Record<SyncTarget, string | null>;
  // The detail endpoint always classifies the return (narrows the optional on ReturnSummary).
  type: ReturnType;
  // Present only when type === "appeasement".
  appeasement?: AppeasementFields;
}

export interface ReturnableLine {
  orderItemSeqId: string;
  productId: string;
  productName: string; // "" when the backend doesn't supply one; views fall back to sku, then productId
  sku?: string; // Product SKU — preferred customer/merchant-facing identifier over the internal productId. Populated once the backend returns it.
  orderedQty: number;
  alreadyReturnedQty: number;
  returnableQty: number;
  unitPrice: number;
}

export interface OrderForReturn {
  orderId: string;
  // Customer-facing Shopify order name/number (e.g. "#1001"); "" when absent.
  orderName: string;
  // Order currency (e.g. "USD"); needed to label/submit an appeasement refund. Defaults to "USD".
  currencyUomId: string;
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
  // Present only when the operator added an appeasement; co-creates a linked appeasement return.
  appeasement?: AppeasementInput;
}
