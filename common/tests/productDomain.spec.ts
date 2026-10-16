import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  posts: [] as any[],
  upserts: [] as any[][],
  stored: [] as any[],
  response: {} as any,
  fail: false,
}));

vi.mock("../core/workerRemoteApi", () => ({
  workerPost: vi.fn(async (_ctx: any, url: string, data: any) => {
    state.posts.push({ url, data });
    if (state.fail) throw new Error("Solr down");
    return state.response;
  }),
}));
vi.mock("../db/schema/appDbRegistry", () => ({
  getAppDb: () => ({
    entity: () => ({
      getMany: vi.fn(async (ids: string[]) => state.stored.filter((row) => ids.includes(row.productId))),
      upsertMany: vi.fn(async (rows: any[]) => { state.upserts.push(rows); return rows.length; }),
    }),
  }),
}));

import { productDomain } from "../db/seed/productDomain";
import { PRODUCT_STALE_MS } from "../db/seed/productMaster";

const ctx = { maargUrl: "https://example.test/rest/s1/", token: "t", omsInstance: "demo", now: Date.now() } as any;
const solr = (docs: any[]) => ({ response: { response: { docs } } });

describe("product domain", () => {
  beforeEach(() => {
    state.posts = [];
    state.upserts = [];
    state.stored = [];
    state.response = solr([]);
    state.fail = false;
  });

  it("queries Maarg Solr for the ids and stores the mapped products", async () => {
    state.response = solr([{ productId: "P1", productName: "Shirt", goodIdentifications: ["SKU/SH-1"] }]);

    expect(await productDomain.refetchOne!(ctx, { productIds: ["P1"] })).toBe(1);
    expect(state.posts[0].url).toBe("admin/search/query");
    expect(state.posts[0].data.filter).toContain("productId:(P1)");
    expect(state.upserts[0][0]).toMatchObject({ productId: "P1", productName: "Shirt", sku: "SH-1" });
  });

  it("skips products stored within PRODUCT_STALE_MS and refetches older ones", async () => {
    state.stored = [
      { productId: "FRESH", syncedAt: Date.now() },
      { productId: "STALE", syncedAt: Date.now() - PRODUCT_STALE_MS - 1 },
    ];

    await productDomain.refetchOne!(ctx, { productIds: ["FRESH", "STALE", "MISSING"] });

    expect(state.posts[0].data.filter).toContain("productId:(STALE OR MISSING)");
  });

  it("asks for nothing when every product is fresh, unless forced", async () => {
    state.stored = [{ productId: "FRESH", syncedAt: Date.now() }];

    expect(await productDomain.refetchOne!(ctx, { productIds: ["FRESH"] })).toBe(0);
    expect(state.posts).toEqual([]);

    await productDomain.refetchOne!(ctx, { productIds: ["FRESH"], force: true });
    expect(state.posts).toHaveLength(1);
  });

  it("throws when Solr fails, so refreshAfterMutation rejects", async () => {
    state.fail = true;

    await expect(productDomain.refetchOne!(ctx, { productIds: ["P1"] })).rejects.toThrow("Solr down");
  });
});
