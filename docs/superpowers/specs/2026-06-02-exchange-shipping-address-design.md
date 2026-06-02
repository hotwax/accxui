# PWA Exchange — shipping address (show + edit/create on create) — Frontend Design

**Date:** 2026-06-02
**App:** `apps/returns`
**Backend prompt:** `2026-06-02-exchange-shipping-address-backend-prompt.md`
**Folds into:** `2026-06-02-exchange-create-time-fulfillment-design.md` (same create form, SHIPPED branch).

---

## 1. Goal

For a **SHIPPED** exchange, show the **order's shipping address** on the create form as **always-editable
fields** (prefilled from the order), with **country + state/province dropdowns** backed by geo endpoints
(real geoIds). The address in the fields at submit is sent on `customerExchange` and becomes the replacement
order's ship-to. **IMMEDIATE** shows no address.

Decisions locked during brainstorming: order address with override allowed; always-editable fields; geo
dropdowns (not free text).

## 2. Types (`types/returns.ts`)

```ts
/** A postal address (replacement ship-to / order ship-to). geoIds drive the country/state dropdowns. */
export interface PostalAddress {
  toName?: string;
  attnName?: string;
  address1: string;
  address2?: string;
  city: string;
  stateProvinceGeoId?: string;  // omitted for countries without a state level
  postalCode: string;
  countryGeoId: string;
  phone?: string;
}

/** A selectable geo (country or state/province) for the address dropdowns. */
export interface Geo {
  geoId: string;
  geoName: string;
}
```

- `OrderForReturn` gains `shippingAddress?: PostalAddress` (prefill source).
- `CreateExchangeInput` gains `shippingAddress?: PostalAddress` (sent for SHIPPED only).

## 3. Service (`ReturnsService.ts`)

Add:
```ts
listCountries(): Promise<Geo[]>;
listStates(countryGeoId: string): Promise<Geo[]>;
```

## 4. Adapters

**omsAdapter**
- `mapOrderToReturnable` (and the `RawShipGroup`/`RawOrder` types) map a ship group's `shippingAddress` into
  `OrderForReturn.shippingAddress` via a small pure `mapPostalAddress(raw)` (unit-tested; tolerant of
  missing fields). The first ship group with an address wins.
- `listCountries()` → `GET oms/geos?geoTypeId=COUNTRY` → `{ geoId, geoName }[]` (tolerant of array or
  `resp.data.geos`).
- `listStates(countryGeoId)` → `GET oms/geos?geoIdFrom={countryGeoId}&geoTypeId=PROVINCE` → same shape;
  returns `[]` when the country has no states.
- `buildExchangeCreateBody` includes `shippingAddress` **only when present** (the create form omits it for
  IMMEDIATE). Endpoint names are the backend-prompt proposals; remap if backend differs.

**stubAdapter**
- The demo `ORDER` gains a `shippingAddress` (a US address) so the form prefills.
- Canned `COUNTRIES` (`USA`, `CAN`) and a `STATES` map (`USA` → a few states, `CAN` → a few provinces).
- `listCountries`/`listStates` return the canned data (`listStates` returns `[]` for unknown country).
- `createExchange` stores the submitted `shippingAddress` on the exchange block (for the replacement panel /
  future display); `getReplacementOrder` may surface it later (not required for this slice).

## 5. Store (`returnsStore.ts`)

```ts
async loadCountries() { return getReturnsService().listCountries(); }
async loadStates(countryGeoId: string) { return getReturnsService().listStates(countryGeoId); }
```

## 6. Create form (`views/CreateReturn.vue`) — SHIPPED branch only

Inside the existing Fulfillment card, when `exchangeFulfillment === "SHIPPED"`, render an **address block**
below the shipment-method picker:

- State:
  ```ts
  const shippingAddress = reactive<PostalAddress>({ address1: "", city: "", postalCode: "", countryGeoId: "" });
  const countries = ref<Geo[]>([]);
  const states = ref<Geo[]>([]);
  ```
- On the first switch into exchange mode (the existing lazy `loadFulfillmentOptions`), also load countries
  (alongside shipment methods + facilities, all `Promise.allSettled`). When the order loads and has a
  `shippingAddress`, prefill `shippingAddress` from it (deep copy) and, if it has a `countryGeoId`, load that
  country's states.
- Fields (always editable): `toName`, `address1`, `address2`, `city`, **country** (`ion-select` from
  `countries`), **state/province** (`ion-select` from `states`, disabled while `states` is empty),
  `postalCode`, `phone`. Changing the country reloads `states` and clears `stateProvinceGeoId`.
- Validation — a new computed `shippingAddressValid`:
  ```
  SHIPPED ⇒ address1 && city && postalCode && countryGeoId && (states.length === 0 || stateProvinceGeoId)
  ```
  Fold into `canSubmit` for the SHIPPED case (in addition to the shipment method).
- `submit()` (exchange + SHIPPED) adds `shippingAddress: { ...shippingAddress }` to the `submitExchange`
  payload. IMMEDIATE omits it.
- `data-testid`s: `create-ship-toName`, `create-ship-address1`, `create-ship-address2`, `create-ship-city`,
  `create-ship-country`, `create-ship-state`, `create-ship-postalCode`, `create-ship-phone`.
- Expose the new state on `defineExpose` for tests.

## 7. Tests

- `omsAdapter.spec`: `mapPostalAddress` maps/handles missing fields; `mapOrderToReturnable` surfaces
  `shippingAddress`; `listCountries`/`listStates` map the geo shape; `buildExchangeCreateBody` includes
  `shippingAddress` when present and omits it when absent.
- `stubAdapter.spec`: `ORDER.shippingAddress` present; `listCountries`/`listStates` return canned data
  (`[]` for unknown country); `createExchange` stores the address.
- `returnsStoreCrud.spec`: `loadCountries`/`loadStates`.
- `CreateReturn.spec`: SHIPPED prefills the address from the order; submit blocked until the address is
  valid; changing country loads states and clears the state; submit sends `shippingAddress`; IMMEDIATE sends
  none and shows no address block.

## 8. i18n (`locales/en.json`)

Add: "Shipping address", field labels ("Recipient", "Address line 1", "Address line 2", "City",
"State / Province", "Postal code", "Country", "Phone"), and any address validation copy.

## 9. Definition of done

- SHIPPED create form shows the order's shipping address as editable fields with working country→state
  dropdowns; IMMEDIATE shows none.
- Submit sends `shippingAddress` (geoIds) for SHIPPED; the stub stores it; unit tests green; `vue-tsc` clean.
- Wired against the stub now; lights up against the backend when items 1–3 of the backend prompt land.

## 10. Known backend gaps (tracked, not blocking)

Order-detail address, geo endpoints, and the `customerExchange` `shippingAddress` field may not exist yet —
the stub provides canned data and the body field is sent regardless, lighting up when the backend lands.
Endpoint paths/field names in §4 are the backend-prompt proposals and may be remapped after backend answers.
</content>
