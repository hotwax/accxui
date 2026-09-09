import { beforeEach, describe, expect, it, vi } from "vitest";

const workerRemoteApi = vi.hoisted(() => vi.fn());
vi.mock("../core/workerRemoteApi", () => ({ default: workerRemoteApi }));

import { defineEntity } from "../db/defineEntity";
import { registerSnapshotDomain } from "../db/sync/snapshotDomain";
import { clearSyncRegistry } from "../db/sync/syncRegistry";
import type { SyncContext } from "../db/types";

const ctx = {
  token: "t", maargUrl: "https://x.test/rest/s1/", omsInstance: "demo", now: 0,
} as unknown as SyncContext;

const stubDb = (parents: any[] = []) => ({
  table: () => ({
    count: async () => 0,
    toArray: async () => parents,
    toCollection: () => ({ primaryKeys: async () => [], toArray: async () => parents }),
    where: () => ({ equals: () => ({ toArray: async () => [] }) }),
    bulkPut: async () => {},
    bulkDelete: async () => {},
    delete: async () => {},
  }),
  transaction: async (_m: any, _t: any, fn: () => Promise<any>) => fn(),
  syncMeta: { get: async () => undefined, put: async () => {}, delete: async () => {} },
}) as any;

const carrierFacility = defineEntity({
  primaryKey: "partyId,facilityId",
  fields: { partyId: "text", facilityId: "text" },
});

describe("snapshot domain fetch labels", () => {
  beforeEach(() => {
    clearSyncRegistry();
    workerRemoteApi.mockReset();
  });

  it("labels a plain list failure with the domain name", async () => {
    workerRemoteApi.mockResolvedValueOnce({ partyList: [] });

    const domain = registerSnapshotDomain({
      name: "carrier",
      table: "carriers",
      projection: defineEntity({ primaryKey: "partyId", fields: { partyId: "text" } }),
      listUrl: "oms/shippingGateways/carrierParties",
      collectionKey: null,
      strictCollection: true,
    }, () => stubDb());

    await expect(domain.sync(ctx, undefined, { force: true })).rejects.toThrow(/\bcarrier\b/);
  });

  /**
   * A fan-out issues one request per parent. Reporting only the URL leaves an operator to work
   * out which domain and which parent that was; the label carries both.
   */
  it("labels a fan-out failure with the domain name and the parent id", async () => {
    workerRemoteApi.mockResolvedValueOnce({ carrierFacilityList: [] });

    const domain = registerSnapshotDomain({
      name: "carrierFacility",
      table: "carrierFacilities",
      projection: carrierFacility,
      listUrl: "oms/shippingGateways/carrierParties",
      collectionKey: null,
      strictCollection: true,
      fanOut: {
        parentTable: "carriers",
        parentKeyField: "partyId",
        urlFor: (id) => `oms/shippingGateways/carrierParties/${id}/facilities`,
      },
    }, () => stubDb([{ partyId: "FEDEX" }]));

    await expect(domain.sync(ctx, undefined, { force: true }))
      .rejects.toThrow("carrierFacility:FEDEX");
  });

  it("labels a scoped refetch with the domain name", async () => {
    workerRemoteApi.mockResolvedValueOnce({ unexpected: [] });

    const domain = registerSnapshotDomain({
      name: "systemMessageRemote",
      table: "systemMessageRemotes",
      projection: defineEntity({
        primaryKey: "systemMessageRemoteId",
        fields: { systemMessageRemoteId: "text" },
      }),
      listUrl: "oms/systemMessageRemotes",
      collectionKey: null,
      strictCollection: true,
      refetchScope: (pk) => ({
        params: { systemMessageRemoteId: pk.systemMessageRemoteId },
        scope: { field: "systemMessageRemoteId", value: pk.systemMessageRemoteId },
      }),
    }, () => stubDb());

    await expect(domain.refetchOne!(ctx, { systemMessageRemoteId: "SHOPIFY_1" }))
      .rejects.toThrow("systemMessageRemote");
  });
});

describe("snapshot domain database resolution", () => {
  beforeEach(() => {
    clearSyncRegistry();
    workerRemoteApi.mockReset();
  });

  it("warns when getDb is omitted, because the domain then writes to whichever db registered last", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    registerSnapshotDomain({
      name: "legacy",
      table: "carriers",
      projection: defineEntity({ primaryKey: "partyId", fields: { partyId: "text" } }),
      listUrl: "oms/x",
      collectionKey: null,
    } as any);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("legacy"));
    warn.mockRestore();
  });
});
