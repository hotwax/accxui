# Backend requests: returns-list 500/400 bug + Shopify order id (search) + product SKU

Three asks surfaced while dogfooding the Returns PWA against the OMS build at `localhost:8081`.
Ask **#1 is a bug** (P0 — the returns list is completely unusable); **#2** and **#3** are
additive, backward-compatible field requests. See also the companion doc
[`backend-request-list-order-id.md`](./backend-request-list-order-id.md) (the order *name* on list rows).

---

## #1 — BUG: `GET /oms/returns` throws a 400 for every request (P0, blocks the whole list)

The returns list endpoint returns **HTTP 400** with a Java `ClassCastException` for **every** call —
including with no query parameters at all. Because of this the list screen shows zero returns
(now rendered as a "Couldn't load returns" error after a frontend fix).

### Reproduction
```bash
curl -s "http://localhost:8081/rest/s1/oms/returns" -H "api_key: <UserLoginKey>"
curl -s "http://localhost:8081/rest/s1/oms/returns?pageIndex=0&pageSize=20&returnHeaderTypeId=CUSTOMER_RETURN" -H "api_key: <UserLoginKey>"
```
### Actual response (both, and every param combination tried)
```json
{
  "errorCode": 400,
  "errors": "class java.lang.String cannot be cast to class java.lang.Boolean (java.lang.String and java.lang.Boolean are in module java.base of loader 'bootstrap')"
}
```

### Evidence it is server-side, not the request
With the **same `api_key`** on the same build, these all succeed:
- `GET /oms/returnReasons` → **200**
- `GET /oms/orders/{id}` → **200**
- `GET /oms/returns/{id}` → **200** (or `400 "ReturnHeader [..] not found"` for a bad id — i.e. the path resolves)
- `GET /admin/user/profile` → **200**

Only the **list** (`GET /oms/returns`) throws, and it throws *before* any of our params can matter
(no-params also 400s). This points to a `String`→`Boolean` coercion **inside the list service / its
REST mapping** — most likely a parameter or flag declared `Boolean` that receives a `String` default
(e.g. a `pageNoLimit`-style flag, or a Boolean in-parameter with a `default-value=""`).

### Ask
Fix the `GET /oms/returns` service so it returns the list (paged via `pageIndex`/`pageSize`,
filtered by `returnHeaderTypeId=CUSTOMER_RETURN` and optional `statusId`) without the cast error.
Please confirm the offending parameter/field once fixed.

### Acceptance criteria
1. `GET /oms/returns?returnHeaderTypeId=CUSTOMER_RETURN&pageIndex=0&pageSize=20` returns `200` with a
   `returns[]` array and `returnsCount`.
2. `statusId` (e.g. `RETURN_REQUESTED`) filters the list without error.
3. No `ClassCastException` for any valid combination of `pageIndex` / `pageSize` / `returnHeaderTypeId` / `statusId`.

---

## #2 — Add the Shopify order id to list rows (so search can find a return by Shopify order id)

CSRs search the list by the **Shopify order id** (the GID `gid://shopify/Order/5512123…`, or the raw
numeric id). The PWA can't match it today because the list row carries no Shopify order id — only the
internal `orderId` and, per the companion doc, the order *name* (`externalOrderId`, e.g. `#1001`).

This is distinct from the order *name* request: `externalOrderId` is the human name (`#1001`);
`orderExternalId` here is the machine **GID / external id**.

### Requested per-row addition
```jsonc
{
  "returns": [
    {
      "returnId": "10042",
      "orderId": "10001",                              // (see companion doc)
      "externalOrderId": "#1001",                      // (see companion doc — order name)
      "orderExternalId": "gid://shopify/Order/5512123",// NEW — Shopify order GID / external id
      "statusId": "RETURN_REQUESTED",
      "entryDate": "2026-05-29 18:30:00.000"
    }
  ],
  "returnsCount": 1
}
```

| Field | Type | Required | Meaning / sourcing |
|-------|------|----------|--------------------|
| `orderExternalId` | string \| null | preferred | The Shopify order **GID** (or raw external order id) for the order this return is against — the same value `GET /oms/orders/{id}` returns on `orderDetail.orderExternalId`. NOT the human name. Omit/`null` for OMS-only returns. |

### Acceptance criteria
1. `GET /oms/returns` returns `orderExternalId` (the Shopify order GID/external id) on each row when available.
2. The value matches `orderDetail.orderExternalId` from `GET /oms/orders/{id}` for the same order.
3. `null`/omitted when the return has no linked Shopify order.

---

## #3 — Add the product SKU to order & return items (show SKU, not the internal product id)

Return/order line items render the product as the internal HotWax `productId` (e.g. `10000`) whenever
no `productName` is present. Merchants expect the **SKU**. Please include the SKU on each item.

### Endpoints & requested addition
`GET /oms/orders/{id}` → `orderDetail.shipGroups[].items[]`, and
`GET /oms/returns/{id}` → `items[]`:
```jsonc
{
  "orderItemSeqId": "00001",
  "productId": "10000",
  "productName": "Classic Tee",
  "sku": "TEE-BLK-M",        // NEW — product SKU (or the chosen GoodIdentification value)
  "returnQuantity": 1,
  "returnReasonId": "DEFECTIVE"
}
```

| Field | Type | Required | Meaning / sourcing |
|-------|------|----------|--------------------|
| `sku` | string \| null | preferred | The product SKU. If this OMS sources it from `GoodIdentification`, please use the merchant-facing SKU type and tell us the `goodIdentificationTypeId` used, so naming stays consistent. Omit/`null` when unknown. |

### Acceptance criteria
1. `GET /oms/orders/{id}` items and `GET /oms/returns/{id}` items each carry `sku` when available.
2. `null`/omitted when no SKU exists; existing fields unchanged.
3. Reply with the entity/field (and `goodIdentificationTypeId`, if used) chosen for `sku`.

---

## Frontend status (already wired — nothing else needed from us once the backend lands these)

The PWA consumes all three defensively and degrades gracefully until they arrive:
- **#1:** `omsAdapter.listReturns()` already calls the endpoint correctly; the list view now shows the
  real error instead of a misleading empty state, and will populate the moment the 400 is fixed.
- **#2:** `omsAdapter.listReturns()` maps `row.orderExternalId` onto `ReturnSummary.orderExternalId`, and
  `returnsStore.getFilteredReturns` indexes it — so a Shopify order id/GID will match in search
  immediately once rows carry it. (Search is currently client-side over the loaded page; full
  server-side search would be a separate ask if needed.)
- **#3:** `omsAdapter` maps `item.sku` onto `ReturnableLine.sku` / `ReturnItemDetail.sku`, and the
  Create/Detail views display `productName → sku → productId` plus a `SKU: …` line — so the SKU shows
  (instead of the internal id) as soon as items carry it.

So no further frontend change is needed for any of the three after the backend delivers them.
