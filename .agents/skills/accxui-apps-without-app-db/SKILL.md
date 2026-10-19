---
name: accxui-apps-without-app-db
description: Use when changing apps/bopis or apps/fulfillment, or any AccxUI app with no src/db (no IndexedDB app database), where server and reference data live in Pinia stores. Triggers include useUtilStore, getStatusDesc / fetchStatusDesc, enumerations, facilityTypeDesc, useProductStore / useProduct, cached products, getProduct, fetchProducts, productStore.ts, persist / persistedstate, $reset in postLogout, DxpFacilitySwitcher, DxpProductStoreSelector, DxpOmsInstanceNavigator, DxpProductIdentifier, DxpTimeZoneSwitcher, DxpLanguageSwitcher, DxpAppVersionInfo, Fulfillment's src/index.ts, module federation (fulfillment_extensions, useDynamicImport, VITE_REMOTE_ENTRY), catalog:ionic7, Zebra / BrowserPrint / useZebraPrinter, BOPIS tabs, meta.menuIndex, the next('/shopify-login') guard, an app whose build doesn't lint, and "should this app use useSeedData / useLiveEntity".
---

# Working in an app without an app database (BOPIS, Fulfillment)

BOPIS (`apps/bopis`) and Fulfillment (`apps/fulfillment`) predate the app database: they have no
`src/db`, no sync worker, and keep server and reference data in persisted Pinia stores. Work **with**
that pattern when changing them; a **new** app is built like Company / Order Manager instead
(**accxui-new-app**). Each is its own git repo.

## Rules

1. **No app-db APIs here.** `useLiveEntity`, `useSeedData`, `useDbStatus`, `useProductMaster`,
   `refreshAfterMutation` all need an app db and its worker; in these apps they read nothing or
   throw. Labels and lookups come from the app's stores (below).
2. **Reuse the store that already caches the data.** A status label is `useUtilStore().getStatusDesc`
   in Fulfillment, a product is `getProduct(id)` from the product store. Adding a second fetch or
   cache for the same data (or `useProducts()` beside the product store) splits the truth.
3. **New code follows the layer rules** (**accxui-app-layers**) even though the build doesn't
   enforce them: API calls in store actions or composables, none in `.vue` files or utils; utils
   take store data as parameters; stores don't import composables. Don't add to the existing
   violations (end of this file); fix one only when you're already changing that code for the task.
4. **Session data is reset on logout.** A new store holding user or tenant data gets a `$reset()`
   line in the user store's `postLogout` (Fulfillment resets ten stores there; follow the list).
5. **Moving one of these apps onto an app database is its own project.** Ask first; then
   **accxui-app-db-setup** and **accxui-new-app** (lifecycle wiring) apply.
6. **Lint the files you change** from the app folder: `npx eslint src/path/File.vue`. The apps'
   `.eslintrc.js` is ignored by ESLint 10, so this runs the root `eslint.config.js` (layer, naming,
   i18n and style rules). Existing files report hundreds of style errors that are not yours: read
   only the layer, data-access and translation-key messages, and never reformat whole files.

## Where data lives

| Data | Fulfillment | BOPIS |
|---|---|---|
| Statuses, enums, shipment method / facility / payment method types, party names, carriers, facility addresses | `store/util.ts` (`useUtilStore`): one map per kind (`statusDesc`, `enumerations`, `shipmentMethodTypeDesc`, `facilityTypeDesc`, …), filled lazily by `fetch…(ids)` for ids not cached yet, read with `get…Desc(id)` getters | per-screen fetches in the stores (`order.ts`, `productStore.ts`); a few in views |
| Products | `store/product.ts` (`useProductStore`, imported as `useProduct`): `cached` map, `fetchProducts({ productIds })` skips cached ids, `getProduct(id)` | `store/product.ts`: `fetchProducts`, `getProduct`, `findProduct` |
| Facilities, product stores, their preferences | `store/productStore.ts` (**also** exported as `useProductStore`, id `"productStore"`): `currentFacility`, `fetchUserFacilities`, `fetchProductStores`, `fetchProductStorePreference` | `store/productStore.ts` |
| User, permissions, locale, time zone | `store/user.ts` (**accxui-auth**, **accxui-permissions**) | `store/user.ts` |
| Orders and the rest | `order`, `orderLookup`, `transferorder`, `rejection`, `stock`, `carrier` stores; Solr through `useSolrSearch` (**accxui-solr-search**) | `order`, `stock` stores |

**Recipe: a label in Fulfillment**

```ts
// the page
const utilStore = useUtilStore();
watch(orders, (list) => { void utilStore.fetchStatusDesc(list.map((order) => order.statusId)) }, { immediate: true });
// template: {{ utilStore.getStatusDesc(order.statusId) }}
```

Fetch once for the visible ids, read through the getter; never call the API per row.

**Persistence:** stores use `persist: true` (pinia-plugin-persistedstate **v4**). To persist part of a
store, v4 takes `persist: { pick: ["a", "b"] }`; Fulfillment's `util.ts` passes the v3 option
`paths`, which v4 ignores (the whole store persists). Don't copy `paths`.

## App-specific wiring

**Fulfillment**
- `src/main.ts` is only `import("./index")`; the real bootstrap is `src/index.ts`. Module federation
  needs that async boundary. Put app setup in `index.ts`, and keep `main.ts` a single import.
