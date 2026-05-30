# Returns UI Skeleton Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align `apps/returns` to the canonical `apps/transfers` UI skeleton — shared shell, navigation flow, settings layout, list/detail/create view patterns, and DXP components — so all company apps look and flow the same.

**Architecture:** Five ordered layers (bootstrap → navigation → settings → view patterns → DXP components). Store-level behavior (pagination, query, permissions) is built test-first; presentational shell/view/CSS changes are verified by `build` + e2e selector updates. Each task is independently shippable and committed.

**Tech Stack:** Vue 3 `<script setup>` + TypeScript, Ionic Vue 8, Pinia, `@common` shared package, Vitest (unit), Cypress (e2e), pnpm workspace (`pnpm --filter returns <script>`).

**Spec:** `docs/superpowers/specs/2026-05-30-returns-ui-skeleton-alignment-design.md`

**Conventions applied throughout (from the spec):**
- `data-testid` on every interactive/assertable element, named `<screen>-<thing>-<role>`.
- All user-facing strings via `translate(...)`; new keys added to `src/locales/en.json`.
- Data loads via `onIonViewWillEnter`, not `onMounted`.
- `import router from "@/router"` (singleton), never `useRouter()`.
- Use design tokens (`--spacer-*`, `--border-medium`, `--ion-color-medium`); never hardcode spacing/colors.

**Verify after every task:**
```bash
pnpm --filter returns lint && pnpm --filter returns build && pnpm --filter returns test:unit
```

---

## File Structure

**Layer 1 — Bootstrap**
- Modify: `apps/returns/src/main.ts` (IonicVue options)
- Modify: `apps/returns/src/App.vue` (global loader, timezone, testids)

**Layer 2 — Navigation**
- Modify: `apps/returns/src/views/Tabs.vue` (responsive bar, showFooter, testids)
- Modify: `apps/returns/src/router/index.ts` (top-level routes, names, permission guard)
- Modify: `apps/returns/src/views/ReturnsList.vue` (link updates only)
- Create: `apps/returns/src/composables/useMobile.ts` (ported from transfers)

**Layer 3 — Settings**
- Modify: `apps/returns/src/views/Settings.vue` (profile card + section layout + DXP placeholders)

**Layer 4 — View patterns**
- Modify: `apps/returns/src/store/returnsStore.ts` (query state, append pagination, isScrollable)
- Test: `apps/returns/tests/unit/returnsStore.spec.ts` (new)
- Modify: `apps/returns/src/views/ReturnsList.vue` (.find grid, search, sort, 3-state empty, infinite scroll, FAB)
- Create: `apps/returns/src/components/ReturnFiltersContent.vue` (status filter)
- Modify: `apps/returns/src/views/CreateReturn.vue` + `ReturnDetail.vue` (loader + testids)
- Modify: `apps/returns/tests/e2e/returns-happy-path.cy.ts` (new selectors)
- Modify: `apps/returns/src/locales/en.json` (new keys)

**Layer 5 — DXP components**
- Modify: `apps/returns/src/store/userStore.ts` (permissions + hasPermission)
- Test: `apps/returns/tests/unit/userStore.spec.ts` (new)
- Create: `apps/returns/src/components/Dxp*.vue`, `Image.vue` (ported from transfers)
- Modify: `apps/returns/src/views/Settings.vue` (fill DXP slots)
- Modify: `apps/returns/src/views/Tabs.vue` (permission-gate if applicable)

---

## Task 1: Bootstrap — IonicVue options

**Files:**
- Modify: `apps/returns/src/main.ts`

- [ ] **Step 1: Update IonicVue options**

In `apps/returns/src/main.ts`, change:
```ts
  .use(IonicVue, { mode: "md" })
```
to:
```ts
  .use(IonicVue, { mode: "md", innerHTMLTemplatesEnabled: true })
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter returns build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/returns/src/main.ts
git commit -m "feat(returns): enable innerHTMLTemplatesEnabled to match canonical IonicVue config"
```

---

## Task 2: Bootstrap — global loader + timezone in App.vue

**Files:**
- Modify: `apps/returns/src/App.vue`

- [ ] **Step 1: Replace App.vue with the canonical shell**

Replace the entire contents of `apps/returns/src/App.vue` with:
```vue
<template>
  <ion-app data-testid="app-root">
    <ion-router-outlet data-testid="app-router-outlet" />
  </ion-app>
</template>

<script setup lang="ts">
import { computed, onBeforeMount, onMounted, onUnmounted, ref } from "vue";
import { IonApp, IonRouterOutlet, loadingController } from "@ionic/vue";
import { emitter, translate } from "@common";
import { Settings } from "luxon";
import { useUserStore } from "@/store/userStore";

const userProfile = computed(() => useUserStore().getUserProfile);
const loader = ref(null) as any;

async function presentLoader(options: any) {
  const backdropDismiss = options?.backdropDismiss || false;
  // Custom message: drop any existing loader first, else the old message sticks.
  if (options?.message && loader.value) dismissLoader();
  if (!loader.value) {
    loader.value = await loadingController.create({
      message: options?.message
        ? translate(options.message)
        : backdropDismiss
          ? translate("Click the backdrop to dismiss.")
          : translate("Loading..."),
      translucent: true,
      backdropDismiss,
    });
  }
  loader.value.present();
}

function dismissLoader() {
  if (loader.value) {
    loader.value.dismiss();
    loader.value = null as any;
  }
}

onBeforeMount(() => {
  emitter.on("presentLoader", presentLoader);
  emitter.on("dismissLoader", dismissLoader);
});

onMounted(() => {
  // Luxon should render dates in the user's selected timezone, like every other app.
  if (userProfile.value?.timeZone) Settings.defaultZone = userProfile.value.timeZone;
});

onUnmounted(() => {
  emitter.off("presentLoader", presentLoader);
  emitter.off("dismissLoader", dismissLoader);
});
</script>
```

- [ ] **Step 2: Add the two new strings to en.json**

