# RMA Returns PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `apps/returns/` Ionic/Vue micro-frontend that demos a happy-path customer return round-tripping between OMS (Moqui) and Shopify, coded against a clean typed REST contract with a pluggable real/stub backend.

**Architecture:** Contract-first. Screens and a Pinia store talk only to a typed `ReturnsService`; an `omsAdapter` (real, via `@common` `api`) or `stubAdapter` (in-memory) satisfies it, chosen by `VITE_RETURNS_BACKEND`. OMS owns Shopify sync; the PWA infers sync state from `ReturnIdentification (SHOPIFY_RTN_ID)` and may trigger an outbound push. Auth/i18n/logging come entirely from `@common`.

**Tech Stack:** Vue 3, Ionic 8, Vite 4, Pinia, vue-i18n, Vitest, Cypress, `@common` shared library.

**Spec:** `docs/superpowers/specs/2026-05-29-rma-returns-pwa-design.md`

---

## File Structure

```
apps/returns/
├── package.json                # workspace member "returns"
├── vite.config.ts              # @ and @common aliases, vitest, port 8101
├── tsconfig.json
├── index.html
├── manifest.json
├── .browserslistrc
├── .eslintrc.js
├── .env.example                # VITE_RETURNS_BACKEND, OMS/Maarg base URLs
├── src/
│   ├── main.ts                 # bootstrap + initialiseConfig
│   ├── App.vue
│   ├── router/index.ts         # authGuard → @common Login.vue, Tabs shell
│   ├── theme/variables.css
│   ├── locales/en.json
│   ├── types/returns.ts        # all domain types (Task 2)
│   ├── util/
│   │   ├── returnable.ts        # pure computeReturnableLines (Task 4)
│   │   └── syncState.ts         # pure resolveSyncState / resolveOrigin (Task 5)
│   ├── services/ReturnsService.ts   # interface + getReturnsService() selector (Task 3)
│   ├── adapters/
│   │   ├── stubAdapter.ts       # in-memory (Task 6)
│   │   └── omsAdapter.ts        # real, via @common api (Task 7)
│   ├── store/
│   │   ├── userStore.ts         # @common initialiseConfig contract (Task 1)
│   │   └── returnsStore.ts      # list/current/sync (Task 8)
│   └── views/
│       ├── Tabs.vue             # (Task 1)
│       ├── Settings.vue         # (Task 1)
│       ├── ReturnsList.vue      # (Task 9)
│       ├── CreateReturn.vue     # (Task 10)
│       └── ReturnDetail.vue     # (Task 11)
└── tests/
    ├── unit/
    │   ├── returnable.spec.ts   # (Task 4)
    │   ├── syncState.spec.ts    # (Task 5)
    │   ├── stubAdapter.spec.ts  # (Task 6)
    │   ├── omsAdapter.spec.ts   # (Task 7)
    │   ├── returnsStore.spec.ts # (Task 8)
    │   └── CreateReturn.spec.ts # (Task 10)
    └── e2e/returns-happy-path.cy.ts  # (Task 12)
```

---

## Task 1: Scaffold the `apps/returns` app

**Files:**
- Create: `apps/returns/package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `manifest.json`, `.browserslistrc`, `.eslintrc.js`, `.env.example`
- Create: `apps/returns/src/main.ts`, `App.vue`, `router/index.ts`, `theme/variables.css`, `locales/en.json`, `store/userStore.ts`, `views/Tabs.vue`, `views/Settings.vue`

- [ ] **Step 1: Create `apps/returns/package.json`**

```json
{
  "name": "returns",
  "version": "1.0.0",
  "private": true,
  "description": "RMA Returns PWA",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "test:e2e": "cypress run",
    "test:unit": "vitest",
    "lint": "eslint ."
  },
  "dependencies": {
    "@ionic/core": "8.4.2",
    "@ionic/vue": "8.4.2",
    "@ionic/vue-router": "8.4.2",
    "axios": "^0.21.1",
    "core-js": "^3.6.5",
    "luxon": "^2.3.0",
    "pinia": "^2.1.7",
    "pinia-plugin-persistedstate": "^3.2.0",
    "vue": "^3.3.0",
    "vue-i18n": "~9.1.6",
    "vue-router": "^4.3.0"
  },
  "devDependencies": {
    "@intlify/vue-i18n-loader": "^2.1.0",
    "@types/luxon": "^3.7.1",
    "@typescript-eslint/eslint-plugin": "~5.26.0",
    "@typescript-eslint/parser": "~5.26.0",
    "@vue/eslint-config-typescript": "^9.1.0",
    "@vue/test-utils": "^2.0.0-0",
    "@vitejs/plugin-legacy": "^4.0.0",
    "@vitejs/plugin-vue": "^4.0.0",
    "cypress": "^13.0.0",
    "eslint": "^7.32.0",
    "eslint-plugin-vue": "^8.0.3",
    "jsdom": "^24.0.0",
    "terser": "^5.16.0",
    "typescript": "~4.7.4",
    "vite": "^4.0.0",
    "vitest": "^1.0.0"
  }
}
```

- [ ] **Step 2: Create `apps/returns/vite.config.ts`** (port 8101 to avoid clashing with order-routing's 8100)

```ts
/// <reference types="vitest" />

import legacy from '@vitejs/plugin-legacy'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig(() => {
  return {
    plugins: [vue(), legacy()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
        '@common': path.resolve(__dirname, '../../common')
      },
    },
    test: {
      globals: true,
      environment: 'jsdom'
    },
    server: {
      port: 8101
    }
  }
})
```

- [ ] **Step 3: Copy boilerplate config from `order-routing`, changing only the name**

Run these from the repo root. Each copies an identical-by-convention file; we edit names afterward.

```bash
cp apps/order-routing/tsconfig.json apps/returns/tsconfig.json
cp apps/order-routing/.browserslistrc apps/returns/.browserslistrc
cp apps/order-routing/.eslintrc.js apps/returns/.eslintrc.js
cp apps/order-routing/manifest.json apps/returns/manifest.json
cp apps/order-routing/index.html apps/returns/index.html
cp apps/order-routing/src/theme/variables.css apps/returns/src/theme/variables.css
```

Then edit `apps/returns/manifest.json` and `apps/returns/index.html`: replace any "order-routing"/"Order Routing"/"Circuit" title/name strings with "Returns" / "RMA Returns". (`tsconfig.json`, `.browserslistrc`, `.eslintrc.js`, `variables.css` need no edits.)

- [ ] **Step 4: Create `apps/returns/.env.example`**

```bash
# Backend adapter: "oms" (live OMS) or "stub" (in-memory demo data)
VITE_RETURNS_BACKEND=stub

# Base URLs (used only when VITE_RETURNS_BACKEND=oms; resolved via @common commonUtil)
VITE_VUE_APP_OMS_API_URL=
VITE_VUE_APP_MAARG_API_URL=
VITE_VUE_APP_DEFAULT_LOG_LEVEL=error
```

- [ ] **Step 5: Create `apps/returns/src/store/userStore.ts`** (minimal `initialiseConfig` contract — no permissions/timezone machinery for the demo)

```ts
import { defineStore } from 'pinia'
import { api, commonUtil, logger, useAuth } from '@common'

