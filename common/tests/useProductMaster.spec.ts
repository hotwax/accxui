import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, shallowRef } from "vue";

const live = vi.hoisted(() => ({ records: null as any, opened: 0, refresh: null as any }));

vi.mock("../db/composables/useLiveEntity", () => ({
  useLiveEntity: () => {
    live.opened += 1;
    return { records: live.records };
  },
}));

vi.mock("../db/sync/setupAppDbSync", () => ({
  getAppDbSync: () => ({ refreshAfterMutation: live.refresh }),
}));

import { useProductMaster } from "../db/composables/useProductMaster";
import { PRODUCT_STALE_MS } from "../db/seed/productDomain";
import { clearSessionScopedState } from "../core/sessionScope";

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const flush = () => Promise.resolve().then(() => Promise.resolve());

/** A component holding the shared live read, so getProduct can see the table's rows. */
function mount() {
  const scope = effectScope();
  const master = scope.run(() => useProductMaster())!;
  return { ...master, unmount: () => scope.stop() };
}

describe("useProductMaster", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-16T10:00:00Z"));
    live.records = shallowRef([{ productId: "P1", productName: "Shirt", syncedAt: Date.now() }]);
    live.opened = 0;
    live.refresh = vi.fn(async () => 1);
    clearSessionScopedState();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("answers from the table and asks only for the missing ids a render touched, in one batch", async () => {
    const { getProduct, unmount } = mount();

    expect(getProduct("P1")?.productName).toBe("Shirt");
    expect(getProduct("P2")).toBeUndefined();
    expect(getProduct("P3")).toBeUndefined();
    getProduct("P2");
    await flush();

    expect(live.refresh).toHaveBeenCalledTimes(1);
    expect(live.refresh).toHaveBeenCalledWith("product", { productIds: ["P2", "P3"] });
    unmount();
  });

  it("never asks for a fresh row", async () => {
    const { getProduct, prefetch, unmount } = mount();

    getProduct("P1");
    await prefetch(["P1"]);
    await flush();

    expect(live.refresh).not.toHaveBeenCalled();
    unmount();
  });

  it("asks for a row as soon as it passes PRODUCT_STALE_MS by its own syncedAt, while the screen is open", async () => {
    // The review's case: a 23-hour-old row is shown, then turns stale an hour later.
    live.records.value = [{ productId: "P1", productName: "Shirt", syncedAt: Date.now() - 23 * HOUR }];
    const { getProduct, unmount } = mount();

    getProduct("P1");
    await flush();
    expect(live.refresh).not.toHaveBeenCalled();

    vi.setSystemTime(Date.now() + HOUR);
    getProduct("P1");
    await flush();
    expect(live.refresh).toHaveBeenCalledWith("product", { productIds: ["P1"] });
    expect(Date.now() - live.records.value[0].syncedAt).toBeGreaterThanOrEqual(PRODUCT_STALE_MS);
    unmount();
  });

  it("asks again for a product Solr had no document for after a short pause, not on every render", async () => {
    const { getProduct, unmount } = mount();

    getProduct("GONE");
    await flush();
    getProduct("GONE");
    await flush();
    expect(live.refresh).toHaveBeenCalledTimes(1);

    vi.setSystemTime(Date.now() + 5 * MINUTE);
    getProduct("GONE");
    await flush();
    expect(live.refresh).toHaveBeenCalledTimes(2);
    unmount();
  });

  it("asks again right after a failed fetch instead of waiting out the pause", async () => {
    live.refresh = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(1);
    const { prefetch } = useProductMaster();

    await prefetch(["P2"]);
    await prefetch(["P2"]);

    expect(live.refresh).toHaveBeenCalledTimes(2);
  });

  it("shares one live read between components and closes it with the last", () => {
    const first = mount();
    const second = mount();
    expect(live.opened).toBe(1);

    first.unmount();
    second.unmount();
    const third = mount();
    expect(live.opened).toBe(2);
    third.unmount();
  });
});
