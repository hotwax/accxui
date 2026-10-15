---
name: accxui-product-search
description: Use when AccxUI app code (any app under apps/*) shows product details (name, image, SKU, identifiers, features) for rows that only carry a productId, or searches products by keyword / barcode / product store. Triggers include useProducts, resolve, products.value.get, ResolvedProduct, parentProductName, mainImageUrl, goodIdentifications, productFeatures, searchProducts, productStoreIds_s, a product picker or "add product" modal, scanning a barcode, Order Manager's useProductMaster / useProductCacheStore / productDb / prefetch / getProduct / primaryId / secondaryId, BOPIS's product store, and a row that shows a raw productId instead of a name.
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
write them into the app db. In Order Manager, feed them into its product cache (`upsertFromApi`) so
later id lookups hit it: that cache is its own Dexie store, not the app db.

## Order Manager's product cache

Order Manager keeps products in a persistent, per-OMS Dexie store so a product is fetched once, ever:

| Piece | File | Role |
|---|---|---|
| `getProductDb(oms)` | `src/db/productDb.ts` | Dexie database `${oms}-CommonDB`, table `products` (`productId, updatedAt`); survives logout. App-local store outside the app db (lint-exempt in `eslint.config.js`) |
| `useProductCacheStore` | `src/store/productCache.ts` | reactive mirror `byId` over Dexie. `prefetch(ids)` (fetch only what isn't fully cached, then store), `getProduct(id)` (sync read), `getById(id, { refresh? })`, `upsertDocs(docs)`, `reset()` (mirror only, from `postLogout`) |
| `useProductMaster()` | `src/composables/useProductMaster.ts` | what components use: `prefetch`, `getById`, `getByIds`, `upsertFromApi`, and `primaryId(product, fallbacks)` / `secondaryId(...)` which follow the user's product-identifier setting |
| `useProductIdentity()` | `src/composables/useProductIdentity.ts` | `getProduct`, `primaryIdentifier`, `secondaryIdentifier`, `imagePreview`, `featureLabel` |
| query and fields | `src/utils/productDocs.ts` | `PRODUCT_FIELDS` (the common fields + `groupId`, `groupName`, `primaryProductCategoryName`, `title`) and `isFullyCached`: **add a key there whenever `PRODUCT_FIELDS` grows**, or old rows never heal |

Pattern: components call `useProductMaster().prefetch(ids)` when rows arrive (stores call
`useProductCacheStore().prefetch`), then read `productCache.getProduct(id)` and name the product with
`primaryId(product || item, [item.name, item.sku])`.

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
| Adding a field to Order Manager's `PRODUCT_FIELDS` only | cached products never get it | add it to `isFullyCached` too |
| Copying Order Manager's Dexie cache into another app | a second product store to maintain | ask first; use `useProducts` meanwhile |