export const useUserStore = defineStore('user', {
  state: () => ({
    current: null as any,
    oms: null as any,
  }),
  getters: {
    getUserProfile: (state) => state.current,
    getOms: (state) => state.oms,
  },
  actions: {
    async setOms(oms: any) { this.oms = oms },
    async fetchUserProfile(): Promise<any> {
      try {
        const resp = await api({ url: 'admin/user/profile', method: 'GET', baseURL: commonUtil.getMaargURL() })
        if (commonUtil.hasError(resp)) throw 'Error getting user profile'
        this.current = resp.data
        useAuth().updateUserId(this.current.userId)
        return Promise.resolve(resp.data)
      } catch (error: any) {
        logger.error('fetchUserProfile failed', error)
        return Promise.reject(error)
      }
    },
    async postLogin() {
      await this.fetchUserProfile()
      await this.setOms(commonUtil.getOmsURL())
    },
    async postLogout() { this.$reset() },
  },
  persist: true,
})
```

- [ ] **Step 6: Create `apps/returns/src/views/Tabs.vue`**

```vue
<template>
  <ion-page>
    <ion-tabs>
      <ion-router-outlet></ion-router-outlet>
      <ion-tab-bar slot="bottom">
        <ion-tab-button tab="returns" href="/tabs/returns">
          <ion-icon :icon="receiptOutline" />
          <ion-label>{{ translate("Returns") }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="settings" href="/tabs/settings">
          <ion-icon :icon="settingsOutline" />
          <ion-label>{{ translate("Settings") }}</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  </ion-page>
</template>

<script setup lang="ts">
import { translate } from "@common";
import { IonIcon, IonLabel, IonPage, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs } from "@ionic/vue";
import { receiptOutline, settingsOutline } from "ionicons/icons";
</script>
```

- [ ] **Step 7: Create `apps/returns/src/views/Settings.vue`**

```vue
<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ translate("Settings") }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-list>
        <ion-item lines="none">
          <ion-label>
            <p>{{ translate("Instance") }}</p>
            <h2>{{ userStore.getOms || "—" }}</h2>
          </ion-label>
        </ion-item>
        <ion-item lines="none">
          <ion-label>
            <p>{{ translate("User") }}</p>
            <h2>{{ userStore.getUserProfile?.userId || "—" }}</h2>
          </ion-label>
        </ion-item>
      </ion-list>
      <ion-button expand="block" fill="outline" class="ion-margin" @click="logout">
        {{ translate("Logout") }}
      </ion-button>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { translate, useAuth } from "@common";
import { IonButton, IonContent, IonHeader, IonItem, IonLabel, IonList, IonPage, IonTitle, IonToolbar } from "@ionic/vue";
import { useUserStore } from "@/store/userStore";

const userStore = useUserStore();
function logout() { useAuth().logout(); }
</script>
```

- [ ] **Step 8: Create `apps/returns/src/router/index.ts`**

```ts
import { createRouter, createWebHistory } from "@ionic/vue-router";
import { RouteRecordRaw } from "vue-router";
import Tabs from "@/views/Tabs.vue";
import { useAuth } from "@common";
import Login from "@common/components/Login.vue";

const authGuard = async () => {
  if (!useAuth().isAuthenticated.value) return { path: "/login" };
};

const routes: Array<RouteRecordRaw> = [
  { path: "/", redirect: "/tabs/returns" },
  { path: "/login", component: Login },
  {
    path: "/tabs",
    component: Tabs,
    children: [
      { path: "", redirect: "/tabs/returns" },
      { path: "returns", component: () => import("@/views/ReturnsList.vue"), beforeEnter: authGuard },
      { path: "returns/create", component: () => import("@/views/CreateReturn.vue"), beforeEnter: authGuard },
      { path: "returns/:returnId", component: () => import("@/views/ReturnDetail.vue"), props: true, beforeEnter: authGuard },
      { path: "settings", component: () => import("@/views/Settings.vue"), beforeEnter: authGuard },
    ],
  },
];

const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes });
export default router;
```

- [ ] **Step 9: Create placeholder views so the router resolves** (real content in later tasks)

Create `apps/returns/src/views/ReturnsList.vue`, `CreateReturn.vue`, `ReturnDetail.vue`, each with this body (so the build compiles now):

```vue
<template>
  <ion-page><ion-content>{{ translate("Coming soon") }}</ion-content></ion-page>
</template>
<script setup lang="ts">
import { translate } from "@common";
import { IonContent, IonPage } from "@ionic/vue";
</script>
```

- [ ] **Step 10: Create `apps/returns/src/locales/en.json`**

```json
{
  "Returns": "Returns",
  "Settings": "Settings",
  "Instance": "Instance",
  "User": "User",
  "Logout": "Logout",
  "Coming soon": "Coming soon"
}
```

- [ ] **Step 11: Create `apps/returns/src/App.vue`**

```vue
<template>
  <ion-app>
    <ion-router-outlet />
  </ion-app>
</template>

<script setup lang="ts">
import { IonApp, IonRouterOutlet } from "@ionic/vue";
</script>
```

- [ ] **Step 12: Create `apps/returns/src/main.ts`**

```ts
import { createApp } from "vue";
import App from "./App.vue";
import router from "./router";
import { IonicVue } from "@ionic/vue";

import "@ionic/vue/css/core.css";
import "@ionic/vue/css/normalize.css";
import "@ionic/vue/css/structure.css";
import "@ionic/vue/css/typography.css";
import "@ionic/vue/css/padding.css";
import "@ionic/vue/css/flex-utils.css";
import "@ionic/vue/css/display.css";

import "@common/css/settings.css";
import "@common/css/theme.css";
import "./theme/variables.css";

import { createPinia } from "pinia";
import piniaPluginPersistedstate from "pinia-plugin-persistedstate";
import { logger, createDxpI18n, initialiseConfig } from "@common";
import localeMessages from "./locales/en.json";
import { useUserStore } from "@/store/userStore";

const i18n = createDxpI18n({ en: localeMessages });
const pinia = createPinia().use(piniaPluginPersistedstate);
const app = createApp(App)
  .use(IonicVue, { mode: "md" })
  .use(logger, { level: import.meta.env.VITE_VUE_APP_DEFAULT_LOG_LEVEL })
  .use(router)
  .use(i18n)
  .use(pinia);

initialiseConfig({
  postLogin: useUserStore().postLogin,
  postLogout: useUserStore().postLogout,
  get oms() { return useUserStore().oms; },
  set oms(val) { useUserStore().oms = val; },
  get current() { return useUserStore().current; },
  set current(val) { useUserStore().current = val; },
  router: router,
});

router.isReady().then(() => { app.mount("#app"); });
```

- [ ] **Step 13: Install and verify the app builds**

Run from repo root:
```bash
pnpm install
pnpm --filter returns build
```
Expected: install adds `returns` to the workspace; build completes with no TypeScript errors and emits `apps/returns/dist`.

> If `createDxpI18n` signature differs from the `{ en: localeMessages }` shape, match `apps/order-routing/src/main.ts` exactly (it passes `localeMessages` from `./locales`). Verify against that file before adjusting.

- [ ] **Step 14: Commit**

```bash
git add apps/returns pnpm-lock.yaml
git commit -m "feat(returns): scaffold RMA returns PWA app shell"
```

---

## Task 2: Domain types

**Files:**
- Create: `apps/returns/src/types/returns.ts`

- [ ] **Step 1: Write the types**

```ts
export type SyncTarget = "shopify";
export type SyncState = "not_synced" | "pending" | "synced" | "failed";
export type ReturnOrigin = "pwa" | "shopify";

export interface ReturnItemInput {
  orderItemSeqId: string;
  productId: string;
  returnQuantity: number;
  returnReasonId: string;
}

export interface ReturnSummary {
  returnId: string;
  orderId: string;
  statusId: string;
  entryDate: string;
  origin: ReturnOrigin;
  sync: Record<SyncTarget, SyncState>;
}

export interface ReturnItemDetail {
  orderItemSeqId: string;
  productId: string;
  returnQuantity: number;
  returnReasonId: string;
  returnReasonDesc?: string;
}

