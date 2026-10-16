---
name: accxui-product-search
description: Use when AccxUI app code (any app under apps/*) shows product details (name, image, SKU, identifiers, features) for rows that only carry a productId, or searches products by keyword / barcode / product store. Triggers include useProducts, resolve, products.value.get, ResolvedProduct, parentProductName, mainImageUrl, goodIdentifications, productFeatures, searchProducts, productStoreIds_s, a product picker or "add product" modal, scanning a barcode, useProductMaster, the products seed table, the product domain, prefetch / getProduct, Order Manager's primaryId / secondaryId, BOPIS's product store, and a row that shows a raw productId instead of a name.
---

# Products: resolving by id and searching

Product data comes from Solr. Two jobs, two tools:

| Job | Use |
|---|---|
| Show product details for rows that carry only a `productId` | `useProducts()` from `@common` (in-memory, per session), or, in an app that keeps them in its app db, `useProductMaster()` from `@common/db` (below) |
| Find products by keyword, barcode or store | `useSolrSearch().searchProducts(...)` from `@common` (**accxui-solr-search**) |

Follow the app's existing way: Order Manager uses `useProductMaster` (through its own wrapper),
Company and the apps without an app db use `useProducts`. Moving an app from one to the other is its
own change: ask first.

## `useProducts()` (framework)

```ts
const { products, resolve } = useProducts();
```

| Member | Does |
|---|---|
| `resolve(ids)` | fetches the ids not requested yet this session (batches of 200, one Solr query each) and adds them to `products`. Safe to call on every render: a stable set of rows makes one round trip. Never throws (failures are logged; the screen keeps its ids). The map clears itself on logout |
| `products` | `Ref<Map<productId, ResolvedProduct>>`, shared by every caller; reactive |

`ResolvedProduct`: `productId`, `productName` (the variant's own name, e.g. "S": a qualifier, not a
label), **`parentProductName` (the name to show)**, `sku` (the `SKU` identification when the doc has no
`sku`), `internalName`, `mainImageUrl`, `goodIdentifications: { type, value }[]`, `productFeatures`
(raw `"<typeId>/<description>"` strings; format with `commonUtil.getFeatures(...)`).

An id Solr didn't return stays requested and isn't asked again this session.

### Recipe: rows with only a productId

```ts
// in the page or a composable it calls
const { products, resolve } = useProducts();
watch(rows, (list) => { void resolve(list.map((row) => row.productId).filter(Boolean)) }, { immediate: true });
const productOf = (productId: string) => products.value.get(productId);
```

```html
<ion-thumbnail><DxpShopifyImg :src="productOf(row.productId)?.mainImageUrl" size="small" /></ion-thumbnail>
<ion-label>
  {{ productOf(row.productId)?.parentProductName || productOf(row.productId)?.productName || row.productId }}
  <p>{{ productOf(row.productId)?.sku }}</p>
</ion-label>
```

Company uses this in `views/ShopifyFulfillmentSync.vue` and `views/ShopifyTransferSyncDetail.vue`.

## Searching products

```ts
const { products, total } = await useSolrSearch().searchProducts({
  keyword: query.value.trim(),
  viewSize: 20,
  viewIndex: page,                                            // 0-based
  filters: { productStoreIds_s: { value: currentProductStoreId } },
});
const rows = total ? products : [];                           // {} when nothing matched
```

- Variants only (`isVariant: true`, `isVirtual: false`) unless `filters` sets them.
- Barcode / identifier lookup: `viewSize: 1` and
  `filters: { goodIdentifications: { value: \`${identificationTypeId}/${value}\` } }` (Order Manager's
  `CreateOrder.vue`).
- Infinite scroll: next `viewIndex`, append to the list.

Search results are screen data: keep them in the component, composable or store that searched. Never
write them into the app db. In Order Manager, a screen that needs them as product master rows shows
them from the search answer until `useProductMaster().getProduct(id)` has the stored row
(`CreateOrder.vue`'s `searchedProducts`).

## `useProductMaster()` (framework, apps with an app db)

An app with an app db can keep products in it instead: the `products` seed table (declared
`retainOnLogout: true`, so logout keeps it) filled by the class C `product` seed domain. A product is
fetched once, then again only when it is older than `PRODUCT_STALE_MS` (24 h). Order Manager uses it;
Company still uses `useProducts`.

| Piece | Where (`@common/db`) | Role |
|---|---|---|
| `products` table | `common/db/seed/seedSchema.ts` | an app picks it like any seed table (`commonSchema.pick([..., "products"])`; Order Manager takes the whole `commonSchema`) and registers the seed domains as usual. A `version` bump drops its rows |
| `product` domain (class C) | `common/db/seed/productDomain.ts` | `refreshAfterMutation("product", { productIds })` fetches only the ids missing or stale (`force: true`: all), from Maarg's `admin/search/query`, 200 per query, and stores them through the app's composed entity |
| `useProductMaster({ refreshAfterMutation })` | `common/db/composables/useProductMaster.ts` | during setup: `getProduct(id)` (live; also queues the id, and queued ids go to the worker in one batch) and `prefetch(ids)` (awaitable, never rejects). One live read shared by every mounted caller |
| `ProductRow`, `PRODUCT_FIELDS`, `mapDocToProduct`, `buildProductQuery`, `PRODUCT_STALE_MS` | `common/db/seed/productMaster.ts` | the row type and the Solr query; worker-safe |

The app wraps it in its own composable, which passes its `refreshAfterMutation` and adds how the app
names products. Order Manager's `src/composables/useProductMaster.ts` adds `primaryId(product,
fallbacks)` / `secondaryId(...)` (the Settings product identifier) and `getByIds(ids)` (Solr, not
stored: a picker's results); `useProductIdentity()` builds on it.

Pattern: a page calls the app's `useProductMaster()` in setup, may `await prefetch(ids)` when its rows
arrive, and names each product with `primaryId(getProduct(item.productId) || item, [item.name,
item.sku])`. A store can't read the table: it asks with `refreshAfterMutation("product", { productIds })`,
and a store getter that needs product fields takes a lookup from its caller (Order Manager's
`orderDetail.itemExternalIdBySeqIdByOrderId(orderId, skuOf)`). A new field goes in `PRODUCT_FIELDS`,
`mapDocToProduct` and the `products` entity (framework), with a `version` bump in every app that
picks the table, or an app adds it for itself with `extendEntities`.

BOPIS keeps products in its own persisted Pinia store (`src/store/product.ts`: `fetchProducts`,
`getProduct`, `findProduct`).

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| Showing `productName` | "S" or "Red" instead of the product | `parentProductName`, falling back to `productName`, then the id |
| `searchProducts` per row to get a name | one Solr call per row | `useProducts().resolve(ids)` once |
| Reading `products.length` after a search with no hits | crash: it's `{}` | check `total` |
| A module-level product map of your own in a shared composable | the next user sees the previous tenant's products | `useProducts` (it resets on logout), or `onSessionCleared` |
| Hardcoding SKU or productId as the label in Order Manager | ignores the user's identifier setting | `primaryId` / `secondaryId` |
| Adding a field to `PRODUCT_FIELDS` only | the entity's `fields` whitelist drops it | declare it on the `products` entity too, and bump the `version` of every app db that picks it |
| `getProduct` copied into a list once, right after `prefetch` | rows miss the product: the live read lands after `prefetch` resolves | read `getProduct` in a `computed` or the template (`SwapOrders.vue`'s `setupCandidatesWithProducts`) |
| An app declaring its own products table | a second product master to maintain | pick the framework's `products` seed table |
