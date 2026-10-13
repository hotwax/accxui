import { beforeEach, describe, expect, it, vi } from "vitest";

const harnessStub = vi.hoisted(() => ({
  start: vi.fn(async () => {}),
  setDomains: vi.fn(async () => {}),
  syncNow: vi.fn(async () => {}),
  syncAll: vi.fn(async () => {}),
  syncDomainNow: vi.fn(async (_domain: string) => 3),
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

import { setupAppDbSync, type AppDbSyncConfig } from "../db/sync/setupAppDbSync";
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

/** Records the order the write and the reconciliation happen in. */
let calls: string[];

const start = async (overrides: Partial<AppDbSyncConfig> = {}) => {
  const api = vi.fn(async (request: any) => {
    calls.push(`api:${request.method}`);
    return { status: 200, data: { facilityId: "NEW_1" } };
  });
  const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService, api, ...overrides });
  await sync.startAppDbSync();
  return { sync, api };
};

describe("mutate", () => {
  beforeEach(() => {
    __resetErrorState();
    workerStub.onmessage = null;
    calls = [];
    harnessStub.refetchOne.mockReset().mockImplementation(async ({ domain }: any) => {
      calls.push(`refetch:${domain}`);
      return 1;
    });
    harnessStub.syncDomainNow.mockReset().mockImplementation(async (domain: string) => {
      calls.push(`resync:${domain}`);
      return 3;
    });
  });

  it("passes the request to api unchanged and returns its response", async () => {
    const { sync, api } = await start();
    const request = { url: "oms/facilities/F1", method: "put", data: { facilityName: "X" }, params: { a: 1 } };

    const response = await sync.mutate(request, { refresh: [["facility", { facilityId: "F1" }]] });

    expect(api).toHaveBeenCalledWith(request);
    expect(response).toEqual({ status: 200, data: { facilityId: "NEW_1" } });
  });

  it("refreshes every listed key after the write lands", async () => {
    const { sync } = await start();

    await sync.mutate({ url: "oms/facilities", method: "put" }, {
      refresh: [["facility", { facilityId: "F1" }], ["facility", { facilityId: "F2" }]],
    });

    expect(harnessStub.refetchOne).toHaveBeenCalledWith({ domain: "facility", pk: { facilityId: "F1" } });
    expect(harnessStub.refetchOne).toHaveBeenCalledWith({ domain: "facility", pk: { facilityId: "F2" } });
    expect(calls[0]).toBe("api:put");
  });

  it("resyncs every listed domain after the write lands", async () => {
    const { sync } = await start();

    await sync.mutate({ url: "oms/carriers", method: "delete" }, { resync: ["carrier", "productStoreShipmentCount"] });

    expect(harnessStub.syncDomainNow).toHaveBeenCalledWith("carrier");
    expect(harnessStub.syncDomainNow).toHaveBeenCalledWith("productStoreShipmentCount");
    expect(calls[0]).toBe("api:delete");
  });

  it("runs refreshes and resyncs together when both are given", async () => {
    const { sync } = await start();

    await sync.mutate({ url: "oms/carriers", method: "post" }, {
      refresh: [["carrierShipmentMethod", { partyId: "C1" }]],
      resync: ["productStoreShipmentCount"],
    });

    expect(calls.slice(1).sort()).toEqual(["refetch:carrierShipmentMethod", "resync:productStoreShipmentCount"]);
  });

  it("builds the targets from the response when given a function", async () => {
    const { sync } = await start();

    await sync.mutate({ url: "oms/facilities", method: "post" }, (response) => ({
      refresh: [["facility", { facilityId: response.data.facilityId }]],
    }));

    expect(harnessStub.refetchOne).toHaveBeenCalledWith({ domain: "facility", pk: { facilityId: "NEW_1" } });
  });

  it("refreshes a key and resyncs a domain once each, however often they are listed", async () => {
    const { sync } = await start();

    await sync.mutate({ url: "oms/x", method: "put" }, {
      refresh: [["enum", { enumId: "A", enumTypeId: "T" }], ["enum", { enumTypeId: "T", enumId: "A" }]],
      resync: ["carrier", "carrier"],
    });

    expect(harnessStub.refetchOne).toHaveBeenCalledTimes(1);
    expect(harnessStub.syncDomainNow).toHaveBeenCalledTimes(1);
  });

  it("skips reconciliation when the caller states why none is needed", async () => {
    const { sync } = await start();

    const response = await sync.mutate({ url: "oms/jobs/run", method: "post" }, { none: "fires a one-off job" });

    expect(response.status).toBe(200);
    expect(harnessStub.refetchOne).not.toHaveBeenCalled();
    expect(harnessStub.syncDomainNow).not.toHaveBeenCalled();
  });

  it("rejects an opt-out with no reason before sending anything", async () => {
    const { sync, api } = await start();

    await expect(sync.mutate({ url: "oms/x", method: "post" }, { none: "  " }))
      .rejects.toThrow(/mutate: `none` needs a reason/);
    expect(api).not.toHaveBeenCalled();
  });

  it("rejects targets that name nothing before sending anything", async () => {
    const { sync, api } = await start();

    await expect(sync.mutate({ url: "oms/x", method: "post" }, { refresh: [], resync: [] }))
      .rejects.toThrow(/mutate: nothing to reconcile/);
    expect(api).not.toHaveBeenCalled();
  });

  it("rethrows a failed write and reconciles nothing", async () => {
    const failure = new Error("400");
    const { sync } = await start({ api: vi.fn(async () => { throw failure; }) });

    await expect(sync.mutate({ url: "oms/x", method: "put" }, { resync: ["carrier"] })).rejects.toBe(failure);
    expect(harnessStub.syncDomainNow).not.toHaveBeenCalled();
  });

  it("throws the response and reconciles nothing when isError flags it", async () => {
    const errorResponse = { status: 200, data: { errors: "Facility not found" } };
    const { sync } = await start({
      api: vi.fn(async () => errorResponse),
      isError: (response) => Boolean(response.data?.errors),
    });

    await expect(sync.mutate({ url: "oms/x", method: "put" }, { resync: ["facility"] })).rejects.toBe(errorResponse);
    expect(harnessStub.syncDomainNow).not.toHaveBeenCalled();
  });

  it("reports a failed refresh as committed, after still attempting the others", async () => {
    const { sync } = await start();
    harnessStub.refetchOne.mockImplementation(async ({ domain }: any) => {
      if (domain === "facility") throw new Error("refetch boom");
      return 1;
    });

    const error = await sync.mutate({ url: "oms/x", method: "put" }, {
      refresh: [["facility", { facilityId: "F1" }], ["productStore", { productStoreId: "S1" }]],
      resync: ["carrier"],
    }).catch((e) => e);

    expect(isCacheReconciliationError(error)).toBe(true);
    expect(error.mutationCommitted).toBe(true);
    expect(error.failedDomains).toEqual(["facility"]);
    expect(harnessStub.refetchOne).toHaveBeenCalledTimes(2);
    expect(harnessStub.syncDomainNow).toHaveBeenCalledWith("carrier");
  });

  it("lists every domain that failed to reconcile", async () => {
    const { sync } = await start();
    harnessStub.refetchOne.mockRejectedValue(new Error("refetch boom"));
    harnessStub.syncDomainNow.mockRejectedValue(new Error("resync boom"));

    const error = await sync.mutate({ url: "oms/x", method: "put" }, {
      refresh: [["facility", { facilityId: "F1" }]],
      resync: ["carrier"],
    }).catch((e) => e);

    expect(error.failedDomains).toEqual(["facility", "carrier"]);
  });

  it("treats a target function that names nothing as a committed write that could not reconcile", async () => {
    const { sync, api } = await start();

    const error = await sync.mutate({ url: "oms/x", method: "post" }, () => ({ refresh: [] })).catch((e) => e);

    expect(api).toHaveBeenCalledTimes(1);
    expect(isCacheReconciliationError(error)).toBe(true);
  });

  it("refuses to run when the app configured no api", async () => {
    const sync = setupAppDbSync({ db: fakeAppDb(), createSyncService });

    await expect(sync.mutate({ url: "oms/x", method: "put" }, { resync: ["carrier"] }))
      .rejects.toThrow(/mutate: no `api` was passed to setupAppDbSync/);
  });
});
