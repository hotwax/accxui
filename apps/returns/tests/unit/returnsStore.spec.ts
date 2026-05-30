import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the service so the store has no real network dependency.
const listReturns = vi.fn();
vi.mock("@/services/ReturnsService", () => ({
  getReturnsService: () => ({ listReturns }),
}));

import { useReturnsStore } from "@/store/returnsStore";

describe("returnsStore pagination + query", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listReturns.mockReset();
  });

  it("replaces the list on page 0 and appends on later pages", async () => {
    const store = useReturnsStore();
    listReturns.mockResolvedValueOnce({ items: [{ returnId: "A", statusId: "RETURN_REQUESTED", entryDate: "1" }], total: 2 });
    await store.fetchReturns(0);
    expect(store.returns.map((r) => r.returnId)).toEqual(["A"]);

    listReturns.mockResolvedValueOnce({ items: [{ returnId: "B", statusId: "RETURN_REQUESTED", entryDate: "2" }], total: 2 });
    await store.fetchReturns(1);
    expect(store.returns.map((r) => r.returnId)).toEqual(["A", "B"]);
  });

  it("isScrollable is true while fewer items than total are loaded", async () => {
    const store = useReturnsStore();
    listReturns.mockResolvedValueOnce({ items: [{ returnId: "A", statusId: "RETURN_REQUESTED", entryDate: "1" }], total: 2 });
    await store.fetchReturns(0);
    expect(store.isScrollable).toBe(true);

    listReturns.mockResolvedValueOnce({ items: [{ returnId: "B", statusId: "RETURN_REQUESTED", entryDate: "2" }], total: 2 });
    await store.fetchReturns(1);
    expect(store.isScrollable).toBe(false);
  });

  it("passes the status filter from query to the service", async () => {
    const store = useReturnsStore();
    store.query.statusId = "RETURN_REQUESTED";
    listReturns.mockResolvedValueOnce({ items: [], total: 0 });
    await store.fetchReturns(0);
    expect(listReturns).toHaveBeenCalledWith(expect.objectContaining({ statusId: "RETURN_REQUESTED", pageIndex: 0 }));
  });

  it("getFilteredReturns filters by search term and passes through when empty", async () => {
    const store = useReturnsStore();
    listReturns.mockResolvedValueOnce({ items: [
      { returnId: "ABC-1", orderName: "#1001", statusId: "RETURN_REQUESTED", entryDate: "1" },
      { returnId: "XYZ-2", orderName: "#2002", statusId: "RETURN_REQUESTED", entryDate: "2" },
    ], total: 2 });
    await store.fetchReturns(0);
    store.query.searchTerm = "abc";
    expect(store.getFilteredReturns.map((r) => r.returnId)).toEqual(["ABC-1"]);
    store.query.searchTerm = "#2002";
    expect(store.getFilteredReturns.map((r) => r.returnId)).toEqual(["XYZ-2"]);
    store.query.searchTerm = "";
    expect(store.getFilteredReturns).toHaveLength(2);
  });

  it("getFilteredReturns matches the Shopify order id (orderExternalId)", async () => {
    const store = useReturnsStore();
    listReturns.mockResolvedValueOnce({ items: [
      { returnId: "ABC-1", orderName: "#1001", orderExternalId: "gid://shopify/Order/5512123", statusId: "RETURN_REQUESTED", entryDate: "1" },
      { returnId: "XYZ-2", orderName: "#2002", orderExternalId: "gid://shopify/Order/9999000", statusId: "RETURN_REQUESTED", entryDate: "2" },
    ], total: 2 });
    await store.fetchReturns(0);
    store.query.searchTerm = "5512123"; // numeric Shopify order id, a substring of the GID
    expect(store.getFilteredReturns.map((r) => r.returnId)).toEqual(["ABC-1"]);
  });
});
