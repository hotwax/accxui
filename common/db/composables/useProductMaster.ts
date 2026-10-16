/**
 * `useProductMaster` — product details (name, SKU, image, identifiers) for rows that carry only a
 * productId, from the app db's `products` seed table, for an app that picked it.
 *
 * `getProduct(id)` is safe to call from a template on every render: it answers from the table and
 * queues the id, and the queued ids go to the worker's `product` domain in one batch. The domain
 * fetches only the ones missing or older than PRODUCT_STALE_MS, and the live read shows them once
 * stored. An app without an app db uses `useProducts` instead (a session Map, no table).
 *
 * The app passes its own `refreshAfterMutation` (from `setupAppDbSync`), as `useDbStatus` takes its
 * actions; an app usually wraps this in its own composable that also names products its way.
 */

import { computed, effectScope, getCurrentScope, onScopeDispose, type EffectScope, type Ref } from "vue";
import logger from "../../core/logger";
import { onSessionCleared } from "../../core/sessionScope";
import { PRODUCT_STALE_MS, type ProductRow } from "../seed/productMaster";
import { useLiveEntity } from "./useLiveEntity";

export interface ProductMasterActions {
  refreshAfterMutation: (domain: string, pk: Record<string, unknown>) => Promise<unknown>;
}

/** One live read of the table, shared by every mounted user and closed when the last unmounts. */
let reader: { scope: EffectScope; byId: Ref<Map<string, ProductRow>> } | null = null;
let readers = 0;
let actions: ProductMasterActions | null = null;

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
 * When each id was last sent to the worker. The worker decides what is stale; this only keeps a
 * re-rendering screen from asking again for an id it asked for within PRODUCT_STALE_MS.
 */
const askedAt = new Map<string, number>();
const queued = new Set<string>();

onSessionCleared(() => {
  askedAt.clear();
  queued.clear();
});

/** Ask the worker for the products a screen shows. Resolves once they are stored; never rejects. */
async function prefetch(productIds: Array<string | null | undefined>): Promise<void> {
  const now = Date.now();
  const due = [...new Set(productIds.filter(Boolean) as string[])]
    .filter((productId) => now - (askedAt.get(productId) ?? -Infinity) >= PRODUCT_STALE_MS);
  if (!due.length || !actions) return;

  due.forEach((productId) => askedAt.set(productId, now));
  try {
    await actions.refreshAfterMutation("product", { productIds: due });
  } catch (error) {
    // Let the next render ask again rather than wait out PRODUCT_STALE_MS.
    due.forEach((productId) => askedAt.delete(productId));
    logger.error("Failed to fetch products", error);
  }
}

function queue(productId: string) {
  const asked = askedAt.get(productId);
  if (asked !== undefined && Date.now() - asked < PRODUCT_STALE_MS) return;
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

export function useProductMaster(productActions: ProductMasterActions) {
  actions = productActions;
  // In a component (or effect scope), hold the shared live read open until it unmounts. Outside one,
  // getProduct answers from a read another component holds, if any.
  if (getCurrentScope()) {
    openReader();
    onScopeDispose(closeReader);
  }
  return { getProduct, prefetch };
}
