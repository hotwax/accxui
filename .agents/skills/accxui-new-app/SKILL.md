---
name: accxui-new-app
description: Use when creating a new AccxUI app under apps/* (a new HotWax PWA on the accxui framework), or when an existing app's shell is missing a piece or diverges (main.ts, App.vue, router, user store, vite.config, tsconfig, eslint.config.js, index.html, manifest.json, firebase.json, .env.example, CI workflows, Settings page). Triggers include "new app", "scaffold", "bootstrap", "start an app like Order Manager / Company", createApp, IonicVue, initialiseConfig, createDxpI18n, piniaPluginPersistedstate, router.isReady, Login route, authGuard, checkAppVersionRedirect, postLogin / postLogout, fetchUserProfile, fetchPermissions, VITE_APP_VERSION_CONFIG, VITE_APP_PERMISSION_ID, commonEnvPlugin, localApiServerDiscoveryPlugin, versionInfoUtil, VITE_APP_VERSION_INFO, resolve.dedupe, the @common alias, a blank page after login, and an app that builds without linting.
---

# A new AccxUI app, from an empty folder to a running login

Every app is a Vue 3 + Ionic PWA in `apps/<name>`, **its own git repo** inside the accxui pnpm
workspace (`pnpm-workspace.yaml` already globs `apps/*`). Build it like **Order Manager**
(`apps/order-manager`, the leanest app with an app database); Company is the reference for own
tables and class A/C domains. **Don't copy BOPIS or Fulfillment**: they predate the app database and
the layer rules (**accxui-apps-without-app-db**).

## Rules

1. **Every new app has an app database from the start** (AGENTS.md): at minimum the framework seed
   tables it shows labels from, like Order Manager. *Why:* `useSeedData`, `useLiveEntity`,
   `useProductMaster` and the Settings status card all need it, and adding it later means rewriting
   every store that cached reference data.
2. **Copy the shape below, not another app's extras.** Each app has features (module federation,
   Zebra printing, Shopify embedding, push) that a new app adds only when it needs them, through its
   skill.
3. **The build lints and checks the wiring:** `"build": "eslint src && pnpm check:wiring && vite
   build"` with `eslint.config.js` re-exporting the root `dbConfig`. *Why:* BOPIS and Fulfillment
   build without linting and collected violations.
4. **Dependencies come from the catalog** (`"catalog:"`), installed with `pnpm install` at the accxui
   root (**accxui-dependencies-and-config**). Ask before adding one the catalog doesn't have. The test
   tools (`vitest`, `jsdom`, `@vue/test-utils`) come from the root `package.json`; an app doesn't list
   them.
5. **Framework imports:** `@common` in app code, deep `@common/db/*` paths in `src/db` and
   `src/workers` (**accxui-app-db-setup**). Never copy a framework file into the app.

## Files, in build order

| # | File | Contents (skeletons below) |
|---|---|---|
| 1 | `package.json` | name, version, scripts, `catalog:` dependencies (copy Order Manager's list, drop what you don't use) |
| 2 | `vite.config.ts` | plugins, version base, aliases, `dedupe`, vitest block |
| 3 | `tsconfig.json`, `src/shims-vue.d.ts`, `src/vite-env.d.ts` | Order Manager's, unchanged |
| 4 | `eslint.config.js` | `export default [...dbConfig]` |
| 5 | `index.html`, `manifest.json`, `public/assets/icon/favicon.svg`, `public/robots.txt` | title and names changed. The manifest's `img/icons/*.png` entries need real files (Order Manager lists them but ships none): add them or trim the list |
| 6 | `.env.example` (committed), `.env` (git-ignored) | below |
| 7 | `src/locales/en.json`, `src/locales/index.ts` | `{ "en-US": en }`. Name the English file `en.json`: the i18n key lint looks for exactly that name. Include the keys of the framework components the app renders (`Login`, `DxpOmsInstanceFooter`, `FastTravel`): copy them from Order Manager's `en-US.json`. A missing key with a `{placeholder}` renders raw |
| 8 | `src/authorization/actions.ts` | `APP_*` actions (**accxui-permissions**) |
| 9 | `src/db/appDb.ts`, `src/workers/appSyncDomains.ts`, `src/workers/appSync.worker.ts`, `src/db/appDbSync.ts`, `tests/db/appDbWiring.spec.ts` | **accxui-app-db-setup** (seed tables only to begin with) |
| 10 | `src/store/user.ts` | profile, permissions, login / logout hooks |
| 11 | `src/router/index.ts` | Login route, guard, permission check |
| 12 | `src/main.ts`, `src/App.vue`, `src/components/Menu.vue` | bootstrap and shell |
| 13 | `src/views/Settings.vue` + the first page | **accxui-ui-conventions** has the Settings layout |
| 14 | `tests/setup/i18n.ts` | `createDxpI18n({ "en-US": en })` |
| 15 | `firebase.json`, `.firebaserc`, `.github/workflows/{pull-request,firebase-hosting-merge,firebase-hosting-release}.yml` | Order Manager's, with `app: hotwax/<name>` and `appDir: <name>` |
| 16 | outside the app | add `"<name>"` to the `matrix.app` list in accxui `.github/workflows/pull-request.yml`; a Fast Travel entry (**accxui-fast-travel**); a Launchpad tile (**accxui-launchpad-icon-export**). Separate commits in their repos |

## Skeletons

### `package.json` (scripts)

```json
{
  "name": "inventory-audit",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "eslint src && pnpm check:wiring && vite build",
    "check:wiring": "vitest run tests/db/appDbWiring.spec.ts",
    "preview": "vite preview",
    "test:unit": "vitest run",
    "test:watch": "vitest",
    "lint": "eslint ."
  }
}
```

### `vite.config.ts`

```ts
/// <reference types="vitest" />
import legacy from "@vitejs/plugin-legacy";
import vue from "@vitejs/plugin-vue";
import path from "path";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { versionInfoUtil } from "../../common/utils/versionInfoUtil";
import { commonEnvPlugin } from "../../common/vite/commonEnvPlugin";
import { localApiServerDiscoveryPlugin } from "../../common/vite/localApiServerDiscoveryPlugin";
import pkg from "./package.json";
import manifest from "./manifest.json";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // "" = the root bootstrap build; "vX.Y.Z" = a build served under /vX.Y.Z/ (multi-version hosting).
  // `|| "{}"`: vitest loads this config too, and a fresh clone has no .env (CI copies .env.example).
  const appBuild = JSON.parse(env.VITE_APP_VERSION_CONFIG || "{}").buildVersion;

  return {
    base: appBuild ? `/${appBuild}/` : "/",
    build: { outDir: appBuild ? `dist/${appBuild}` : "dist" },
    plugins: [
      commonEnvPlugin(),                 // root VITE_* (dev login, aliases) while serving only
      vue(),
      legacy(),
      localApiServerDiscoveryPlugin(),   // offers local OMS servers on the login page
      VitePWA({ registerType: "autoUpdate", selfDestroying: true, manifest, devOptions: { enabled: true } }),
    ],
    define: {
      // read by the app's DxpAppVersionInfo; versionInfoUtil is Node-only: never import it in src/
      "import.meta.env.VITE_APP_VERSION_INFO": JSON.stringify(JSON.stringify(versionInfoUtil.getVersionInfo(pkg.version))),
    },
    resolve: {
      dedupe: ["vue", "vue-router", "@ionic/vue", "@ionic/vue-router", "pinia", "vue-i18n"],
      extensions: [".ts", ".tsx", ".mjs", ".js", ".mts", ".jsx", ".json"],
      alias: { "@": path.resolve(__dirname, "src"), "@common": path.resolve(__dirname, "../../common") },
    },
    test: {
      globals: true,
      environment: "jsdom",
      include: ["tests/**/*.spec.ts"],
      exclude: ["node_modules", "dist"],
      setupFiles: ["tests/setup/i18n.ts"],
    },
  };
});
```

Without `dedupe`, the app and `common/` load two copies of Vue / Pinia / Ionic: stores and
`provide`/`inject` silently stop sharing state.

### `eslint.config.js`

```js
import { dbConfig } from "../../eslint.config.js";

