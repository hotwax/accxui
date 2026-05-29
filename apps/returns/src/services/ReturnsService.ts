import type {
  CreateReturnInput, OrderForReturn, PushOutcome, ReturnDetail, ReturnReason,
  ReturnSummary, SyncState, SyncTarget,
} from "@/types/returns";
import { stubAdapter } from "@/adapters/stubAdapter";
import { omsAdapter } from "@/adapters/omsAdapter";

export interface ReturnsService {
  listReturns(p: { pageIndex?: number; pageSize?: number; statusId?: string }): Promise<{ items: ReturnSummary[]; total: number }>;
  getReturn(returnId: string): Promise<ReturnDetail>;
  createReturn(input: CreateReturnInput): Promise<{ returnId: string }>;
  getOrderForReturn(orderId: string): Promise<OrderForReturn>;
  listReturnReasons(): Promise<ReturnReason[]>;
  pushToTarget(returnId: string, target: SyncTarget): Promise<PushOutcome>;
  getSyncStatus(returnId: string): Promise<Record<SyncTarget, SyncState>>;
}

export function getReturnsService(): ReturnsService {
  const backend = import.meta.env.VITE_RETURNS_BACKEND;
  return backend === "oms" ? omsAdapter : stubAdapter;
}