In `apps/returns/src/locales/en.json`, add these keys (keep alphabetical-ish grouping is not required, just valid JSON):
```json
  "Loading...": "Loading...",
  "Click the backdrop to dismiss.": "Click the backdrop to dismiss.",
```

- [ ] **Step 3: Verify build + lint**

Run: `pnpm --filter returns lint && pnpm --filter returns build`
Expected: both pass.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run: `pnpm --filter returns dev`, then in devtools console confirm a loader appears/disappears via the emitter (a view that calls `emitter.emit("presentLoader")` will be added in Task 12). For now confirm the app still boots to the returns list.

- [ ] **Step 5: Commit**

```bash
git add apps/returns/src/App.vue apps/returns/src/locales/en.json
git commit -m "feat(returns): add global loader + timezone init + root testids to App.vue"
```

---

## Task 3: Navigation — port useMobile composable

**Files:**
- Create: `apps/returns/src/composables/useMobile.ts`

- [ ] **Step 1: Create the composable**

Create `apps/returns/src/composables/useMobile.ts` with:
```ts
import { ref, onMounted, onUnmounted } from "vue";

/** Reactive flag: true below the desktop breakpoint. Mirrors the shared transfers composable. */
export function useMobile(breakpoint = 990) {
  const mediaQueryList = window.matchMedia(`(max-width: ${breakpoint}px)`);
  const isMobile = ref(mediaQueryList.matches);

  function updateIsMobile(e: MediaQueryListEvent) {
    isMobile.value = e.matches;
  }

  onMounted(() => mediaQueryList.addEventListener("change", updateIsMobile as EventListener));
  onUnmounted(() => mediaQueryList.removeEventListener("change", updateIsMobile as EventListener));

  return isMobile;
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter returns build`
Expected: build succeeds (composable is unused until Task 11 — acceptable).

- [ ] **Step 3: Commit**

```bash
git add apps/returns/src/composables/useMobile.ts
git commit -m "feat(returns): port useMobile composable for responsive layouts"
```

---

## Task 4: Navigation — responsive tab bar + testids + showFooter

**Files:**
- Modify: `apps/returns/src/views/Tabs.vue`

- [ ] **Step 1: Replace Tabs.vue**

Replace the entire contents of `apps/returns/src/views/Tabs.vue` with:
```vue
<template>
  <ion-page>
    <ion-tabs>
      <ion-router-outlet data-testid="tabs-router-outlet"></ion-router-outlet>
      <ion-tab-bar data-testid="tabs-bottom-bar" slot="bottom" v-if="showFooter()">
        <ion-tab-button tab="returns" href="/tabs/returns">
          <ion-icon :icon="receiptOutline" />
          <ion-label data-testid="tabs-returns-btn">{{ translate("Returns") }}</ion-label>
        </ion-tab-button>
        <ion-tab-button tab="settings" href="/tabs/settings">
          <ion-icon :icon="settingsOutline" />
          <ion-label data-testid="tabs-settings-btn">{{ translate("Settings") }}</ion-label>
        </ion-tab-button>
      </ion-tab-bar>
    </ion-tabs>
  </ion-page>
</template>

<script setup lang="ts">
import { translate } from "@common";
import { IonIcon, IonLabel, IonPage, IonRouterOutlet, IonTabBar, IonTabButton, IonTabs } from "@ionic/vue";
import { receiptOutline, settingsOutline } from "ionicons/icons";
import router from "@/router";

// Only show the tab bar on top-level tab routes (hidden on pushed detail/create pages).
function showFooter() {
  return ["/tabs/returns", "/tabs/settings"].includes(router.currentRoute.value.path);
}
</script>

<style scoped>
ion-tab-bar {
  bottom: 0px;
  width: 100%;
  transition: width .5s ease-in-out, bottom 1s ease-in-out;
}

@media (min-width: 991px) {
  ion-tab-bar {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    bottom: var(--spacer-base);
    width: 375px;
    box-shadow: rgb(0 0 0 / 20%) 0px 3px 1px -2px, rgb(0 0 0 / 14%) 0px 2px 2px 0px, rgb(0 0 0 / 12%) 0px 1px 5px 0px;
    border-radius: 15px;
  }
}
</style>
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter returns build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add apps/returns/src/views/Tabs.vue
git commit -m "feat(returns): responsive floating tab bar + testids + showFooter gating"
```

---

## Task 5: Navigation — top-level routes, names, permission guard

**Files:**
- Modify: `apps/returns/src/router/index.ts`
- Modify: `apps/returns/src/views/ReturnsList.vue` (link only)
- Modify: `apps/returns/src/views/CreateReturn.vue` + `ReturnDetail.vue` (back-button hrefs)

- [ ] **Step 1: Replace router/index.ts**

Replace the entire contents of `apps/returns/src/router/index.ts` with:
```ts
import { createRouter, createWebHistory } from "@ionic/vue-router";
import { RouteRecordRaw } from "vue-router";
import Tabs from "@/views/Tabs.vue";
import { commonUtil, translate, useAuth } from "@common";
import Login from "@common/components/Login.vue";
import { useUserStore } from "@/store/userStore";

declare module "vue-router" {
  interface RouteMeta {
    permissionId?: string;
  }
}

const authGuard = async (to: any) => {
  if (!useAuth().isAuthenticated.value) {
    to.fullPath != "/" && localStorage.setItem("requestedPagePath", to.fullPath);
    return { path: "/login" };
  }
};

const routes: Array<RouteRecordRaw> = [
  { path: "/", redirect: "/tabs/returns" },
  { path: "/login", name: "Login", component: Login },
  {
    path: "/tabs",
    component: Tabs,
    beforeEnter: authGuard,
    children: [
      { path: "", redirect: "/tabs/returns" },
      { path: "returns", name: "Returns", component: () => import("@/views/ReturnsList.vue") },
      { path: "settings", name: "Settings", component: () => import("@/views/Settings.vue") },
    ],
  },
  { path: "/create-return", name: "CreateReturn", component: () => import("@/views/CreateReturn.vue"), beforeEnter: authGuard },
  { path: "/return-detail/:returnId", name: "ReturnDetail", component: () => import("@/views/ReturnDetail.vue"), props: true, beforeEnter: authGuard },
];

const router = createRouter({ history: createWebHistory(import.meta.env.BASE_URL), routes });

// Shared flow contract: block routes the user lacks permission for. No route sets permissionId yet
// (returns defines no permissions), but the guard is installed so the flow matches other apps.
router.beforeEach((to, from) => {
  const userStore = useUserStore();
  if (to.meta.permissionId && !userStore.hasPermission(to.meta.permissionId)) {
    let redirectToPath = from.path;
    if (redirectToPath == "/login" || redirectToPath == "/") redirectToPath = "/tabs/settings";
    else commonUtil.showToast(translate("You do not have permission to access this page"), { position: "top" });
    return { path: redirectToPath };
  }
});

export default router;
```

