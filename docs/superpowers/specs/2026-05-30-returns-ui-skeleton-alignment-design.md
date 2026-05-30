# Returns UI Skeleton Alignment

**Date:** 2026-05-30
**Status:** Design — ready to execute
**Reference app:** `apps/transfers` (v3.0.0, newest catalog-based app)
**Target app:** `apps/returns` (RMA Returns PWA)

## Purpose & Scope

Align the `returns` app to the canonical UI skeleton established by `transfers`, so that
all HotWax company apps share the same **visual shell** and **interaction flow**. This is a
migration guide written for an implementer to execute file by file.

Scope is the full **shell + view patterns + DXP components**:

- **Bootstrap & shell** — `main.ts`, `App.vue`, `Tabs.vue`, `router`
- **Settings page** — profile card + DXP settings sections
- **View patterns** — the canonical list / detail / create page structure
- **DXP components** — the shared `Dxp*` component set (and their store/permission prerequisites)

### What "symmetry" means here

- **UI symmetry (visual):** same shell chrome, same layout grids, same design tokens, same
  empty-state / loading / list-item treatments, same shared components — so two apps placed
  side by side look like the same product.
- **Flow symmetry (interaction):** same navigation model (tabs + top-level detail/create
  routes), same auth flow, same permission gating, same global loader behavior, same
  `data-testid` conventions — so a user (or an e2e test) moves through any app the same way.

## Already-Shared Foundation — do NOT re-do

`returns` already consumes the shared platform. These are **done** and must not be reworked:

- **`@common` package** — `createDxpI18n`, `initialiseConfig`, `logger`, `useAuth`, `translate`,
  `emitter`, `commonUtil`, `Login` are already imported (`apps/returns/src/main.ts`,
  `apps/returns/src/router/index.ts`).
- **Theme CSS** — `@common/css/settings.css` and `@common/css/theme.css` are already imported
  in `main.ts` alongside the local `theme/variables.css`.
- **Pinia + persisted state** — already configured.
- **i18n bootstrap** — `createDxpI18n(localeMessages)` already wired.

### Design tokens — use them, never hardcode

The shared theme (`@common/css/theme.css`) already exposes the tokens the canonical layouts
depend on. They are available in `returns` today; the gap is that `returns` views don't yet
*use* them. Always reach for these instead of literal values:

| Token | Value | Use |
|-------|-------|-----|
| `--spacer-2xs` | 4px | tight gaps |
| `--spacer-xs` | 8px | button margins, section-header padding |
| `--spacer-sm` | 16px | default padding |
| `--spacer-base` | 24px | floating tab-bar offset |
| `--spacer-lg` | 32px | empty-state padding, list bottom padding |
| `--spacer-xl` | 40px | desktop search/filter inset |
| `--border-medium` | (theme) | list-item dividers, section rules |
| `--ion-color-medium` | (theme) | muted/secondary text |

Status colors come from `commonUtil.getStatusColor(...)` — do not invent a local color map.

### Global conventions (apply in every layer)

- **`data-testid` on every interactive / assertable element.** Naming: `<screen>-<thing>-<role>`,
  e.g. `transfers-search-input`, `settings-logout-btn`, `tabs-returns-btn`,
  `orders-row-${id}`. `returns` currently has **none** — add them as each file is touched.
- **Use `onIonViewWillEnter` for data loads**, not `onMounted`. Ionic keeps pages alive in the
  router outlet; `onMounted` only fires once and breaks refresh-on-revisit.
- **Wrap all user-facing strings in `translate(...)`** and add keys to `src/locales/en.json`.
- **Import `router` as the singleton** (`import router from "@/router"`), consistent with the
  existing returns fix in commit `401df89`.

## How to use this guide

Execute layers **in order** — later layers depend on earlier ones (e.g. Layer 5's DXP
components need the stores/permissions introduced in Layers 2–3). Each layer is independently
shippable and ends with an **acceptance checklist**. After each layer, verify with:

```bash
pnpm --filter returns lint
pnpm --filter returns build
pnpm --filter returns test:unit
```

---

## Layer 1 — Bootstrap parity

**Goal:** the app entry and root component behave like every other app — global loader,
timezone, ionic mode, root testids.

### Current state (`returns`)

- `main.ts`: `IonicVue` configured with `mode: "md"` only; no `innerHTMLTemplatesEnabled`.
- `App.vue` (`apps/returns/src/App.vue`): bare shell — just `<ion-app><ion-router-outlet/></ion-app>`.
  No global loader, no timezone init, no `data-testid`.

