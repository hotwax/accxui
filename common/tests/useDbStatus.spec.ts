import { describe, expect, it, vi } from "vitest";

vi.mock("dexie", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, liveQuery: () => ({ subscribe: () => ({ unsubscribe: () => {} }) }) };
});

import { useDbStatus } from "../db/useDbStatus";

const stubDb = () => ({
  syncMeta: { toArray: async () => [] },
  table: () => ({ count: async () => 0 }),
}) as any;

const actions = { resyncDomain: vi.fn(async () => {}), resyncAll: vi.fn(async () => {}) };

describe("useDbStatus catalog source", () => {
  it("accepts a static array, unchanged", () => {
    const { domains } = useDbStatus(
      stubDb(),
      [{ name: "a", table: "as", label: "Alpha", syncClass: "B" }],
      actions,
    );

    expect(domains.value).toEqual([]); // not yet emitted; the array is the source, not the rows
  });

  it("accepts an async source and resolves it", async () => {
    const source = vi.fn(async () => [{ name: "a", label: "Alpha", syncClass: "B" as const }]);

    const { catalogLoaded } = useDbStatus(stubDb(), source, actions);
    await vi.waitFor(() => expect(catalogLoaded.value).toBe(true));

    expect(source).toHaveBeenCalledTimes(1);
  });

  /**
   * The worker may not be up when a status view mounts. A rejected catalog must leave the card
   * empty and loaded, not spinning forever.
   */
  it("settles when the async source rejects", async () => {
    const source = vi.fn(async () => { throw new Error("worker not started"); });

    const { catalogLoaded, domains } = useDbStatus(stubDb(), source, actions);
    await vi.waitFor(() => expect(catalogLoaded.value).toBe(true));

    expect(domains.value).toEqual([]);
  });
});