> NOTE: `userStore.hasPermission` does not exist yet — it is added in Task 13. Until then this guard's branch is never entered (no route has `permissionId`), but `hasPermission` is referenced. To keep the build green now, Task 13 adds the method. If executing strictly in order, the call is only reached when `to.meta.permissionId` is truthy, which never happens before Task 13, so TypeScript is the only concern. Add a temporary store method in Step 2 below to satisfy the type until Task 13 fleshes it out.

- [ ] **Step 2: Add a minimal hasPermission stub to the user store (type-safety bridge)**

In `apps/returns/src/store/userStore.ts`, add to `getters`:
```ts
    // Permission check. Returns defines no permissions yet, so this is permissive;
    // Task 13 replaces it with the real permission-list-backed implementation.
    hasPermission: () => (_permissionId: string): boolean => true,
```

- [ ] **Step 3: Update the create link in ReturnsList.vue**

In `apps/returns/src/views/ReturnsList.vue`, change the header button link:
```vue
        <ion-button router-link="/tabs/returns/create">
```
to:
```vue
        <ion-button router-link="/create-return">
```
And change the list item link:
```vue
        <ion-item v-for="r in store.returns" :key="r.returnId" :router-link="`/tabs/returns/${r.returnId}`">
```
to:
```vue
        <ion-item v-for="r in store.returns" :key="r.returnId" :router-link="`/return-detail/${r.returnId}`">
```

- [ ] **Step 4: Update back-button default hrefs**

In both `apps/returns/src/views/CreateReturn.vue` and `apps/returns/src/views/ReturnDetail.vue`, the back button already uses `default-href="/tabs/returns"` — leave as-is (correct). No change needed; verify by grep:

Run: `grep -n "default-href" apps/returns/src/views/CreateReturn.vue apps/returns/src/views/ReturnDetail.vue`
Expected: both show `default-href="/tabs/returns"`.

- [ ] **Step 5: Update any other create/detail navigation**

Run: `grep -rn "/tabs/returns/create\|/tabs/returns/" apps/returns/src apps/returns/tests`
Expected after fixes: no remaining `/tabs/returns/create` or `/tabs/returns/:id` references in `src/` (the e2e test is updated in Task 12). Fix any stragglers (e.g. a `router.push` in CreateReturn after submit) to `/return-detail/${returnId}`.

- [ ] **Step 6: Verify build + lint**

Run: `pnpm --filter returns lint && pnpm --filter returns build`
Expected: both pass.

- [ ] **Step 7: Commit**

```bash
git add apps/returns/src/router/index.ts apps/returns/src/store/userStore.ts apps/returns/src/views/ReturnsList.vue
git commit -m "feat(returns): top-level named create/detail routes + permission guard scaffold"
```

---

## Task 6: Settings — profile card + section layout + DXP placeholders

**Files:**
- Modify: `apps/returns/src/views/Settings.vue`

- [ ] **Step 1: Replace Settings.vue**

Replace the entire contents of `apps/returns/src/views/Settings.vue` with:
```vue
<template>
  <ion-page>
    <ion-header :translucent="true">
      <ion-toolbar>
        <ion-title>{{ translate("Settings") }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content>
      <div class="user-profile">
        <ion-card>
          <ion-card-header class="ion-no-padding ion-padding-vertical ion-padding-start">
            <ion-card-subtitle>{{ userProfile?.userId }}</ion-card-subtitle>
            <ion-card-title>{{ userProfile?.userFullName || userProfile?.userId }}</ion-card-title>
          </ion-card-header>
          <ion-button data-testid="settings-logout-btn" color="danger" @click="logout()">
            {{ translate("Logout") }}
          </ion-button>
          <ion-button data-testid="settings-go-launchpad-btn" fill="outline" @click="goToLaunchpad()">
            {{ translate("Go to Launchpad") }}
            <ion-icon slot="end" :icon="openOutline" />
          </ion-button>
        </ion-card>
      </div>

      <div class="section-header">
        <h1>{{ translate("OMS") }}</h1>
      </div>
      <section>
        <!-- DXP: OMS instance navigator — added in Task 14 -->
        <ion-item lines="none">
          <ion-label>
            <p>{{ translate("Instance") }}</p>
            <h2>{{ userStore.getOms || "—" }}</h2>
          </ion-label>
        </ion-item>
      </section>

      <hr />

      <!-- DXP: app version info — added in Task 14 -->

      <section>
        <!-- DXP: product identifier + timezone switcher — added in Task 14 -->
      </section>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import {
  IonButton, IonCard, IonCardHeader, IonCardSubtitle, IonCardTitle, IonContent,
  IonHeader, IonIcon, IonItem, IonLabel, IonPage, IonTitle, IonToolbar,
} from "@ionic/vue";
import { computed } from "vue";
import { openOutline } from "ionicons/icons";
import router from "@/router";
import { translate, useAuth } from "@common";
import { useUserStore } from "@/store/userStore";

const userStore = useUserStore();
const userProfile = computed(() => userStore.getUserProfile);

async function logout() {
  const redirectionUrl: any = await useAuth().logout({ isUserUnauthorised: false });
  if (!redirectionUrl) router.replace("/login");
  else window.location.href = redirectionUrl;
}

function goToLaunchpad() {
  window.location.href = `${import.meta.env.VITE_LOGIN_URL}`;
}
</script>

<style scoped>
ion-card > ion-button {
  margin: var(--spacer-xs);
}
section {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  align-items: start;
}
.user-profile {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
}
hr {
  border-top: 1px solid var(--border-medium);
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacer-xs) 10px 0px;
}
ion-content {
  --padding-bottom: 80px;
}
</style>
```

