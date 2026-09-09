import { beforeEach, describe, expect, it, vi } from "vitest";

const workerRemoteApi = vi.hoisted(() => vi.fn());
vi.mock("../core/workerRemoteApi", () => ({ default: workerRemoteApi }));

import { pageAll } from "../db/sync/workerFetch";
import type { SyncContext } from "../db/types";

const ctx = { token: "test-token", maargUrl: "https://example.hotwax.io/rest/s1/", now: 0 } as unknown as SyncContext;
const keyOf = (record: any) => record?.id;
const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: `ID_${from + i}` }));
/** The params handed to the transport. `workerGet` no longer embeds a query string in the URL. */
const paramsOf = (call: number): Record<string, any> => workerRemoteApi.mock.calls[call][0].params ?? {};

describe("pageAll", () => {
  beforeEach(() => {
    workerRemoteApi.mockReset();
  });

  // Regression: an unpaged fetch that omits pageSize inherits Moqui's default of 20 rows, which
  // silently truncated reference snapshots (contactMechPurposeTypes stored 20 of 56 records).
  it("asks for a full page even when it does not page", async () => {
    workerRemoteApi.mockResolvedValueOnce(rows(0, 56));

    const result = await pageAll({ ctx, url: "oms/contactMechPurposeTypes", unpaged: true, keyOf });

    expect(result).toHaveLength(56);
    expect(workerRemoteApi).toHaveBeenCalledTimes(1);
    expect(paramsOf(0).pageSize).toBe(250);
    expect(paramsOf(0).viewSize).toBe(250);
  });

  it("keeps caller params when it does not page", async () => {
    workerRemoteApi.mockResolvedValueOnce(rows(0, 1));

    await pageAll({ ctx, url: "oms/carrierParties", params: { roleTypeId: "CARRIER" }, unpaged: true, batchSize: 500, keyOf });

    expect(paramsOf(0).roleTypeId).toBe("CARRIER");
    expect(paramsOf(0).pageSize).toBe(500);
  });

  it("pages until a short page comes back", async () => {
    workerRemoteApi
      .mockResolvedValueOnce(rows(0, 250))
      .mockResolvedValueOnce(rows(250, 127));

    const result = await pageAll({ ctx, url: "admin/statusFlows/transitions", keyOf });

    expect(result).toHaveLength(377);
    expect(workerRemoteApi).toHaveBeenCalledTimes(2);
    expect(paramsOf(0).pageIndex).toBe(0);
    expect(paramsOf(1).pageIndex).toBe(1);
  });

  it("stops when a page repeats keys it has already seen", async () => {
    workerRemoteApi.mockResolvedValue(rows(0, 250));

    const result = await pageAll({ ctx, url: "oms/roleTypes", keyOf });

    expect(result).toHaveLength(250);
    expect(workerRemoteApi).toHaveBeenCalledTimes(2);
  });
});

/**
 * `strictCollection` is the guard for mutation-sensitive snapshots.
 *
 * A snapshot treats an empty collection as authoritative and prunes the whole scope, so an
 * unexpected success envelope must not be allowed to become `[]`. Without the guard
 * `unwrapCollection` degrades every unrecognized shape to an empty array, and the caller cannot
 * tell "the server returned nothing" from "the server returned something I did not understand".
 */
describe("pageAll strictCollection", () => {
  beforeEach(() => {
    workerRemoteApi.mockReset();
  });

  it("rejects a paged response that has no array at the configured key", async () => {
    workerRemoteApi.mockResolvedValueOnce({ ok: true });

    await expect(
      pageAll({ ctx, url: "admin/serviceJobs", collectionKey: "serviceJobList", strictCollection: true, keyOf }),
    ).rejects.toThrow(/serviceJobList/);
  });

  it("rejects a paged response that is not the bare array it declared", async () => {
    workerRemoteApi.mockResolvedValueOnce({ unexpectedEnvelope: rows(0, 3) });

    await expect(
      pageAll({ ctx, url: "oms/shippingGateways/carrierParties", collectionKey: null, strictCollection: true, keyOf }),
    ).rejects.toThrow(/bare array/);
  });

  it("rejects an unpaged response of the wrong shape too", async () => {
    workerRemoteApi.mockResolvedValueOnce({ ok: true });

    await expect(
      pageAll({ ctx, url: "oms/returnTypes", collectionKey: null, strictCollection: true, unpaged: true, keyOf }),
    ).rejects.toThrow(/bare array/);
  });

  it("accepts the shape it declared", async () => {
    workerRemoteApi.mockResolvedValueOnce({ serviceJobList: rows(0, 4) });

    const result = await pageAll({
      ctx, url: "admin/serviceJobs", collectionKey: "serviceJobList", strictCollection: true, keyOf,
    });

    expect(result).toHaveLength(4);
  });

  // The guard is opt-in: every domain that has not asked for it keeps the lenient unwrap.
  it("leaves the default lenient when it is not asked for", async () => {
    workerRemoteApi.mockResolvedValueOnce({ ok: true });

    await expect(
      pageAll({ ctx, url: "admin/serviceJobs", collectionKey: "serviceJobList", keyOf }),
    ).resolves.toEqual([]);
  });
});