### Target (`transfers`)

- `main.ts` (`apps/transfers/src/main.ts`): `IonicVue` with `{ mode: "md", innerHTMLTemplatesEnabled: true }`.
- `App.vue` (`apps/transfers/src/App.vue`):
  - `data-testid="app-root"` on `ion-app`, `data-testid="app-router-outlet"` on the outlet.
  - Global loader: `presentLoader` / `dismissLoader` registered on `emitter` in
    `onBeforeMount`, torn down in `onUnmounted`, using `loadingController`.
  - Timezone init in `onMounted`: `Settings.defaultZone = userProfile.timeZone` (luxon).
  - Optional `isAuthenticated` post-login data prefetch (only if `returns` has equivalent stores).

### Steps

1. In `apps/returns/src/main.ts`, set `IonicVue` options to
   `{ mode: "md", innerHTMLTemplatesEnabled: true }`.
2. Rewrite `apps/returns/src/App.vue` to mirror the transfers loader pattern:
   - Import `emitter`, `logger`, `translate` from `@common`; `loadingController` from `@ionic/vue`.
   - Add `presentLoader`/`dismissLoader` and register them on `emitter` in `onBeforeMount`,
     unregister in `onUnmounted`.
   - Add timezone init in `onMounted` from the returns user profile.
   - Add `data-testid="app-root"` and `data-testid="app-router-outlet"`.
3. Omit the product-store prefetch block for now (no product store in `returns` yet — see Layer 5).

### ✅ Acceptance checklist

- [ ] `ion-app` has `data-testid="app-root"`; outlet has `data-testid="app-router-outlet"`.
- [ ] `emitter.emit('presentLoader')` shows a loader; `emitter.emit('dismissLoader')` hides it.
- [ ] A custom loader message passes through `translate(...)`.
- [ ] Listeners are removed in `onUnmounted` (no leak across hot reloads).
- [ ] Luxon `Settings.defaultZone` is set from the user profile when present.
- [ ] `IonicVue` uses `mode: "md"` and `innerHTMLTemplatesEnabled: true`.
- [ ] `pnpm --filter returns build` passes.

---

## Layer 2 — Navigation shell

**Goal:** identical navigation model and chrome — responsive tab bar, permission-gated tabs,
top-level detail/create routes, route-level permission guard.

### Current state (`returns`)

- `Tabs.vue` (`apps/returns/src/views/Tabs.vue`): static bottom tab bar, always visible, no
  `data-testid`, no permission gating, no responsive desktop styling.
- `router` (`apps/returns/src/router/index.ts`): create/detail nested **under** `/tabs`,
  unnamed routes, auth guard only, **no permission gating**.

### Target (`transfers`)

- `Tabs.vue` (`apps/transfers/src/views/Tabs.vue`):
  - Per-tab `data-testid` (`tabs-transfers-btn`, `tabs-settings-btn`, …).
  - `showFooter()` guard so the bar only renders on top-level tab routes.
  - Permission-gated tab via `userStore.hasPermission('...')`.
  - Responsive scoped CSS: full-width on mobile, **floating centered 375px bar** with radius +
    shadow at `min-width: 991px`, offset by `--spacer-base`.
- `router` (`apps/transfers/src/router/index.ts`):
  - Detail/create routes are **top-level** (`/order-detail/:id`, `/create-order`,
    `/bulk-upload`), each with `beforeEnter: authGuard` and `props: true` where they take params.
  - Named routes.
  - `RouteMeta.permissionId` declared via module augmentation.
  - Global `router.beforeEach` that blocks routes whose `meta.permissionId` the user lacks,
    redirecting to settings (silent on login/load) or showing a toast via `commonUtil.showToast`.

### Steps

1. **`Tabs.vue`:** add `data-testid` to each `ion-tab-button`'s label; add a `showFooter()`
   computed/function gating on the top-level tab paths; copy the responsive `<style scoped>`
   block from transfers (the floating-bar `@media (min-width: 991px)` rule). Gate any
   permission-specific tab with `userStore.hasPermission(...)` once permissions exist (Layer 5);
   until then leave returns/settings ungated.
2. **`router`:** move `returns/create` and `returns/:returnId` **out** of the `/tabs` children
   to top-level routes (`/create-return`, `/return-detail/:returnId`) with `beforeEnter: authGuard`
   and `props: true` for the detail route. Update the in-app links accordingly
   (`ReturnsList.vue`, any `router.push`). Name all routes.