- [ ] **Step 2: Add new strings to en.json**

In `apps/returns/src/locales/en.json`, add:
```json
  "OMS": "OMS",
  "Go to Launchpad": "Go to Launchpad",
  "You do not have permission to access this page": "You do not have permission to access this page",
```

- [ ] **Step 3: Confirm `useAuth().logout` signature accepts the options object**

Run: `grep -n "logout" common/composables/useAuth.ts`
Expected: `logout` accepts an options arg (as used in transfers). If the signature is `logout()` with no args, drop the `{ isUserUnauthorised: false }` argument in Step 1. Adjust if needed.

- [ ] **Step 4: Verify build + lint**

Run: `pnpm --filter returns lint && pnpm --filter returns build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add apps/returns/src/views/Settings.vue apps/returns/src/locales/en.json
git commit -m "feat(returns): canonical Settings layout (profile card + sections + DXP slots)"
```

---

## Task 7: List store — query + isScrollable (test first)

**Files:**
- Modify: `apps/returns/src/store/returnsStore.ts`
- Test: `apps/returns/tests/unit/returnsStore.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/returns/tests/unit/returnsStore.spec.ts`:
```ts
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the service so the store has no real network dependency.
const listReturns = vi.fn();
vi.mock("@/services/ReturnsService", () => ({
  getReturnsService: () => ({ listReturns }),
}));

import { useReturnsStore } from "@/store/returnsStore";

describe("returnsStore pagination + query", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    listReturns.mockReset();
  });

  it("replaces the list on page 0 and appends on later pages", async () => {
    const store = useReturnsStore();
    listReturns.mockResolvedValueOnce({ items: [{ returnId: "A", statusId: "RETURN_REQUESTED", entryDate: "1" }], total: 2 });
    await store.fetchReturns(0);
    expect(store.returns.map((r) => r.returnId)).toEqual(["A"]);

    listReturns.mockResolvedValueOnce({ items: [{ returnId: "B", statusId: "RETURN_REQUESTED", entryDate: "2" }], total: 2 });
    await store.fetchReturns(1);
    expect(store.returns.map((r) => r.returnId)).toEqual(["A", "B"]);
  });

  it("isScrollable is true while fewer items than total are loaded", async () => {
    const store = useReturnsStore();
    listReturns.mockResolvedValueOnce({ items: [{ returnId: "A", statusId: "RETURN_REQUESTED", entryDate: "1" }], total: 2 });
    await store.fetchReturns(0);
    expect(store.isScrollable).toBe(true);

    listReturns.mockResolvedValueOnce({ items: [{ returnId: "B", statusId: "RETURN_REQUESTED", entryDate: "2" }], total: 2 });
    await store.fetchReturns(1);
    expect(store.isScrollable).toBe(false);
  });

  it("passes the status filter from query to the service", async () => {
    const store = useReturnsStore();
    store.query.statusId = "RETURN_REQUESTED";
    listReturns.mockResolvedValueOnce({ items: [], total: 0 });
    await store.fetchReturns(0);
    expect(listReturns).toHaveBeenCalledWith(expect.objectContaining({ statusId: "RETURN_REQUESTED", pageIndex: 0 }));
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `pnpm --filter returns test:unit returnsStore`
Expected: FAIL (`isScrollable`/`query` undefined; append not implemented).

- [ ] **Step 3: Implement store changes**

In `apps/returns/src/store/returnsStore.ts`:

Add to `state`:
```ts
    query: { searchTerm: "", statusId: "" },
```

Add a `getters` block (the store currently has none — add it above `actions`):
```ts
  getters: {
    // More loaded pages are available while we hold fewer rows than the server reports.
    isScrollable: (state) => state.returns.length < state.total,
    // Client-side free-text filter (the list endpoint has no search param): match id/order fields.
    getFilteredReturns: (state) => {
      const term = state.query.searchTerm.trim().toLowerCase();
      if (!term) return state.returns;
      return state.returns.filter((r) =>
        [r.returnId, r.orderName, r.orderId].some((v) => v?.toLowerCase().includes(term)),
      );
    },
  },
```

Replace the `fetchReturns` action with:
```ts
    async fetchReturns(pageIndex = 0, pageSize = 20) {
      this.loading = true;
      try {
        const statusId = this.query.statusId || undefined;
        const { items, total } = await getReturnsService().listReturns({ pageIndex, pageSize, statusId });
        // Page 0 = fresh load (replace); later pages = infinite scroll (append).
        this.returns = pageIndex === 0 ? items : [...this.returns, ...items];
        this.total = total;
      } catch (e) {
        logger.error("fetchReturns failed", e);
        throw e;
      } finally {
        this.loading = false;
      }
    },
    async updateAppliedFilters(value: string, filterName: "searchTerm" | "statusId") {
      this.query[filterName] = value;
      await this.fetchReturns(0);
    },
```

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm --filter returns test:unit returnsStore`
Expected: PASS (3 tests).

- [ ] **Step 5: Verify full unit suite + build**

Run: `pnpm --filter returns test:unit && pnpm --filter returns build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/returns/src/store/returnsStore.ts apps/returns/tests/unit/returnsStore.spec.ts
git commit -m "feat(returns): add query state, append pagination, isScrollable to returns store"
```

---

## Task 8: List view — status filter component

**Files:**
- Create: `apps/returns/src/components/ReturnFiltersContent.vue`

- [ ] **Step 1: Create the filter component**

