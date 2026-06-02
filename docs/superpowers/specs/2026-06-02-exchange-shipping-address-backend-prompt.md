# Backend Prompt — Exchange shipping address (show + override on create)

**Date:** 2026-06-02
**Requested by:** PWA returns app (`apps/returns`)
**Type:** Additive — one order-detail field group, geo list endpoints, one `customerExchange` body field
**Builds on:** `2026-06-02-exchange-create-time-fulfillment-backend-prompt.md` (+ answers). That work added
create-time fulfillment (`fulfillmentType` + `facilityId`, shipped → `ORDER_APPROVED`). This adds the
**ship-to address** for a SHIPPED exchange.

> **Goal of this doc:** tell us **what already exists** vs **what's net-new** for the three items below, and
> answer the "Questions for backend" inline.

---

## What the PWA will do

On the create page, for a **SHIPPED** exchange, the operator sees the **order's shipping address** as
**editable fields** (prefilled), with **country + state/province dropdowns** (real geoIds). Whatever is in
the fields at submit is sent on `customerExchange` and becomes the **replacement order's ship-to**. An
**IMMEDIATE** exchange ships nothing (handed over in store) — no address is shown or sent.

To do that the PWA needs: (1) the order's current ship-to address to prefill, (2) geo lists to drive the
country/state dropdowns, (3) `customerExchange` to accept the chosen address.

---

## Proposed contract

### 1. `GET /oms/orders/{orderId}` — expose the ship-to postal address (CHANGE/CONFIRM)

The PWA already calls this for the returnable-lines view and reads `orderDetail.shipGroups[]`. Please ensure
the ship group (or order level) exposes the **destination postal address** so we can prefill the form:

```jsonc
"shipGroups": [{
  "shipmentMethod": "...",
  "shippingAddress": {
    "toName": "Jane Doe",
    "attnName": null,
    "address1": "123 Main St",
    "address2": "Apt 4",
    "city": "Austin",
    "stateProvinceGeoId": "USA_TX",   "stateProvinceGeoName": "Texas",
    "postalCode": "78701",
    "countryGeoId": "USA",            "countryGeoName": "United States",
    "phone": "+1 512 555 0100"
  },
  "items": [ … ]
}]
```

Field names are a proposal — if the real shape differs (e.g. `postalAddress`, or `stateProvinceGeoId`
already present elsewhere), tell us the actual path/names and we'll map to them.

### 2. Geo list endpoints — countries + states/provinces (NEW or CONFIRM)

The country/state dropdowns need:

- **Countries:** a list of `{ geoId, geoName }` for selectable countries.
- **States/provinces for a country:** given a `countryGeoId`, the list of `{ geoId, geoName }` child regions
  (empty for countries without a state level).

What we'd like (rename to whatever exists):

- `GET /oms/geos?geoTypeId=COUNTRY` → `{ "geos": [ { "geoId": "USA", "geoName": "United States" }, … ] }`
- `GET /oms/geos?geoIdFrom={countryGeoId}&geoTypeId=PROVINCE` (or `STATE`) → states/provinces of that country.

Moqui has geo data (`Geo`, `GeoAssoc`, `mantle`/`moqui` geo services). If there's an existing endpoint
(e.g. `get#GeoData`, a `geos` REST resource, or a productStore-scoped country list), point us at it and its
parameters; we don't need a new one if one already returns these shapes.

### 3. `POST /oms/returns/customerExchange` — accept a `shippingAddress` (CHANGE)

For a **SHIPPED** exchange, the body adds (alongside `fulfillmentType: "SHIPPED"` + `shipmentMethodTypeId`):

```jsonc
{
  "fulfillmentType": "SHIPPED",
  "shipmentMethodTypeId": "STANDARD",
  "shippingAddress": {
    "toName": "Jane Doe", "attnName": null,
    "address1": "123 Main St", "address2": "Apt 4",
    "city": "Austin", "stateProvinceGeoId": "USA_TX",
    "postalCode": "78701", "countryGeoId": "USA",
    "phone": "+1 512 555 0100"
  }
}
```

The replacement order's ship group ships to this address. **IMMEDIATE** sends no `shippingAddress`.

We send **geoIds** (`countryGeoId`, `stateProvinceGeoId`) from the dropdowns, not free text, so no geo
resolution is needed on your side. `address2`/`attnName`/`phone` may be null/omitted.

---

## Questions for backend (answer inline)

1. **Order address:** does `GET /oms/orders/{orderId}` already return the ship-to postal address on
   `orderDetail.shipGroups[]` (or order-level)? If so, what's the exact path + field names? If not, can it be
   added additively?
2. **Geo lists:** is there an existing endpoint for (a) countries and (b) a country's states/provinces, each
   returning `{ geoId, geoName }`? What are the paths/params? If not, can `GET /oms/geos` (with a geoType /
   parent filter) be exposed?
3. **State level:** what `geoTypeId`(s) represent the state/province level we should request per country
   (e.g. `PROVINCE`, `STATE`, `STATE_PROVINCE`)? Does it vary by country?
4. **customerExchange address:** can the create call accept an inline `shippingAddress` (postal fields +
   geoIds) for SHIPPED and use it as the replacement ship-to? Field names you expect?
5. **Persistence:** does supplying an edited/new address create a new `PostalAddress`/`ContactMech` on the
   order's party, or is it attached only to the replacement order's ship group? (Either is fine for us — just
   tell us the behavior.)
6. **Validation:** which address fields are required server-side for a shipped exchange, and what happens if
   a `stateProvinceGeoId` is omitted for a country that has states? Error shape (we expect a 4xx message
   string, per the prior contract)?
7. **Immediate:** confirm `shippingAddress` is simply ignored/optional for `IMMEDIATE`.

---

## Notes

- Until items 1–3 land, the PWA wires the address block against the **stub adapter** (canned order address +
  geos) and submits `shippingAddress`; it lights up against the real backend when the fields/endpoints exist
  — same "wires now, lights up when backend lands" pattern as the rest of the returns work.
</content>
