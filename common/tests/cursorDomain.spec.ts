import { beforeEach, describe, expect, it, vi } from "vitest";

const workerRemoteApi = vi.hoisted(() => vi.fn());
vi.mock("../core/workerRemoteApi", () => ({ default: workerRemoteApi }));

import { defineEntity } from "../db/defineEntity";
import { registerCursorDomain } from "../db/sync/cursorDomain";
import { clearSyncRegistry } from "../db/sync/syncRegistry";
import type { SyncContext } from "../db/types";

const ctx = {
  token: "t", maargUrl: "https://x.test/rest/s1/", omsInstance: "demo", now: 0,
} as unknown as SyncContext;

const logs = defineEntity({
  primaryKey: "logId",
  fields: { logId: "text", configId: "text", createdDate: "date" },
  indexes: ["configId", "createdDate"],
});

const written: any[] = [];

function stubDb(existing: any[]) {
  const collection = (subset: any[]) => ({
    toArray: async () => subset,
    count: async () => subset.length,
    primaryKeys: async () => subset.map((r) => r.logId),
  });
  return {
    table: () => ({
      ...collection(existing),
      toCollection: () => collection(existing),
      where: (field: string) => ({
        equals: (value: unknown) => collection(existing.filter((r) => r[field] === value)),
      }),
      bulkPut: async (rows: any[]) => { written.push(...rows); },
      bulkDelete: async () => {},
      delete: async () => {},
    }),
    transaction: async (_m: any, _t: any, fn: () => Promise<any>) => fn(),
  } as any;
}

const CONFIG = {
  name: "dataManagerLog",
  label: "Data Manager Logs",
  table: "dataManagerLogs",
  projection: logs,
  intervalMs: 10_000,
  listUrl: "admin/dataManager/details",
  collectionKey: "dataManagerLogs",
  cursorField: "createdDate",
  cursorParam: "createdDate_from",
  total: 100,
  batchSize: 25,
  scopeOf: (args: any) => (args?.configId ? { field: "configId", value: args.configId } : undefined),
};

const page = (from: number, count: number) =>
  ({ dataManagerLogs: Array.from({ length: count }, (_, i) => ({
    logId: `L${from + i}`, configId: "C1", createdDate: from + i,
  })) });

describe("cursor domain", () => {
  beforeEach(() => {
    clearSyncRegistry();
    workerRemoteApi.mockReset();
    written.length = 0;
  });

  it("registers as a class-A domain carrying its label and cadence", () => {
    const domain = registerCursorDomain(CONFIG, () => stubDb([]));

    expect(domain.name).toBe("dataManagerLog");
    expect(domain.label).toBe("Data Manager Logs");
    expect(domain.syncClass).toBe("A");
    expect(domain.intervalMs).toBe(10_000);
  });

  it("sends no lower bound on an empty scope", async () => {
    workerRemoteApi.mockResolvedValueOnce(page(1, 5));
    const domain = registerCursorDomain(CONFIG, () => stubDb([]));

    await domain.sync(ctx, { configId: "C1" });

    expect(workerRemoteApi.mock.calls[0][0].params).not.toHaveProperty("createdDate_from");
  });

  /**
   * The bug this encodes: with a cursor AND stop-on-first-known-row, paging halts at page 0 every
   * tick once anything is cached. `total` would then only ever apply to an EMPTY scope, and raising
   * it later would silently do nothing. Below target, page from zero with no cursor to DEEPEN.
   */
  it("deepens a shallow window instead of topping it up", async () => {
    workerRemoteApi.mockResolvedValue(page(1, 25));
    const shallow = Array.from({ length: 10 }, (_, i) => ({ logId: `E${i}`, configId: "C1", createdDate: i }));
    const domain = registerCursorDomain(CONFIG, () => stubDb(shallow));

    await domain.sync(ctx, { configId: "C1" });

    expect(workerRemoteApi.mock.calls[0][0].params).not.toHaveProperty("createdDate_from");
  });

  it("sends the cursor as a lower bound once the window is at target", async () => {
    workerRemoteApi.mockResolvedValueOnce(page(200, 1));
    const full = Array.from({ length: 100 }, (_, i) => ({ logId: `E${i}`, configId: "C1", createdDate: i + 1 }));
    const domain = registerCursorDomain(CONFIG, () => stubDb(full));

    await domain.sync(ctx, { configId: "C1" });

    expect(workerRemoteApi.mock.calls[0][0].params.createdDate_from)
      .toBe(new Date(100).toISOString());
  });

  /**
   * Moqui's `_from` is INCLUSIVE, so the boundary row comes back on every quiet poll. Dropping it
   * client-side is what makes a quiet tick write nothing at all.
   */
  it("drops the inclusive boundary row so a quiet tick writes nothing", async () => {
    workerRemoteApi.mockResolvedValueOnce({
      dataManagerLogs: [{ logId: "E99", configId: "C1", createdDate: 100 }],
    });
    const full = Array.from({ length: 100 }, (_, i) => ({ logId: `E${i}`, configId: "C1", createdDate: i + 1 }));
    const domain = registerCursorDomain(CONFIG, () => stubDb(full));

    const count = await domain.sync(ctx, { configId: "C1" });

    expect(count).toBe(0);
    expect(written).toHaveLength(0);
  });

  it("upserts projected rows and reports how many it wrote", async () => {
    workerRemoteApi.mockResolvedValueOnce(page(1, 3));
    const domain = registerCursorDomain(CONFIG, () => stubDb([]));

    const count = await domain.sync(ctx, { configId: "C1" });

    expect(count).toBe(3);
    expect(written).toHaveLength(3);
    expect(written[0]).toHaveProperty("syncedAt");
  });

  it("merges caller params into the request", async () => {
    workerRemoteApi.mockResolvedValueOnce(page(1, 1));
    const domain = registerCursorDomain(
      { ...CONFIG, paramsOf: (args: any) => ({ statusId: args.statusId }) },
      () => stubDb([]),
    );

    await domain.sync(ctx, { configId: "C1", statusId: "SUCCESS" });

    expect(workerRemoteApi.mock.calls[0][0].params.statusId).toBe("SUCCESS");
    expect(workerRemoteApi.mock.calls[0][0].params.configId).toBeUndefined();
  });
});
