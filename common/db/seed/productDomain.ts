/**
 * Product master from Solr (class C): fetched when a screen shows a product, never polled. Fills the
 * `products` seed table, which an app picks like any other (`commonSchema.pick([..., "products"])`).
 *
 * `refreshAfterMutation("product", { productIds })` asks for any number of ids. Only the ones the
 * table lacks, or holds for longer than PRODUCT_STALE_MS, are fetched, so a screen can ask for every
 * product it shows without refetching what is already fresh. `force: true` refetches them all.
 *
 * Worker code: deep imports only, never `vue`.
 */

import { workerPost } from "../../core/workerRemoteApi";
import { getAppDb } from "../schema/appDbRegistry";
import { defineSyncDomain } from "../sync/defineSyncDomain";
// Type only, erased at build: the composable's runtime (vue) never reaches the worker.
import type { ProductIdentification, ProductRow } from "../composables/useProductMaster";

/** A row older than this is refetched the next time a screen shows it. */
export const PRODUCT_STALE_MS = 24 * 60 * 60 * 1000;

/** Product ids per Solr query. */
export const PRODUCT_BATCH_SIZE = 200;

/**
 * Every field a product-identifier setting can point at: the static options plus goodIdentifications,
 * which carries the fetched types (UPC and friends).
 */
export const PRODUCT_FIELDS = "productId productName parentProductName internalName groupId groupName primaryProductCategoryName title goodIdentifications mainImageUrl productFeatures";

function escapeSolrValue(value: string) {
  return String(value).replace(/([\\+\-!(){}[\]^"~*?:]|&&|\|\|)/g, "\\$1");
}

/** Solr's `"TYPE/value"` strings, or objects already shaped, as `{ type, value }`. */
export function parseGoodIdentifications(raw: unknown): ProductIdentification[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((identification: any) => {
    if (typeof identification === "string") {
      const slash = identification.indexOf("/");
      return slash === -1
        ? { type: "", value: identification.trim() }
        : { type: identification.slice(0, slash).trim(), value: identification.slice(slash + 1).trim() };
    }
    return { type: String(identification?.type || "").trim(), value: String(identification?.value || "").trim() };
  });
}

/** A Solr product document as a `products` row. */
export function mapDocToProduct(doc: any): ProductRow {
  const goodIdentifications = parseGoodIdentifications(doc?.goodIdentifications);
  const sku = doc?.sku || goodIdentifications.find((identification) => identification.type === "SKU")?.value || "";
  return {
    productId: doc?.productId,
    productName: doc?.productName || "",
    sku,
    parentProductName: doc?.parentProductName || "",
    internalName: doc?.internalName || "",
    mainImageUrl: doc?.mainImageUrl || "",
    productFeatures: Array.isArray(doc?.productFeatures) ? doc.productFeatures : [],
    groupId: doc?.groupId || "",
    groupName: doc?.groupName || "",
    primaryProductCategoryName: doc?.primaryProductCategoryName || "",
    title: doc?.title || "",
    goodIdentifications,
  };
}

/** The Solr query for these product ids, in the `{ json }` shape `useSolrSearch().runSolrQuery` takes. */
export function buildProductQuery(productIds: string[]) {
  return {
    json: {
      params: {
        rows: productIds.length,
        start: 0,
        "q.op": "AND",
        fl: PRODUCT_FIELDS,
      } as Record<string, any>,
      query: "*:*",
      filter: ["docType:PRODUCT", `productId:(${productIds.map(escapeSolrValue).join(" OR ")})`],
    },
  };
}


/** The ids a refetch asks for: `productIds`, or a single `productId`. */
function requestedIds(pk: Record<string, unknown>): string[] {
  const ids = Array.isArray(pk?.productIds) ? pk.productIds : [pk?.productId];
  return [...new Set(ids.map((id) => String(id ?? "")).filter(Boolean))];
}

export const productDomain = defineSyncDomain({
  name: "product",
  table: "products",
  label: "Products",
  syncClass: "C",
  async sync() { return 0; },
  async refetchOne(ctx, pk) {
    const ids = requestedIds(pk);
    if (!ids.length) return 0;
    // Resolved per call, through the app's composed entity, so an app's extendEntities applies.
    const products = getAppDb().entity<ProductRow>("products");

    let due = ids;
    if (!pk?.force) {
      const now = Date.now();
      const fresh = new Set((await products.getMany(ids))
        .filter((row) => now - Number(row.syncedAt ?? 0) < PRODUCT_STALE_MS)
        .map((row) => row.productId));
      due = ids.filter((id) => !fresh.has(id));
    }

    let written = 0;
    let failure: unknown = null;
    for (let index = 0; index < due.length; index += PRODUCT_BATCH_SIZE) {
      const batch = due.slice(index, index + PRODUCT_BATCH_SIZE);
      try {
        // Maarg's Solr route: the bare Solr JSON in, the Solr answer nested under `response` out.
        const resp = await workerPost(ctx, "admin/search/query", buildProductQuery(batch).json);
        const docs: any[] = resp?.response?.response?.docs ?? resp?.response?.docs ?? [];
        const rows = docs.map(mapDocToProduct).filter((row) => row.productId);
        if (rows.length) written += await products.upsertMany(rows as unknown as Array<Record<string, unknown>>);
      } catch (error) {
        // Keep going: one failed batch must not cost the others their products.
        failure = error;
      }
    }
    if (failure) throw failure;
    return written;
  },
});
