import type {
  CreateExchangeInput, CreateReturnInput, Facility, OrderForReturn, PushOutcome, ReplacementOrderDetail,
  ReturnDetail, ReturnReason, ReturnSummary, ShipmentMethod, SyncState, SyncTarget,
} from "@/types/returns";
import { stubAdapter } from "@/adapters/stubAdapter";
import { omsAdapter } from "@/adapters/omsAdapter";

export interface ReturnsService {
  listReturns(p: { pageIndex?: number; pageSize?: number; statusId?: string }): Promise<{ items: ReturnSummary[]; total: number }>;
  getReturn(returnId: string): Promise<ReturnDetail>;
  createReturn(input: CreateReturnInput): Promise<{ returnId: string; appeasementReturnId?: string }>;
  createExchange(input: CreateExchangeInput): Promise<{ returnId: string; replacementOrderId?: string }>;
  retryExchangePush(returnId: string): Promise<void>;
  // Approval lifecycle. approve transitions RETURN_REQUESTED -> RETURN_APPROVED and (server-side)
  // triggers the OMS->Shopify push; reject/cancel are terminal and never sync.
  approveReturn(returnId: string): Promise<void>;
  rejectReturn(returnId: string): Promise<void>;
  cancelReturn(returnId: string): Promise<void>;
  // Complete transitions RETURN_APPROVED/RETURN_RECEIVED -> RETURN_COMPLETED and (server-side) triggers
  // the async Shopify completion (returnProcess + returnClose). retryComplete re-runs a failed close.
  completeReturn(returnId: string): Promise<void>;
  retryComplete(returnId: string): Promise<void>;
  // Shipment methods for the create-page picker (shown for a SHIPPED exchange).
  listShipmentMethods(): Promise<ShipmentMethod[]>;
  // Physical facilities an exchange can be fulfilled from (the Complete picker on the exchange page).
  listFacilities(): Promise<Facility[]>;
  getOrderForReturn(orderId: string): Promise<OrderForReturn>;
  // The outgoing replacement order for an exchange (order-level detail for the exchange-detail panel).
  getReplacementOrder(orderId: string): Promise<ReplacementOrderDetail>;
  listReturnReasons(): Promise<ReturnReason[]>;
  listAppeasementReasons(): Promise<ReturnReason[]>;
  pushToTarget(returnId: string, target: SyncTarget): Promise<PushOutcome>;
  getSyncStatus(returnId: string): Promise<Record<SyncTarget, SyncState>>;
}

export function getReturnsService(): ReturnsService {
  const backend = import.meta.env.VITE_RETURNS_BACKEND;
  return backend === "oms" ? omsAdapter : stubAdapter;
}
