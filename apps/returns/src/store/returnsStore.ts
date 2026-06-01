import { defineStore } from "pinia";
import { logger } from "@common";
import { getReturnsService } from "@/services/ReturnsService";
import { resolveShopifyCloseState } from "@/util/syncState";
import type { CompletionState, CreateReturnInput, ReturnDetail, ReturnSummary, SyncState, SyncTarget } from "@/types/returns";

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
    // Client-side free-text filter (the list endpoint has no search param): match id/order fields,
    // including the Shopify order id (orderExternalId) so a Shopify order id/GID finds its return.
    getFilteredReturns: (state) => {
      const term = state.query.searchTerm.trim().toLowerCase();
      if (!term) return state.returns;
      return state.returns.filter((r) =>
        [r.returnId, r.orderName, r.orderId, r.orderExternalId].some((v) => v?.toLowerCase().includes(term)),
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
    /**
     * Approve a requested return. Approval is meant to trigger the OMS→Shopify push server-side, but that
     * push can wedge, so if it didn't fire we kick it from the client — approval always drives the sync,
     * with no separate manual step — then poll the in-flight push to completion.
     */
    async approveReturn(returnId: string, opts: { intervalMs?: number; maxAttempts?: number } = {}) {
      await getReturnsService().approveReturn(returnId);
      await this.fetchReturn(returnId);
      const sync = this.current?.sync.shopify;
      if (sync === "synced") return;
      // Not pending means the backend didn't start a push (still not_synced, or a prior attempt failed) → kick it.
      if (sync === "not_synced" || sync === "failed") {
        await getReturnsService().pushToTarget(returnId, "shopify");
      }
      return this.pollSync(returnId, "shopify", opts);
    },
    async rejectReturn(returnId: string) {
      await getReturnsService().rejectReturn(returnId);
      await this.fetchReturn(returnId);
    },
    async cancelReturn(returnId: string, opts: { intervalMs?: number; maxAttempts?: number } = {}) {
      await getReturnsService().cancelReturn(returnId);
      await this.fetchReturn(returnId);
      // A synced return is also cancelled in Shopify asynchronously — poll briefly for returnStatusId.
      if (this.current?.shopifySync?.synced && this.current.shopifySync.returnStatusId !== "CANCELED") {
        const intervalMs = opts.intervalMs ?? 3000;
        const maxAttempts = opts.maxAttempts ?? 5;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await sleep(intervalMs);
          await this.fetchReturn(returnId);
          if (this.current?.shopifySync?.returnStatusId === "CANCELED") break;
        }
      }
    },
    /**
     * Complete an approved/received return. The OMS transition is immediate; the Shopify completion
     * (close) runs async, so poll it to completion just like approve polls the create-push.
     */
    async completeReturn(returnId: string, opts: { intervalMs?: number; maxAttempts?: number } = {}) {
      await getReturnsService().completeReturn(returnId);
      return this.pollCompletion(returnId, opts);
    },
    /** Re-run a failed Shopify completion (CLOSE_FAILED), then poll until it settles. */
    async retryComplete(returnId: string, opts: { intervalMs?: number; maxAttempts?: number } = {}) {
      await getReturnsService().retryComplete(returnId);
      return this.pollCompletion(returnId, opts);
    },
    /** Re-fetch the return until the Shopify close settles (completed/failed/skipped) or attempts run out. */
    async pollCompletion(returnId: string, opts: { intervalMs?: number; maxAttempts?: number } = {}): Promise<CompletionState> {
      const intervalMs = opts.intervalMs ?? 3000;
      const maxAttempts = opts.maxAttempts ?? 30;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await this.fetchReturn(returnId);
        const state = resolveShopifyCloseState(this.current?.shopifySync);
        if (state !== "pending") return state; // completed | failed | skipped
        await sleep(intervalMs);
      }
      return "pending";
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
