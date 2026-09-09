import { beforeEach, describe, expect, it, vi } from "vitest";

const harnessStub = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  setDomains: vi.fn(async () => {}),
  syncNow: vi.fn(async () => {}),
  syncDomainNow: vi.fn(async () => 3),
  refetchOne: vi.fn(async () => 1),
  domains: vi.fn(async () => ["a", "b"]),
  catalog: vi.fn(async () => [{ name: "a", label: "Alpha", syncClass: "B" }]),
  stop: vi.fn(),
}));
const terminate = vi.hoisted(() => vi.fn());
const workerStub = vi.hoisted(() => ({ onmessage: null as any }));

vi.mock("../core/workerFactory", () => ({
  WorkerFactory: { createWorker: () => ({ api: harnessStub, terminate, worker: workerStub }) },
}));
vi.mock("../utils/commonUtil", () => ({
  commonUtil: {
    getToken: () => "tok",
    getMaargURL: () => "https://x.test/",
    getOMSInstanceName: () => "demo",
  },
}));
vi.mock("../db/sync/pollingTokenChannel", () => ({
  createTokenPublisher: () => ({ publish: vi.fn(), close: vi.fn() }),
}));

import { createSyncService } from "../db/sync/syncService";
import { DB_SHAPE_VERSION } from "../db/baseDb";

/**
 * A minimal `BaseDB`-shaped stub: enough of `syncMeta.get`/`put`, `transaction`, `table` and
 * `getTableNames` for `ensureRowShape`/`clearDatabaseTables` (in `common/db/baseDb.ts`) to run
 * against, without a real Dexie instance.
 */
function createDbStub(storedVersion: number | undefined) {
  let version = storedVersion;
  const cleared: string[] = [];
  const putCalls: Array<Record<string, unknown>> = [];
  const tableNames = ["widgets"];

  return {
    name: "test-db",
    getTableNames: () => tableNames,
    table: (tableName: string) => ({
      clear: vi.fn(async () => { cleared.push(tableName); }),
    }),
    transaction: async (_mode: string, _tables: string[], fn: () => Promise<void>) => { await fn(); },
    syncMeta: {
      get: vi.fn(async (key: string) =>
        key === "dbShapeVersion" && version !== undefined ? { key, version } : undefined),
      put: vi.fn(async (record: Record<string, unknown>) => {
        putCalls.push(record);
        if (record.key === "dbShapeVersion") version = record.version as number;
      }),
    },
    cleared,
    putCalls,
  };
}

describe("createSyncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workerStub.onmessage = null;
  });

  it("starts the worker with the current token, url and instance", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });

    await service.start();

    expect(harnessStub.start).toHaveBeenCalledWith(
      expect.objectContaining({ token: "tok", maargUrl: "https://x.test/", omsInstance: "demo" }),
    );
    service.stop();
  });

  // Idempotent: App.vue mounts can race, and a second worker would double every poll.
  it("does not spawn a second worker when start is called twice", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });

    await Promise.all([service.start(), service.start()]);

    expect(harnessStub.start).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it("swaps the activated set without respawning", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();

    await service.setDomains([{ name: "x" }]);

    expect(harnessStub.setDomains).toHaveBeenCalledWith([{ name: "x" }]);
    expect(harnessStub.start).toHaveBeenCalledTimes(1);
    service.stop();
  });

  it("routes an auth-error status to the app's hook", async () => {
    const onAuthError = vi.fn();
    const service = createSyncService({ workerUrl: "/w.js", onAuthError });
    await service.start();

    workerStub.onmessage!({ data: { type: "auth-error", message: "401" } } as MessageEvent);

    expect(onAuthError).toHaveBeenCalledWith("401");
    service.stop();
  });

  it("forwards every status message to the app's listener", async () => {
    const onStatus = vi.fn();
    const service = createSyncService({ workerUrl: "/w.js", onStatus });
    await service.start();

    workerStub.onmessage!({ data: { type: "sync-end", domain: "a", written: 4 } } as MessageEvent);

    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ type: "sync-end", domain: "a" }));
    service.stop();
  });

  it("proxies the catalog from the worker", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();

    await expect(service.catalog()).resolves.toEqual([{ name: "a", label: "Alpha", syncClass: "B" }]);
    service.stop();
  });

  it("terminates the worker on stop, so its timer dies with it", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();

    service.stop();

    expect(terminate).toHaveBeenCalled();
  });

  it("can be restarted after stop", async () => {
    const service = createSyncService({ workerUrl: "/w.js" });
    await service.start();
    service.stop();

    await service.start();

    expect(harnessStub.start).toHaveBeenCalledTimes(2);
    service.stop();
  });

  it("clears the local tables and writes the current marker when the stored row shape is stale", async () => {
    const db = createDbStub(DB_SHAPE_VERSION - 1);
    const service = createSyncService({ workerUrl: "/w.js", db: db as any });

    await service.start();

    expect(db.cleared).toEqual(["widgets"]);
    expect(db.putCalls).toContainEqual(
      expect.objectContaining({ key: "dbShapeVersion", version: DB_SHAPE_VERSION }),
    );
    service.stop();
  });

  it("does not clear the local tables when the stored row shape already matches", async () => {
    const db = createDbStub(DB_SHAPE_VERSION);
    const service = createSyncService({ workerUrl: "/w.js", db: db as any });

    await service.start();

    expect(db.cleared).toEqual([]);
    expect(db.putCalls).toEqual([]);
    service.stop();
  });
});
