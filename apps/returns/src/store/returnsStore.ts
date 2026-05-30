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
    query: { searchTerm: "", statusId: "" },
  }),
  getters: {
    // More loaded pages are available while we hold fewer rows than the server reports.
    isScrollable: (state) => state.returns.length < state.total,
    // Client-side free-text filter (the list endpoint has no search param): match id/order fields.
    getFilteredReturns: (state) => {
      const term = state.query.searchTerm.trim().toLowerCase();
      if (!term) return state.returns;
      return state.returns.filter((r) =>
        [r.returnId, r.orderName, r.orderId].some((v) => v?.toLowerCase().includes(term)),
      );
    },
  },
  actions: {
    async fetchReturns(pageIndex = 0, pageSize = 20) {
      this.loading = true;
      try {
        const statusId = this.query.statusId || undefined;
        const { items, total } = await getReturnsService().listReturns({ pageIndex, pageSize, statusId });
        // Page 0 = fresh load (replace); later pages = infinite scroll (append).
        this.returns = pageIndex === 0 ? items : [...this.returns, ...items];
        this.total = total;
      } catch (e) {
        logger.error("fetchReturns failed", e);
        throw e;
      } finally {
        this.loading = false;
      }
    },
    async updateAppliedFilters(value: string, filterName: "searchTerm" | "statusId") {
      this.query[filterName] = value;
      await this.fetchReturns(0);
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
    /** Poll sync status until synced/failed or attempts exhausted (no push triggered). */
    async pollSync(returnId: string, target: SyncTarget, opts: { intervalMs?: number; maxAttempts?: number } = {}) {
      const intervalMs = opts.intervalMs ?? 3000;
      const maxAttempts = opts.maxAttempts ?? 30;
      const svc = getReturnsService();
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
    /** Manually trigger an outbound push (retry), then poll until it settles. */
    async pushAndPoll(returnId: string, target: SyncTarget, opts: { intervalMs?: number; maxAttempts?: number } = {}) {
      const outcome = await getReturnsService().pushToTarget(returnId, target);
      if (outcome === "skipped") {
        // Backend won't change sync state (e.g. non-Shopify order); refresh once, don't poll for 90s.
        if (this.current && this.current.returnId === returnId) await this.fetchReturn(returnId);
        return (this.current?.sync[target] ?? "not_synced") as SyncState;
      }
      return this.pollSync(returnId, target, opts);
    },
  },
});
