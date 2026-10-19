---
name: accxui-fast-travel
description: Use when an AccxUI app (any app under apps/* or a new one) links to another HotWax app, mounts the Cmd/Ctrl+K app switcher, or registers a new app in the suite. Triggers include FastTravel, current-app, useFastTravel, openApp, buildAppUrl, getFastTravelApps, getFastTravelApp, fastTravelRegistry.ts, VITE_LAUNCHPAD_URL, VITE_ORDER_MANAGER_URL, VITE_ORDER_ROUTING_URL, VITE_JOB_MANAGER_URL, VITE_COMPANY_URL, VITE_PRODUCTS_URL, VITE_TRANSFERS_URL, VITE_CYCLE_COUNT_URL, VITE_PREORDER_URL, a "view in Company / Order Routing" link, a hardcoded https://<app>.hotwax.io URL, "Go to Launchpad", or a palette entry that opens the wrong host.
---

# Fast Travel: links between HotWax apps

`common/utils/fastTravelRegistry.ts` is the one list of suite apps and their URLs. The palette
(`<FastTravel>`) and every cross-app link read it, so no app hardcodes another app's URL.

## Rules

1. **Never hardcode another app's URL.** `buildAppUrl(appId, path?, query?)` or
   `useFastTravel().openApp(appId, { path, query, newTab })`. *Why:* URLs differ per deployment and
   are overridden by env; the registry applies that.
2. **Ids are the registry's** (`launchpad`, `order-manager`, `order-routing`, `job-manager`,
   `company`, `products`, `preorder`, `transfers`, `cycle-count`). BOPIS and Fulfillment aren't in it
   yet: add them (below) before linking to them.
3. **`buildAppUrl` returns `null`** for an unknown id: hide or disable the link then, never render
   `href="null"`. A blank or missing `VITE_*_URL` override falls back to the production URL in the
   registry, so a registered app always has one; an override must be the app's base URL (Order
   Manager's `.env.example` sets `VITE_LAUNCHPAD_URL` to `…/login`, which makes the palette's
   Launchpad entry open the login page).
4. **Mount the palette once**, in `App.vue` inside `<ion-app>`: `<FastTravel current-app="<id>" />`
   (Company and Order Manager do; BOPIS and Fulfillment don't yet).

## Recipes

```ts
import { buildAppUrl, useFastTravel } from "@common";

// a link (template: <ion-button v-if="carriersUrl" :href="carriersUrl" target="_blank">)
const carriersUrl = computed(() => buildAppUrl("company", "/carriers"));

// open from a handler; newTab uses window.open(…, "_blank", "noopener")
const { openApp } = useFastTravel();
openApp("order-routing", { path: `/inventory/${productId}`, query: { facilityId }, newTab: true });
```

Empty `query` values are dropped. A pure util that builds a link (Company's
`utils/shopifyTransferSync.ts`) may call `buildAppUrl`: it is a pure function.

"Go to Launchpad" on Settings reads `VITE_LOGIN_URL` in the existing apps
(`window.location.href = import.meta.env.VITE_LOGIN_URL || "/"`); follow the app you're in. A new
app may use `buildAppUrl("launchpad")`.

## Adding an app to the registry (a framework change)

In `common/utils/fastTravelRegistry.ts`, one commit in accxui (**accxui-framework-change**):

1. `URLS`: `inventoryAudit: configuredUrl(import.meta.env.VITE_INVENTORY_AUDIT_URL, "https://inventory-audit.hotwax.io")`.
   Read `import.meta.env.VITE_…` with a **literal** key: Vite inlines only literal keys.
2. `APPS`: `{ id: "inventory-audit", name: "Inventory Audit", description: "Audits & count sheets", icon: clipboardOutline, color: "success", baseUrl: URLS.inventoryAudit }`
   (an `ionicons/icons` import, an Ionic color; `name` and `description` are English and translated
   when shown: add both as keys in every app that mounts the palette, and in Order Manager's
   `en-US.json` / `es-ES.json` (**accxui-framework-change**, rule 9)). Ask for the production URL;
   don't guess it.
3. List `VITE_INVENTORY_AUDIT_URL=` (blank) in the `.env.example` of each app that overrides URLs.
4. In the new app: `<FastTravel current-app="inventory-audit" />` in `App.vue`.

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| `https://company.hotwax.io/carriers` in a template | wrong host on UAT / other deployments | `buildAppUrl("company", "/carriers")` |
| Using `buildAppUrl`'s result without a null check | a broken `null` link | `v-if` on the url |
| `import.meta.env[\`VITE_${name}_URL\`]` | always undefined in the build | a literal key per app |
| `<FastTravel>` in a page or the menu | several palettes, duplicate Cmd+K handlers | once in `App.vue` |
| `current-app` not matching a registry id | the current app isn't marked, and shows as a target | the registry id |