Create `apps/returns/src/components/ReturnFiltersContent.vue`:
```vue
<template>
  <ion-item lines="none">
    <ion-select
      data-testid="returns-status-filter"
      :label="translate('Status')"
      :value="store.query.statusId"
      interface="popover"
      :placeholder="translate('All')"
      @ionChange="store.updateAppliedFilters($event.detail.value, 'statusId')"
    >
      <ion-select-option value="">{{ translate("All") }}</ion-select-option>
      <ion-select-option v-for="s in statuses" :key="s" :value="s">
        {{ translate(formatStatus(s)) }}
      </ion-select-option>
    </ion-select>
  </ion-item>
</template>

<script setup lang="ts">
import { IonItem, IonSelect, IonSelectOption } from "@ionic/vue";
import { translate } from "@common";
import { useReturnsStore } from "@/store/returnsStore";
import { formatStatus } from "@/util/labels";

const store = useReturnsStore();
// The four known return statuses (matches util/labels STATUS_LABELS).
const statuses = ["RETURN_REQUESTED", "RETURN_RECEIVED", "RETURN_COMPLETED", "RETURN_CANCELLED"];
</script>
```

- [ ] **Step 2: Add new string to en.json**

In `apps/returns/src/locales/en.json`, add:
```json
  "All": "All",
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter returns build`
Expected: build succeeds (component unused until Task 9 — acceptable).

- [ ] **Step 4: Commit**

```bash
git add apps/returns/src/components/ReturnFiltersContent.vue apps/returns/src/locales/en.json
git commit -m "feat(returns): add ReturnFiltersContent status filter component"
```

---

## Task 9: List view — .find grid, search, sort, 3-state empty, infinite scroll, FAB

**Files:**
- Modify: `apps/returns/src/views/ReturnsList.vue`

- [ ] **Step 1: Replace ReturnsList.vue**

Replace the entire contents of `apps/returns/src/views/ReturnsList.vue` with:
```vue
<template>
  <ion-page>
    <ion-header>
      <ion-toolbar>
        <ion-title>{{ translate("Returns") }}</ion-title>
      </ion-toolbar>
    </ion-header>

    <ion-content id="filter-content" :scroll-y="false">
      <div class="find">
        <section class="search">
          <ion-searchbar
            data-testid="returns-search-input"
            :placeholder="translate('Search returns')"
            :value="store.query.searchTerm"
            @ionInput="store.query.searchTerm = $event.target.value"
          />
        </section>

        <aside class="filters">
          <ReturnFiltersContent />
        </aside>

        <main class="ion-content-scroll-host">
          <div class="empty-state" data-testid="returns-loading" v-if="store.loading && !store.returns.length">
            <ion-spinner name="crescent" />
            <p>{{ translate("Fetching returns") }}</p>
          </div>

          <div class="empty-state" data-testid="returns-empty" v-else-if="!filteredReturns.length">
            <template v-if="isAnyFilterApplied">
              <p>{{ translate("No returns found for the applied filters.") }}</p>
            </template>
            <template v-else>
              <ion-icon :icon="receiptOutline" color="medium" />
              <h1>{{ translate("No returns yet") }}</h1>
              <p>{{ translate("No returns were found. Create a return to get started.") }}</p>
              <ion-button fill="outline" @click="router.push('/create-return')">
                {{ translate("Create return") }}
              </ion-button>
            </template>
          </div>

          <template v-else>
            <div
              class="list-item return"
              :data-testid="`returns-row-${r.returnId}`"
              v-for="r in filteredReturns"
              :key="r.returnId"
              @click="router.push(`/return-detail/${r.returnId}`)"
            >
              <ion-item lines="none">
                <ion-label>
                  <template v-if="orderLabel(r)">{{ translate("Order") }} {{ orderLabel(r) }}</template>
                  <template v-else>{{ translate("Return") }} #{{ r.returnId }}</template>
                  <p>{{ translate(formatStatus(r.statusId)) }} · {{ translate("Requested") }} {{ formatDate(r.entryDate) }}</p>
                </ion-label>
              </ion-item>
              <div class="metadata">
                <ion-badge v-if="r.origin === 'shopify'" color="tertiary">{{ translate("From Shopify") }}</ion-badge>
                <ion-badge v-if="r.sync" :color="syncColor(r.sync.shopify)">{{ syncLabel(r.sync.shopify) }}</ion-badge>
              </div>
            </div>
          </template>

          <ion-infinite-scroll
            data-testid="returns-infinite-scroll"
            @ionInfinite="loadMore($event)"
            threshold="100px"
            v-if="store.isScrollable"
          >
            <ion-infinite-scroll-content loading-spinner="crescent" :loading-text="translate('Loading')" />
          </ion-infinite-scroll>
        </main>
      </div>

      <ion-fab vertical="bottom" horizontal="end" slot="fixed">
        <ion-fab-button data-testid="returns-create-fab" @click="router.push('/create-return')">
          <ion-icon :icon="addOutline" />
        </ion-fab-button>
      </ion-fab>
    </ion-content>
  </ion-page>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { translate } from "@common";
import {
  IonBadge, IonButton, IonContent, IonFab, IonFabButton, IonHeader, IonIcon,
  IonInfiniteScroll, IonInfiniteScrollContent, IonItem, IonLabel, IonPage,
  IonSearchbar, IonSpinner, IonTitle, IonToolbar, onIonViewWillEnter,
} from "@ionic/vue";
import { addOutline, receiptOutline } from "ionicons/icons";
import router from "@/router";
import ReturnFiltersContent from "@/components/ReturnFiltersContent.vue";
import { useReturnsStore } from "@/store/returnsStore";
import { formatStatus } from "@/util/labels";
import { formatDate } from "@/util/dates";
import type { ReturnSummary, SyncState } from "@/types/returns";

const store = useReturnsStore();
const filteredReturns = computed(() => store.getFilteredReturns);
const isAnyFilterApplied = computed(() => !!(store.query.searchTerm || store.query.statusId));

// Prefer the customer-facing order name; fall back to the internal order id. Empty -> caller shows the return id.
function orderLabel(r: ReturnSummary) {
  return r.orderName || r.orderId || "";
}
function syncColor(s: SyncState) {
  return { synced: "success", pending: "warning", failed: "danger", not_synced: "medium" }[s];
}
function syncLabel(s: SyncState) {
  return translate({ synced: "Synced", pending: "Pending", failed: "Failed", not_synced: "Not synced" }[s]);
}
async function loadMore(event: any) {
  const nextPage = Math.ceil(store.returns.length / 20);
  await store.fetchReturns(nextPage);
  await event.target.complete();
}

onIonViewWillEnter(() => store.fetchReturns(0));
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--spacer-lg);
}
.empty-state ion-icon {
  font-size: 72px;
  margin-bottom: var(--spacer-md);
}
.empty-state h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
}
.empty-state p {
  color: var(--ion-color-medium);
  max-width: 400px;
  margin-bottom: var(--spacer-lg);
}
.metadata {
  text-align: end;
  margin-inline-end: var(--spacer-sm);
}
.find {
  height: 100%;
  display: grid;
  grid-template-rows: auto auto 1fr;
}
.find main {
  height: 100%;
  overflow-y: auto;
  padding-bottom: var(--spacer-lg);
}
.return {
  border-bottom: var(--border-medium);
  transition: background-color .3s ease;
  cursor: pointer;
}
.return ion-item {
  --background: transparent;
  width: 100%;
}
@media (min-width: 991px) {
  .find {
    grid-template-rows: auto 1fr;
  }
  .find .search {
    margin-inline-start: var(--spacer-xl);
    padding-block-start: var(--spacer-sm);
  }
  .find main {
    overflow-y: scroll;
  }
}
</style>
```

