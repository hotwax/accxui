import { beforeEach, describe, expect, it, vi } from "vitest";
import workerRemoteApi, { pageAll } from "../core/workerRemoteApi";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const ok = (body: unknown = {}) => ({ ok: true, status: 200, json: async () => body });
const requestedUrl = () => new URL(String(fetchMock.mock.calls[0][0]));

describe("workerRemoteApi query serialization", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(ok());
  });

  it("expands an array param into repeated keys", async () => {
    await workerRemoteApi({
      baseURL: "https://x.test/rest/s1/",
      url: "oms/systemMessages",
      params: { systemMessageId: ["A", "B"], statusId: "SENT" },
    });

    const query = requestedUrl().searchParams;
    expect(query.getAll("systemMessageId")).toEqual(["A", "B"]);
    expect(query.get("statusId")).toBe("SENT");
  });

  // Moqui reads a comma-joined value as ONE literal id and matches nothing, so the request
  // succeeds with an empty list. That silence is what made this bug survive so long.
  it("never comma-joins an array", async () => {
    await workerRemoteApi({
      baseURL: "https://x.test/rest/s1/",
      url: "oms/systemMessages",
      params: { systemMessageId: ["A", "B"] },
    });

    expect(String(fetchMock.mock.calls[0][0])).not.toContain("%2C");
  });

  it("drops null and undefined rather than sending them as strings", async () => {
    await workerRemoteApi({
      baseURL: "https://x.test/rest/s1/",
      url: "oms/facilities",
      params: { a: null, b: undefined, c: "keep" },
    });

    const query = requestedUrl().searchParams;
    expect(query.has("a")).toBe(false);
    expect(query.has("b")).toBe(false);
    expect(query.get("c")).toBe("keep");
  });

  it("skips null entries inside an array", async () => {
    await workerRemoteApi({
      baseURL: "https://x.test/rest/s1/",
      url: "oms/facilities",
      params: { facilityId: ["A", null, "B"] },
    });

    expect(requestedUrl().searchParams.getAll("facilityId")).toEqual(["A", "B"]);
  });
});

const emptyBody = () => {
  throw new SyntaxError("Unexpected end of JSON input");
};

describe("workerRemoteApi empty body handling", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("resolves null for a successful response with no body", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: emptyBody });

    await expect(
      workerRemoteApi({ baseURL: "https://x.test/rest/s1/", url: "oms/facilityGroups/types" }),
    ).resolves.toBeNull();
  });

  it("still throws for a failed response with no body, carrying the status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 502, json: emptyBody });

    await expect(
      workerRemoteApi({ baseURL: "https://x.test/rest/s1/", url: "oms/facilities" }),
    ).rejects.toThrow(/502/);
  });

  // The existing contract: a failure WITH a parsed body throws that body, because callers
  // classify auth errors by sniffing its message. Do not turn this into an Error.
  it("still throws the parsed body for a failed response that has one", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ errors: "User is not authorized" }),
    });

    await expect(
      workerRemoteApi({ baseURL: "https://x.test/rest/s1/", url: "oms/facilities" }),
    ).rejects.toEqual({ errors: "User is not authorized" });
  });

  it("rethrows a genuine parse error, which is not the same as an empty body", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError("Unexpected token < in JSON at position 0"); },
    });

    await expect(
      workerRemoteApi({ baseURL: "https://x.test/rest/s1/", url: "oms/facilities" }),
    ).rejects.toThrow(/Unexpected token/);
  });
});

/**
 * A snapshot domain replaces the scope it fetched: rows the fetch did not return are pruned. So a
 * TRUNCATED walk is not a smaller result, it is data loss — `requireComplete` makes the walk fail
 * instead of handing back a partial set the caller would treat as authoritative.
 */
describe("pageAll requireComplete", () => {
  const ctx = { token: "t", maargUrl: "https://x.test/rest/s1/", omsInstance: "demo", now: 0 } as any;

  beforeEach(() => {
    fetchMock.mockReset();
  });

  /** Always a full page, so the walk never ends on its own and runs into the page backstop. */
  const endlessPages = (batchSize: number) => {
    let id = 0;
    fetchMock.mockImplementation(async () => ok(
      Array.from({ length: batchSize }, () => ({ id: `ROW_${id++}` })),
    ));
  };

  it("throws when the page backstop cuts the walk short", async () => {
    endlessPages(2);

    await expect(pageAll({
      ctx, url: "sob/x", collectionKey: null, batchSize: 2, maxPages: 3,
      requireComplete: true, keyOf: (r: any) => r.id,
    })).rejects.toThrow(/truncated/i);
  });

  it("returns the partial set without requireComplete, as before", async () => {
    endlessPages(2);

    const rows = await pageAll({
      ctx, url: "sob/x", collectionKey: null, batchSize: 2, maxPages: 3,
      keyOf: (r: any) => r.id,
    });

    expect(rows).toHaveLength(6);
  });

  it("throws when the endpoint ignores pageIndex and repeats a page", async () => {
    // Same two rows forever: the walk cannot advance, so the set is incomplete.
    fetchMock.mockResolvedValue(ok([{ id: "A" }, { id: "B" }]));

    await expect(pageAll({
      ctx, url: "sob/x", collectionKey: null, batchSize: 2, maxPages: 5,
      requireComplete: true, keyOf: (r: any) => r.id,
    })).rejects.toThrow(/pageIndex/i);
  });

  it("does not throw on a walk that finished normally", async () => {
    fetchMock.mockResolvedValue(ok([{ id: "A" }]));

    const rows = await pageAll({
      ctx, url: "sob/x", collectionKey: null, batchSize: 2, maxPages: 5,
      requireComplete: true, keyOf: (r: any) => r.id,
    });

    expect(rows).toHaveLength(1);
  });
});