export interface ReturnStatus {
  statusId: string;
  statusDate: string;
}

export interface ReturnDetail extends ReturnSummary {
  items: ReturnItemDetail[];
  statuses: ReturnStatus[];
  externalIds: Record<SyncTarget, string | null>;
}

export interface ReturnableLine {
  orderItemSeqId: string;
  productId: string;
  orderedQty: number;
  alreadyReturnedQty: number;
  returnableQty: number;
  unitPrice: number;
}

export interface OrderForReturn {
  orderId: string;
  items: ReturnableLine[];
  billingEmail?: string;
}

export interface ReturnReason {
  returnReasonId: string;
  description: string;
}

export interface CreateReturnInput {
  orderId: string;
  items: ReturnItemInput[];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter returns exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/returns/src/types/returns.ts
git commit -m "feat(returns): domain types for the returns contract"
```

---

## Task 3: `ReturnsService` interface + adapter selector

**Files:**
- Create: `apps/returns/src/services/ReturnsService.ts`

This task defines the contract and the selector. The adapters it imports are created in Tasks 6–7; create thin stubs now so this compiles, then fill them in later.

- [ ] **Step 1: Create placeholder adapter modules so the selector compiles**

Create `apps/returns/src/adapters/stubAdapter.ts`:
```ts
import type { ReturnsService } from "@/services/ReturnsService";
export const stubAdapter: ReturnsService = {} as ReturnsService;
```
Create `apps/returns/src/adapters/omsAdapter.ts`:
```ts
import type { ReturnsService } from "@/services/ReturnsService";
export const omsAdapter: ReturnsService = {} as ReturnsService;
```

- [ ] **Step 2: Write `ReturnsService.ts`**

```ts
import type {
  CreateReturnInput, OrderForReturn, ReturnDetail, ReturnReason,
  ReturnSummary, SyncState, SyncTarget,
} from "@/types/returns";
import { stubAdapter } from "@/adapters/stubAdapter";
import { omsAdapter } from "@/adapters/omsAdapter";

export interface ReturnsService {
  listReturns(p: { pageIndex?: number; pageSize?: number; statusId?: string }): Promise<{ items: ReturnSummary[]; total: number }>;
  getReturn(returnId: string): Promise<ReturnDetail>;
  createReturn(input: CreateReturnInput): Promise<{ returnId: string }>;
  getOrderForReturn(orderId: string): Promise<OrderForReturn>;
  listReturnReasons(): Promise<ReturnReason[]>;
  pushToTarget(returnId: string, target: SyncTarget): Promise<void>;
  getSyncStatus(returnId: string): Promise<Record<SyncTarget, SyncState>>;
}

export function getReturnsService(): ReturnsService {
  const backend = import.meta.env.VITE_RETURNS_BACKEND;
  return backend === "oms" ? omsAdapter : stubAdapter;
}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm --filter returns exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/returns/src/services/ReturnsService.ts apps/returns/src/adapters
git commit -m "feat(returns): ReturnsService contract and adapter selector"
```

---

## Task 4: Pure `computeReturnableLines` (TDD)

**Files:**
- Create: `apps/returns/src/util/returnable.ts`
- Test: `apps/returns/tests/unit/returnable.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { computeReturnableLines } from "@/util/returnable";

const orderItems = [
  { orderItemSeqId: "00001", productId: "P1", quantity: 3, unitPrice: 10 },
  { orderItemSeqId: "00002", productId: "P2", quantity: 1, unitPrice: 25 },
];

describe("computeReturnableLines", () => {
  it("returns full ordered qty when nothing returned yet", () => {
    const lines = computeReturnableLines(orderItems, {});
    expect(lines).toEqual([
      { orderItemSeqId: "00001", productId: "P1", orderedQty: 3, alreadyReturnedQty: 0, returnableQty: 3, unitPrice: 10 },
      { orderItemSeqId: "00002", productId: "P2", orderedQty: 1, alreadyReturnedQty: 0, returnableQty: 1, unitPrice: 25 },
    ]);
  });

  it("subtracts already-returned quantities per orderItemSeqId", () => {
    const lines = computeReturnableLines(orderItems, { "00001": 2 });
    expect(lines[0]).toMatchObject({ alreadyReturnedQty: 2, returnableQty: 1 });
    expect(lines[1]).toMatchObject({ alreadyReturnedQty: 0, returnableQty: 1 });
  });

  it("never returns a negative returnableQty", () => {
    const lines = computeReturnableLines(orderItems, { "00002": 5 });
    expect(lines[1].returnableQty).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter returns test:unit -- returnable`
Expected: FAIL — `computeReturnableLines` is not defined.

- [ ] **Step 3: Implement `apps/returns/src/util/returnable.ts`**

```ts
import type { ReturnableLine } from "@/types/returns";

export interface RawOrderItem {
  orderItemSeqId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
}

/** Pure: compute returnable qty per line by subtracting already-returned quantities. */
export function computeReturnableLines(
  orderItems: RawOrderItem[],
  returnedQtyBySeqId: Record<string, number>
): ReturnableLine[] {
  return orderItems.map((item) => {
    const alreadyReturnedQty = returnedQtyBySeqId[item.orderItemSeqId] ?? 0;
    const returnableQty = Math.max(0, item.quantity - alreadyReturnedQty);
    return {
      orderItemSeqId: item.orderItemSeqId,
      productId: item.productId,
      orderedQty: item.quantity,
      alreadyReturnedQty,
      returnableQty,
      unitPrice: item.unitPrice,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter returns test:unit -- returnable`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/returns/src/util/returnable.ts apps/returns/tests/unit/returnable.spec.ts
git commit -m "feat(returns): pure returnable-quantity computation"
```

---

## Task 5: Pure sync-state resolver (TDD)

**Files:**
- Create: `apps/returns/src/util/syncState.ts`
- Test: `apps/returns/tests/unit/syncState.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { resolveOrigin, resolveSyncState } from "@/util/syncState";

describe("resolveOrigin", () => {
  it("is shopify when a SHOPIFY_RTN_ID identification exists", () => {
    expect(resolveOrigin([{ returnIdentificationTypeId: "SHOPIFY_RTN_ID", idValue: "gid://1" }])).toBe("shopify");
  });
  it("is pwa when no shopify identification exists", () => {
    expect(resolveOrigin([])).toBe("pwa");
  });
});

describe("resolveSyncState", () => {
  it("is synced when a shopify GID is present", () => {
    expect(resolveSyncState({ hasShopifyId: true, origin: "pwa", pushAttempted: false, pushFailed: false })).toBe("synced");
  });
  it("is not_synced for a pwa return with no push attempted", () => {
    expect(resolveSyncState({ hasShopifyId: false, origin: "pwa", pushAttempted: false, pushFailed: false })).toBe("not_synced");
  });
  it("is pending for a pwa return after a push, before the GID lands", () => {
    expect(resolveSyncState({ hasShopifyId: false, origin: "pwa", pushAttempted: true, pushFailed: false })).toBe("pending");
  });
  it("is failed when a push failed", () => {
    expect(resolveSyncState({ hasShopifyId: false, origin: "pwa", pushAttempted: true, pushFailed: true })).toBe("failed");
  });
  it("is pending for a shopify-origin return that has not yet recorded its GID", () => {
    expect(resolveSyncState({ hasShopifyId: false, origin: "shopify", pushAttempted: false, pushFailed: false })).toBe("pending");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter returns test:unit -- syncState`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/returns/src/util/syncState.ts`**

```ts
import type { ReturnOrigin, SyncState } from "@/types/returns";

export interface Identification {
  returnIdentificationTypeId: string;
  idValue: string;
}

export function resolveOrigin(identifications: Identification[]): ReturnOrigin {
  return identifications.some((i) => i.returnIdentificationTypeId === "SHOPIFY_RTN_ID") ? "shopify" : "pwa";
}

export interface SyncStateInput {
  hasShopifyId: boolean;
  origin: ReturnOrigin;
  pushAttempted: boolean;
  pushFailed: boolean;
}

export function resolveSyncState({ hasShopifyId, origin, pushAttempted, pushFailed }: SyncStateInput): SyncState {
  if (hasShopifyId) return "synced";
  if (pushFailed) return "failed";
  if (pushAttempted) return "pending";
  // Shopify-origin returns are mid-ingest until their GID is recorded; PWA returns await a push.
  return origin === "shopify" ? "pending" : "not_synced";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter returns test:unit -- syncState`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/returns/src/util/syncState.ts apps/returns/tests/unit/syncState.spec.ts
git commit -m "feat(returns): pure sync-state and origin resolvers"
```

---

## Task 6: `stubAdapter` (TDD)

**Files:**
- Modify: `apps/returns/src/adapters/stubAdapter.ts`
- Test: `apps/returns/tests/unit/stubAdapter.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { stubAdapter, __resetStub } from "@/adapters/stubAdapter";

describe("stubAdapter", () => {
  beforeEach(() => __resetStub());

  it("seeds one shopify-origin return in the list", async () => {
    const { items, total } = await stubAdapter.listReturns({});
    expect(total).toBeGreaterThanOrEqual(1);
    expect(items.some((r) => r.origin === "shopify")).toBe(true);
  });

  it("looks up an order with returnable lines", async () => {
    const order = await stubAdapter.getOrderForReturn("DEMO-1001");
    expect(order.orderId).toBe("DEMO-1001");
    expect(order.items[0].returnableQty).toBeGreaterThan(0);
  });

  it("creates a pwa-origin return that starts not_synced", async () => {
    const { returnId } = await stubAdapter.createReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
    });
    const detail = await stubAdapter.getReturn(returnId);
    expect(detail.origin).toBe("pwa");
    expect(detail.sync.shopify).toBe("not_synced");
  });

  it("flips pending then synced across polls after a push", async () => {
    const { returnId } = await stubAdapter.createReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
    });
    await stubAdapter.pushToTarget(returnId, "shopify");
    expect((await stubAdapter.getSyncStatus(returnId)).shopify).toBe("pending");
    expect((await stubAdapter.getSyncStatus(returnId)).shopify).toBe("synced");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter returns test:unit -- stubAdapter`
Expected: FAIL — `__resetStub` not exported / methods undefined.

- [ ] **Step 3: Implement `apps/returns/src/adapters/stubAdapter.ts`**

```ts
import type { ReturnsService } from "@/services/ReturnsService";
import type {
  CreateReturnInput, OrderForReturn, ReturnDetail, ReturnReason,
  ReturnSummary, SyncState, SyncTarget,
} from "@/types/returns";

interface StubReturn extends ReturnDetail {
  pushAttempted: boolean;
  pollsUntilSynced: number;
}

const REASONS: ReturnReason[] = [
  { returnReasonId: "RTN_NOT_WANT", description: "No longer wanted" },
  { returnReasonId: "RTN_DEFECTIVE_ITEM", description: "Defective item" },
  { returnReasonId: "RTN_SIZE_EXCHANGE", description: "Wrong size" },
];

const ORDER: OrderForReturn = {
  orderId: "DEMO-1001",
  billingEmail: "demo@example.com",
  items: [
    { orderItemSeqId: "00001", productId: "P1", orderedQty: 2, alreadyReturnedQty: 0, returnableQty: 2, unitPrice: 19.99 },
    { orderItemSeqId: "00002", productId: "P2", orderedQty: 1, alreadyReturnedQty: 0, returnableQty: 1, unitPrice: 49.0 },
  ],
};

let store: Map<string, StubReturn>;
let seq: number;

function seedShopifyReturn(): StubReturn {
  return {
    returnId: "10000",
    orderId: "DEMO-2002",
    statusId: "RETURN_REQUESTED",
    entryDate: "2026-05-28T10:00:00Z",
    origin: "shopify",
    sync: { shopify: "synced" },
    items: [{ orderItemSeqId: "00001", productId: "P9", returnQuantity: 1, returnReasonId: "DEFECTIVE", returnReasonDesc: "Defective item" }],
    statuses: [{ statusId: "RETURN_REQUESTED", statusDate: "2026-05-28T10:00:00Z" }],
    externalIds: { shopify: "gid://shopify/Return/555" },
    pushAttempted: false,
    pollsUntilSynced: 0,
  };
}

export function __resetStub() {
  store = new Map();
  const seed = seedShopifyReturn();
  store.set(seed.returnId, seed);
  seq = 20000;
}
__resetStub();

function toSummary(r: StubReturn): ReturnSummary {
  return { returnId: r.returnId, orderId: r.orderId, statusId: r.statusId, entryDate: r.entryDate, origin: r.origin, sync: r.sync };
}

export const stubAdapter: ReturnsService = {
  async listReturns({ pageIndex = 0, pageSize = 20 }) {
    const all = [...store.values()].map(toSummary);
    const start = pageIndex * pageSize;
    return { items: all.slice(start, start + pageSize), total: all.length };
  },
  async getReturn(returnId) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    const { pushAttempted, pollsUntilSynced, ...detail } = r;
    return detail;
  },
  async createReturn({ orderId, items }: CreateReturnInput) {
    const returnId = String(seq++);
    const now = "2026-05-29T12:00:00Z";
    store.set(returnId, {
      returnId, orderId, statusId: "RETURN_REQUESTED", entryDate: now, origin: "pwa",
      sync: { shopify: "not_synced" },
      items: items.map((i) => ({ ...i, returnReasonDesc: REASONS.find((x) => x.returnReasonId === i.returnReasonId)?.description })),
      statuses: [{ statusId: "RETURN_REQUESTED", statusDate: now }],
      externalIds: { shopify: null },
      pushAttempted: false, pollsUntilSynced: 0,
    });
    return { returnId };
  },
  async getOrderForReturn(orderId) {
    return { ...ORDER, orderId };
  },
  async listReturnReasons() {
    return REASONS;
  },
  async pushToTarget(returnId, _target: SyncTarget) {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    r.pushAttempted = true;
    r.pollsUntilSynced = 1; // one poll shows "pending", the next shows "synced"
    r.sync = { shopify: "pending" };
  },
  async getSyncStatus(returnId): Promise<Record<SyncTarget, SyncState>> {
    const r = store.get(returnId);
    if (!r) throw new Error("Return not found");
    if (r.pushAttempted && r.sync.shopify !== "synced") {
      if (r.pollsUntilSynced > 0) {
        r.pollsUntilSynced -= 1;
        r.sync = { shopify: "pending" };
      } else {
        r.sync = { shopify: "synced" };
        r.externalIds = { shopify: "gid://shopify/Return/999" };
      }
    }
    return r.sync;
  },
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter returns test:unit -- stubAdapter`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/returns/src/adapters/stubAdapter.ts apps/returns/tests/unit/stubAdapter.spec.ts
git commit -m "feat(returns): in-memory stub adapter for demo + tests"
```

---

## Task 7: `omsAdapter` (real backend) + pure mappers (TDD)

**Files:**
- Modify: `apps/returns/src/adapters/omsAdapter.ts`
- Test: `apps/returns/tests/unit/omsAdapter.spec.ts`

We unit-test the pure mapping functions (raw OMS payload → domain types); the adapter methods wire those mappers to `@common` `api`.

- [ ] **Step 1: Write the failing test (mappers only)**

```ts
import { describe, it, expect } from "vitest";
import { mapReturnHeaderToSummary, mapOrderToReturnable } from "@/adapters/omsAdapter";

describe("mapReturnHeaderToSummary", () => {
  it("flags shopify origin and synced when SHOPIFY_RTN_ID identification is present", () => {
    const summary = mapReturnHeaderToSummary({
      returnId: "10000", statusId: "RETURN_REQUESTED", entryDate: "2026-05-28T10:00:00Z",
      orderId: "DEMO-2002",
      returnIdentifications: [{ returnIdentificationTypeId: "SHOPIFY_RTN_ID", idValue: "gid://1" }],
    });
    expect(summary).toMatchObject({ returnId: "10000", origin: "shopify", sync: { shopify: "synced" } });
  });

  it("flags pwa origin and not_synced with no identification", () => {
    const summary = mapReturnHeaderToSummary({
      returnId: "20000", statusId: "RETURN_REQUESTED", entryDate: "2026-05-29T12:00:00Z",
      orderId: "DEMO-1001", returnIdentifications: [],
    });
    expect(summary).toMatchObject({ origin: "pwa", sync: { shopify: "not_synced" } });
  });
});

describe("mapOrderToReturnable", () => {
  it("flattens ship-group items and computes returnable qty", () => {
    const order = mapOrderToReturnable({
      orderDetail: { orderId: "DEMO-1001", billingEmail: "a@b.com" },
      shipGroups: [{ items: [{ orderItemSeqId: "00001", productId: "P1", quantity: 2, unitPrice: 10 }] }],
    });
    expect(order.orderId).toBe("DEMO-1001");
    expect(order.items[0]).toMatchObject({ orderItemSeqId: "00001", returnableQty: 2 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter returns test:unit -- omsAdapter`
Expected: FAIL — mappers not exported.

- [ ] **Step 3: Implement `apps/returns/src/adapters/omsAdapter.ts`**

```ts
import { api, commonUtil } from "@common";
import type { ReturnsService } from "@/services/ReturnsService";
import type {
  CreateReturnInput, OrderForReturn, ReturnDetail, ReturnReason,
  ReturnSummary, SyncState, SyncTarget,
} from "@/types/returns";
import { computeReturnableLines, type RawOrderItem } from "@/util/returnable";
import { resolveOrigin, resolveSyncState, type Identification } from "@/util/syncState";

// ---- Pure mappers (unit-tested) ----

interface RawReturnHeader {
  returnId: string;
  statusId: string;
  entryDate: string;
  orderId?: string;
  returnIdentifications?: Identification[];
}

export function mapReturnHeaderToSummary(h: RawReturnHeader): ReturnSummary {
  const idents = h.returnIdentifications ?? [];
  const origin = resolveOrigin(idents);
  const hasShopifyId = idents.some((i) => i.returnIdentificationTypeId === "SHOPIFY_RTN_ID");
  const shopify: SyncState = resolveSyncState({ hasShopifyId, origin, pushAttempted: false, pushFailed: false });
  return {
    returnId: h.returnId,
    orderId: h.orderId ?? "",
    statusId: h.statusId,
    entryDate: h.entryDate,
    origin,
    sync: { shopify },
  };
}

interface RawOrder {
  orderDetail: { orderId: string; billingEmail?: string };
  shipGroups?: Array<{ items?: RawOrderItem[] }>;
}

export function mapOrderToReturnable(o: RawOrder, returnedQtyBySeqId: Record<string, number> = {}): OrderForReturn {
  const rawItems = (o.shipGroups ?? []).flatMap((g) => g.items ?? []);
  return {
    orderId: o.orderDetail.orderId,
    billingEmail: o.orderDetail.billingEmail,
    items: computeReturnableLines(rawItems, returnedQtyBySeqId),
  };
}

// ---- Adapter (wires mappers to OMS endpoints) ----

export const omsAdapter: ReturnsService = {
  async listReturns({ pageIndex = 0, pageSize = 20, statusId }) {
    const resp: any = await api({
      url: "oms/returns", method: "GET", baseURL: commonUtil.getMaargURL(),
      params: { pageIndex, pageSize, ...(statusId ? { statusId } : {}) },
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to list returns");
    const rows: RawReturnHeader[] = resp.data ?? [];
    const total = Number(resp.headers?.["x-total-count"] ?? rows.length);
    return { items: rows.map(mapReturnHeaderToSummary), total };
  },

  async getReturn(returnId): Promise<ReturnDetail> {
    const resp: any = await api({
      url: `ReturnHeader/${returnId}`, method: "GET", baseURL: commonUtil.getMaargURL(),
      params: { dependents: true },
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to load return");
    const h = resp.data;
    const summary = mapReturnHeaderToSummary(h);
    return {
      ...summary,
      items: (h.returnItems ?? []).map((i: any) => ({
        orderItemSeqId: i.orderItemSeqId, productId: i.productId,
        returnQuantity: Number(i.returnQuantity), returnReasonId: i.returnReasonId,
      })),
      statuses: (h.returnStatuses ?? []).map((s: any) => ({ statusId: s.statusId, statusDate: s.statusDate })),
      externalIds: { shopify: (h.returnIdentifications ?? []).find((i: any) => i.returnIdentificationTypeId === "SHOPIFY_RTN_ID")?.idValue ?? null },
    };
  },

  async createReturn(input: CreateReturnInput) {
    // Assumes composite create#CustomerReturn (backend in progress). One transactional call.
    const resp: any = await api({
      url: "oms/returns", method: "POST", baseURL: commonUtil.getMaargURL(), data: input,
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to create return");
    return { returnId: resp.data.returnId };
  },

  async getOrderForReturn(orderId) {
    const resp: any = await api({
      url: `oms/orders/${orderId}`, method: "GET", baseURL: commonUtil.getMaargURL(),
    });
    if (commonUtil.hasError(resp)) throw new Error("Order not found");
    return mapOrderToReturnable(resp.data);
  },

  async listReturnReasons(): Promise<ReturnReason[]> {
    const resp: any = await api({
      url: "ReturnReason", method: "GET", baseURL: commonUtil.getMaargURL(),
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to load reasons");
    return (resp.data ?? []).map((r: any) => ({ returnReasonId: r.returnReasonId, description: r.description }));
  },

  async pushToTarget(returnId, _target: SyncTarget) {
    // Assumes outbound push#ShopifyReturn endpoint (backend in progress).
    const resp: any = await api({
      url: `oms/returns/${returnId}/push`, method: "POST", baseURL: commonUtil.getMaargURL(),
    });
    if (commonUtil.hasError(resp)) throw new Error("Failed to push to Shopify");
  },

  async getSyncStatus(returnId): Promise<Record<SyncTarget, SyncState>> {
    const detail = await this.getReturn(returnId);
    return detail.sync;
  },
};
```

> NOTE: `oms/returns`, `ReturnHeader/{id}` and `ReturnReason` resolve relative to the base URL. If `commonUtil.getMaargURL()` does not already include the `/rest/s1/...` (service) vs `/rest/e1/...` (entity) prefixes, set the full path in each `url` (e.g. `"rest/e1/ReturnHeader/" + returnId`). Confirm the base-URL shape against `apps/order-routing` service calls before finalizing.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter returns test:unit -- omsAdapter`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/returns/src/adapters/omsAdapter.ts apps/returns/tests/unit/omsAdapter.spec.ts
git commit -m "feat(returns): OMS adapter with pure payload mappers + tests"
```

---

## Task 8: `returnsStore` (Pinia) (TDD)

**Files:**
- Create: `apps/returns/src/store/returnsStore.ts`
- Test: `apps/returns/tests/unit/returnsStore.spec.ts`

- [ ] **Step 1: Write the failing test** (runs against the stub adapter)

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";

vi.stubEnv("VITE_RETURNS_BACKEND", "stub");

import { useReturnsStore } from "@/store/returnsStore";
import { __resetStub } from "@/adapters/stubAdapter";

describe("returnsStore", () => {
  beforeEach(() => { setActivePinia(createPinia()); __resetStub(); });

  it("fetches the returns list", async () => {
    const store = useReturnsStore();
    await store.fetchReturns();
    expect(store.returns.length).toBeGreaterThanOrEqual(1);
    expect(store.total).toBeGreaterThanOrEqual(1);
  });

  it("creates a return and loads it as current", async () => {
    const store = useReturnsStore();
    const returnId = await store.submitReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
    });
    await store.fetchReturn(returnId);
    expect(store.current?.returnId).toBe(returnId);
    expect(store.current?.sync.shopify).toBe("not_synced");
  });

  it("pushes and resolves to synced via polling", async () => {
    const store = useReturnsStore();
    const returnId = await store.submitReturn({
      orderId: "DEMO-1001",
      items: [{ orderItemSeqId: "00001", productId: "P1", returnQuantity: 1, returnReasonId: "RTN_NOT_WANT" }],
    });
    await store.fetchReturn(returnId);
    await store.pushAndPoll(returnId, "shopify", { intervalMs: 0, maxAttempts: 5 });
    expect(store.current?.sync.shopify).toBe("synced");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter returns test:unit -- returnsStore`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/returns/src/store/returnsStore.ts`**

```ts
import { defineStore } from "pinia";
import { logger } from "@common";
import { getReturnsService } from "@/services/ReturnsService";
import type { CreateReturnInput, ReturnDetail, ReturnSummary, SyncState, SyncTarget } from "@/types/returns";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const useReturnsStore = defineStore("returns", {
  state: () => ({
    returns: [] as ReturnSummary[],
    total: 0,
    current: null as ReturnDetail | null,
    loading: false,
  }),
  actions: {
    async fetchReturns(pageIndex = 0, pageSize = 20) {
      this.loading = true;
      try {
        const { items, total } = await getReturnsService().listReturns({ pageIndex, pageSize });
        this.returns = items;
        this.total = total;
      } catch (e) {
        logger.error("fetchReturns failed", e);
        throw e;
      } finally {
        this.loading = false;
      }
    },
    async fetchReturn(returnId: string) {
      this.current = await getReturnsService().getReturn(returnId);
    },
    async submitReturn(input: CreateReturnInput): Promise<string> {
      const { returnId } = await getReturnsService().createReturn(input);
      return returnId;
    },
    async loadOrder(orderId: string) {
      return getReturnsService().getOrderForReturn(orderId);
    },
    async loadReasons() {
      return getReturnsService().listReturnReasons();
    },
    /** Trigger an outbound push, then poll sync status until synced/failed or attempts exhausted. */
    async pushAndPoll(returnId: string, target: SyncTarget, opts = { intervalMs: 3000, maxAttempts: 30 }) {
      const svc = getReturnsService();
      await svc.pushToTarget(returnId, target);
      for (let attempt = 0; attempt < opts.maxAttempts; attempt++) {
        const sync = await svc.getSyncStatus(returnId);
        if (this.current && this.current.returnId === returnId) {
          this.current = { ...this.current, sync };
        }
        const state: SyncState = sync[target];
        if (state === "synced" || state === "failed") return state;
        await sleep(opts.intervalMs);
      }
      return "pending" as SyncState;
    },
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter returns test:unit -- returnsStore`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/returns/src/store/returnsStore.ts apps/returns/tests/unit/returnsStore.spec.ts
git commit -m "feat(returns): returns Pinia store with push-and-poll"
```

---

## Task 9: `ReturnsList.vue` (screen 1)

**Files:**
- Modify: `apps/returns/src/views/ReturnsList.vue`
- Modify: `apps/returns/src/locales/en.json` (add keys)

- [ ] **Step 1: Add locale keys to `apps/returns/src/locales/en.json`**

Add these entries to the JSON object:
```json
{
  "Create return": "Create return",
  "Order": "Order",
  "From Shopify": "From Shopify",
  "Synced": "Synced",
  "Pending": "Pending",
  "Not synced": "Not synced",
  "Failed": "Failed",
  "No returns yet": "No returns yet"
}
```

- [ ] **Step 2: Implement `apps/returns/src/views/ReturnsList.vue`**

```vue
<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ translate("Returns") }}</ion-title>
        <ion-buttons slot="end">
          <ion-button router-link="/tabs/returns/create">
            <ion-icon slot="icon-only" :icon="addOutline" />
          </ion-button>
        </ion-buttons>
      </ion-toolbar>
    </ion-header>
    <ion-content>
      <ion-refresher slot="fixed" @ionRefresh="refresh($event)">
        <ion-refresher-content />
      </ion-refresher>

      <div v-if="!store.returns.length && !store.loading" class="ion-padding ion-text-center">
        {{ translate("No returns yet") }}
      </div>

      <ion-list>
        <ion-item v-for="r in store.returns" :key="r.returnId" :router-link="`/tabs/returns/${r.returnId}`">
          <ion-label>
            <h2>#{{ r.returnId }}</h2>
            <p>{{ translate("Order") }} {{ r.orderId }}</p>
          </ion-label>
          <ion-badge v-if="r.origin === 'shopify'" slot="end" color="tertiary">{{ translate("From Shopify") }}</ion-badge>
          <ion-badge slot="end" :color="syncColor(r.sync.shopify)">{{ syncLabel(r.sync.shopify) }}</ion-badge>
        </ion-item>
      </ion-list>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { translate } from "@common";
import {
  IonBadge, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem,
  IonLabel, IonList, IonPage, IonRefresher, IonRefresherContent, IonTitle, IonToolbar,
} from "@ionic/vue";
import { addOutline } from "ionicons/icons";
import { useReturnsStore } from "@/store/returnsStore";
import type { SyncState } from "@/types/returns";

const store = useReturnsStore();

function syncColor(s: SyncState) {
  return { synced: "success", pending: "warning", failed: "danger", not_synced: "medium" }[s];
}
function syncLabel(s: SyncState) {
  return translate({ synced: "Synced", pending: "Pending", failed: "Failed", not_synced: "Not synced" }[s]);
}
async function refresh(ev: CustomEvent) {
  await store.fetchReturns();
  (ev.target as any).complete();
}

onMounted(() => store.fetchReturns());
</script>
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter returns exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/returns/src/views/ReturnsList.vue apps/returns/src/locales/en.json
git commit -m "feat(returns): returns list screen with origin + sync badges"
```

---

## Task 10: `CreateReturn.vue` (screen 2) + component test

**Files:**
- Modify: `apps/returns/src/views/CreateReturn.vue`
- Modify: `apps/returns/src/locales/en.json`
- Test: `apps/returns/tests/unit/CreateReturn.spec.ts`

- [ ] **Step 1: Add locale keys to `apps/returns/src/locales/en.json`**

```json
{
  "Look up order": "Look up order",
  "Order ID": "Order ID",
  "Order not found": "Order not found",
  "Nothing on this order can be returned": "Nothing on this order can be returned",
  "Reason": "Reason",
  "Submit return": "Submit return",
  "Quantity": "Quantity"
}
```

- [ ] **Step 2: Write the failing component test**

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { setActivePinia, createPinia } from "pinia";
import { mount, flushPromises } from "@vue/test-utils";

vi.stubEnv("VITE_RETURNS_BACKEND", "stub");
vi.mock("@common", () => ({ translate: (s: string) => s, logger: { error: () => {} } }));
vi.mock("vue-router", () => ({ useRouter: () => ({ push: () => {} }) }));

import CreateReturn from "@/views/CreateReturn.vue";
import { __resetStub } from "@/adapters/stubAdapter";

describe("CreateReturn.vue", () => {
  beforeEach(() => { setActivePinia(createPinia()); __resetStub(); });

  it("looks up an order and exposes returnable lines", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    expect((wrapper.vm as any).order.items.length).toBe(2);
    expect((wrapper.vm as any).order.items[0].returnableQty).toBe(2);
  });

  it("submits a return and returns the new id", async () => {
    const wrapper = mount(CreateReturn, { global: { stubs: { "ion-page": false } } });
    (wrapper.vm as any).orderId = "DEMO-1001";
    await (wrapper.vm as any).lookupOrder();
    await flushPromises();
    (wrapper.vm as any).selections["00001"] = { qty: 1, returnReasonId: "RTN_NOT_WANT" };
    const id = await (wrapper.vm as any).submit();
    expect(id).toBeTruthy();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter returns test:unit -- CreateReturn`
Expected: FAIL — component has placeholder body, methods undefined.

- [ ] **Step 4: Implement `apps/returns/src/views/CreateReturn.vue`**

```vue
<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button default-href="/tabs/returns" /></ion-buttons>
        <ion-title>{{ translate("Create return") }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <ion-item>
        <ion-input v-model="orderId" :label="translate('Order ID')" label-placement="stacked" />
        <ion-button slot="end" @click="lookupOrder">{{ translate("Look up order") }}</ion-button>
      </ion-item>

      <p v-if="error" class="ion-padding-start" style="color: var(--ion-color-danger)">{{ translate(error) }}</p>

      <template v-if="order">
        <p v-if="!hasReturnable" class="ion-padding-start">{{ translate("Nothing on this order can be returned") }}</p>
        <ion-list>
          <ion-item v-for="line in order.items" :key="line.orderItemSeqId" :disabled="line.returnableQty === 0">
            <ion-label>
              <h2>{{ line.productId }}</h2>
              <p>{{ translate("Quantity") }}: {{ line.returnableQty }}</p>
            </ion-label>
            <ion-select
              :placeholder="translate('Quantity')" slot="end" style="min-width: 90px"
              :value="selections[line.orderItemSeqId]?.qty ?? 0"
              @ionChange="setQty(line.orderItemSeqId, $event.detail.value)">
              <ion-select-option v-for="n in line.returnableQty + 1" :key="n - 1" :value="n - 1">{{ n - 1 }}</ion-select-option>
            </ion-select>
            <ion-select
              :placeholder="translate('Reason')" slot="end" style="min-width: 140px"
              :value="selections[line.orderItemSeqId]?.returnReasonId"
              @ionChange="setReason(line.orderItemSeqId, $event.detail.value)">
              <ion-select-option v-for="r in reasons" :key="r.returnReasonId" :value="r.returnReasonId">{{ r.description }}</ion-select-option>
            </ion-select>
          </ion-item>
        </ion-list>

        <ion-button expand="block" :disabled="!canSubmit" @click="submit">{{ translate("Submit return") }}</ion-button>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { translate } from "@common";
import {
  IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonInput, IonItem,
  IonLabel, IonList, IonPage, IonSelect, IonSelectOption, IonTitle, IonToolbar,
} from "@ionic/vue";
import { useReturnsStore } from "@/store/returnsStore";
import type { OrderForReturn, ReturnReason } from "@/types/returns";

const router = useRouter();
const store = useReturnsStore();

const orderId = ref("");
const order = ref<OrderForReturn | null>(null);
const reasons = ref<ReturnReason[]>([]);
const error = ref("");
const selections = reactive<Record<string, { qty: number; returnReasonId?: string }>>({});

const hasReturnable = computed(() => !!order.value?.items.some((i) => i.returnableQty > 0));
const canSubmit = computed(() =>
  Object.values(selections).some((s) => s.qty > 0 && s.returnReasonId)
);

async function lookupOrder() {
  error.value = "";
  order.value = null;
  try {
    order.value = await store.loadOrder(orderId.value.trim());
    reasons.value = await store.loadReasons();
  } catch {
    error.value = "Order not found";
  }
}
function setQty(seqId: string, qty: number) {
  selections[seqId] = { ...(selections[seqId] ?? {}), qty };
}
function setReason(seqId: string, returnReasonId: string) {
  selections[seqId] = { qty: selections[seqId]?.qty ?? 0, returnReasonId };
}
async function submit(): Promise<string | undefined> {
  if (!order.value) return;
  const items = Object.entries(selections)
    .filter(([, s]) => s.qty > 0 && s.returnReasonId)
    .map(([orderItemSeqId, s]) => {
      const line = order.value!.items.find((i) => i.orderItemSeqId === orderItemSeqId)!;
      return { orderItemSeqId, productId: line.productId, returnQuantity: s.qty, returnReasonId: s.returnReasonId! };
    });
  if (!items.length) return;
  const returnId = await store.submitReturn({ orderId: order.value.orderId, items });
  router.push(`/tabs/returns/${returnId}`);
  return returnId;
}

defineExpose({ orderId, order, selections, lookupOrder, submit });
</script>
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter returns test:unit -- CreateReturn`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/returns/src/views/CreateReturn.vue apps/returns/tests/unit/CreateReturn.spec.ts apps/returns/src/locales/en.json
git commit -m "feat(returns): create-return screen (order lookup → items → reason → submit)"
```

---

## Task 11: `ReturnDetail.vue` (screen 3) with sync polling

**Files:**
- Modify: `apps/returns/src/views/ReturnDetail.vue`
- Modify: `apps/returns/src/locales/en.json`

- [ ] **Step 1: Add locale keys to `apps/returns/src/locales/en.json`**

```json
{
  "Return": "Return",
  "Status": "Status",
  "Shopify sync": "Shopify sync",
  "Push to Shopify": "Push to Shopify",
  "Retry": "Retry",
  "Shopify return ID": "Shopify return ID"
}
```

- [ ] **Step 2: Implement `apps/returns/src/views/ReturnDetail.vue`**

```vue
<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-buttons slot="start"><ion-back-button default-href="/tabs/returns" /></ion-buttons>
        <ion-title>{{ translate("Return") }} #{{ returnId }}</ion-title>
      </ion-toolbar>
    </ion-header>
    <ion-content class="ion-padding">
      <template v-if="r">
        <ion-item lines="none">
          <ion-label>
            <p>{{ translate("Order") }}</p>
            <h2>{{ r.orderId }}</h2>
          </ion-label>
        </ion-item>
        <ion-item lines="none">
          <ion-label>
            <p>{{ translate("Status") }}</p>
            <h2>{{ r.statusId }}</h2>
          </ion-label>
        </ion-item>

        <ion-list>
          <ion-item v-for="it in r.items" :key="it.orderItemSeqId">
            <ion-label>
              <h2>{{ it.productId }}</h2>
              <p>{{ translate("Quantity") }}: {{ it.returnQuantity }} · {{ it.returnReasonDesc || it.returnReasonId }}</p>
            </ion-label>
          </ion-item>
        </ion-list>

        <ion-card>
          <ion-card-header><ion-card-title>{{ translate("Shopify sync") }}</ion-card-title></ion-card-header>
          <ion-card-content>
            <ion-chip :color="syncColor(r.sync.shopify)">
              <ion-spinner v-if="r.sync.shopify === 'pending'" name="dots" />
              <ion-label>{{ syncLabel(r.sync.shopify) }}</ion-label>
            </ion-chip>
            <p v-if="r.externalIds.shopify">{{ translate("Shopify return ID") }}: {{ r.externalIds.shopify }}</p>

            <ion-button v-if="r.sync.shopify === 'not_synced'" expand="block" :disabled="busy" @click="push">
              {{ translate("Push to Shopify") }}
            </ion-button>
            <ion-button v-if="r.sync.shopify === 'failed'" expand="block" color="danger" :disabled="busy" @click="push">
              {{ translate("Retry") }}
            </ion-button>
          </ion-card-content>
        </ion-card>
      </template>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { translate } from "@common";
import {
  IonBackButton, IonButton, IonButtons, IonCard, IonCardContent, IonCardHeader, IonCardTitle,
  IonChip, IonContent, IonHeader, IonItem, IonLabel, IonList, IonPage, IonSpinner, IonTitle, IonToolbar,
} from "@ionic/vue";
import { useReturnsStore } from "@/store/returnsStore";
import type { SyncState } from "@/types/returns";

const props = defineProps<{ returnId: string }>();
const store = useReturnsStore();
const busy = ref(false);

const r = computed(() => store.current);

function syncColor(s: SyncState) {
  return { synced: "success", pending: "warning", failed: "danger", not_synced: "medium" }[s];
}
function syncLabel(s: SyncState) {
  return translate({ synced: "Synced", pending: "Pending", failed: "Failed", not_synced: "Not synced" }[s]);
}
async function push() {
  busy.value = true;
  try {
    await store.pushAndPoll(props.returnId, "shopify");
  } finally {
    busy.value = false;
  }
}

onMounted(() => store.fetchReturn(props.returnId));
</script>
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter returns exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/returns/src/views/ReturnDetail.vue apps/returns/src/locales/en.json
git commit -m "feat(returns): return detail screen with Shopify sync panel + push/poll"
```

---

## Task 12: E2E happy-path spec (Cypress, against stub)

**Files:**
- Create: `apps/returns/cypress.config.ts`
- Create: `apps/returns/tests/e2e/returns-happy-path.cy.ts`

This spec runs against the dev server with `VITE_RETURNS_BACKEND=stub`. Auth is `@common`'s; for the demo, the spec assumes a logged-in session (or run after manual login). It documents the demo narrative.

- [ ] **Step 1: Create `apps/returns/cypress.config.ts`**

```ts
import { defineConfig } from "cypress";

export default defineConfig({
  e2e: {
    baseUrl: "http://localhost:8101",
    specPattern: "tests/e2e/**/*.cy.ts",
    supportFile: false,
  },
});
```

- [ ] **Step 2: Create `apps/returns/tests/e2e/returns-happy-path.cy.ts`**

```ts
// Demo narrative: create a return → push to Shopify → watch it sync; list shows a Shopify-origin return.
describe("Returns happy path (stub backend)", () => {
  it("creates a return and syncs it to Shopify", () => {
    cy.visit("/tabs/returns/create");
    cy.get("ion-input[label='Order ID'] input").type("DEMO-1001");
    cy.contains("ion-button", "Look up order").click();

    cy.contains("ion-item", "P1").within(() => {
      cy.get("ion-select").first().click();
    });
    cy.get("ion-select-option").contains("1").click();
    // pick a reason on the same line
    cy.contains("ion-item", "P1").find("ion-select").last().click();
    cy.get("ion-select-option").first().click();

    cy.contains("ion-button", "Submit return").click();

    // Lands on detail; push and watch sync
    cy.contains("Shopify sync");
    cy.contains("ion-button", "Push to Shopify").click();
    cy.contains("Synced", { timeout: 15000 });
  });

  it("shows a Shopify-origin return in the list", () => {
    cy.visit("/tabs/returns");
    cy.contains("ion-badge", "From Shopify");
  });
});
```

- [ ] **Step 3: Verify (manual run)**

Run in one terminal: `pnpm --filter returns dev`
Run in another (after logging in once in the browser): `pnpm --filter returns test:e2e`
Expected: both specs pass against the stub. (If auth blocks the e2e run, log in manually first; production-grade auth bypass is out of scope per the spec.)

- [ ] **Step 4: Commit**

```bash
git add apps/returns/cypress.config.ts apps/returns/tests/e2e/returns-happy-path.cy.ts
git commit -m "test(returns): e2e happy-path demo spec against stub backend"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run the full unit suite**

Run: `pnpm --filter returns test:unit`
Expected: all specs pass (returnable, syncState, stubAdapter, omsAdapter, returnsStore, CreateReturn).

- [ ] **Step 2: Typecheck + lint + build**

```bash
pnpm --filter returns exec tsc --noEmit
pnpm --filter returns lint
pnpm --filter returns build
```
Expected: no type errors, no lint errors, build emits `dist`.

- [ ] **Step 3: Manual smoke (stub backend)**

```bash
cp apps/returns/.env.example apps/returns/.env   # VITE_RETURNS_BACKEND=stub
pnpm --filter returns dev
```
Open http://localhost:8101 → log in → confirm: list shows the seeded Shopify-origin return; create a return for `DEMO-1001`; on the detail screen press "Push to Shopify" and watch the badge go Pending → Synced.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A apps/returns
git commit -m "chore(returns): final verification fixes"
```

---

## Backend handoff notes (parallel, not part of this plan)

The `omsAdapter` assumes these endpoints; until they exist, run with `VITE_RETURNS_BACKEND=stub`:
- `POST /oms/returns` → composite `create#CustomerReturn` (header + items, atomic).
- `POST /oms/returns/{id}/push` → outbound `push#ShopifyReturn` (Shopify `returnCreate` mutation).
- `GET /oms/returns/{id}` (or Entity REST `GET /rest/e1/ReturnHeader/{id}?dependents=true`).
- `GET /oms/returnReasons` (or Entity REST `GET /rest/e1/ReturnReason`).
- Confirm `@common` `api` persists `api_key` (not the ~300s JWT) and the base-URL prefix shape (`/rest/s1` vs `/rest/e1`).
- Unpause the Shopify ServiceJobs in the target deployment for the inbound leg to flow.

When the real endpoints land, set `VITE_RETURNS_BACKEND=oms` and re-run the manual smoke against a live instance; adjust the `omsAdapter` URL prefixes per the confirmed base-URL shape.

### Known caveats from the final holistic review (address during backend wiring)

1. **Entity REST base-URL prefix.** `commonUtil.getMaargURL()` returns a `…/rest/s1/` base, but `getReturn` (`ReturnHeader/{id}`) and `listReturnReasons` (`ReturnReason`) are Entity REST and need `/rest/e1/`. Either prepend the correct path in those `omsAdapter` calls (e.g. `url: "rest/e1/ReturnHeader/" + returnId` against the host base) or expose `/oms/returns/{id}` and `/oms/returnReasons` service mounts. The stub is unaffected.

2. **Inbound `pending` is unreachable in the OMS mapper.** In `omsAdapter.mapReturnHeaderToSummary`, `origin` and `hasShopifyId` are both derived from the same `SHOPIFY_RTN_ID` identification, so `origin === "shopify"` ⟺ synced — the `resolveSyncState` "shopify-origin → pending" branch (spec §5, inbound mid-ingest before the GID lands) can never fire. A real inbound return whose `ReturnHeader` exists but whose `SHOPIFY_RTN_ID` row isn't written yet would map as `pwa`/`not_synced`. When wiring the backend, derive `origin` from a distinct signal (order source, or a separate in-progress identification type) rather than from the GID identification itself. Not demo-blocking (the seeded stub Shopify return is already `synced`).

3. **OMS `getReturn` doesn't populate `returnReasonDesc`.** The stub fills it; the OMS path leaves it undefined and the detail view falls back to the raw `returnReasonId`. Join `ReturnReason.description` in the composite/detail service (or map it client-side) for parity.