> NOTE on `--spacer-md`: the empty-state CSS references `--spacer-md`. Confirm it exists in `@common/css/theme.css` (the spec token table lists `--spacer-sm` then `--spacer-base`, no `--spacer-md`). If `--spacer-md` is absent, replace `margin-bottom: var(--spacer-md);` with `margin-bottom: var(--spacer-sm);`.

Run: `grep -n "spacer-md" common/css/theme.css`
- If found: leave as-is.
- If not found: change `var(--spacer-md)` → `var(--spacer-sm)` in the style block.

- [ ] **Step 2: Add new strings to en.json**

In `apps/returns/src/locales/en.json`, add:
```json
  "Search returns": "Search returns",
  "Fetching returns": "Fetching returns",
  "No returns found for the applied filters.": "No returns found for the applied filters.",
  "No returns were found. Create a return to get started.": "No returns were found. Create a return to get started.",
  "Loading": "Loading",
```

- [ ] **Step 3: Verify build + lint + unit**

Run: `pnpm --filter returns lint && pnpm --filter returns build && pnpm --filter returns test:unit`
Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add apps/returns/src/views/ReturnsList.vue apps/returns/src/locales/en.json
git commit -m "feat(returns): canonical list view (.find grid, search, 3-state empty, infinite scroll, FAB)"
```

---

## Task 10: Detail + Create — global loader + testids

**Files:**
- Modify: `apps/returns/src/views/CreateReturn.vue`
- Modify: `apps/returns/src/views/ReturnDetail.vue`

- [ ] **Step 1: Add testids to CreateReturn key controls**

In `apps/returns/src/views/CreateReturn.vue` template:
- Order-id input (line ~11): add `data-testid="create-orderid-input"`.
- "Look up order" button (line ~12): add `data-testid="create-lookup-btn"`.
- "Submit return" button (line ~47): add `data-testid="create-submit-btn"`.

- [ ] **Step 2: Import emitter and wrap lookup + submit with the global loader**

In `apps/returns/src/views/CreateReturn.vue`, add `emitter` to the `@common` import:
```ts
import { emitter, translate } from "@common";
```

Replace the existing `lookupOrder` function (lines ~78–87) with:
```ts
async function lookupOrder() {
  error.value = "";
  order.value = null;
  emitter.emit("presentLoader", { message: "Looking up order" });
  try {
    order.value = await store.loadOrder(orderId.value.trim());
    reasons.value = await store.loadReasons();
  } catch (e) {
    error.value = describeApiError(e, "Order not found");
  } finally {
    emitter.emit("dismissLoader");
  }
}
```

Replace the `submit` function's `try` block (lines ~104–110) so it shows the loader **and** uses the new top-level detail route (this also resolves the stale `/tabs/returns/${returnId}` push flagged by Task 5 Step 5):
```ts
  error.value = "";
  emitter.emit("presentLoader", { message: "Submitting return" });
  try {
    const returnId = await store.submitReturn({ orderId: order.value.orderId, items });
    router.push(`/return-detail/${returnId}`);
    return returnId;
  } catch (e) {
    error.value = describeApiError(e, "Failed to create return");
  } finally {
    emitter.emit("dismissLoader");
  }
```

- [ ] **Step 3: Add testids + loader to ReturnDetail**

In `apps/returns/src/views/ReturnDetail.vue`:
- Add `data-testid="detail-push-btn"` to the "Push to Shopify" button and `data-testid="detail-retry-btn"` to the "Retry" button (if present).
- Wrap the push/poll async action with `emitter.emit("presentLoader", { message: "Pushing to Shopify" })` … `finally { emitter.emit("dismissLoader") }`.

- [ ] **Step 4: Add new strings to en.json**

In `apps/returns/src/locales/en.json`, add:
```json
  "Submitting return": "Submitting return",
  "Looking up order": "Looking up order",
  "Pushing to Shopify": "Pushing to Shopify",