// The local-database and layer rules (`dbConfig` in the root eslint.config.js). The build runs this lint first.
export default [...dbConfig];
```

### `.env.example`

```bash
VITE_OMS_TYPE=
VITE_I18N_LOCALE=en-US
VITE_I18N_FALLBACK_LOCALE=en-US
VITE_CACHE_MAX_AGE=3600
VITE_VIEW_SIZE=20
VITE_DEFAULT_LOG_LEVEL=error
VITE_APP_PERMISSION_ID=INVAUDIT_APP_VIEW
# Multi-version hosting. buildVersion: "" = root bootstrap, "vX.Y.Z" = versioned build.
VITE_APP_VERSION_CONFIG={"appId":"INVENTORY_AUDIT","environmentTypeId":"AppEnvDev","buildVersion":""}
```

`appId` and the permission id are created on the server; ask for them. Dev login credentials never go
here (**accxui-dependencies-and-config**).

### `src/store/user.ts`

```ts
import { defineStore } from "pinia";
import { Settings } from "luxon";
import { api, commonUtil, cookieHelper, logger, translate, useAuth } from "@common";
import { startAppDbSync, stopAppDbSync } from "@/db/appDbSync";

export const useUserStore = defineStore("user", {
  state: () => ({
    current: {} as any,
    permissions: [] as string[],
    oms: "",
    appVersion: undefined as string | undefined,   // undefined = not resolved yet; set by the framework
  }),
  getters: {
    hasPermission: (state) => (permissionId: string): boolean => {
      if(!permissionId) {
        return true;
      }
      if(permissionId.includes(" OR ")) {
        return permissionId.split(" OR ").some((part) => useUserStore().hasPermission(part.trim()));
      }
      if(permissionId.includes(" AND ")) {
        return permissionId.split(" AND ").every((part) => useUserStore().hasPermission(part.trim()));
      }

      return state.permissions.includes(permissionId);
    },
  },
  actions: {
    async fetchUserProfile() {
      const resp: any = await api({ url: "admin/user/profile", method: "get" });
      if(commonUtil.hasError(resp)) {
        throw resp.data;
      }
      this.current = resp.data;
      useAuth().updateUserId(this.current.userId);   // without it isAuthenticated stays false
      if(this.current.timeZone) {
        Settings.defaultZone = this.current.timeZone;
      }
    },
    async fetchPermissions() {
      const permissions: string[] = [];
      for(let viewIndex = 0; viewIndex < 50; viewIndex++) {
        const resp: any = await api({ url: "admin/user/permissions", method: "get", params: { viewIndex, viewSize: 200 } });
        const docs = commonUtil.hasError(resp) ? [] : resp.data?.docs ?? [];
        permissions.push(...docs.map((permission: any) => permission.permissionId));
        if(docs.length < 200) {
          break;
        }
      }
      const appPermission = import.meta.env.VITE_APP_PERMISSION_ID;
      if(appPermission && !permissions.includes(appPermission)) {
        const message = "You do not have permission to access the app.";
        commonUtil.showToast(translate(message));
        throw new Error(message);                    // fails the login
      }
      this.permissions = permissions;
    },
    async postLogin() {
      // Every login starts from an empty local database (a stale session may have skipped postLogout).
      await stopAppDbSync().catch((error) => logger.error("Failed to clear the local database on login", error));
      try {
        await this.fetchUserProfile();
        this.oms = cookieHelper().get("oms") || "";
        await this.fetchPermissions();
      } catch (error) {
        useAuth().clearAuth();

        return Promise.reject(error);
      }
      void startAppDbSync();
    },
    async postLogout() {
      await stopAppDbSync().catch(() => { /* never block logout on cleanup */ });
      this.$reset();                                 // and $reset() every other session store
    },
  },
  persist: true,
});
```

### `src/router/index.ts`

```ts
import { createRouter, createWebHistory } from "@ionic/vue-router";
import type { RouteRecordRaw } from "vue-router";
import { commonUtil, Login, translate, useAuth } from "@common";
import Actions from "@/authorization/actions";
import { useUserStore } from "@/store/user";
import Audits from "@/views/Audits.vue";
import Settings from "@/views/Settings.vue";

