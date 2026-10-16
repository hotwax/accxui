/**
 * The product master row and the Solr query that fills it: what the `products` seed table holds,
 * shared by its sync domain (`productDomain.ts`) and the `useProductMaster` composable.
 *
 * Imports nothing: the sync workers reach this file, so nothing here may pull in `vue`.
 */

export interface ProductIdentification {
  type: string;
  value: string;
}

/** A row of the `products` table. */
export interface ProductRow {
  productId: string;
  /** The variant's own name. For a sized product this is just the option ("S"), so never the label on its own. */
  productName: string;
  sku: string;
  /** The name a merchandiser recognises. */
  parentProductName: string;
  internalName: string;
  mainImageUrl: string;
  /** Solr `productFeatures` verbatim: `"SIZE/M"`-style entries, empty when the variant has none. */
  productFeatures: string[];
  groupId: string;
  groupName: string;
  primaryProductCategoryName: string;
  title: string;
  goodIdentifications: ProductIdentification[];
  /** When the product domain stored it, in epoch millis. */
  syncedAt?: number;
}

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
