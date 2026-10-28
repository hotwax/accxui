---
name: accxui-permissions
description: "Use when AccxUI app code (apps/company, apps/order-manager, apps/bopis, apps/fulfillment or a new app) checks what the logged-in user may see or do: gating a route, hiding or disabling a button, filtering menu entries, adding a permission, or the app-access check at login. Triggers include hasPermission, Actions, src/authorization/actions.ts, permissionId, meta.permissionId, requirePermission, fetchPermissions, admin/user/permissions, VITE_APP_PERMISSION_ID, 'You do not have permission to access the app', 'You do not have permission to access this page', COMMON_ADMIN, an OR / AND permission string, and Company's useAuth().hasPermission from composables/useSecurity.ts."
---

# Permissions

Permissions are app-level: each app has the same pieces, and the framework only calls the app's
`postLogin`, where permissions are loaded. Follow the app you're in; a new app copies the pattern below.

## The pieces (every app)

| Piece | Where | What |
|---|---|---|
| Action map | `src/authorization/actions.ts` | `export default { APP_X_VIEW: "PERM_A OR PERM_B", … } as const satisfies Record<string, string>`. The **only** place permission ids appear |
| Loading | `fetchPermissions()` in `src/store/user.ts`, called from `postLogin` | pages `GET admin/user/permissions` (`viewSize: 200`) into `state.permissions: string[]`; persisted with the user store, cleared by `$reset()` in `postLogout` |
| App access | same action | if `VITE_APP_PERMISSION_ID` (e.g. `COMPANY_APP_VIEW`, `ORDERMGR_APP_VIEW`, `BOPIS_APP_VIEW`, `FULFILLMENT_APP_VIEW`) isn't in the list: toast "You do not have permission to access the app." and reject, which fails the login |
| Check | `hasPermission` getter on the user store | `useUserStore().hasPermission(Actions.APP_X)` |

**`hasPermission(value)`**: an empty value is `true` (every logged-in user); `"A OR B"` = any;
`"A AND B"` = all; `OR` splits first, so `"A AND B OR C"` = `(A and B) or C`; no parentheses; no admin
bypass: include the admin permission in the action's value (`"ORDERMGR_VIEW OR ORDERMGR_ADMIN"`).

## Adding a permission check

1. **Add an action** to `src/authorization/actions.ts` (name `APP_<AREA>_<VERB>`), with the server
   permission ids, admin ones included. Never put a raw permission id in a view, route or store.
2. **Gate the route**, the way the app does it:
   - **Order Manager, BOPIS, Fulfillment** (and a new app): `meta: { permissionId: Actions.APP_X_VIEW }` on the route;
     the global `router.beforeEach` sends a denied user back to `from.path` with "You do not have
     permission to access this page.", or to Settings without a toast when coming from `/login` or `/`.
   - **Company**: `beforeEnter: requirePermission(Actions.APP_X_VIEW)` (in `src/router/index.ts`);
     denial toasts and redirects to `/product-store`.
3. **Gate the controls** (below).

```ts
// Order Manager / BOPIS / Fulfillment router
{ path: "/carrier-accounts", component: CarrierAccounts, beforeEnter: authGuard, meta: { permissionId: Actions.APP_CARRIER_ACCOUNTS_VIEW } }

// Company router
{ path: "/carrier-accounts", component: CarrierAccounts, beforeEnter: requirePermission(Actions.APP_CARRIER_ACCOUNTS_VIEW) }
```

## In views

- **Hide** what the user can never use: menu entries, links to pages they can't open, whole cards.
- **Disable** an action on something they can see: Save, Edit, a toggle.
- Compute the flag once in `<script setup>` and use it in the template and the handler (the handler
  returns early too):

```ts
const userStore = useUserStore();
const canEditCarrier = computed(() => userStore.hasPermission(Actions.APP_CARRIER_UPDATE));
async function save() {
  if (!canEditCarrier.value) return;
  // …
}
```

```html
<ion-item v-if="userStore.hasPermission(Actions.APP_CARRIER_ACCOUNTS_VIEW)" router-link="/carrier-accounts">…</ion-item>
<ion-button :disabled="!canEditCarrier" @click="save()">{{ translate("Save") }}</ion-button>
```

- **Company** components read it through `useAuth()` from `@/composables/useSecurity`
  (`{ hasPermission, userProfile }`), so views don't import the store; Menu imports it as `useAppAuth`.
  This is not `@common`'s `useAuth`. Router guards and stores call `useUserStore().hasPermission` directly.
- A store action that must refuse without a permission checks `useUserStore().hasPermission(Actions.X)`
  (Order Manager `store/orderDetail.ts`). Always check through `hasPermission`; `state.permissions` is a
  plain list of permission ids.
- In a PWA window, `:standalone-hidden="!hasPermission(Actions.APP_PWA_STANDALONE_ACCESS)"` hides an
  element when the app runs installed (`[standalone-hidden="true"]` in `common/css/theme.css`).

## Company extras

- `src/config/appPermissions.ts` + `composables/useAppPermissions.ts`: the App Permissions admin screen
  (which permissions each app uses, per user group). Not used for runtime checks.
- Shopify sync screens take capabilities from `getSyncCapabilities` in `composables/useShopify.ts`,
  passing `{ hasPermission: (id) => userStore.hasPermission(id) }`.

## Common mistakes

| Mistake | Result | Fix |
|---|---|---|
| A raw id (`"CARRIER_SETUP_VIEW"`) in a route or view | a second place to change; OR / admin rules skipped | an `Actions.*` entry |
| Assuming admins pass every check | admins denied | list the admin permission in the action |
| Only hiding the button | the handler still runs from elsewhere | also return early in the handler |
| Checking a permission inside a util | a util reading a store (layer rule) | pass the flag in |
| Reading `@common`'s `accxuiConfig.permissions` | it's never filled | the app's user store |
| Mixing the two route styles in one app | two places to look | follow the app's existing style |
| An action with `""` | allowed for every logged-in user | intended only for open screens |