```

- [ ] **Step 5: Verify build + lint + unit**

Run: `pnpm --filter returns lint && pnpm --filter returns build && pnpm --filter returns test:unit`
Expected: all pass (note: `CreateReturn.spec.ts` exists — if it asserts on the submit flow, update it for the loader emit; if it breaks, fix the test to mock `emitter`).

- [ ] **Step 6: Commit**

```bash
git add apps/returns/src/views/CreateReturn.vue apps/returns/src/views/ReturnDetail.vue apps/returns/src/locales/en.json apps/returns/tests/unit/CreateReturn.spec.ts
git commit -m "feat(returns): global loader + testids on create/detail views"
```

---

## Task 11: List view — mobile filters menu (responsive)

**Files:**
- Modify: `apps/returns/src/views/ReturnsList.vue`

- [ ] **Step 1: Add the mobile filter menu + header button**

In `apps/returns/src/views/ReturnsList.vue`, wrap the filters in an `ion-menu` for mobile and add a header menu button (mirrors transfers' `Filters` pattern but inline since returns has only one filter group).

Add at the top of `<template>`, before `<ion-header>`:
```vue
    <ion-menu v-if="isMobile" menu-id="returns-filter" content-id="filter-content" type="overlay">
      <ion-header>
        <ion-toolbar>
          <ion-title>{{ translate("Filters") }}</ion-title>
        </ion-toolbar>
      </ion-header>
      <ion-content>
        <ReturnFiltersContent />
      </ion-content>
    </ion-menu>
```

Add a filter button to the header toolbar `<ion-buttons slot="end">`:
```vue
        <ion-buttons slot="end">
          <ion-menu-button menu="returns-filter" class="mobile-only">
            <ion-icon :icon="filterOutline" />
          </ion-menu-button>
        </ion-buttons>
```

Hide the desktop `aside` filters on mobile by gating it:
```vue
        <aside class="filters" v-if="!isMobile">
          <ReturnFiltersContent />
        </aside>
