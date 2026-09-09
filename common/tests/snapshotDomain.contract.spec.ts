import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The `SyncDomain` call contract, pinned.
 *
 * `sync` and `refetchOne` are invoked by a worker harness that only ever sees the registry's
 * `SyncDomain` shape — it cannot tell a factory-built domain from a hand-written one. So the
 * argument order has to be identical for both, and it has to be `(ctx, …)` like every other
 * method on the domain: a harness holds ONE context and passes it to whichever domain is due.
 *
 * Getting this wrong is silent. A domain called as `refetchOne(ctx, pk)` while it expects
 * `(pk, ctx)` reads its key fields off the context object — every member is `undefined` — and
 * issues the request with the primary key where the token should be. The HTTP write that
 * triggered the refetch has already succeeded at that point, so the UI reports success while
 * the row it just changed is never refreshed.
 */
const workerRemoteApi = vi.hoisted(() => vi.fn());
vi.mock("../core/workerRemoteApi", () => ({ default: workerRemoteApi }));

import { defineEntity } from "../db/defineEntity";
import { registerSnapshotDomain } from "../db/sync/snapshotDomain";
import { clearSyncRegistry } from "../db/sync/syncRegistry";
import type { SyncContext } from "../db/types";

const serviceJob = defineEntity({
  primaryKey: "jobName",
  fields: { jobName: "text", description: "text" },
});

const ctx = {
  token: "test-token",
  maargUrl: "https://example.hotwax.io/rest/s1/",
  omsInstance: "demo",
  now: 0,
} as unknown as SyncContext;

/** A Dexie stand-in that records nothing — this spec is about the CALL, not the write. */
const stubDb = () => ({
  table: () => ({
    count: async () => 0,
    toArray: async () => [],
    toCollection: () => ({ primaryKeys: async () => [] }),
    where: () => ({ equals: () => ({ toArray: async () => [] }) }),
    bulkPut: async () => {},
    bulkDelete: async () => {},
    delete: async () => {},
  }),
  transaction: async (_mode: any, _tables: any, fn: () => Promise<any>) => fn(),
  syncMeta: { get: async () => undefined, put: async () => {}, delete: async () => {} },
}) as any;

const urlOf = (call: number) => String(workerRemoteApi.mock.calls[call][0].url);
const authOf = (call: number) => String(workerRemoteApi.mock.calls[call][0].headers?.Authorization ?? "");
const paramsOf = (call: number): Record<string, any> => workerRemoteApi.mock.calls[call][0].params ?? {};

describe("snapshot domain call contract", () => {
  beforeEach(() => {
    clearSyncRegistry();
    workerRemoteApi.mockReset();
  });

  it("takes the context first and the primary key second on refetchOne", async () => {
    workerRemoteApi.mockResolvedValueOnce({ jobName: "queue_ShopifyOrderSync", description: "x" });

    const domain = registerSnapshotDomain(
      {
        name: "serviceJob",
        table: "serviceJobs",
        projection: serviceJob,
        listUrl: "admin/serviceJobs",
        collectionKey: "serviceJobList",
        byPk: (pk) => ({ url: `admin/serviceJobs/${encodeURIComponent(String(pk.jobName))}` }),
      },
      () => stubDb(),
    );

    await domain.refetchOne!(ctx, { jobName: "queue_ShopifyOrderSync" });

    // The key reached `byPk`, so the URL names the job rather than `undefined`.
    expect(urlOf(0)).toContain("admin/serviceJobs/queue_ShopifyOrderSync");
    // ...and the context reached the fetch layer, so the request is authenticated.
    expect(authOf(0)).toBe("Bearer test-token");
  });

  it("keeps the same order on the scoped-refetch path", async () => {
    workerRemoteApi.mockResolvedValueOnce([]);

    const domain = registerSnapshotDomain(
      {
        name: "systemMessageRemote",
        table: "systemMessageRemotes",
        projection: defineEntity({
          primaryKey: "systemMessageRemoteId",
          fields: { systemMessageRemoteId: "text" },
        }),
        listUrl: "oms/systemMessageRemotes",
        collectionKey: null,
        refetchScope: (pk) => ({
          params: { systemMessageRemoteId: pk.systemMessageRemoteId },
          scope: { field: "systemMessageRemoteId", value: pk.systemMessageRemoteId },
        }),
      },
      () => stubDb(),
    );

    await domain.refetchOne!(ctx, { systemMessageRemoteId: "SHOPIFY_1" });

    expect(paramsOf(0).systemMessageRemoteId).toBe("SHOPIFY_1");
    expect(authOf(0)).toBe("Bearer test-token");
  });

  it("returns the number of rows written, so a harness can report it", async () => {
    workerRemoteApi.mockResolvedValueOnce({ jobName: "queue_ShopifyOrderSync", description: "x" });

    const domain = registerSnapshotDomain(
      {
        name: "serviceJob",
        table: "serviceJobs",
        projection: serviceJob,
        listUrl: "admin/serviceJobs",
        collectionKey: "serviceJobList",
        byPk: (pk) => ({ url: `admin/serviceJobs/${encodeURIComponent(String(pk.jobName))}` }),
      },
      () => stubDb(),
    );

    await expect(domain.refetchOne!(ctx, { jobName: "queue_ShopifyOrderSync" })).resolves.toBe(1);
  });
});
