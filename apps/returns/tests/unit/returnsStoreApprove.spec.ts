import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the service so we control exactly what each re-fetch reports, modelling the async server-side
// push that the stub adapter cannot (it claims the slot synchronously). This lets us exercise the
// grace-poll fallback in approveReturn: kick pushToShopify ONLY when the server push never starts.
const approveReturn = vi.fn();
const getReturn = vi.fn();
const pushToTarget = vi.fn();
const getSyncStatus = vi.fn();
const completeReturn = vi.fn();

vi.mock("@/services/ReturnsService", () => ({
  getReturnsService: () => ({ approveReturn, getReturn, pushToTarget, getSyncStatus, completeReturn }),
}));

import { useReturnsStore } from "@/store/returnsStore";
import type { ReturnDetail, SyncState } from "@/types/returns";

function detail(sync: SyncState, over: Partial<ReturnDetail> = {}): ReturnDetail {
  return {
    returnId: "R1", orderId: "O1", origin: "pwa", statusId: "RETURN_APPROVED",
    entryDate: "1", type: "standard", sync: { shopify: sync },
    items: [], statuses: [], externalIds: { shopify: null }, ...over,
  };
}

describe("approveReturn grace-poll fallback", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    approveReturn.mockReset().mockResolvedValue(undefined);
    getReturn.mockReset();
    pushToTarget.mockReset().mockResolvedValue("pushed");
    getSyncStatus.mockReset().mockResolvedValue({ shopify: "synced" });
    completeReturn.mockReset().mockResolvedValue(undefined);
  });

  it("does NOT kick pushToShopify when the server push reaches pending within the grace window", async () => {
    const store = useReturnsStore();
    // not_synced the instant we re-fetch, then the async server push claims the slot (pending).
    getReturn
      .mockResolvedValueOnce(detail("not_synced"))
      .mockResolvedValueOnce(detail("pending"))
      .mockResolvedValue(detail("synced"));

    await store.approveReturn("R1", { intervalMs: 0, maxAttempts: 5, graceMs: 0 });

    expect(pushToTarget).not.toHaveBeenCalled();
  });

  it("kicks pushToShopify exactly once when the server push never starts (stays not_synced)", async () => {
    const store = useReturnsStore();
    getReturn.mockResolvedValue(detail("not_synced")); // server SECA skipped — never leaves not_synced

    await store.approveReturn("R1", { intervalMs: 0, maxAttempts: 5, graceMs: 0, graceTries: 3 });

    expect(pushToTarget).toHaveBeenCalledTimes(1);
    expect(pushToTarget).toHaveBeenCalledWith("R1", "shopify");
  });

  it("never kicks pushToShopify for an exchange, even while it reads not_synced", async () => {
    const store = useReturnsStore();
    getReturn.mockResolvedValue(detail("not_synced", { isExchange: true }));

    await store.approveReturn("R1", { intervalMs: 0, maxAttempts: 5, graceMs: 0 });

    expect(pushToTarget).not.toHaveBeenCalled();
  });

  it("does NOT auto-kick when the push already failed (recovered via the explicit Retry instead)", async () => {
    const store = useReturnsStore();
    getReturn.mockResolvedValue(detail("failed"));
    getSyncStatus.mockResolvedValue({ shopify: "failed" });

    const sync = await store.approveReturn("R1", { intervalMs: 0, maxAttempts: 5, graceMs: 0 });

    expect(pushToTarget).not.toHaveBeenCalled();
    expect(sync).toBe("failed");
  });

  it("auto-completes an appeasement once it syncs (unchanged), without a redundant kick", async () => {
    const store = useReturnsStore();
    // Appeasement: server refund push lands pending then synced; approval IS completion.
    getReturn
      .mockResolvedValueOnce(detail("pending", { type: "appeasement" }))
      .mockResolvedValue(detail("synced", { type: "appeasement" }));

    await store.approveReturn("R1", { intervalMs: 0, maxAttempts: 5, graceMs: 0 });

    expect(pushToTarget).not.toHaveBeenCalled();
    expect(completeReturn).toHaveBeenCalledWith("R1");
  });
});
