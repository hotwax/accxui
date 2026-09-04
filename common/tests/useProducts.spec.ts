import { beforeEach, describe, expect, it, vi } from "vitest";

const runSolrQuery = vi.fn();

vi.mock("../composables/useSolrSearch", () => ({
  useSolrSearch: () => ({ runSolrQuery }),
}));
vi.mock("../core/logger", () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../utils/commonUtil", () => ({
  commonUtil: { hasError: (response: any) => Boolean(response?.data?.error) },
}));

import { useProducts } from "../composables/useProducts";
import { clearSessionScopedState } from "../core/sessionScope";

const solrDoc = (productId: string, overrides: Record<string, unknown> = {}) => ({
  productId,
  productName: "S",
  parentProductName: `Parent ${productId}`,
  internalName: `INT-${productId}`,
  goodIdentifications: [`SKU/SKU-${ productId}`, "UPC/0001"],
  mainImageUrl: "",
  ...overrides,
});

describe("useProducts (shared product master)", () => {
  beforeEach(() => {
    runSolrQuery.mockReset();
    useProducts().reset();
  });

  it("resolves ids into the shared map with the merchandiser-facing fields", async () => {
    runSolrQuery.mockResolvedValueOnce({ data: { response: { docs: [solrDoc("P1"), solrDoc("P2")] } } });

    const { products, resolve } = useProducts();
    await resolve(["P1", "P2", "", "P1"]);

    expect(runSolrQuery).toHaveBeenCalledTimes(1);
    const query = runSolrQuery.mock.calls[0][0];
    expect(query.json.filter).toEqual(["docType:PRODUCT", "productId:(P1 OR P2)"]);
    expect(products.value.get("P1")).toMatchObject({ parentProductName: "Parent P1", sku: "SKU-P1", productName: "S" });
    expect(products.value.get("P1")?.goodIdentifications).toEqual([
      { type: "SKU", value: "SKU-P1" },
      { type: "UPC", value: "0001" },
    ]);
  });

  it("never asks Solr twice for an id already requested", async () => {
    runSolrQuery.mockResolvedValue({ data: { response: { docs: [solrDoc("P1")] } } });
    const { resolve } = useProducts();

    await resolve(["P1"]);
    await resolve(["P1"]);

    expect(runSolrQuery).toHaveBeenCalledTimes(1);
  });

  it("escapes Solr syntax in ids and batches large id lists", async () => {
    runSolrQuery.mockResolvedValue({ data: { response: { docs: [] } } });
    const { resolve } = useProducts();
    const ids = Array.from({ length: 201 }, (_, index) => `ID-${index}`);

    await resolve([...ids, "a:b"]);

    expect(runSolrQuery).toHaveBeenCalledTimes(2);
    const filters = runSolrQuery.mock.calls.map((call) => call[0].json.filter[1]).join(" ");
    expect(filters).toContain("ID\\-0");
    expect(filters).toContain("a\\:b");
  });

  it("leaves rows unresolved on a Solr error and does not throw", async () => {
    runSolrQuery.mockResolvedValueOnce({ data: { error: "boom" } });
    const { products, resolve } = useProducts();

    await expect(resolve(["P9"])).resolves.toBeUndefined();
    expect(products.value.has("P9")).toBe(false);
  });

  it("reset() forgets resolved products so the next session refetches", async () => {
    runSolrQuery.mockResolvedValue({ data: { response: { docs: [solrDoc("P1")] } } });
    const { products, resolve, reset } = useProducts();

    await resolve(["P1"]);
    expect(products.value.size).toBe(1);
    reset();
    expect(products.value.size).toBe(0);
    await resolve(["P1"]);
    expect(runSolrQuery).toHaveBeenCalledTimes(2);
  });
  it("drops a resolution that was in flight when reset() ran, so a logout cannot repopulate the map", async () => {
    let release: (value: unknown) => void = () => {};
    runSolrQuery.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    const { products, resolve, reset } = useProducts();

    const inFlight = resolve(["P1"]);
    reset();
    release({ data: { response: { docs: [solrDoc("P1")] } } });
    await inFlight;

    expect(products.value.size).toBe(0);

    // The next session asks again and gets its own answer.
    runSolrQuery.mockResolvedValueOnce({ data: { response: { docs: [solrDoc("P1", { parentProductName: "Tenant B" })] } } });
    await resolve(["P1"]);
    expect(products.value.get("P1")?.parentProductName).toBe("Tenant B");
    expect(runSolrQuery).toHaveBeenCalledTimes(2);
  });

  it("registers its reset with the common session scope, so logout clears it without app wiring", async () => {
    runSolrQuery.mockResolvedValue({ data: { response: { docs: [solrDoc("P1")] } } });
    const { products, resolve } = useProducts();
    await resolve(["P1"]);
    expect(products.value.size).toBe(1);

    clearSessionScopedState();

    expect(products.value.size).toBe(0);
  });
});
