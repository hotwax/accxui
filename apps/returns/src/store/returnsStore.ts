import { defineStore } from "pinia";
import { logger } from "@common";
import { getReturnsService } from "@/services/ReturnsService";
import type { CreateReturnInput, ReturnDetail, ReturnSummary, SyncState, SyncTarget } from "@/types/returns";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const useReturnsStore = defineStore("returns", {
  state: () => ({
    returns: [] as ReturnSummary[],
    total: 0,
    current: null as ReturnDetail | null,
    loading: false,
  }),
  actions: {
    async fetchReturns(pageIndex = 0, pageSize = 20) {
      this.loading = true;
      try {
        const { items, total } = await getReturnsService().listReturns({ pageIndex, pageSize });
        this.returns = items;
        this.total = total;
      } catch (e) {
        logger.error("fetchReturns failed", e);
        throw e;
      } finally {
        this.loading = false;
      }
    },
    async fetchReturn(returnId: string) {
      this.current = await getReturnsService().getReturn(returnId);
    },
    async submitReturn(input: CreateReturnInput): Promise<string> {
      const { returnId } = await getReturnsService().createReturn(input);
      return returnId;
    },
    async loadOrder(orderId: string) {
      return getReturnsService().getOrderForReturn(orderId);
    },
    async loadReasons() {
      return getReturnsService().listReturnReasons();
    },
    /** Trigger an outbound push, then poll sync status until synced/failed or attempts exhausted. */
    async pushAndPoll(returnId: string, target: SyncTarget, opts: { intervalMs?: number; maxAttempts?: number } = {}) {
      const intervalMs = opts.intervalMs ?? 3000;
      const maxAttempts = opts.maxAttempts ?? 30;
      const svc = getReturnsService();
      await svc.pushToTarget(returnId, target);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const sync = await svc.getSyncStatus(returnId);
        if (this.current && this.current.returnId === returnId) {
          this.current = { ...this.current, sync };
        }
        const state: SyncState = sync[target];
        if (state === "synced" || state === "failed") {
          // Refresh the full return so externalIds (the Shopify return ID) and statuses surface.
          if (this.current && this.current.returnId === returnId) await this.fetchReturn(returnId);
          return state;
        }
        await sleep(intervalMs);
      }
      return "pending" as SyncState;
    },
  },
});
