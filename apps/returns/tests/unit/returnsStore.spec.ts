import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

vi.stubEnv("VITE_RETURNS_BACKEND", "stub");

import { useReturnsStore } from "@/store/returnsStore";
import { __resetStub } from "@/adapters/stubAdapter";

describe("returnsStore", () => {
  beforeEach(() => { setActivePinia(createPinia()); __resetStub(); });

  it("fetches the returns list", async () => {
    const store = useReturnsStore();
    await store.fetchReturns();
    expect(store.returns.length).toBeGreaterThanOrEqual(1);
    expect(store.total).toBeGreaterThanOrEqual(1);
  });

  it("creates a return and loads it as current", async () => {
    const store = useReturnsStore();
    const returnId = await store.submitReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
    });
    await store.fetchReturn(returnId);
    expect(store.current?.returnId).toBe(returnId);
    expect(store.current?.sync.shopify).toBe("not_synced");
  });

  it("pushes and resolves to synced via polling", async () => {
    const store = useReturnsStore();
    const returnId = await store.submitReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
    });
    await store.fetchReturn(returnId);
    await store.pushAndPoll(returnId, "shopify", { intervalMs: 0, maxAttempts: 5 });
    expect(store.current?.sync.shopify).toBe("synced");
  });
});
