import { defineStore } from "pinia";
import { logger } from "@common";
import { getReturnsService } from "@/services/ReturnsService";
import { resolveShopifyCloseState } from "@/util/syncState";
import type { CompletionState, CreateExchangeInput, CreateReturnInput, ReturnDetail, ReturnSummary, SyncState, SyncTarget } from "@/types/returns";

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
    async submitExchange(input: CreateExchangeInput): Promise<string> {
      const { returnId } = await getReturnsService().createExchange(input);
      return returnId;
    },
    /** Re-run a failed/stuck exchange push (pushExchangeToShopify), then poll until it settles. */
    async retryExchangePush(returnId: string, opts: { intervalMs?: number; maxAttempts?: number } = {}) {
      await getReturnsService().retryExchangePush(returnId);
      return this.pollSync(returnId, "shopify", opts);
    },
    /**
     * Approve a requested return. Approval triggers the OMS→Shopify push server-side, and that push is
     * ASYNC — so the return still reads `not_synced` the instant we re-fetch, before the server push has
     * claimed its slot (not_synced → pending). The client kick is only a *fallback* for environments where
     * the server-side push SECA never fires (e.g. dev with the post-commit SECA skipped). To keep it a true
     * fallback we give the server push a brief grace window to start: poll a few short cycles and kick the
     * plain `pushToShopify` ONLY if the state is still `not_synced` afterwards. When the SECA does fire the
     * client sees `pending` quickly and never kicks, so the two pushes can't race over the same returnId.
     *
     * Exchanges are excluded entirely: the approve SECA fully owns the *exchange* push (returnCreate WITH the
     * replacement line items, then returnProcess). The plain `pushToShopify` omits the exchange items and
     * would race the automatic exchange push over the same returnable units, producing a phantom "invalid
     * quantity" PUSH_FAILED on an exchange that actually succeeded. For an exchange we only poll; a
     * genuinely-failed exchange is recovered via the type-correct Retry (retryExchangePush).
     *
     * A `failed` state after the grace window is NOT auto-kicked either: a genuine prior failure is better
     * recovered via the explicit Retry button than a silent auto-retry.
     */
    async approveReturn(returnId: string, opts: { intervalMs?: number; maxAttempts?: number; graceMs?: number; graceTries?: number } = {}) {
      await getReturnsService().approveReturn(returnId);

      // Give the async server-side push a beat to claim the slot (not_synced → pending) before deciding
      // whether to kick the client fallback. A few short polls; defaults tunable via opts (0 in tests).
      const graceMs = opts.graceMs ?? 1500;
      const graceTries = opts.graceTries ?? 3;
      let sync: SyncState | undefined;
      for (let i = 0; i < graceTries; i++) {
        await this.fetchReturn(returnId);
        sync = this.current?.sync.shopify;
        if (sync !== "not_synced") break; // server push started (pending) / already synced / failed
        if (i < graceTries - 1) await sleep(graceMs);
      }

      const isAppeasement = this.current?.type === "appeasement";
      const isExchange = this.current?.isExchange === true;
      if (sync !== "synced") {
        // Fallback ONLY when the server push never started (still not_synced after the grace window). Never
        // for an exchange (its push path is different and must not be kicked via pushToShopify), and never
        // for `failed` (use the explicit Retry) — see the doc comment above.
        if (!isExchange && sync === "not_synced") {
          await getReturnsService().pushToTarget(returnId, "shopify");
        }
        sync = await this.pollSync(returnId, "shopify", opts);
      }
      // For an appeasement, approval *is* completion: the refund is the terminal action, so once it has
      // synced, finalize the OMS return to RETURN_COMPLETED. The refund already succeeded, so a failure
      // to finalize must not surface as an approval error.
      if (isAppeasement && sync === "synced") {
        try {
          await this.completeReturn(returnId, opts);
        } catch (e) {
          logger.error("auto-complete of approved appeasement failed", e);
        }
      }
      return sync;
    },
    async rejectReturn(returnId: string) {
      await getReturnsService().rejectReturn(returnId);
      await this.fetchReturn(returnId);
    },
    async cancelReturn(returnId: string, opts: { intervalMs?: number; maxAttempts?: number } = {}) {
      await getReturnsService().cancelReturn(returnId);
      await this.fetchReturn(returnId);
      // A synced Shopify *return* is also cancelled in Shopify asynchronously — poll briefly for
      // returnStatusId. A refund-only appeasement (shopifyRefundId, no shopifyReturnId) has no Shopify
      // return to cancel, so skip the poll — its returnStatusId never arrives.
      if (this.current?.shopifySync?.synced && this.current.shopifySync.shopifyReturnId && this.current.shopifySync.returnStatusId !== "CANCELED") {
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
    /** Fetch the outgoing replacement order for an exchange (the exchange-detail replacement panel). */
    async loadReplacementOrder(orderId: string) {
      return getReturnsService().getReplacementOrder(orderId);
    },
    /** Physical facilities an exchange can be fulfilled from (the Complete picker on the exchange page). */
    async loadFacilities() {
      return getReturnsService().listFacilities();
    },
    /** Shipment methods for the create-page exchange picker (shown for a shipped exchange). */
    async loadShipmentMethods() {
      return getReturnsService().listShipmentMethods();
    },
    /** Countries for the create-page shipping-address dropdown. */
    async loadCountries() {
      return getReturnsService().listCountries();
    },
    /** States/provinces for a chosen country (empty when the country has none). */
    async loadStates(countryGeoId: string) {
      return getReturnsService().listStates(countryGeoId);
    },
    async loadReasons() {
      return getReturnsService().listReturnReasons();
    },
    async loadAppeasementReasons() {
      return getReturnsService().listAppeasementReasons();
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
