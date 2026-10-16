---
name: accxui-seed-data
description: Use when AccxUI app code (apps/company, apps/order-manager or a new app) shows labels or option lists from framework reference data (statuses, enums, facilities, facility types, geos / countries / states, carriers, shipment and payment method types, product stores, return types, status transitions, Shopify shops), or builds the Settings data / cache status card. Triggers include useSeedData, seed.statusDescription, enumsByType, facilityName, statesForCountry, allowedTransitions, .withSync, getFacilities / getFacilityTypes, a store or util that needs seed rows, a label showing a raw id, an "empty" message showing before data loads, useDbStatus, statusCatalog, catalogFrom, refreshDomain / refreshAll, the error "useSeedData() only works during setup", and the lint error "No useSeedData() in App.vue".
---

# Seed labels (`useSeedData`) and the data status card (`useDbStatus`)

Both are framework composables from `@common/db`, built on `useLiveEntity`. Call them only in a
`.vue` file or a composable, **during setup**. Picking seed tables into the app db is
**accxui-app-db-setup**; everything else about reading app data is **accxui-app-db-access**.

## `useSeedData()`

```ts
import { useSeedData } from "@common/db";
const seed = useSeedData();          // during setup, in the page or component that shows the labels
```

- **One read per table per component tree.** The first `useSeedData()` in a tree opens a live read
  of each table the first time a getter touches it, and provides itself; every component below that
  calls `useSeedData()` gets the same instance. A page with 200 cards holds one query per table. The
  reads close when the providing component unmounts. Two sibling components with no calling ancestor
  each open their own, so call it in the page as well when several of its children need labels.
- **During setup only.** Outside setup (a click handler, `setTimeout`, a `watch` callback, an async
  function after an `await`) it throws `[seed] useSeedData() only works during setup`. Call it once in
  setup and use that `seed` everywhere in the component.
- **Never in `App.vue` or a layout** (lint rejects `App.vue`): every component would inject that one
  instance and every seed table would stay open for the session.
- **Not in stores, utils, the router or workers** (lint). They take the rows as arguments (below).
- **Only seed tables the app picked.** A table not in the app db reads as empty: lists `[]`, labels
  the raw id. An app's own tables (`productTypes`, …) are read with `useLiveEntity`, not here.

### Getters

**Reactive** (no prefix): synchronous; in a template or `computed` they re-render when the table
changes. On a cold table, or for an id with no row, a label getter returns the **raw id** (`""` for a
missing id) and a list getter returns `[]`.

| Getter | Returns |
|---|---|
| `statusDescription(statusId)` | label |
| `statuses()`, `statusItemsByType(statusTypeId)` | rows |
| `enumDescription(enumId)` | label |
| `enums()`, `enumTypes()`, `enumsByType(enumTypeId)`, `enumsByParentType(parentTypeId)` | rows |
| `orderIdentificationTypeOptions()` | `{ enumId, description }[]` (type `ORDER_IDENTITY`) |
| `facilityName(facilityId)` | label (`facilityName`, else the id) |
| `facility(facilityId)`, `facilityType(facilityTypeId)` | one row or `undefined` |
| `facilities()`, `facilityTypes()` | rows |
| `productStoreName(productStoreId)` | label (`storeName`, else `companyName`) |
| `productStoreFacilities(productStoreId)` | rows |
| `carrierName(partyId)`, `carriers()`, `shipmentMethodsByCarrier(carrierPartyId)` | label / rows |
| `shipmentMethodDescription(id)`, `shipmentMethodTypes()`, `shipmentMethodOptions()` | label / rows / `{ id, label }[]` |
| `paymentMethodDescription(id)`, `paymentMethodTypes()` | label / rows |
| `returnReasonDescription(id)`, `returnTypeDescription(id)`, `returnItemTypeDescription(id)` | label |
| `contactPurposeDescription(id)`, `communicationEventTypeDescription(id)`, `partyRelationshipDescription(id)`, `orderAdjustmentTypeDescription(id)` | label |
| `roleTypes()`, `partyRelationshipTypes()` | rows |
| `allowedTransitions(statusId, statusFlowId?)` | transitions out of a status in one flow (`Default` unless named), in sequence, each with `toStatusDescription` |
| `geoName(geoId)`, `geos()`, `countries()`, `states()` | label / rows (sorted by name) |
| `statesForCountry(countryGeoId)`, `dbicCountries()` | rows (`geoAssocs` + `geos`) |
| `shopifyShops()`, `shopifyShopLocations()` | rows |

