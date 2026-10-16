import { beforeEach, describe, expect, it, vi } from "vitest";
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
import { clearSessionScopedState } from "../core/sessionScope";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("useProductMaster", () => {
  beforeEach(() => {
    live.records = shallowRef([{ productId: "P1", productName: "Shirt" }]);
    live.opened = 0;
    clearSessionScopedState();
  });

  it("answers from the table and asks for every id a render touched in one batch", async () => {
    const refreshAfterMutation = live.refresh = vi.fn(async () => 1);
    const scope = effectScope();
    const { getProduct } = scope.run(() => useProductMaster())!;

    expect(getProduct("P1")?.productName).toBe("Shirt");
    expect(getProduct("P2")).toBeUndefined();
    getProduct("P1");
    await flush();

    expect(refreshAfterMutation).toHaveBeenCalledTimes(1);
    expect(refreshAfterMutation).toHaveBeenCalledWith("product", { productIds: ["P1", "P2"] });
    scope.stop();
  });

  it("does not ask again for an id it asked for recently", async () => {
    const refreshAfterMutation = live.refresh = vi.fn(async () => 1);
    const { prefetch } = useProductMaster();

    await prefetch(["P1"]);
    await prefetch(["P1"]);

    expect(refreshAfterMutation).toHaveBeenCalledTimes(1);
  });

  it("asks again after a failed fetch instead of waiting out the stale window", async () => {
    const refreshAfterMutation = live.refresh = vi.fn().mockRejectedValueOnce(new Error("down")).mockResolvedValue(1);
    const { prefetch } = useProductMaster();

    await prefetch(["P1"]);
    await prefetch(["P1"]);

    expect(refreshAfterMutation).toHaveBeenCalledTimes(2);
  });

  it("shares one live read between components and closes it with the last", () => {
    live.refresh = vi.fn(async () => 1);
    const first = effectScope();
    const second = effectScope();
    first.run(() => useProductMaster());
    second.run(() => useProductMaster());
    expect(live.opened).toBe(1);

    first.stop();
    second.stop();
    const third = effectScope();
    third.run(() => useProductMaster());
    expect(live.opened).toBe(2);
    third.stop();
  });
});
