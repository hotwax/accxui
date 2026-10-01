import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Seed domains a mutation refreshes through `refreshAfterMutation`. A domain with neither `byPk`
 * nor `refetchScope` makes that call a silent no-op: the server write succeeds and the local row
 * stays missing until the next login sync.
 */
const pageAll = vi.hoisted(() => vi.fn());
vi.mock("../core/workerRemoteApi", () => ({ pageAll, workerGet: vi.fn() }));

const writes = vi.hoisted(() => ({ put: [] as any[], scopedTo: [] as any[] }));
vi.mock("../db/schema/appDbRegistry", async () => {
  const { defineEntity } = await import("../db/schema/defineEntity");
  const stubDb = {
    table: () => ({
      count: async () => 0,
      toArray: async () => [],
      toCollection: () => ({ primaryKeys: async () => [] }),
      where: (field: string) => ({
        equals: (value: unknown) => {
          writes.scopedTo.push({ field, value });
          return { toArray: async () => [], primaryKeys: async () => [] };
        },
      }),
      bulkPut: async (rows: any[]) => { writes.put.push(...rows); },
      bulkDelete: async () => {},
      delete: async () => {},
    }),
    transaction: async (_mode: any, _tables: any, fn: () => Promise<any>) => fn(),
    syncMeta: { get: async () => undefined, put: async () => {}, delete: async () => {} },
  };
  return {
    getAppDb: () => ({
      get: () => stubDb,
      entities: { enums: defineEntity({ primaryKey: "enumId", fields: { enumId: "text", enumTypeId: "text", description: "text" } }) },
    }),
  };
});

import { commonDomains } from "../db/seed/seedDomains";
import type { SyncContext } from "../db/types";

const ctx = { token: "t", maargUrl: "https://example.hotwax.io/rest/s1/", omsInstance: "demo", now: 0 } as unknown as SyncContext;

describe("enum seed domain refetch", () => {
  beforeEach(() => {
    pageAll.mockReset();
    writes.put = [];
    writes.scopedTo = [];
  });

  it("refetches the mutated enum's type and writes the new row", async () => {
    pageAll.mockResolvedValueOnce([{ enumId: "SHOPIFY_ID", enumTypeId: "ORDER_IDENTITY", description: "Shopify ID" }]);

    const written = await commonDomains.enum.refetchOne!(ctx, { enumId: "SHOPIFY_ID", enumTypeId: "ORDER_IDENTITY" });

    expect(pageAll.mock.calls[0][0].url).toBe("admin/enums");
    expect(pageAll.mock.calls[0][0].params).toMatchObject({ enumTypeId: "ORDER_IDENTITY" });
    expect(written).toBe(1);
    expect(writes.put.map((row) => row.enumId)).toEqual(["SHOPIFY_ID"]);
  });

  it("does nothing without a type, rather than replacing every enum", async () => {
    await expect(commonDomains.enum.refetchOne!(ctx, { enumId: "SHOPIFY_ID" })).resolves.toBe(0);
    expect(pageAll).not.toHaveBeenCalled();
  });
});