**`.withSync(...)`**: every **list** getter (not the label or single-row getters) also has it, with
the same arguments. It returns `{ data, synced }`; `synced` is true once every table behind the
getter holds this login's sync. Those are the getter's own table, except `statesForCountry` and
`dbicCountries` (`geos` + `geoAssocs`), `enumsByParentType` (`enumTypes` + `enums`) and
`allowedTransitions` (`statusFlowTransitions` + `statuses`). Use it where an empty list drives what
the user sees:

```ts
const seed = useSeedData();
const states = computed(() => seed.statesForCountry.withSync(countryGeoId.value));
// template
//   <ion-skeleton-text v-if="countryGeoId && !states.synced" />
//   <p v-else-if="countryGeoId && !states.data.length">{{ translate("This country has no states") }}</p>
//   <ion-select-option v-for="state in states.data" :key="state.geoId" :value="state.geoId">{{ state.geoName }}</ion-select-option>
```

**Async** (`get` prefix): read the table's current rows once and resolve; not reactive. For an
action that needs rows *now*, or to pass to a store:
`getFacilities()`, `getFacilityTypes()`, `getGeos()`, `getPaymentMethodTypes()`,
`getEnumsByType(enumTypeId)`, `getProductStoreFacilities(productStoreId)`,
`getFacilityParentTypeIds(facilityTypeIds)` (→ `{ [facilityTypeId]: parentTypeId }`),
`getStatesForCountry(countryGeoId)`.

### Recipe: a page and its cards

```vue
<!-- OrderDetail.vue -->
<script setup lang="ts">
import { computed } from "vue";
import { useSeedData } from "@common/db";
const seed = useSeedData();                                      // provides to every child below
const salesChannels = computed(() => seed.enumsByType("ORDER_SALES_CHANNEL"));
</script>
<template>
  <p>{{ seed.statusDescription(order.statusId) }} · {{ seed.enumDescription(order.salesChannelEnumId) }}</p>
  <p>{{ seed.facilityName(order.facilityId) }}</p>
  <ion-select :value="order.salesChannelEnumId">
    <ion-select-option v-for="channel in salesChannels" :key="channel.enumId" :value="channel.enumId">
      {{ channel.description || channel.enumId }}
    </ion-select-option>
  </ion-select>
  <OrderItemCard v-for="item in order.items" :key="item.orderItemSeqId" :item="item" />
</template>

<!-- OrderItemCard.vue: injects the page's instance, opens nothing -->
<script setup lang="ts">
import { useSeedData } from "@common/db";
const seed = useSeedData();
</script>
<template><ion-note>{{ seed.statusDescription(item.statusId) }}</ion-note></template>
```

This page holds three reads (statuses, enums, facilities), however many cards it renders.

### Recipe: a store action or util that needs seed rows

The store never reads the app db; the composable or page reads the rows and passes them:

```ts
// composables/useTransfers.ts
export function useTransfers() {
  const seed = useSeedData();                                    // setup
  const transferStore = useTransferStore();
  async function createTransfer(facilityId: string) {
    const typeId = seed.facility(facilityId)?.facilityTypeId;   // or (await seed.getFacilities()).find(…)
    return transferStore.createTransfer(facilityId, typeId);
  }
  return { createTransfer };
}
```

A util takes the rows or the looked-up value as a parameter in the same way.

### Wrappers and new getters

- An app may wrap getters in its own composable to keep shapes its templates use (Company's
  `composables/useSeed.ts`: `useStatuses()`, `useTypedEnums(type)`, …). Each wrapper calls
  `useSeedData()` itself, so it too only works during setup.
- A lookup every app needs belongs in the framework: add it to `createSeedLookups` in
  `common/db/composables/useSeedData.ts` (built with `listGetter([...tables], read)` for a list, so it
  gets `.withSync`), and the table to `SEED_TABLES` if it's new. That is a framework commit, separate
  from the app's.