const authGuard = () => {
  if(!useAuth().isAuthenticated.value) {
    return { path: "/login" };
  }
};

const routes: RouteRecordRaw[] = [
  { path: "/", redirect: "/audits" },
  { path: "/login", name: "Login", component: Login },
  { path: "/audits", name: "Audits", component: Audits, beforeEnter: authGuard, meta: { permissionId: Actions.APP_AUDITS_VIEW } },
  { path: "/settings", name: "Settings", component: Settings, beforeEnter: authGuard },
  { path: "/:pathMatch(.*)*", redirect: "/audits" },
];

const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes });

router.beforeEach((to, from) => {
  if(useAuth().checkAppVersionRedirect()) {
    return false;   // the tenant is pinned to another version: the page reloads there
  }
  if(to.meta.permissionId && !useUserStore().hasPermission(to.meta.permissionId as string)) {
    if(from.path === "/login" || from.path === "/") {
      return { path: "/settings" };
    }
    commonUtil.showToast(translate("You do not have permission to access this page."));

    return { path: from.path };
  }
});

export default router;
```

### `src/main.ts`

```ts
import { createApp, watchEffect } from "vue";
import { IonicVue } from "@ionic/vue";
import { createPinia } from "pinia";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";
import { commonUtil, cookieHelper, createDxpI18n, imagePreview, initialiseConfig, logger } from "@common";
import App from "./App.vue";
import { appDb } from "./db/appDb";
import localeMessages from "./locales";
import router from "./router";
import { useUserStore } from "./store/user";

