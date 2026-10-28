---
name: accxui-solr-search
description: Use when AccxUI app code (any app under apps/*) or framework code in common/ (components, composables) searches products or orders through Solr, or builds a Solr facet / count / grouped query. Triggers include useSolrSearch, searchProducts, runSolrQuery, prepareOrderQuery, admin/runSolrQuery, admin/search/query, docType, filters / facet / group in a search payload, an "add product" or product picker search, an order lookup, a search result that is {} instead of [], a search that breaks on a special character, or one that works on OFBiz but not on Moqui.
---

# Solr search: `useSolrSearch`

`useSolrSearch()` from `@common` (or `@common/composables/useSolrSearch`) is a plain framework
helper: it makes API calls, so call it where API calls may live: a composable, a Pinia store action,
or a `.vue` file (it counts as the composable that owns the request). Not in a util, the router or a
sync worker (it pulls in `api` and `commonUtil`).

**Inside `common/` itself**, import it with a relative path, never `@common` or `../index`:
`import { useSolrSearch } from "../composables/useSolrSearch";` (or `"./useSolrSearch"` from another
composable, as `common/composables/useProducts.ts` does).

It hides the backend split: on Moqui it posts `payload.json` to `admin/search/query` and normalizes
the answer; on OFBiz it posts `payload` to `admin/runSolrQuery`. Either way you read
`resp.data.response`, `resp.data.grouped` and `resp.data.facets`.

## Functions

| Function | Returns |
|---|---|
| `searchProducts({ keyword?, viewSize?, viewIndex?, filters?, qf?, sort? })` | `{ products, total }`. **No hits: `{ products: {}, total: 0 }`**, an object, not `[]`. Rejects `{ code: "error", message, serverResponse }` on a request failure |
| `runSolrQuery(payload)` | the raw axios response (normalized on Moqui). Fills `json.query` from `json.params.q` or `*:*` if missing |
| `prepareOrderQuery(params)` | an order-item payload (`docType` default `OISGIR`) grouped by `orderId` (or `groupBy`), for `runSolrQuery`. Params: `viewSize`, `viewIndex`, `sort` (default `reservedDatetime asc`), `queryString` + `queryFields`, `filters` (as below), `facet`, `docType` |

### `searchProducts`

- Products only (`docType: PRODUCT`), 100 rows by default, `start = viewSize * viewIndex`.
- With a keyword: each word becomes a prefix match (`abc* OR xyz*`) plus the whole phrase boosted;
  a keyword starting with `"` is searched exactly. `qf` and `sort` apply **only without a keyword**.
- Adds `isVirtual: false` and `isVariant: true` unless `filters` sets them.
- `filters`: `{ field: { value } }` → `AND field: value`; an array value → `field: (a OR b)`
  (`op: "AND"` to change the operator).

```ts
const { products, total } = await useSolrSearch().searchProducts({
  keyword: query.value.trim(),
  viewSize: 20,
  viewIndex: page,
  filters: { productStoreIds_s: { value: productStoreId } },
});
const rows = total ? products : [];             // never iterate `products` when total is 0
```

### Order-item search (BOPIS `store/order.ts`)

```ts
const payload = useSolrSearch().prepareOrderQuery({
  viewSize,
  filters: {
    facilityId: { value: facilityId },
    orderStatusId: { value: "ORDER_APPROVED" },
    orderTypeId: { value: "SALES_ORDER" },
    "-fulfillmentStatus": { value: "(Cancelled OR Rejected OR Completed)" },   // a leading "-" excludes
  },
});
const resp: any = await useSolrSearch().runSolrQuery(payload);
const orderIds = !commonUtil.hasError(resp) && resp.data.grouped?.orderId?.ngroups > 0
  ? resp.data.grouped.orderId.groups.map((group: any) => group.doclist.docs[0].orderId)
  : [];
```

## Recipe: a raw facet query

Build the payload yourself when no helper fits; keep the `{ json: { params, query, filter, facet } }`
shape so both backends work:

```ts
// store action: completed sales per facility for a product, last 30 days
const resp: any = await useSolrSearch().runSolrQuery({
  json: {
    params: { rows: 0, "q.op": "AND" },
    query: "*:*",
    filter: [
      "docType: ORDER",
      "orderTypeId: SALES_ORDER",
      `productId: "${productId}"`,
      "orderItemStatusId: ITEM_COMPLETED",
      "orderDate:[NOW-30DAYS TO NOW]",
    ],
    facet: { facilities: { type: "terms", field: "facilityId", limit: -1, mincount: 1 } },
  },
});
if (commonUtil.hasError(resp)) throw new Error("Search failed");
const buckets = resp.data?.facets?.facilities?.buckets ?? [];   // [{ val, count }]
```

Reading results: plain `resp.data.response.docs` / `numFound`; grouped
`resp.data.grouped.<field>.groups[].doclist.docs` and `.ngroups`; facets `resp.data.facets.<name>.buckets`.

## Rules

- **Quote values in filters** (`productId: "${productId}"`), so an id with `-` or `:` stays one value.
  `searchProducts` handles the keyword itself; filter values you pass go in as given.
- **Check `total` (or `numFound`) before using results**; `searchProducts` returns `{}` on no hits.
- **Check `commonUtil.hasError(resp)`** after `runSolrQuery`: an error body can come back with status 200.
- **Always the `json` wrapper**: on Moqui only `payload.json` is sent.
- **Search results are not app-db data**: keep them in the component, composable or store that asked.
  Never write them into an app db table (only sync domains write it).

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| `products.length` / `products.map` with no hits | `undefined` / crash (`{}`) | use `total` first |
| `qf` or `sort` passed with a keyword | ignored | they apply only without a keyword |
| Unquoted id with `-` or `:` in a filter | Solr syntax error or wrong matches | quote the value |
| A flat payload without `json` | works on OFBiz, empty on Moqui | `{ json: { … } }` |
| Calling it from a util or worker | breaks the layer rule (utils make no API calls; lint doesn't catch this one) / the worker bundle | a composable or store action |
| Expecting variants and virtuals both | `searchProducts` filters to variants | set `filters.isVirtual` / `isVariant` |