## `useDbStatus()`: the Settings data status card

```ts
import { catalogFrom, useDbStatus } from "@common/db";
import { appDb } from "@/db/appDb";
import { resyncDomain, resyncReferenceData } from "@/db/appDbSync";

const { domains, loaded, catalogLoaded, refreshing, totalRows, oldestSyncedAt, lastSyncedAt, refreshDomain, refreshAll } =
  useDbStatus(
    appDb.client(),                                              // the one place app code may call client()
    async () => catalogFrom((await import("@/workers/appSyncDomains")).appSyncDomains),
    { resyncDomain, resyncAll: resyncReferenceData },
  );
```

**Arguments**

1. `appDb.client()`. (A raw `BaseDB` is still accepted for old callers, but getting one needs
   `appDb.get()`, which lint rejects in app code.)
2. The catalog, the domains to list:
   - an app with its own domains (or overridden seed domains): the async `catalogFrom(appSyncDomains)`
     above. It lists exactly what the worker registers, and works before the worker is up or after
     it failed to start. Import it lazily, to keep domain code out of startup;
   - an app with seed tables only and no domains of its own: `appDb.statusCatalog` (Company and
     Order Manager both have own domains, so both use `catalogFrom`);
   - omitted: every framework seed domain, including tables the app doesn't have. Don't.
3. `{ resyncDomain, resyncAll }` from `@/db/appDbSync`. Omitted, the Refresh buttons do nothing.

**Returns**

| Field | Meaning |
|---|---|
| `domains` | `Ref` of `{ name, table, label, syncClass, count, syncedAt, status }`, one per catalog entry, live |
| `status` | `"success"`: has rows. `"empty"`: 0 rows and synced, or a class A domain with 0 rows (it only fills while a screen polls it). `"none"`: 0 rows, never synced (a class C domain no screen has asked for yet reads this way) |
| `syncedAt` | epoch ms of the domain's last recorded sync, or `null` |
| `loaded` / `catalogLoaded` | the first count read landed / the catalog resolved |
| `refreshing` | `null`, a domain name while `refreshDomain` runs, or `"*"` during `refreshAll` |
| `totalRows`, `oldestSyncedAt`, `lastSyncedAt` | across all listed domains |
| `refreshDomain(name)` | `resyncDomain(name)`: a forced full pass of that domain |
| `refreshAll()` | `resyncReferenceData()`: clears every sync marker and re-runs every active domain |

**Refresh buttons:** classes A and B get one; class C doesn't (it has no full pass, it fetches one
record when a screen asks), so show "fetched when opened" instead. Disable all buttons while
`refreshing` is set. The template to copy is Company's `src/views/Settings.vue`.

`useDbStatus` closes its live read on unmount. Like the others, it is for `.vue` files and
composables, not stores (lint).

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| `useSeedData()` inside a handler, `watch` callback or after an `await` | throws "only works during setup" | call it once in setup, use that `seed` |
| `useSeedData()` in `App.vue` or a layout | every seed table open for the session (lint rejects `App.vue`) | call it in the page |
| Each card calls `useSeedData()` with no call in the page | one set of reads per card | call it in the page too |
| "No states" / "No facilities" while the table is still syncing | wrong empty state after login | `.withSync(...)` and wait for `synced` |
| Reading `seed.getFacilities()` in a `computed` | never updates, a Promise in the template | reactive `seed.facilities()` |
| `useSeedData` / `loadSeedData` / app db reads in a store or util | lint error | the composable passes the rows as an argument |
| `useSeedData` for the app's own table | always empty | `useLiveEntity(appDb.tables.x)` |
| A label showing the raw id | the table isn't picked, the row isn't synced yet, or the row has no label field | pick the table; it fills after the login sync |
| `useDbStatus(appDb.client())` with no catalog | lists every framework seed domain, most with 0 rows | `catalogFrom(appSyncDomains)` or `appDb.statusCatalog` |
| No actions argument | Refresh buttons do nothing | `{ resyncDomain, resyncAll: resyncReferenceData }` |
| A Refresh button on class C rows | it re-runs nothing | "fetched when opened", no button |