import "@ionic/vue/css/core.css";
import "@ionic/vue/css/normalize.css";
import "@ionic/vue/css/structure.css";
import "@ionic/vue/css/typography.css";
import "@ionic/vue/css/padding.css";
import "@ionic/vue/css/float-elements.css";
import "@ionic/vue/css/text-alignment.css";
import "@ionic/vue/css/text-transformation.css";
import "@ionic/vue/css/flex-utils.css";
import "@ionic/vue/css/display.css";
import "@ionic/vue/css/palettes/dark.system.css";
import "./theme/variables.css";
import "@common/css/settings.css";
import "@common/css/theme.css";

// Here, not in src/db: keeps commonUtil out of the sync worker chunk.
appDb.setOmsInstanceResolver(() => commonUtil.getOMSInstanceName());

const i18n = createDxpI18n(localeMessages);
const savedLocale = cookieHelper().get("locale");
if(savedLocale && savedLocale in localeMessages) {
  i18n.global.locale.value = savedLocale;
}
watchEffect(() => { document.documentElement.lang = i18n.global.locale.value; });

const app = createApp(App)
  .use(IonicVue, { mode: "md", innerHTMLTemplatesEnabled: true })
  .use(logger, { level: import.meta.env.VITE_DEFAULT_LOG_LEVEL })
  .use(i18n)
  .use(createPinia().use(piniaPluginPersistedstate));

// After pinia: the getters/setters read the user store. Pass every field (it replaces the config).
initialiseConfig({
  postLogin: useUserStore().postLogin,
  postLogout: useUserStore().postLogout,
  get oms() { return useUserStore().oms; },
  set oms(val) { useUserStore().oms = val; },
  get appVersion() { return useUserStore().appVersion; },
  set appVersion(val) { useUserStore().appVersion = val; },
  get current() { return useUserStore().current; },
  set current(val) { useUserStore().current = val; },
  router,
});

app.use(router);
router.isReady().then(() => {
  app.directive("image-preview", imagePreview);   // only if pages use v-image-preview (accxui-ui-conventions)
  app.mount("#app");
});
```

No `registerDomains(...)` here: the domain registry is read only inside the sync worker, which
registers its own (Order Manager's main-thread call is dead code).

### `src/App.vue`

```vue
<template>
  <ion-app>
    <ion-split-pane content-id="main-content" when="lg">
      <Menu v-if="route.name !== 'Login'" />
      <ion-router-outlet id="main-content" />
    </ion-split-pane>
    <FastTravel current-app="inventory-audit" />   <!-- once it has a registry entry (accxui-fast-travel) -->
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet, IonSplitPane, loadingController } from "@ionic/vue";
import { onMounted, onUnmounted, watch } from "vue";
import { useRoute } from "vue-router";
import { emitter, FastTravel, translate, useAuth } from "@common";
import Menu from "@/components/Menu.vue";
import { startAppDbSync } from "@/db/appDbSync";