3. Add the `declare module 'vue-router' { interface RouteMeta { permissionId?: string } }`
   augmentation and the global `beforeEach` permission guard (mirror transfers), even if no
   route sets `permissionId` yet — it's the shared flow contract.

> **Flow-symmetry note:** moving detail/create to top-level routes is deliberate — it gives the
> full-screen push transition every other app uses, instead of a tab-nested swap. Verify the
> back button returns to the list.

### ✅ Acceptance checklist

- [ ] Each tab button has a `data-testid` following `tabs-<name>-btn`.
- [ ] Tab bar is full-width on mobile and a floating centered 375px bar on desktop (≥991px).
- [ ] Tab bar hides on non-tab routes (detail/create) via `showFooter()`.
- [ ] Create & detail are top-level routes with `authGuard` and full-screen push transition.
- [ ] All routes are named.
- [ ] `RouteMeta.permissionId` is declared and a global `beforeEach` permission guard exists.
- [ ] In-app navigation links updated to the new top-level paths; back button works.
- [ ] `pnpm --filter returns build` passes.

---

## Layer 3 — Settings page

**Goal:** the Settings screen matches the canonical profile-card + sectioned layout.

### Current state (`returns`)

- `Settings.vue` (`apps/returns/src/views/Settings.vue`): a plain `ion-list` showing instance +
  user id and a single Logout button. No profile card, no DXP sections, no `data-testid`.

### Target (`transfers`)

- `Settings.vue` (`apps/transfers/src/views/Settings.vue`):
  - **User-profile card**: avatar (`Image` component) + `userId` / `userFullName`, Logout
    (`data-testid="settings-logout-btn"`, `color="danger"`) and **Go to Launchpad**
    (`data-testid="settings-go-launchpad-btn"`, permission-gated) buttons.
  - **OMS section**: `DxpOmsInstanceNavigator` + `DxpProductStoreSelector`.
  - `DxpAppVersionInfo` (`data-testid="settings-app-version"`).
  - **Section** with `DxpProductIdentifier` + `DxpTimeZoneSwitcher`.
  - Section-grid CSS (`repeat(auto-fill, minmax(300px, 1fr))`), `--padding-bottom: 80px`.

### Steps

1. Rebuild `Settings.vue` around the profile-card layout: card with avatar + user id/name,
   `settings-logout-btn` (danger) wired to the existing `useAuth().logout(...)` →
   `router.replace("/login")` flow, and a `settings-go-launchpad-btn` linking to
   `VITE_LOGIN_URL`.
2. Add the section-grid scoped CSS from transfers.
3. Add the DXP settings components **as their prerequisites land in Layer 5**. Until then,
   keep the existing instance/user rows so the page stays functional, and leave clearly marked
   placeholders (`<!-- DXP: OMS section — added in Layer 5 -->`) where each `Dxp*` component
   will slot in. Do **not** ship empty/broken sections.

### ✅ Acceptance checklist

- [ ] Profile card shows avatar (when available) + user id + full name.
- [ ] Logout button (`settings-logout-btn`, danger) logs out and redirects to `/login`.
- [ ] Go-to-Launchpad button (`settings-go-launchpad-btn`) present (permission-gated once
      permissions exist).
- [ ] Section-grid CSS and `--padding-bottom` applied.
- [ ] DXP section slots are present as marked placeholders (filled in Layer 5), page still works.
- [ ] `pnpm --filter returns build` passes.

---

## Layer 4 — View patterns (list / detail / create)

**Goal:** every screen type follows the canonical structure so list/detail/create flows are
symmetric across apps. The list view is the highest-value target.

### Current state (`returns`)

- `ReturnsList.vue` (`apps/returns/src/views/ReturnsList.vue`): header with title + single add
  button; an `ion-refresher`; a **single** plain empty state ("No returns yet"); a flat
  `ion-list` of items; loads via `onMounted`. No search, no filters, no sort, no
  `.find` grid, no infinite scroll, no FAB, no `data-testid`, minimal CSS.

### Target (`transfers`) — the canonical list view

Reference `apps/transfers/src/views/Transfers.vue`:

- **Header**: `ion-toolbar` + title; on mobile an `ion-menu-button` opens the filters menu
  (`class="mobile-only"`).
- **`.find` grid** (`grid-template-rows: auto auto 1fr`) inside a non-scrolling `ion-content`:
  - `<section class="search">` — `ion-searchbar` (`data-testid="<screen>-search-input"`),
    applies filter on enter.
  - `<aside class="filters">` — filter content component.
  - `<main class="ion-content-scroll-host">` — sort row, divider, results, infinite scroll.
