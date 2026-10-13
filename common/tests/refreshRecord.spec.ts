import { beforeEach, describe, expect, it, vi } from "vitest";

const harnessStub = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  setDomains: vi.fn(async () => {}),
  syncNow: vi.fn(async () => {}),
  syncAll: vi.fn(async () => {}),
  syncDomainNow: vi.fn(async (_domain: string) => 0),
  refetchOne: vi.fn(async (_request: any) => 1),
  domains: vi.fn(async () => []),
  catalog: vi.fn(async () => []),
  stop: vi.fn(),
}));
const workerStub = vi.hoisted(() => ({ onmessage: null as any }));

vi.mock("../core/workerFactory", () => ({
  WorkerFactory: { createWorker: () => ({ api: harnessStub, terminate: vi.fn(), worker: workerStub }) },
}));
vi.mock("../utils/commonUtil", () => ({
  commonUtil: {
    getToken: () => "tok",
    getMaargURL: () => "https://x.test/",
    getOMSInstanceName: () => "demo",
  },
}));
vi.mock("../db/sync/channels", () => ({
  createTokenPublisher: () => ({ publish: vi.fn(), close: vi.fn() }),
}));

import { setupAppDbSync } from "../db/sync/setupAppDbSync";
import { isCacheReconciliationError } from "../db/sync/reconciliation";
import { createSyncService, __resetErrorState } from "../db/sync/syncService";
import type { AppDb } from "../db/schema/defineAppDb";
import { dbClient } from "../db/storage/dbClient";

const fakeRaw = () => ({
  name: "test-db",
  isOpen: () => true,
  open: async () => {},
  close: () => {},
  getTableNames: () => [],
  table: () => ({ clear: async () => {} }),
  transaction: async (_m: any, _t: any, fn: () => Promise<any>) => fn(),
  syncMeta: {
    get: async () => ({ key: "dbShapeVersion", version: 2 }),
    put: async () => {},
    delete: async () => {},
    toCollection: () => ({ primaryKeys: async () => [] }),
    bulkDelete: async () => {},
  },
});
const fakeAppDb = () => ({ raw: fakeRaw, client: () => dbClient(fakeRaw as any) }) as unknown as AppDb;

describe("refreshRecord", () => {
  beforeEach(() => {
    __resetErrorState();
    workerStub.onmessage = null;
    harnessStub.start.mockReset().mockImplementation(async () => {});
    harnessStub.refetchOne.mockReset().mockImplementation(async () => 1);
  });

  it("runs the domain's refetchOne in the worker and resolves with what it wrote", async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });

    await expect(sync.refreshRecord("widget", { widgetId: "W1" })).resolves.toBe(1);
    expect(harnessStub.refetchOne).toHaveBeenCalledWith({ domain: "widget", pk: { widgetId: "W1" } });
  });

  it("does not wait for the worker's first sync pass", async () => {
    // After login the first pass fetches every seed domain; a lookup must not queue behind it.
    harnessStub.start.mockImplementation(() => new Promise<void>(() => {}));
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });
    void sync.startAppDbSync();

    await expect(sync.refreshRecord("widget", { widgetId: "W1" })).resolves.toBe(1);
  });

  it("starts the sync itself when nothing has started it yet", async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });

    await sync.refreshRecord("widget", { widgetId: "W1" });
    expect(harnessStub.start).toHaveBeenCalledTimes(1);
  });

  it("rethrows the domain's own error, not a reconciliation error", async () => {
    // Nothing was written to the server, so `mutationCommitted: true` would be a lie.
    const failure = new Error("Request failed with status code 500");
    harnessStub.refetchOne.mockRejectedValue(failure);
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });

    const error = await sync.refreshRecord("widget", { widgetId: "W1" }).catch((e) => e);
    expect(error).toBe(failure);
    expect(isCacheReconciliationError(error)).toBe(false);
  });

  it("rejects with the start error when the sync could not start", async () => {
    const failingService = () => ({
      start: async () => { throw new Error("cache open failed"); },
      stop: vi.fn(),
      setDomains: async () => {},
      refetchOne: vi.fn(async () => 1),
      whenOpen: () => new Promise<void>(() => {}),
    }) as any;
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService: failingService });

    await expect(sync.refreshRecord("widget", { widgetId: "W1" })).rejects.toThrow("cache open failed");
  });

  it("falls back to full readiness for a service without whenOpen", async () => {
    const refetchOne = vi.fn(async () => 2);
    const legacyService = () => ({ start: async () => {}, stop: vi.fn(), setDomains: async () => {}, refetchOne }) as any;
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService: legacyService });

    await expect(sync.refreshRecord("widget", { widgetId: "W1" })).resolves.toBe(2);
  });
});
