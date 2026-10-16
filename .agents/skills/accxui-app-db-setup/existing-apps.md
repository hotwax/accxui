# The app databases that exist today: Company and Order Manager

Only these two apps have an app database (as of 2026-10-16: Company at `version: 6`, Order Manager at
`version: 4`; always read the current value in the file before bumping it). Change them in place, in the files below; don't add new
files or folders for something one of these already holds. Paths are under `apps/<app>/`.

## Company (`apps/company`)

| File | Holds | Add here when… |
|---|---|---|
| `src/db/companyDb.ts` | `companyDb = defineAppDb({ suffix: "CompanyDB", version, schema: mergeSchemas(commonSchema.pick([...COMPANY_SEED_TABLES]), companySchema) })`; `COMPANY_SEED_TABLES` (the picked seed tables); the `vN:` history comments | picking another seed table; **every schema change: bump `version` and add a `vN:` line** |
| `src/db/companySchema.ts` | `companySchema = defineSchema({...})`: every own table, grouped by section comments (class A; class B reference / config; lookup / type reference; per-store aggregate; NetSuite order push; composite-key tables; Shopify fulfillment sync); shared `INVENTORY_LEDGER_FIELDS` / `INVENTORY_LEDGER_INDEXES` | a new own table (in the section that matches it), a field or index on an own table |
| `src/db/appDbSync.ts` | `setupAppDbSync(...)` and its exports, class A functions included | never, normally |
| `src/workers/appSyncDomains.ts` | `OVERRIDDEN_SEED_TABLES` (`carriers`, `carrierShipmentMethods`, `shopifyShops`, `facilityGroups`, `statuses`), the derived `companySeedDomains`, and `appSyncDomains` (every registered domain) | **every new domain is added to this array** |
| `src/workers/appSync.worker.ts` | `registerDomains(appSyncDomains)` + `exposeWorkerHarness` (registers the resolver in the worker) | never |
| `src/workers/domains/referenceDomains.ts` | `referenceDomains: SyncDomain[]`: every class B `defineSnapshotDomain` (organizationRelationship, serviceJob, inventoryEventDocument, systemMessageRemote, the seed overrides carrier / carrierShipmentMethod / shopifyShop / facilityGroup / status, carrierFacility, permission, integrationTypeMapping, the lookup map userGroup / productType / currency / systemMessageType, shopifyLocation, shopifyTypeMapping, productStoreShipmentCount, shopifyCarrierShipment, enumGroupMember, facilityIdentification, productStoreShippingMethod, facilityGroupProductStore, app, appVersion) | **a new class B table from one list endpoint**: add a `defineSnapshotDomain` entry here (no new file, no `appSyncDomains` change: the array is spread in). A plain lookup list goes in the lookup map |
| `src/workers/domains/<thing>Domain.ts` | one hand-written domain (or a small family) per file: dataManagerLog, systemMessage, systemMessageError (C), shopifyBulkOperation (C), dataManagerErrorRecord (C: DataManager error files, 2 h expiry), serviceJobRun, syncRun, productUpdateHistory, organization (B, fan-out), shopifyInventoryMonitoring (B: dataFeeds, inventoryChannels), inventoryEventDomains (A family), shopifyTransferSync, shopifyTransferDelivery, shopifyFulfillmentHistory, shopifyPendingFulfillment, shopifyFulfillmentHealth, shopifyOrderSyncHistory, netSuiteOrderPush | **a class A or C domain, or a class B needing several calls**: a new file here, then add it to `appSyncDomains` |
| `src/config/appSyncConfig.ts` | domain-name constants some domains and screens share (e.g. `INVENTORY_EVENT_DOMAINS`) | a family of domains whose names screens also use |

- Class A domains are all hand-written with `defineSyncDomain` (none uses `defineCursorDomain`).
- `main.ts`: `companyDb.setOmsInstanceResolver(() => commonUtil.getOMSInstanceName())`. `App.vue` starts the
  sync on `isAuthenticated`; `store/user.ts` `postLogin` stops then starts it, `postLogout` stops it.
- Tests: `tests/db/` (wiring spec with `filledBy` and `unfilled`, `companyDb.spec.ts` asserts the store
  count: **update it when you add a table**, `companySchema.spec.ts`, `domainTables.spec.ts`,
  `restoredFields.spec.ts`, `appDbSync.*.spec.ts`) and `tests/workers/` (one spec per domain family:
  add one for a new domain).
- A table filled by a domain whose `table` is another one goes in the wiring spec's `filledBy`
  (`netSuiteDecisionRules` → `netSuiteOrderPush`, …).

## Order Manager (`apps/order-manager`)

| File | Holds | Add here when… |
|---|---|---|
| `src/db/orderManagerDb.ts` | `orderManagerDb = defineAppDb({ suffix: "OrderManagerDB", version, schema: commonSchema })`: **the whole common schema** (seed reference tables and the `products` master), **no own tables**; `getOrderManagerDb(oms)` for the worker; the `vN:` history comments | a schema change: bump `version` with a `vN:` line |
| `src/db/appDbSync.ts` | `setupAppDbSync(...)`; exports only start / stop / `refreshAfterMutation` / `resyncDomain` / `resyncReferenceData` / `bootstrapState` (no class A functions) | the first class A domain: also export `activateSyncDomains` and the rest |
| `src/workers/appSync.worker.ts` | `registerDomains(Object.values(commonDomains))` (the `product` domain included) + `exposeWorkerHarness` (registers the resolver in the worker, which the product domain writes through) | — |
| `src/composables/useProductIdentity.ts` | names products the Settings product-identifier way (`primaryId` / `secondaryId`, …) over the framework's `useProductMaster`, which screens call directly (**accxui-product-search**) | — |

- No `src/workers/domains/`, no own schema, no `appSyncDomains.ts` today. **Order Manager's first own
  table** means following the Company layout: `src/db/orderManagerSchema.ts`, `mergeSchemas(commonSchema,
  orderManagerSchema)`, `src/workers/appSyncDomains.ts` (seed domains + own), the worker registering
  that list, and `src/workers/domains/`. Ask before starting it.
- `main.ts` sets the resolver and also registers the seed domains on the main thread.
  `App.vue`'s `isAuthenticated` watch fetches permissions and starts the sync; `store/user.ts` as in Company.
- The Settings status card lists `orderManagerDb.statusCatalog` (every seed table, Products included);
  class C rows read "fetched when shown" and have no Refresh button.
- Tests: `tests/db/` only (wiring spec, `orderManagerDb.spec.ts`, `projections.spec.ts`,
  `syncCatalog.spec.ts`, `syncDomainUrls.spec.ts`, `aliasImports.spec.ts`).

## Both

- Build: `eslint src && pnpm check:wiring && vite build`; `pnpm test:unit` runs every spec.
- Files under `src/db` and `src/workers` import framework code by deep path (`@common/db/schema/*`,
  `@common/db/sync/*`, `@common/core/workerRemoteApi`); the worker chunk must not pull in `vue` or
  `commonUtil`. Follow that in new files even where an older domain still imports a helper from `@common/db`.
