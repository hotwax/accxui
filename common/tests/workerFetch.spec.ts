import { beforeEach, describe, expect, it, vi } from "vitest";

const workerRemoteApi = vi.hoisted(() => vi.fn());
vi.mock("../core/workerRemoteApi", () => ({ default: workerRemoteApi }));

import { pageAll } from "../cache/sync/workerFetch";
import type { SyncContext } from "../cache/types";

const ctx = { token: "test-token", maargUrl: "https://example.hotwax.io/rest/s1/", now: 0 } as unknown as SyncContext;
const keyOf = (record: any) => record?.id;
const rows = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ id: `ID_${from + i}` }));
const queryOf = (call: number) => new URLSearchParams(workerRemoteApi.mock.calls[call][0].url.split("?")[1] ?? "");

describe("pageAll", () => {
  beforeEach(() => {
    workerRemoteApi.mockReset();
  });

  // Regression: an unpaged fetch that omits pageSize inherits Moqui's default of 20 rows, which
  // silently truncated reference snapshots (contactMechPurposeTypes cached 20 of 56 records).
  it("asks for a full page even when it does not page", async () => {
    workerRemoteApi.mockResolvedValueOnce(rows(0, 56));

    const result = await pageAll({ ctx, url: "oms/contactMechPurposeTypes", unpaged: true, keyOf });

    expect(result).toHaveLength(56);
    expect(workerRemoteApi).toHaveBeenCalledTimes(1);
    expect(queryOf(0).get("pageSize")).toBe("250");
    expect(queryOf(0).get("viewSize")).toBe("250");
  });

  it("keeps caller params when it does not page", async () => {
    workerRemoteApi.mockResolvedValueOnce(rows(0, 1));

    await pageAll({ ctx, url: "oms/carrierParties", params: { roleTypeId: "CARRIER" }, unpaged: true, batchSize: 500, keyOf });

    const query = queryOf(0);
    expect(query.get("roleTypeId")).toBe("CARRIER");
    expect(query.get("pageSize")).toBe("500");
  });

  it("pages until a short page comes back", async () => {
    workerRemoteApi
      .mockResolvedValueOnce(rows(0, 250))
      .mockResolvedValueOnce(rows(250, 127));

    const result = await pageAll({ ctx, url: "admin/statusFlows/transitions", keyOf });

    expect(result).toHaveLength(377);
    expect(workerRemoteApi).toHaveBeenCalledTimes(2);
    expect(queryOf(0).get("pageIndex")).toBe("0");
    expect(queryOf(1).get("pageIndex")).toBe("1");
  });

  it("stops when a page repeats keys it has already seen", async () => {
    workerRemoteApi.mockResolvedValue(rows(0, 250));

    const result = await pageAll({ ctx, url: "oms/roleTypes", keyOf });

    expect(result).toHaveLength(250);
    expect(workerRemoteApi).toHaveBeenCalledTimes(2);
  });
});
