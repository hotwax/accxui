---
name: accxui-product-search
description: Use when AccxUI app code (any app under apps/*) shows product details (name, image, SKU, identifiers, features) for rows that only carry a productId, or searches products by keyword / barcode / product store. Triggers include useProducts, resolve, products.value.get, ResolvedProduct, parentProductName, mainImageUrl, goodIdentifications, productFeatures, searchProducts, productStoreIds_s, a product picker or "add product" modal, scanning a barcode, Order Manager's useProductMaster / products table / product domain / prefetch / getProduct / primaryId / secondaryId, BOPIS's product store, and a row that shows a raw productId instead of a name.
---

# Products: resolving by id and searching

Product data comes from Solr. Two jobs, two tools:

| Job | Use |
|---|---|
| Show product details for rows that carry only a `productId` | `useProducts()` from `@common` (in-memory, per session) |
| Find products by keyword, barcode or store | `useSolrSearch().searchProducts(...)` from `@common` (**accxui-solr-search**) |

Order Manager has its own persistent product cache (below). Follow the app's existing way: in Order
Manager use its product cache, elsewhere use `useProducts`. A shared, framework-level version of the
local-db cache may come later; until then don't copy Order Manager's into another app without asking.

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

## Order Manager's product master

Order Manager keeps products in its app db, in the `products` table, so a product is fetched once and
then again only when it is older than `PRODUCT_STALE_MS` (24 h):

| Piece | File | Role |
|---|---|---|
| `products` table | `src/db/orderManagerSchema.ts` | the product master row, declared `retainOnLogout: true`: the catalog is the same for every user of the instance, so logout keeps it (a `version` bump still drops it) |
| `product` domain (class C) | `src/workers/domains/productDomain.ts` | `refreshAfterMutation("product", { productIds })` fetches only the ids missing or stale (`force: true`: all), from Maarg's `admin/search/query`, 200 per query, and stores them |
| `useProductMaster()` | `src/composables/useProductMaster.ts` | what components use, during setup: `getProduct(id)` (live; also queues the id, and queued ids go to the worker in one batch), `prefetch(ids)` (awaitable), `getByIds(ids)` (Solr, not stored: a picker's results), `primaryId(product, fallbacks)` / `secondaryId(...)` which follow the user's product-identifier setting |
| `useProductIdentity()` | `src/composables/useProductIdentity.ts` | `getProduct`, `primaryIdentifier`, `secondaryIdentifier`, `imagePreview`, `featureLabel` |
| query, fields, row type | `src/utils/productDocs.ts` | `PRODUCT_FIELDS`, `mapDocToProduct`, `CachedProduct`, `PRODUCT_STALE_MS`. Shared with the worker, so no `@common` import |

Pattern: a page calls `const productMaster = useProductMaster()` in setup, may `await
productMaster.prefetch(ids)` when its rows arrive, and names each product with
`primaryId(productMaster.getProduct(item.productId) || item, [item.name, item.sku])`. A store can't
read the table: it asks for products with `refreshAfterMutation("product", { productIds })`, and a
store getter that needs product fields takes a lookup from its caller (`orderDetail`'s
`itemExternalIdBySeqIdByOrderId(orderId, skuOf)`). A new field goes in `PRODUCT_FIELDS`,
`mapDocToProduct` and the `products` entity, with a `version` bump.

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
| Adding a field to Order Manager's `PRODUCT_FIELDS` only | the entity's `fields` whitelist drops it | declare it on the `products` entity and bump the db `version` |
| `getProduct` copied into a list once, right after `prefetch` | rows miss the product: the live read lands after `prefetch` resolves | read `getProduct` in a `computed` or the template (`SwapOrders.vue`'s `setupCandidatesWithProducts`) |
| A products table in another app | a second product master to maintain | ask first; use `useProducts` meanwhile |
