---
name: accxui-app-layers
description: "Use when writing or moving code in any AccxUI app (apps/company, apps/order-manager, apps/bopis, apps/fulfillment or a new one) and deciding where it belongs: a .vue page or component, a composable (src/composables), a Pinia store (src/store), a util (src/utils), the router, src/db or a worker. Triggers include adding an API call (api() / client()), writing a composable, store action, util or router guard, 'where should this request / logic live', a util that needs store data, a store that needs a composable, src/services, naming a composable or store, and lint errors ending 'See AGENTS.md (App layout)', 'Composable function names must start with 'use'', 'Store names must start with 'use' and end with 'Store'', or 'Calling 'api' directly in vue files is not allowed'."
---

# AccxUI app layers: where each kind of code lives

Every app follows the same layering, whether or not it has a local database. Reading and writing the
local app database (IndexedDB) is **accxui-app-db-access**; this skill is about which folder may do
what.

## Rules

1. **API calls live in composables and Pinia stores** (plus worker sync domains in apps with an app
   db). Never in a `.vue` file, util, router or `src/db`. A request a store needs is a store action;
   components call a composable or the store.
2. **App composables (`@/composables/*`) are used only by other composables and `.vue` files.** A
   store, util, router or worker never imports one (type-only imports are fine). *Why:* a composable
   may hold setup-time effects and per-tree state; outside setup it leaks or misbehaves.
3. **Framework helpers are plain functions, not app composables**: `useAuth`, `useSolrSearch`,
   `useNotificationStore`, `firebaseMessaging`, `commonUtil`, `translate`, `emitter`, … may be used
   from stores, the router and `.vue` files alike. The framework *composables* `useLiveEntity`,
   `useSeedData` and `useDbStatus` follow rule 2.
4. **Utils are pure.** No API calls, no Pinia stores, no app db, no composables. A util that needs
   store data, seed rows or a looked-up value takes it as a parameter; the caller passes it.
5. **Stores never call composables.** Logic a store and a composable both need goes in a plain module
   (a util, or a store action the composable calls).
6. **Stores and the app db stay apart** (apps with an app db): a store never imports an app db module
   (only `@/db/appDbSync`, to reconcile after a write), and `src/db` / `src/workers` never import a
   store. A page or composable joins the two.
7. **There is no `src/services/`.** API code goes in composables and stores, pure logic in `src/utils/`.
8. **Names:** a composable is `useThing` (file in `src/composables/`), a store is `useThingStore`.
9. **Worker code** (`src/db/**`, `src/workers/**`, apps with an app db) imports framework code by deep
   path only (`@common/db/schema/*`, `@common/core/workerRemoteApi`, …), never `@common`, `commonUtil`,
   `api()`, stores or composables (**accxui-app-db-setup**).

## Where code goes

| Code | Lives in | May use |
|---|---|---|
| An API call a store needs (shared state, used by several pages) | a Pinia store action | `api()`, other stores, utils, framework helpers |
| An API call only components need | a composable | `api()`, stores, other composables, utils |
| Screen state and behaviour | the `.vue` file, or a composable it calls | composables, stores, utils |
| Mapping, payload building, formatting, validation | `src/utils/` | parameters only |
| Route guards | `src/router` | stores, framework helpers (`useAuth`), utils; no API, no composables |
| Reading local app-db rows (apps with one) | a composable or `.vue` file | **accxui-app-db-access** |
| Writing the app db, polling the server | a worker sync domain | **accxui-app-db-setup** |

**A `.vue` file needs a one-off request and no composable owns it yet:** write one (below), or add
the action to the store that owns that data. Don't import `api` into the page.

**Store or composable?** A store when the data is shared across pages or must survive navigation
(the user, the current facility, a cart); a composable when one screen or a few components own it.

## Recipes

**A composable that owns a request:**

```ts
// src/composables/useReturnActions.ts
import { api, commonUtil } from "@common";

export function useReturnActions() {
  async function markReceived(returnId: string) {
    const resp: any = await api({ url: `oms/returns/${encodeURIComponent(returnId)}`, method: "put", data: { statusId: "RETURN_RECEIVED" } });
    if (commonUtil.hasError(resp)) throw new Error("Failed to mark the return received.");
    return resp.data;
  }
  return { markReceived };
}
// a .vue file: const { markReceived } = useReturnActions();
```

**A util that needs store data:** take it as a parameter.

```ts
// src/utils/index.ts
export const isKit = (product?: any): boolean => product?.productTypeId === "MARKETING_PKG_PICK";
// .vue: isKit(productStore.getProduct(item.productId))
```

**A store action that needs a composable's value:** the composable or page passes it in.

```ts
// composables/useTransfers.ts
const transferStore = useTransferStore();
const createTransfer = (facilityId: string) => transferStore.createTransfer(facilityId, currentFacilityTypeId.value);
```

## Making the call: `api()` and `client()`

`api(config)` (`common/core/remoteApi.ts`) is axios with the session attached. It copies **only**
`url`, `method`, `data`, `params`, `headers`, `responseType`, `baseURL` and `cache`; anything else
(`timeout`, `withCredentials`, …) is silently dropped.

