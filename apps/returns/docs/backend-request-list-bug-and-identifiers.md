# Backend requests: returns list+detail 400 bug + Shopify order id (search) + product SKU

Three asks surfaced while dogfooding the Returns PWA against the OMS build at `localhost:8081`.
Ask **#1 is a bug** (P0 — the returns list *and* return-detail are completely unusable); **#2** and **#3** are
additive, backward-compatible field requests. See also the companion doc
[`backend-request-list-order-id.md`](./backend-request-list-order-id.md) (the order *name* on list rows).

---

## #1 — BUG: the returns service throws a 400 `ClassCastException` whenever it processes a real return (P0, blocks list AND detail)

Both `GET /oms/returns` (list) and `GET /oms/returns/{id}` (detail of an **existing** return) return
**HTTP 400** with a Java `ClassCastException`. This blocks the entire app: the list shows zero returns,
and opening any real return fails (now rendered as a visible error after a frontend fix).

### Reproduction
```bash
# List — fails for every param combination, including none:
curl -s "http://localhost:8081/rest/s1/oms/returns" -H "api_key: <UserLoginKey>"
curl -s "http://localhost:8081/rest/s1/oms/returns?pageIndex=0&pageSize=20&returnHeaderTypeId=CUSTOMER_RETURN" -H "api_key: <UserLoginKey>"
# Detail of a REAL return — also fails:
curl -s "http://localhost:8081/rest/s1/oms/returns/M100052" -H "api_key: <UserLoginKey>"
```
### Actual response (all of the above)
```json
{
  "errorCode": 400,
  "errors": "class java.lang.String cannot be cast to class java.lang.Boolean (java.lang.String and java.lang.Boolean are in module java.base of loader 'bootstrap')"
}
```

### Evidence + narrowing (it is server-side, in per-return processing)
With the **same `api_key`** on the same build:
- `GET /oms/returnReasons` → **200**
- `GET /oms/orders/{id}` → **200** (real orders load fine — e.g. `GORTEST19510`)
- `GET /admin/user/profile` → **200**
- `GET /oms/returns/{id}` for a **non-existent** id → **400 `"ReturnHeader [..] not found"`** (the path resolves and runs; no cast error)
- `GET /oms/returns/{id}` for a **real** id (`M100052`) → **400 `ClassCastException`**
- `GET /oms/returns` (list) → **400 `ClassCastException`** (even with no params)

The cast does **not** fire on the not-found path but **does** fire whenever the service touches an
actual `ReturnHeader` (one record for detail, many for the list). So the offending `String`→`Boolean`
coercion is in the **per-return processing / response mapping of a real return record** — most likely a
field on `ReturnHeader`/`ReturnItem` (or a related entity) declared/cast as `Boolean` but holding a
`String` value, or a Boolean service in/out parameter populated from a String. It is **not** caused by
the request params (no-params list also throws; orders endpoint with the same plumbing works).

### Ask
Fix the returns service so it can serialize a real return without the cast error, for both list and
detail. Please confirm the offending field/parameter once found (that will also tell us if any response
field we map needs handling).

### Acceptance criteria
1. `GET /oms/returns?returnHeaderTypeId=CUSTOMER_RETURN&pageIndex=0&pageSize=20` returns `200` with a `returns[]` array and `returnsCount`.
2. `GET /oms/returns/{id}` returns `200` for an existing return (e.g. `M100052`).
3. `statusId` (e.g. `RETURN_REQUESTED`) filters the list without error.
4. No `ClassCastException` for any real return in list or detail.

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
- **#1:** `omsAdapter.listReturns()` and `getReturn()` already call the endpoints correctly; the list
  and detail views now show the real error instead of failing silently, and will populate the moment
  the 400 is fixed. No frontend change needed.
- **#2:** `omsAdapter.listReturns()` maps `row.orderExternalId` onto `ReturnSummary.orderExternalId`, and
  `returnsStore.getFilteredReturns` indexes it — so a Shopify order id/GID will match in search
  immediately once rows carry it. (Search is currently client-side over the loaded page; full
  server-side search would be a separate ask if needed.)
- **#3:** `omsAdapter` maps `item.sku` onto `ReturnableLine.sku` / `ReturnItemDetail.sku`, and the
  Create/Detail views display `productName → sku → productId` plus a `SKU: …` line — so the SKU shows
  (instead of the internal id) as soon as items carry it.

So no further frontend change is needed for any of the three after the backend delivers them.
