import { describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

/**
 * A reactive query (shop A to shop B) re-subscribes. Until the new query's first emit, the list
 * must be empty and not hydrated, or shop A's rows render under shop B with no skeleton.
 */
const harness = vi.hoisted(() => ({
  emit: {} as Record<string, (rows: any[]) => void>,
  unsubscribed: [] as string[],
}));

vi.mock("../db/schema/appDbRegistry", () => ({ getAppDb: () => ({ raw: () => ({}) }) }));
vi.mock("../db/storage/dbClient", () => ({
  dbClient: () => ({
    entity: () => ({
      live: (options: any) => ({
        subscribe: ({ next }: any) => {
          const shopId = options.scope.value;
          harness.emit[shopId] = next;
          return { unsubscribe: () => harness.unsubscribed.push(shopId) };
        },
      }),
    }),
  }),
}));

import { useDb } from "../db/composables/useDb";

describe("useDb with a reactive query", () => {
  it("re-subscribes on a scope change without showing the old scope's rows", async () => {
    const shopId = ref("A");
    const scope = effectScope();
    const list = scope.run(() => useDb("ledger", () => ({ scope: { field: "shopId", value: shopId.value } })))!;

    harness.emit.A([{ shopId: "A" }]);
    expect(list.records.value).toEqual([{ shopId: "A" }]);
    expect(list.hydrated.value).toBe(true);

    shopId.value = "B";
    await nextTick();
    expect(harness.unsubscribed).toEqual(["A"]);
    expect(list.records.value).toEqual([]);
    expect(list.hydrated.value).toBe(false);

    harness.emit.B([{ shopId: "B" }]);
    expect(list.records.value).toEqual([{ shopId: "B" }]);
    expect(list.hydrated.value).toBe(true);
    scope.stop();
  });
});