| Need | Call |
|---|---|
| A Maarg / Moqui REST endpoint (`oms/…`, `admin/…`, `poorti/…`) | `api({ url: "oms/orders", method: "get", params })`: **the default `baseURL` is Maarg** (`commonUtil.getMaargURL()`, `…/rest/s1/`). Don't pass it |
| An OMS endpoint (OFBiz service names such as `findJobs`, `sendResetPasswordMail`) | `api({ baseURL: commonUtil.getOmsURL(), url: "findJobs", … })`. On Moqui-only instances `getOmsURL()` returns the REST base, so branch the url on `commonUtil.isMoqui()` when the two differ |
| A file / PDF from the Maarg host itself | `baseURL: commonUtil.getMaargBaseURL()`, `responseType: "blob"` |
| Response caching | `cache: true` (max age `VITE_CACHE_MAX_AGE`, default 0) |
| A call that must **not** carry the session (another instance, a token exchange) | `client({ baseURL, url, … })`: a fresh axios with no token, no auth check, no 401 logout, every option passed through |

- Every request except the login / profile / permission endpoints first checks `isAuthenticated`:
  when false it logs out and rejects `Error("INVALID_APP_CONTEXT")` (don't toast it). A `401` logs
  out (**accxui-auth**).
- `params` objects are JSON-stringified, arrays sent as repeated keys.
- **After every call:** `if (commonUtil.hasError(resp)) throw …` (an error body can arrive with HTTP
  200). The caller toasts a fixed `translate("Failed to …")` and `logger.error`s the error; there is
  no framework helper for extracting the server's message (**accxui-common-helpers**).
- **Paging:** Maarg lists take `pageSize` / `pageIndex` (0-based), older endpoints `viewSize` /
  `viewIndex`; Solr goes through `useSolrSearch` (**accxui-solr-search**). Loop until a page comes
  back short, with an upper bound.

```ts
// store action (Order Manager store/stock.ts): every page of a Maarg list. The total is in
// X-Total-Count, which the browser can't read, so a short page is the only end signal.
async fetchAllRows(url: string, params: Record<string, unknown>, pageSize = 250): Promise<any[]> {
  const rows: any[] = [];
  for(let pageIndex = 0; pageIndex < 20; pageIndex++) {
    const resp: any = await api({ url, method: "get", params: { ...params, pageIndex, pageSize } });
    if(commonUtil.hasError(resp)) {
      throw resp.data;
    }
    const page = Array.isArray(resp.data) ? resp.data : [];   // check the endpoint's shape: some wrap the list
    rows.push(...page);
    if(page.length < pageSize) {
      break;
    }
  }

  return rows;
}
```

In an app with an app db, a list that screens show is a sync domain, not a store loop
(**accxui-app-db-setup**).

## Code style

**Match the file you're in.** The root `eslint.config.js` style rules (double quotes, `if(` with no
space, a blank line before `return`, sorted imports) have drifted from the code: `pnpm lint` at the
root reports thousands of existing style problems, and most files use the opposite style. Style
errors are therefore not a regression signal, and a whole-file reformat is never part of a change.
The lint findings that matter are the layer, data-access, naming and translation-key rules (messages
ending "See AGENTS.md (App layout)" or "See docs/APP_DB_DEVELOPER_GUIDE.md §7", and "Translation key
… is missing in en.json"). In a new app, pick one style and keep it.

## Lint

Apps whose build runs the shared `dbConfig` (Company, Order Manager: `eslint src && …` before
`vite build`) fail the build on these; layer messages end with "See AGENTS.md (App layout)". An app
whose build doesn't lint (BOPIS, Fulfillment) still follows the rules for new code; their existing
violations and store-held caches are listed in **accxui-apps-without-app-db**.

| Rejected | Do instead |
|---|---|
| `import { api, client } from "@common"` (or `@common/core/remoteApi`) outside composables, stores and workers | call the composable or store action that owns the request |
| `@/composables/*` imported in a store, util, router, `src/db` or a worker | take what it needs as arguments; a page or composable passes it |
| a store (`@/store/*`, `pinia`) imported in a util, `src/db` or a worker | take the data as a parameter |
| a `use…Store()` call in a util | take the data as a parameter |
| an app db module (`@/db/<app>Db`) imported in a store or util | a composable joins store data with app-db rows (a store may import `@/db/appDbSync`) |

Only the root lint (`pnpm lint` at the accxui root, not an app build) also rejects:

| Rejected | Do instead |
|---|---|
| a function in `composables/*.ts` whose name doesn't start with `use` | `useThing` |
| a Pinia store not named `use…Store` | `useOrderStore` |
| calling `api(...)` / `client(...)` in a `.vue` file by a name the import rule doesn't see | the composable or store action that owns the request |

## Before you finish

- [ ] API calls only in composables and store actions (and worker domains); none in `.vue`, utils or the router.
- [ ] No app composable in a store, util, router or worker; no composable call inside a store.
- [ ] Utils take what they need as parameters: no store, app db, API or composable.
- [ ] New composables are `useX`, new stores `useXStore`; nothing added under `src/services/`.
- [ ] `pnpm build` passes in the app (it lints first where the app has `dbConfig`).