- **Sort row** — `data-testid="<screen>-sort-btn"`, toggles asc/desc with rotating icon.
- **3-state empty/loading block** (this is the key parity item):
  1. **Loading** — `data-testid="<screen>-loading"`, spinner + "Fetching…".
  2. **No results for applied filters** — `data-testid="<screen>-empty"` + `isAnyFilterApplied`,
     message only.
  3. **Truly empty** — icon + heading + explanation + a primary "Create…" button.
- **List items** — `data-testid="<rows>-row-${id}"`, click → detail route; chips for
  facilities, `ion-note` for dates via `commonUtil.formatUtcDate`, `ion-badge` colored via
  `commonUtil.getStatusColor`.
- **Infinite scroll** — `data-testid="<screen>-infinite-scroll"`, `loadMore` paginates;
  shown only when `isScrollable`.
- **FAB** — `ion-fab` bottom/end → create route.
- Loads via `onIonViewWillEnter`.

### Steps

1. **`ReturnsList.vue`** — restructure onto the `.find` grid:
   - Add the search section (`returns-search-input`) wired to the returns store query.
   - Add a filters `aside` (a `ReturnFiltersContent.vue` component — start minimal, e.g. status,
     and grow later) + mobile filters menu via `@common` `Filters`-style menu, or defer the
     `aside` if returns has no filters yet (document the deferral).
   - Replace the single empty state with the **3-state block** (loading / no-results-with-filters
     / truly-empty-with-create-CTA), with the listed `data-testid`s.
   - Convert the loader from `onMounted` → `onIonViewWillEnter`.
   - Keep `ion-refresher` (returns-specific nicety) but add infinite scroll / pagination if the
     returns store supports paging; otherwise document why list is unpaged.
   - Add a FAB → create-return route (consistent with the header add button).
   - Copy the empty-state / list-item / responsive scoped CSS from `Transfers.vue`, using design
     tokens.
2. **`ReturnDetail.vue` / `CreateReturn.vue`** — apply the shared page conventions: `ion-header`
   + `ion-toolbar` + translated title; toolbar action buttons with `data-testid`; form/detail
   body using `--spacer-*` spacing; submit flows surface the global loader via
   `emitter.emit('presentLoader')` / `dismissLoader` (now available from Layer 1) and real API
   errors (consistent with commit `31f929b`).

### ✅ Acceptance checklist

- [ ] List view uses the `.find` grid (search / filters / scrollable main).
- [ ] Searchbar present with `data-testid="returns-search-input"`, applies on enter.
- [ ] **All three** empty/loading states implemented with the correct `data-testid`s.
- [ ] Truly-empty state has icon + heading + explanation + create CTA.
- [ ] List rows have `data-testid="<rows>-row-${id}"`, navigate to detail, use token spacing,
      status badge via `commonUtil.getStatusColor`, dates via `commonUtil.formatUtcDate`.
