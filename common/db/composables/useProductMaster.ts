/**
 * `useProductMaster` — product details (name, SKU, image, identifiers) for rows that carry only a
 * productId, from the app db's `products` seed table, for an app that picked it.
 *
 * `getProduct(id)` is safe to call from a template on every render: it answers from the table and
 * queues the id when its row is missing or older than PRODUCT_STALE_MS (by the row's `syncedAt`), and
 * the queued ids go to the worker's `product` domain in one batch. The live read shows them once
 * stored. An app without an app db uses `useProducts` instead (a session Map, no table).
 *
 * It asks through the app's `refreshAfterMutation`, which `setupAppDbSync` registers. How a product
 * is named (an app's product-identifier setting) stays in the app.
 */

import { computed, effectScope, getCurrentScope, onScopeDispose, type EffectScope, type Ref } from "vue";
import logger from "../../core/logger";
import { onSessionCleared } from "../../core/sessionScope";
import { buildProductQuery, mapDocToProduct, PRODUCT_BATCH_SIZE, PRODUCT_STALE_MS } from "../seed/productDomain";
import { getAppDbSync } from "../sync/setupAppDbSync";
import { useLiveEntity } from "./useLiveEntity";

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


/** One live read of the table, shared by every mounted user and closed when the last unmounts. */
let reader: { scope: EffectScope; byId: Ref<Map<string, ProductRow>> } | null = null;
let readers = 0;

function openReader() {
  if (!reader) {
    const scope = effectScope(true);
    const byId = scope.run(() => {
      const { records } = useLiveEntity<ProductRow>("products");
      return computed(() => new Map(records.value.map((product) => [product.productId, product])));
    })!;
    reader = { scope, byId };
  }
  readers += 1;
}

function closeReader() {
  readers -= 1;
  if (readers > 0 || !reader) return;
  reader.scope.stop();
  reader = null;
  readers = 0;
}

/**
 * How soon an id may be asked for again while its row is still missing or stale: the request is
 * still running, or Solr has no document for it. Keeps a re-rendering screen from asking on every
 * render; it is not a freshness rule.
 */
const RETRY_MS = 5 * 60 * 1000;

/** When each id was last sent to the worker, for RETRY_MS only. */
const askedAt = new Map<string, number>();
const queued = new Set<string>();

onSessionCleared(() => {
  askedAt.clear();
  queued.clear();
});

/**
 * An id is due when its row is missing, or older than PRODUCT_STALE_MS by its own `syncedAt`, and it
 * was not asked for within RETRY_MS. A fresh row is never sent to the worker.
 */
function isDue(productId: string, now: number): boolean {
  const row = reader?.byId.value.get(productId);
  if (row && now - Number(row.syncedAt ?? 0) < PRODUCT_STALE_MS) return false;
  const asked = askedAt.get(productId);
  return asked === undefined || now - asked >= RETRY_MS;
}

/** Ask the worker for the products a screen shows. Resolves once they are stored; never rejects. */
async function prefetch(productIds: Array<string | null | undefined>): Promise<void> {
  const now = Date.now();
  const due = [...new Set(productIds.filter(Boolean) as string[])].filter((productId) => isDue(productId, now));
  if (!due.length) return;

  due.forEach((productId) => askedAt.set(productId, now));
  try {
    // The worker checks `syncedAt` again and fetches only what is missing or stale.
    await getAppDbSync().refreshAfterMutation("product", { productIds: due });
  } catch (error) {
    // Let the next render ask again rather than wait out RETRY_MS.
    due.forEach((productId) => askedAt.delete(productId));
    logger.error("Failed to fetch products", error);
  }
}

function queue(productId: string) {
  if (!isDue(productId, Date.now())) return;
  if (!queued.size) {
    queueMicrotask(() => {
      const ids = [...queued];
      queued.clear();
      void prefetch(ids);
    });
  }
  queued.add(productId);
}

/** The stored product, or undefined until it is fetched (or when Solr has none). */
function getProduct(productId?: string | null): ProductRow | undefined {
  if (!productId) return undefined;
  queue(productId);
  return reader?.byId.value.get(productId);
}

/** Fetch products from Solr without storing them, for a picker that shows search results as-is. */
async function getByIds(productIds: string[]): Promise<ProductRow[]> {
  const ids = [...new Set(productIds.filter(Boolean))];
  const products: ProductRow[] = [];
  if (!ids.length) return products;
  // Loaded on use: the API layer reads cookies when it loads, and `@common/db` must stay importable
  // without it (workers, node-environment specs).
  const [{ useSolrSearch }, { commonUtil }] = await Promise.all([
    import("../../composables/useSolrSearch"),
    import("../../utils/commonUtil"),
  ]);
  for (let index = 0; index < ids.length; index += PRODUCT_BATCH_SIZE) {
    try {
      const resp = await useSolrSearch().runSolrQuery(buildProductQuery(ids.slice(index, index + PRODUCT_BATCH_SIZE)));
      if (commonUtil.hasError(resp)) {
        logger.error("Product Solr query returned an error", resp.data);
        continue;
      }
      products.push(...(resp.data?.response?.docs || []).map(mapDocToProduct));
    } catch (error) {
      logger.error("Product Solr query failed", error);
    }
  }
  return products;
}

export function useProductMaster() {
  // In a component (or effect scope), hold the shared live read open until it unmounts. Outside one,
  // getProduct answers from a read another component holds, if any.
  if (getCurrentScope()) {
    openReader();
    onScopeDispose(closeReader);
  }
  return { getProduct, prefetch, getByIds };
}
