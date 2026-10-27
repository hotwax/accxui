---
name: accxui-shopify-embedded
description: Use when an AccxUI app (apps/bopis, apps/fulfillment or a new one) runs embedded inside Shopify Admin or Shopify POS, or shows Shopify product images. Triggers include ShopifyLogin, ShopifyAppInstall, /shopify-login, /shopify-app-install, useShopify().openPosScanner, useEmbeddedAppStore().getPosLocationId, commonUtil.isAppEmbedded, @shopify/app-bridge, VITE_SHOPIFY_SHOP_CONFIG, VITE_SHOPIFY_SCOPES, VITE_SHOPIFY_REDIRECT_URI, a POS barcode scanner, hiding Logout when embedded, "Session expired. Refreshing...", and DxpShopifyImg.
---

# Shopify embedded apps

An app can run inside Shopify Admin / POS: Shopify loads it in an iframe, the framework exchanges a
Shopify session token for an OMS token, and the app then behaves as if logged in. Everything is in
`@common`; BOPIS and Fulfillment run embedded (`apps/bopis`, `apps/fulfillment`: same routes, guard and
`preLogout`). Follow BOPIS's wiring below; the older snippets in `docs/SHOPIFY_EMBEDDED_APPS.md` are out of date.

## Wiring an app

1. **Env** (names in `.env.example`, values from deploy):

   | Variable | What |
   |---|---|
   | `VITE_SHOPIFY_SHOP_CONFIG` | JSON map `{ "<shop>.myshopify.com": { "apiKey": "…", "maarg": "<maarg url>" } }`: one entry per shop the app is installed on |
   | `VITE_SHOPIFY_SCOPES` | OAuth scopes for install |
   | `VITE_SHOPIFY_REDIRECT_URI` | OAuth redirect URI for install |

2. **Routes**, using the shared components (never local copies):

   ```ts
   import { Login, ShopifyAppInstall, ShopifyLogin, commonUtil, useAuth } from "@common";

   const authGuard = () => {
     if (!useAuth().isAuthenticated.value) {
       return { path: commonUtil.isAppEmbedded() ? "/shopify-login" : "/login" };
     }
   };
   // { path: "/shopify-app-install", component: ShopifyAppInstall },
   // { path: "/shopify-login", component: ShopifyLogin },
   ```

3. **`main.ts`**: the usual `initialiseConfig({ postLogin, postLogout, preLogout, … , router })`
   (**accxui-auth**) and `pinia.use(piniaPluginPersistedstate)`: the embedded store is persisted.
   Nothing Shopify-specific goes in `main.ts` or `App.vue`.

4. **Dependencies**: `@shopify/app-bridge` and `@shopify/app-bridge-utils` come from the pnpm catalog
   (root `package.json`). An app that never embeds can stub them out in `vite.config.ts` as Company
   does (`COMMON_EXTERNALS` → `src/stubs/external.js`).

## How login works

- Shopify opens `/shopify-login?shop=…&host=…`. `ShopifyLogin` exchanges the Shopify session token
  (with the POS location and staff name when inside POS) for an OMS token on that shop's `maarg`,
  stores the session, awaits the app's `postLogin()` and routes to `/`. On failure it shows "Login failed".
- `/shopify-app-install?shop=…&host=…` (`ShopifyAppInstall`) sends the merchant to Shopify's OAuth
  page with `VITE_SHOPIFY_SCOPES` and `VITE_SHOPIFY_REDIRECT_URI`.
- Once logged in, `api()` and `commonUtil.isAppEmbedded()` work as usual; app code needs nothing extra.
- `isAuthenticated` skips the `oms` / `userId` cookie match when embedded (**accxui-auth**).

**Logout when embedded:** `logout()` keeps the token, toasts "Session expired. Refreshing...", resets
the embedded store and reloads `/shopify-login?shop=…&host=…&embedded=1`, which logs in again through
Shopify. So hide the app's own Logout button when embedded (BOPIS `views/Settings.vue`), and also any
link out to the OMS or the launchpad.

## What apps use

- `commonUtil.isAppEmbedded()`: show / hide by context, pick the login route.
- `useEmbeddedAppStore().getPosLocationId`: set only inside Shopify POS.
- `useShopify().openPosScanner()`: the POS camera scanner; resolves the scanned string, rejects when
  not inside POS or the device has no scanner.

The token exchange, App Bridge and OAuth install run inside `ShopifyLogin` / `ShopifyAppInstall`;
app code doesn't call them. Company's `@/composables/useShopify` is a different, app-local composable
(Shopify connection and sync screens).

## Recipes

**POS scanner, web camera elsewhere** (BOPIS `components/GiftCardActivationModal.vue`):

```ts
async function scan() {
  if (useEmbeddedAppStore().getPosLocationId) {
    try {
      code.value = await useShopify().openPosScanner();
    } catch (error) {
      logger.error(error);
    }
    return;
  }
  // open the app's web-camera scanner modal
}
```

**Show or hide by context:**

```html
<ion-button v-if="!commonUtil.isAppEmbedded()" @click="logout()">{{ translate("Logout") }}</ion-button>
<ion-item v-if="!commonUtil.isAppEmbedded() || useEmbeddedAppStore().getPosLocationId">…</ion-item>
```

**POS location scoping:** inside POS, restrict facility choices to the facility linked to
`posContext.locationId` (BOPIS `store/productStore.ts`, `fetchFacilityPreference` and the
`fetchShopifyShopLocation` filter); refuse with a message when the user isn't associated with it.

## `DxpShopifyImg` (any app)

`<DxpShopifyImg :src="product.mainImageUrl" size="small" />`. For Shopify CDN URLs it requests that
size (`_small` …); other URLs are used as is; a failed or missing image shows the default image.
It is the general product image component today (every app uses it).

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| A local copy of the Shopify login / install page | drifts from the token exchange | `ShopifyLogin` / `ShopifyAppInstall` from `@common` |
| The guard always sends to `/login` | embedded users see the OMS login inside Shopify | `/shopify-login` when `isAppEmbedded()` |
| A shop missing from `VITE_SHOPIFY_SHOP_CONFIG` | "Api Key not found", login fails | add the shop with its `apiKey` and `maarg` |
| Logout button shown when embedded | logout just reloads the Shopify login | hide it when embedded |
| `openPosScanner()` outside POS | rejects | check `getPosLocationId` first, else the web camera |
| Reading `?embedded=1` to decide embedded mode | nothing sets behaviour from it | `commonUtil.isAppEmbedded()` |
| Copying snippets from `docs/SHOPIFY_EMBEDDED_APPS.md` | imports that don't exist | follow BOPIS's wiring here |