- [ ] Data loads via `onIonViewWillEnter`.
- [ ] FAB → create route present.
- [ ] Infinite scroll present (or unpaged-list deferral documented in this spec's deferred list).
- [ ] Detail & create pages use the shared header/toolbar/form conventions and the global loader.
- [ ] `pnpm --filter returns build` and existing e2e (`returns-happy-path.cy.ts`) still pass
      (update selectors to the new `data-testid`s).

---

## Layer 5 — DXP component adoption

**Goal:** adopt the shared `Dxp*` settings/util components so the OMS/store/timezone/version
chrome is identical to other apps. **These are app-local in `transfers/src/components/`, not in
`@common`** — they are copied in, and they carry prerequisites.

### Components to adopt (from `apps/transfers/src/components/`)

| Component | Purpose | Prerequisite |
|-----------|---------|--------------|
| `DxpAppVersionInfo.vue` | App version / build info | none (lowest risk — do first) |
| `DxpOmsInstanceNavigator.vue` | Switch/inspect OMS instance | `useUserStore().oms` (returns has this) |
| `DxpTimeZoneSwitcher.vue` | User timezone selection | user profile timezone (Layer 1 init) |
| `DxpProductIdentifier.vue` | Product identifier preference | a product/util store |
| `DxpProductStoreSelector.vue` | Select active product store | **a product store** (returns lacks) |
| `Image.vue` / `Logo.vue` | Avatar / branding | none (Logo also in `@common`) |

### Prerequisites subsection (gate before adopting)

- **Permissions** — `transfers` gates UI on `userStore.hasPermission(...)`. If `returns`' user
  store has no `hasPermission`, add it (port from `transfers/src/store/user`) **before** wiring
  permission-gated tabs (Layer 2) and the launchpad button (Layer 3).
- **Product store** — `DxpProductStoreSelector` and `DxpProductIdentifier` depend on a product
  store (`transfers/src/store/productStore`). `returns` has no product-store concept today.
  **Decision:** if returns genuinely has no product-store dimension, **defer** these two and
  record them in the Deferred list below; do not stub a fake store.

### Steps

1. Add `hasPermission` to the returns user store (if missing); wire the gates deferred from
   Layers 2–3.
2. Copy `DxpAppVersionInfo.vue`, `DxpOmsInstanceNavigator.vue`, `DxpTimeZoneSwitcher.vue` into
   `apps/returns/src/components/`, adjust imports to returns' stores, and slot them into the
   Settings placeholders from Layer 3 (each with its `data-testid`).
3. Copy `Image.vue` (and use it for the profile avatar).
4. For `DxpProductStoreSelector` / `DxpProductIdentifier`: adopt **only if** returns has/should
   have a product store; otherwise add to Deferred.

### ✅ Acceptance checklist

- [ ] `returns/src/components/` exists and holds the adopted `Dxp*` components.
- [ ] Settings shows `DxpAppVersionInfo` (`settings-app-version`), `DxpOmsInstanceNavigator`,
      `DxpTimeZoneSwitcher` with their `data-testid`s.
- [ ] `Image.vue` used for the profile avatar.
- [ ] `hasPermission` exists on the user store; permission-gated tab + launchpad button wired
      (or explicitly documented as ungated because returns defines no permissions yet).
- [ ] Product-store components either adopted (store exists) or listed in Deferred.
- [ ] `pnpm --filter returns build` passes.

---

## Cross-cutting parity checklist (master rollup)

Use this as the final sign-off — every box from Layers 1–5 in one place.

**Shell & bootstrap**
- [ ] `App.vue` global loader via `emitter` + timezone init + root `data-testid`s
- [ ] `IonicVue` `mode: "md"`, `innerHTMLTemplatesEnabled: true`

**Navigation & flow**
- [ ] Responsive floating tab bar (≥991px), `showFooter()` gating, per-tab `data-testid`
- [ ] Top-level named detail/create routes with `authGuard` + push transition
- [ ] `meta.permissionId` + global permission `beforeEach` guard

**Settings**
- [ ] Profile card, danger Logout, Launchpad button, section-grid layout
- [ ] DXP OMS / version / timezone sections

**View patterns**
- [ ] `.find` grid list view: search + filters + scrollable main
- [ ] 3-state empty/loading block with correct `data-testid`s
- [ ] List rows with testids, token spacing, status colors, formatted dates
- [ ] `onIonViewWillEnter` loads; FAB → create; infinite scroll (or documented deferral)
- [ ] Detail/create shared header/toolbar/form conventions + global loader

**Components & conventions**
- [ ] Adopted `Dxp*` components wired into Settings
- [ ] `data-testid` on every interactive/assertable element, named `<screen>-<thing>-<role>`
- [ ] All strings via `translate(...)` with `en.json` keys
- [ ] Design tokens used throughout; no hardcoded spacing/colors

## Out of scope / deferred

Record gaps here as they're discovered so they're tracked, not silently skipped:

- **`DxpProductStoreSelector` / `DxpProductIdentifier`** — deferred unless `returns` gains a
  product-store concept (no backing store today).
- **Permission definitions** — `returns` defines no app permissions yet; the permission guard
  and `meta.permissionId` plumbing is installed for flow symmetry, but no route/tab is gated
  until returns declares permissions.
- **Filters aside on the list view** — if returns has no meaningful filters at adoption time,
  the `.find` grid may ship with search + sort only; the filters `aside` slot stays in the
  markup for later.
- **Bulk upload / CSV import** — transfers-specific; not part of returns.

## Execution order & verification

1. Layer 1 → 2 → 3 → 4 → 5, in order (5's prerequisites unblock the gates deferred in 2–3).
2. After each layer: `pnpm --filter returns lint && pnpm --filter returns build && pnpm --filter returns test:unit`.
3. After Layer 4: update `tests/e2e/returns-happy-path.cy.ts` to the new `data-testid`s and
   re-run `pnpm --filter returns test:e2e`.
4. Final: walk the cross-cutting checklist; place `returns` and `transfers` side by side and
   confirm visual + flow symmetry.