- Ionic **7.6** (`catalog:ionic7` in `pnpm-workspace.yaml`; every other app has Ionic 8 from
  `catalog:`). Check that an Ionic API or component prop exists in 7 before using it. Moving it to 8
  is its own change: ask.
- Per-instance extensions load through module federation: `App.vue` calls `init({ name:
  "fulfillment", remotes: [{ name: "fulfillment_extensions", entry: import.meta.env.VITE_REMOTE_ENTRY,
  type: "module" }] })`, and a view loads one with `moduleFederationUtil.useDynamicImport({ scope:
  "fulfillment_extensions", module: \`${instance}_OrderInvoice\` })` (returns `undefined` when the
  instance has none: render the default then). `vite.config.ts` shares `vue`, `pinia`, `vue-router`,
  `@ionic/*`, `vue-logger-plugin` as singletons; a new shared runtime library goes there too.
- Zebra label printing: `index.html` loads the BrowserPrint scripts; `composables/useZebraPrinter`
  wraps them.
- The menu is built in `App.vue` from `router.getRoutes()` with `meta.menuIndex` (plus `title`,
  `icon`, `childRoutes`, `groupMenuName`, `isDivider`) and filtered by `hasPermission(meta.permissionId)`.
  A new page gets a menu entry by its route meta, not by editing the menu template.

**Both**
- Embedded in Shopify (**accxui-shopify-embedded**): `/shopify-login`, `/shopify-app-install`, and an
  `authGuard(to, from, next)` that sends to `/shopify-login` when `commonUtil.isAppEmbedded()`.
- Push notifications (**accxui-push-notifications**).
- Settings cards are **app-local copies** of the same components: `DxpAppVersionInfo`,
  `DxpFacilitySwitcher`, `DxpOmsInstanceNavigator`, `DxpProductIdentifier`, `DxpTimeZoneSwitcher`,
  `DxpLanguageSwitcher` (Fulfillment also `DxpProductStoreSelector`) in `src/components/`. They
  are not in `@common`, and the BOPIS and Fulfillment copies have drifted apart (only the language and
  time-zone ones are identical). Change the copy in the app you're in. A fix both apps need is made in
  both, or proposed as a move into `common/` (**accxui-framework-change**).

**BOPIS**
- Tabs, not a side menu: `views/Tabs.vue` (`ion-tabs` with a bottom `ion-tab-bar`).
- End-to-end tests only, with Playwright against deployed environments (**accxui-app-testing**);
  every interactive element gets a `data-testid` per `apps/bopis/testidguideline.md`.

**Dates:** Fulfillment's `setUserTimeZone` doesn't update Luxon's `Settings.defaultZone`, so
`commonUtil.getDateAndTime` keeps the old zone after a switch. Format with
`commonUtil.formatUtcDate(value, userStore.getCurrentTimeZone, format)` there.

**Translation keys:** follow the app's `en.json` (often a key without its placeholder, the value with
it). The key lint checks only `translate("…")` in script, so check template keys yourself.

## Known violations (don't copy them)

| Where | What | The rule instead |
|---|---|---|
| Fulfillment `components/DownloadRejectedOrdersModal.vue`, `views/CreateTransferOrder.vue`; BOPIS `views/OrderDetail.vue` | `api()` in a `.vue` file | a store action or composable |
| Fulfillment `views/OpenOrders.vue`, `AssignPickerModal.vue`, `components/EditPickersModal.vue`, `DownloadRejectedOrdersModal.vue` | `useSolrSearch()` queries built in the view | a store action or composable |
| Fulfillment `utils/orderUtil.ts`, `utils/firebaseUtil.ts` | utils reading stores | take the data as a parameter |
| Fulfillment `store/order.ts`, `orderLookup.ts`, `transferorder.ts` | stores importing `useZebraPrinter` | a plain module both can import |
| Fulfillment `store/product.ts` + `store/productStore.ts` | two stores exported as `useProductStore` | import with distinct local names; a new store gets a unique `use…Store` name |
| BOPIS `src/router/index.ts` | imports the Node-only `versionInfoUtil` | only `vite.config` uses it |

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| `useSeedData()` / `useLiveEntity()` in BOPIS or Fulfillment | empty labels, or a throw: there is no app db | the app's util / product / productStore stores |
| A new fetch of statuses or products in a view | a second cache, one API call per screen | the existing store's `fetch…(ids)` + getter |
| A new store with session data and no `$reset()` in `postLogout` | the next user sees it | add it to `postLogout` |
| `persist: { paths: [...] }` | ignored: the whole store persists | `persist: { pick: [...] }` |
| Fulfillment setup code added to `main.ts` | breaks the module-federation boundary | `src/index.ts` |
| An Ionic 8-only API in Fulfillment | runtime error or a no-op | check Ionic 7.6 |
| Editing one app's `Dxp*` copy and assuming the other changed | the apps drift further | change both, or propose moving it into `common/` |
| `pnpm build` passing taken as "lint clean" | the build doesn't lint | `npx eslint <changed files>` |

## Before you finish

- [ ] Data read through the store that already caches it; no app-db API used.
- [ ] No new `api()` in `.vue`, no store in a util, no composable in a store.
- [ ] New session-scoped stores reset in `postLogout`.
- [ ] `npx eslint <changed files>` shows no new layer / data-access / translation-key errors; `pnpm build` passes.