const route = useRoute();
let loader: HTMLIonLoadingElement | null = null;

// `any`: the framework emitter is an untyped mitt(), and a typed default fails vue-tsc (TS2769).
async function presentLoader(options: any = { message: "", backdropDismiss: true }) {
  if(loader) {
    await loader.dismiss();
  }
  loader = await loadingController.create({
    message: translate(options.message || "Click the backdrop to dismiss."),
    translucent: true,
    backdropDismiss: options.backdropDismiss,
  });
  await loader.present();
}
function dismissLoader() {
  loader?.dismiss();
  loader = null;
}

onMounted(() => {
  emitter.on("presentLoader", presentLoader);
  emitter.on("dismissLoader", dismissLoader);
});
onUnmounted(() => {
  emitter.off("presentLoader", presentLoader);
  emitter.off("dismissLoader", dismissLoader);
});

// A reload restores the session without postLogin: start the sync here too (checkSyncLifecycle checks it).
watch(useAuth().isAuthenticated, (authenticated) => {
  if(authenticated) {
    void startAppDbSync();
  }
}, { immediate: true });
</script>
```

No `useSeedData()` here (lint rejects it in `App.vue`), and no data fetching: pages read the app db.

Settings layout, the status card and the "Go to Launchpad" button are in **accxui-ui-conventions**
and **accxui-seed-data**; drop `standalone-hidden` unless the app defines
`APP_PWA_STANDALONE_ACCESS`.

## Order of checks

1. `pnpm install` at the accxui root (the new app joins the lockfile; commit `pnpm-lock.yaml` with the
   accxui change).
2. `pnpm --filter <name> dev`, log in with a dev alias (`docs/DEV_AUTO_LOGIN.md`): you land on the
   first page, not back on `/login`.
3. DevTools → Application → IndexedDB: `{oms}-<suffix>` exists and the seed tables fill.
4. Log out and back in as another user: nothing from the first user shows.
5. `pnpm test:unit` and `pnpm build` in `apps/<name>`.

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| Copying BOPIS / Fulfillment's shell | store-cached reference data, a build that doesn't lint, `next()` guards | this skeleton |
| `postLogin` without `updateUserId` | valid token, back on `/login` | call it after loading the profile |
| `initialiseConfig` before `.use(pinia)` | `getActivePinia` error at startup | after pinia, as above |
| Sync started only in `postLogin` | nothing syncs after a reload | the `isAuthenticated` watch in `App.vue` |
| No `resolve.dedupe` | two Vue / Pinia copies; state not shared with `common/` | the `dedupe` list |
| `versionInfoUtil` imported in `src/` | Node's `child_process` in the browser bundle | `vite.config` only |
| Locale file named `en-US.json` | the translation-key lint finds no file and checks nothing | `src/locales/en.json` mapped as `"en-US"` |
| Hardcoded `/vX.Y.Z/` or `base` | breaks multi-version hosting | `VITE_APP_VERSION_CONFIG.buildVersion` |
| `api({ baseURL: commonUtil.getMaargURL(), … })` everywhere | noise: Maarg is the default | omit it (**accxui-app-layers**) |
| App not added to the accxui PR workflow matrix | framework PRs never build it | add it |

## Before you finish

- [ ] The files above exist; nothing copied from `common/`; dependencies are `catalog:`.
- [ ] App db with at least its seed tables; wiring spec passes.
- [ ] Login lands on the first page; logout clears every session store and the app db.
- [ ] `pnpm build` (lint + wiring + vite) and `pnpm test:unit` pass in the app.
- [ ] Workflow files, Fast Travel entry and the accxui PR matrix updated (or listed as follow-ups).
