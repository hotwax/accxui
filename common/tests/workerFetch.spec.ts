import { beforeEach, describe, expect, it, vi } from "vitest";

const workerRemoteApi = vi.hoisted(() => vi.fn());
vi.mock("../core/workerRemoteApi", () => ({ default: workerRemoteApi }));

import { pageAll, pageNewestFirst } from "../db/sync/workerFetch";
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
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    workerRemoteApi.mockResolvedValue(rows(0, 250));

    const result = await pageAll({ ctx, url: "oms/roleTypes", keyOf });

    expect(result).toHaveLength(250);
    expect(workerRemoteApi).toHaveBeenCalledTimes(2);
    warn.mockRestore();
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

describe("pageAll diagnostics", () => {
  beforeEach(() => {
    workerRemoteApi.mockReset();
  });

  it("names the domain, not just the URL, when a strict collection is wrong", async () => {
    workerRemoteApi.mockResolvedValueOnce({ partyList: [] });

    await expect(
      pageAll({
        ctx,
        url: "oms/shippingGateways/carrierParties/FEDEX/facilities",
        collectionKey: null,
        strictCollection: true,
        label: "carrierFacility:FEDEX",
        keyOf,
      }),
    ).rejects.toThrow("carrierFacility:FEDEX");
  });

  it("falls back to the URL when no label is given", async () => {
    workerRemoteApi.mockResolvedValueOnce({ nope: [] });

    await expect(
      pageAll({ ctx, url: "oms/returnTypes", collectionKey: null, strictCollection: true, keyOf }),
    ).rejects.toThrow("oms/returnTypes");
  });

  // An endpoint that ignores pageIndex returns page 0 forever. Stopping is right; stopping
  // SILENTLY is not — a half-filled table then looks like a complete one.
  it("warns when an endpoint ignores pageIndex", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    workerRemoteApi.mockResolvedValue(rows(0, 250));

    await pageAll({ ctx, url: "oms/roleTypes", label: "roleType", keyOf });

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("roleType"));
    warn.mockRestore();
  });
});

describe("pageNewestFirst", () => {
  beforeEach(() => {
    workerRemoteApi.mockReset();
  });

  it("stops once it has collected the requested total", async () => {
    workerRemoteApi.mockResolvedValue(rows(0, 25));

    const result = await pageNewestFirst({
      ctx, url: "admin/dataManager/details", params: {}, total: 25, batchSize: 25,
    });

    expect(result).toHaveLength(25);
    expect(workerRemoteApi).toHaveBeenCalledTimes(1);
  });

  it("stops on a short page", async () => {
    workerRemoteApi.mockResolvedValueOnce(rows(0, 10));

    const result = await pageNewestFirst({
      ctx, url: "admin/dataManager/details", params: {}, total: 100, batchSize: 25,
    });

    expect(result).toHaveLength(10);
  });

  // `keep` narrowing a page means we have crossed into records already held — stop, don't page on.
  it("stops when keep() drops part of a page", async () => {
    workerRemoteApi
      .mockResolvedValueOnce(rows(0, 25))
      .mockResolvedValueOnce(rows(25, 25));

    const result = await pageNewestFirst({
      ctx, url: "admin/dataManager/details", params: {}, total: 100, batchSize: 25,
      keep: (page) => page.slice(0, 5),
    });

    expect(result).toHaveLength(5);
    expect(workerRemoteApi).toHaveBeenCalledTimes(1);
  });

  it("never returns more than the requested total", async () => {
    workerRemoteApi.mockResolvedValue(rows(0, 25));

    const result = await pageNewestFirst({
      ctx, url: "x", params: {}, total: 10, batchSize: 25,
    });

    expect(result).toHaveLength(10);
  });
});