```

- [ ] **Step 2: Update the script block**

Add imports:
```ts
import { IonButtons, IonMenu, IonMenuButton } from "@ionic/vue";
import { filterOutline } from "ionicons/icons";
import { useMobile } from "@/composables/useMobile";
```
Add:
```ts
const isMobile = useMobile();
```

- [ ] **Step 3: Add `.mobile-only` helper + new string**

Confirm `.mobile-only` exists in the shared theme:

Run: `grep -rn "mobile-only" common/css/*.css`
- If found: no CSS needed.
- If not found: add to the `<style scoped>` block:
```css
@media (min-width: 991px) {
  .mobile-only { display: none; }
}
```

In `apps/returns/src/locales/en.json`, add:
```json
  "Filters": "Filters",
```

- [ ] **Step 4: Verify build + lint**

Run: `pnpm --filter returns lint && pnpm --filter returns build`
Expected: both pass.

- [ ] **Step 5: Commit**

```bash
git add apps/returns/src/views/ReturnsList.vue apps/returns/src/locales/en.json
git commit -m "feat(returns): responsive mobile filters menu on returns list"
```

---

## Task 12: Update e2e to new routes + testids

**Files:**
- Modify: `apps/returns/tests/e2e/returns-happy-path.cy.ts`

- [ ] **Step 1: Update the create-flow navigation + selectors**

In `apps/returns/tests/e2e/returns-happy-path.cy.ts`, change:
```ts
    cy.visit("/tabs/returns/create");
```
to:
```ts
    cy.visit("/create-return");
```
Keep the existing content-based assertions, but prefer the new testids where available. For the submit step, optionally switch to:
```ts
    cy.get("[data-testid=create-submit-btn]").click();
```

- [ ] **Step 2: Update the list-view test**

The second test (`cy.visit("/tabs/returns")` → `cy.contains("ion-badge", "From Shopify")`) still works — the list route is unchanged. No edit required unless the badge moved; verify the `From Shopify` badge still renders in the new `.metadata` block (it does — Task 9 preserves it).

- [ ] **Step 3: Verify selectors compile (build) — e2e run is manual**

Run: `pnpm --filter returns build`
Expected: build passes. (Cypress is not installed by default per the test file's header note; running `test:e2e` requires `pnpm --filter returns add -D cypress` + a dev server. Document that the e2e run is a manual verification step, not part of CI here.)

- [ ] **Step 4: Commit**

```bash
git add apps/returns/tests/e2e/returns-happy-path.cy.ts
git commit -m "test(returns): update e2e to top-level create route + testids"
```

---

## Task 13: User store — real permissions + hasPermission (test first)

**Files:**
- Modify: `apps/returns/src/store/userStore.ts`
- Test: `apps/returns/tests/unit/userStore.spec.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/returns/tests/unit/userStore.spec.ts`:
```ts
import { setActivePinia, createPinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@common", () => ({
  api: vi.fn(),
  commonUtil: { getMaargURL: () => "", getOmsURL: () => "", hasError: () => false },
  logger: { error: vi.fn() },
  useAuth: () => ({ updateUserId: vi.fn() }),
}));

import { useUserStore } from "@/store/userStore";

describe("userStore.hasPermission", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("returns false when the permission is not granted", () => {
    const store = useUserStore();
    store.permissions = ["APP_RETURNS_VIEW"];
    expect(store.hasPermission("APP_RETURNS_ADMIN")).toBe(false);
  });

  it("returns true when the permission is granted", () => {
    const store = useUserStore();
    store.permissions = ["APP_RETURNS_VIEW"];
    expect(store.hasPermission("APP_RETURNS_VIEW")).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

Run: `pnpm --filter returns test:unit userStore`
Expected: FAIL (current `hasPermission` stub always returns `true`; `permissions` state missing).

- [ ] **Step 3: Implement real permissions**

In `apps/returns/src/store/userStore.ts`:

Add to `state`:
```ts
    permissions: [] as string[],
```

Replace the temporary getter from Task 5:
```ts
    hasPermission: () => (_permissionId: string): boolean => true,
```
with:
```ts
    hasPermission: (state) => (permissionId: string): boolean => state.permissions.includes(permissionId),
```

In `postLogout` / `$reset` the `permissions` array resets automatically. (If a permissions fetch endpoint exists, populate `this.permissions` inside `postLogin`; otherwise leave empty — returns defines no permissions yet, per the spec's deferred list.)

- [ ] **Step 4: Run the test — verify it passes**

Run: `pnpm --filter returns test:unit userStore`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify full suite + build**

Run: `pnpm --filter returns test:unit && pnpm --filter returns build`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/returns/src/store/userStore.ts apps/returns/tests/unit/userStore.spec.ts
git commit -m "feat(returns): real hasPermission backed by permissions list"
```

---

## Task 14: DXP components — adopt version/OMS/timezone + Image

**Files:**
- Create: `apps/returns/src/components/Image.vue`
- Create: `apps/returns/src/components/DxpAppVersionInfo.vue`
- Create: `apps/returns/src/components/DxpOmsInstanceNavigator.vue`
- Create: `apps/returns/src/components/DxpTimeZoneSwitcher.vue`
- Modify: `apps/returns/src/views/Settings.vue`

> **Prerequisite gate (from spec Layer 5):** Adopt only components whose dependencies returns
> satisfies. `DxpProductStoreSelector` and `DxpProductIdentifier` depend on a product store
> returns does not have — they stay **deferred** (recorded in the spec). This task adopts the
> three store-light components + `Image`.

- [ ] **Step 1: Copy the four component files from transfers**

```bash
cp apps/transfers/src/components/Image.vue apps/returns/src/components/Image.vue
cp apps/transfers/src/components/DxpAppVersionInfo.vue apps/returns/src/components/DxpAppVersionInfo.vue
cp apps/transfers/src/components/DxpOmsInstanceNavigator.vue apps/returns/src/components/DxpOmsInstanceNavigator.vue
cp apps/transfers/src/components/DxpTimeZoneSwitcher.vue apps/returns/src/components/DxpTimeZoneSwitcher.vue
```

- [ ] **Step 2: Reconcile imports/store references in each copied file**

For each copied component, open it and fix imports that point at transfers-only stores/composables:
- Replace `@/store/user` → `@/store/userStore`.
- Remove or adapt references to `@/store/productStore`, `@/store/util`, `useProduct`, etc. If a component's core function depends on a store returns lacks, and it cannot be trivially adapted, **stop and defer that component** (move it to the spec's Deferred list) rather than stubbing.
- `Image.vue` typically depends only on `@common` `DxpShopifyImg` or a plain `<img>` — keep as-is if no app-store import.

Run after each edit: `pnpm --filter returns build` to surface unresolved imports immediately.

- [ ] **Step 3: Fill the DXP slots in Settings.vue**

In `apps/returns/src/views/Settings.vue`:

Replace the OMS-section placeholder comment + inline instance item:
```vue
      <section>
        <!-- DXP: OMS instance navigator — added in Task 14 -->
        <ion-item lines="none">
          <ion-label>
            <p>{{ translate("Instance") }}</p>
            <h2>{{ userStore.getOms || "—" }}</h2>
          </ion-label>
        </ion-item>
      </section>
```
with:
```vue
      <section>
        <DxpOmsInstanceNavigator />
      </section>
```

Replace `<!-- DXP: app version info — added in Task 14 -->` with:
```vue
      <DxpAppVersionInfo data-testid="settings-app-version" />
```

Replace the product-identifier/timezone placeholder section:
```vue
      <section>
        <!-- DXP: product identifier + timezone switcher — added in Task 14 -->
      </section>
```
with (timezone only — product identifier stays deferred):
```vue
      <section>
        <DxpTimeZoneSwitcher data-testid="settings-timezone-switcher" />
      </section>
```

Add the imports to the Settings `<script setup>`:
```ts
import DxpOmsInstanceNavigator from "@/components/DxpOmsInstanceNavigator.vue";
import DxpAppVersionInfo from "@/components/DxpAppVersionInfo.vue";
import DxpTimeZoneSwitcher from "@/components/DxpTimeZoneSwitcher.vue";
```

- [ ] **Step 4: Add the profile avatar using Image.vue**

In `apps/returns/src/views/Settings.vue`, add an avatar to the profile card (inside `ion-card`, before `ion-card-header`), guarded on a profile image field:
```vue
          <ion-avatar slot="start" v-if="userProfile?.partyImageUrl">
            <Image :src="userProfile.partyImageUrl" />
          </ion-avatar>
```
Add imports: `IonAvatar` to the `@ionic/vue` import list and `import Image from "@/components/Image.vue";`. (If the card layout needs the avatar inside an `ion-item`, mirror the transfers Settings markup.)

- [ ] **Step 5: Verify build + lint + unit**

Run: `pnpm --filter returns lint && pnpm --filter returns build && pnpm --filter returns test:unit`
Expected: all pass.

- [ ] **Step 6: Manual smoke**

Run: `pnpm --filter returns dev`, open Settings, confirm version/OMS/timezone render and Logout still works.

- [ ] **Step 7: Commit**

```bash
git add apps/returns/src/components/ apps/returns/src/views/Settings.vue
git commit -m "feat(returns): adopt DXP version/OMS/timezone components + Image in Settings"
```

---

## Task 15: Final parity sweep

**Files:**
- Modify: `docs/superpowers/specs/2026-05-30-returns-ui-skeleton-alignment-design.md` (deferred list updates only)

- [ ] **Step 1: Walk the cross-cutting checklist**

Open the spec's "Cross-cutting parity checklist" and confirm each box against the running app
(`pnpm --filter returns dev`). For each unchecked box, either implement it or record it under the
spec's "Out of scope / deferred" with a one-line reason.

- [ ] **Step 2: Side-by-side visual check**

Run `transfers` and `returns` dev servers; compare the list view, tab bar (mobile + desktop ≥991px), and Settings. Confirm spacing, empty states, and tab-bar float match.

- [ ] **Step 3: Full verification**

Run: `pnpm --filter returns lint && pnpm --filter returns build && pnpm --filter returns test:unit`
Expected: all pass.

- [ ] **Step 4: Commit any deferred-list updates**

```bash
git add docs/superpowers/specs/2026-05-30-returns-ui-skeleton-alignment-design.md
git commit -m "docs(returns): record deferred items from skeleton alignment sweep"
```

---

## Deferred (carried from spec, confirm still deferred at the end)

- `DxpProductStoreSelector`, `DxpProductIdentifier` — need a product store returns lacks.
- Route/tab permission gating — guard installed, but no `permissionId` set until returns defines permissions.
- Free-text server search — list endpoint has no search param; implemented client-side over the loaded page.
- Bulk upload / CSV import — transfers-specific, out of scope.
