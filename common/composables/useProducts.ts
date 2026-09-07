import { ref } from "vue";
import logger from "../core/logger";
import { onSessionCleared } from "../core/sessionScope";
import { commonUtil } from "../utils/commonUtil";
import { useSolrSearch } from "./useSolrSearch";

/**
 * Shared product master: rich product data from Solr, keyed by HotWax productId, resolved once per
 * session and never refetched.
 *
 * Several ledgers an operator reads carry no product at all (a Shopify inventory adjustment names a
 * remote target and a delta), so a screen showing those rows can only offer an id unless it resolves
 * the product separately. This is that resolver, in one place instead of a copy per app. It keeps the
 * Solr query shape of the per-app `useProductMaster` composables (`docType:PRODUCT`, batched ids, the
 * same field list) but not their durable Dexie DB: the requirement is names for the rows a screen has
 * open, which a Map keyed by productId satisfies.
 *
 * Module state survives an SPA logout, so the composable registers its own `reset()` with the common
 * session scope; `useAuth().logout()` runs it. No consumer has to remember to.
 */

export interface ProductIdentification {
  type: string;
  value: string;
}

export interface ResolvedProduct {
  productId: string;
  /**
   * The variant's own name. For a sized product this is just the option value ("S", "L", "XS"), so it
   * is a qualifier, never the label on its own.
   */
  productName: string;
  /** The name a merchandiser recognises. This is the one to show. */
  parentProductName: string;
  sku: string;
  internalName: string;
  mainImageUrl: string;
  goodIdentifications: ProductIdentification[];
}

const PRODUCT_FIELDS = "productId productName parentProductName internalName goodIdentifications mainImageUrl";
/** Solr takes the whole id list in one filter clause, so this caps the clause rather than the fetch. */
const BATCH_SIZE = 200;

const products = ref(new Map<string, ResolvedProduct>());
/** Ids already requested, so a re-render cannot queue the same product twice. */
const requested = new Set<string>();
/**
 * Bumped by `reset()`. A resolve that was already awaiting Solr when the session was cleared captures
 * the generation first and drops its result if it moved, so a logout mid-request cannot repopulate the
 * map with the previous tenant's products.
 */
let generation = 0;

/** Solr treats these as syntax, so an id containing one has to arrive escaped or the query fails. */
function escapeSolrValue(value: string): string {
  return String(value).replace(/([\\+\-!(){}[\]^"~*?:]|&&|\|\|)/g, "\\$1");
}

/** `goodIdentifications` arrives as "TYPE/value" strings, or already as objects on some catalogs. */
function parseGoodIdentifications(raw: unknown): ProductIdentification[] {
  if(!Array.isArray(raw)) {return [];}

  return raw.map((identification: any) => {
    if(typeof identification === "string") {
      const slash = identification.indexOf("/");

      return slash === -1
        ? { type: "", value: identification.trim() }
        : { type: identification.slice(0, slash).trim(), value: identification.slice(slash + 1).trim() };
    }

    return { type: String(identification?.type || "").trim(), value: String(identification?.value || "").trim() };
  });
}

function mapDocToProduct(doc: any): ResolvedProduct {
  const goodIdentifications = parseGoodIdentifications(doc?.goodIdentifications);

  return {
    productId: String(doc?.productId ?? ""),
    productName: String(doc?.productName || ""),
    parentProductName: String(doc?.parentProductName || ""),
    sku: String(doc?.sku || goodIdentifications.find((identification) => identification.type === "SKU")?.value || ""),
    internalName: String(doc?.internalName || ""),
    mainImageUrl: String(doc?.mainImageUrl || ""),
    goodIdentifications,
  };
}

function buildProductQuery(productIds: string[]) {
  return {
    json: {
      params: { rows: productIds.length, start: 0, "q.op": "AND", fl: PRODUCT_FIELDS },
      query: "*:*",
      filter: ["docType:PRODUCT", `productId:(${productIds.map(escapeSolrValue).join(" OR ")})`],
    },
  };
}

/**
 * Fetch products from Solr in batches. Does not touch the shared map. Failure is not thrown: a screen
 * that cannot reach Solr should still show its rows with the ids it already has.
 */
async function getByIds(productIds: Iterable<string>): Promise<ResolvedProduct[]> {
  const ids = [...new Set([...productIds].map(String).filter(Boolean))];
  const resolved: ResolvedProduct[] = [];
  for(let index = 0; index < ids.length; index += BATCH_SIZE) {
    const batch = ids.slice(index, index + BATCH_SIZE);
    try {
      const response: any = await useSolrSearch().runSolrQuery(buildProductQuery(batch));
      if(commonUtil.hasError(response)) {
        logger.error("Product [Solr] - Query returned an error", response?.data);
        continue;
      }
      for(const doc of response?.data?.response?.docs ?? []) {
        const product = mapDocToProduct(doc);
        if(product.productId) {resolved.push(product);}
      }
    } catch (error) {
      logger.error("Product [Solr] - Query failed", error);
    }
  }

  return resolved;
}

/**
 * Resolve any ids not already known or in flight into the shared map. Safe to call on every render: it
 * filters against `requested` first, so a stable set of rows produces exactly one Solr round trip.
 */
async function resolve(productIds: Iterable<string>): Promise<void> {
  const pending = [...new Set([...productIds].map(String).filter(Boolean))]
    .filter((productId) => !requested.has(productId));
  if(!pending.length) {return;}
  pending.forEach((productId) => requested.add(productId));
  const requestGeneration = generation;

  const fetched = await getByIds(pending);
  if(requestGeneration !== generation || !fetched.length) {return;}
  const next = new Map(products.value);
  for(const product of fetched) {next.set(product.productId, product);}
  products.value = next;
}

/** Forget every resolved product and every in-flight id. Runs on logout via the common session scope. */
function reset(): void {
  generation += 1;
  products.value = new Map();
  requested.clear();
}

onSessionCleared(reset);

export function useProducts() {
  return { products, resolve, getByIds, reset };
}
