import { beforeEach, describe, expect, it, vi } from "vitest";

const workerRemoteApi = vi.hoisted(() => vi.fn());
vi.mock("../core/workerRemoteApi", () => ({
  default: workerRemoteApi,
  pageNewestFirst: async (opts: any) => {
    const res = await workerRemoteApi(opts);
    if (!res) return [];
    let items = Array.isArray(res) ? res : (opts.collectionKey && res[opts.collectionKey] ? res[opts.collectionKey] : [res]);
    if (opts.keep) items = opts.keep(items);
    return items;
  },
}));

import { defineEntity } from "../db/defineEntity";
import { registerCursorDomain } from "../db/sync/defineCursorDomain";
import { clearSyncRegistry } from "../db/sync/syncRegistry";
import type { SyncContext } from "../db/types";

const ctx = {
  token: "t", maargUrl: "https://x.test/rest/s1/", omsInstance: "demo", now: 0,
} as unknown as SyncContext;

const logs = defineEntity({
  primaryKey: "logId",
  fields: { logId: "text", configId: "text", createdDate: "date", logLevel: "text" },
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

  /**
   * `paramsOf` must NOT narrow the record set — it is only for extra params that do not change
   * which rows the endpoint returns (a client tag, a sort hint, ...). Nothing here filters the
   * cached rows the cursor is computed from, so there is nothing to prove about the cursor: this
   * test only proves the value reaches the request.
   */
  it("sends a non-narrowing paramsOf value through to the request", async () => {
    workerRemoteApi.mockResolvedValueOnce(page(1, 1));
    const domain = registerCursorDomain(
      { ...CONFIG, paramsOf: (args: any) => ({ requestedBy: args.requestedBy }) },
      () => stubDb([]),
    );

    await domain.sync(ctx, { configId: "C1", requestedBy: "ui" });

    expect(workerRemoteApi.mock.calls[0][0].params.requestedBy).toBe("ui");
    expect(workerRemoteApi.mock.calls[0][0].params.configId).toBeUndefined();
  });

  /**
   * The bug `narrowOf` exists to prevent: a server-side filter that is not also applied to the
   * cursor computation takes its cursor from the newest row of ANY value of that filter, not the
   * narrowed one. Two rows differing only in `logLevel` — an "INFO" row newer than an "ERROR" row —
   * must yield the ERROR row's (older) date as the cursor when narrowed to `logLevel: "ERROR"`, not
   * the INFO row's newer one; and the request must carry `logLevel` so the server applies the same
   * filter.
   */
  it("narrowOf reaches the request and narrows the cursor computation", async () => {
    workerRemoteApi.mockResolvedValueOnce(page(1, 1));
    const rows = [
      { logId: "E1", configId: "C1", createdDate: 500, logLevel: "ERROR" },
      { logId: "E2", configId: "C1", createdDate: 1000, logLevel: "INFO" },
    ];
    const domain = registerCursorDomain(
      {
        ...CONFIG,
        total: 1, // reached once narrowed to logLevel: "ERROR" (one matching row), so the sync
        // computes a cursor instead of deepening
        narrowOf: (args: any) => ({ logLevel: args.logLevel }),
      },
      () => stubDb(rows),
    );

    await domain.sync(ctx, { configId: "C1", logLevel: "ERROR" });

    const params = workerRemoteApi.mock.calls[0][0].params;
    expect(params.logLevel).toBe("ERROR");
    expect(params.createdDate_from).toBe(new Date(500).toISOString());
  });
});
